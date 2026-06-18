import { Injectable, Logger } from '@nestjs/common';
import { type UploadRejectionReason, MAX_SVG_UPLOAD_BYTES } from '@turkistan/types';
import createDOMPurify, { type DOMPurify } from 'dompurify';
import { JSDOM } from 'jsdom';
import { createHash } from 'node:crypto';
import { optimize } from 'svgo';

/** Thrown when an upload is rejected; `code` maps to a terminal rejection reason. */
export class SvgRejectedError extends Error {
  constructor(
    readonly code: UploadRejectionReason,
    message: string,
  ) {
    super(message);
    this.name = 'SvgRejectedError';
  }
}

export interface SanitizedSvg {
  /** Canonical, optimized, safe SVG. */
  svg: Buffer;
  /** Hex sha256 of the sanitized bytes (for dedupe). */
  checksum: string;
  width: number;
  height: number;
}

// Complexity caps — defend against parse/render blowup and zip/laughs bombs.
const MAX_ELEMENTS = 10_000;
const MAX_DEPTH = 100;
const MAX_PATH_DATA_CHARS = 1_000_000;

// Leading magic bytes of common non-SVG formats (renamed-binary / polyglot guard).
const BINARY_SIGNATURES: ReadonlyArray<readonly number[]> = [
  [0x89, 0x50, 0x4e, 0x47], // PNG
  [0xff, 0xd8, 0xff], // JPEG
  [0x47, 0x49, 0x46], // GIF
  [0x25, 0x50, 0x44, 0x46], // %PDF
  [0x50, 0x4b, 0x03, 0x04], // ZIP / PK
  [0x1f, 0x8b], // gzip
  [0x42, 0x4d], // BMP
];

const EVENT_HANDLER_ATTRS = [
  'onload',
  'onclick',
  'onmouseover',
  'onerror',
  'onbegin',
  'onend',
  'onrepeat',
  'onactivate',
  'onfocusin',
  'onfocusout',
];

// Post-sanitize tripwires (defense in depth — these should already be gone).
const MALICIOUS_PATTERNS: ReadonlyArray<readonly [RegExp, UploadRejectionReason]> = [
  [/<script[\s>]/i, 'unsafe_content'],
  [/<foreignObject[\s>]/i, 'unsafe_content'],
  [/\son\w+\s*=/i, 'unsafe_content'],
  [/javascript:/i, 'unsafe_content'],
  [/<!ENTITY/i, 'unsafe_content'],
  [/<!DOCTYPE/i, 'unsafe_content'],
];

/**
 * Sanitizes an untrusted SVG into a safe, canonical form. DOMPurify (jsdom, SVG
 * profile) + an explicit allowlist is the **security boundary**; svgo is only
 * optimization. See docs/SECURITY.md §1 and docs/UPLOAD-PIPELINE.md §4. Every
 * uploaded SVG is hostile until it passes through here.
 */
@Injectable()
export class SvgSanitizerService {
  private readonly logger = new Logger(SvgSanitizerService.name);
  private readonly purify: DOMPurify;

  constructor() {
    const { window } = new JSDOM('');
    this.purify = createDOMPurify(window as unknown as Window & typeof globalThis);

    // Strip any non-fragment href/xlink:href (blocks SSRF / remote fetch / tracking).
    this.purify.addHook('afterSanitizeAttributes', (node) => {
      const el = node as Element;
      for (const attr of ['href', 'xlink:href']) {
        const value = el.getAttribute?.(attr);
        if (value && !value.trim().startsWith('#')) el.removeAttribute(attr);
      }
    });

    // Neutralize CSS-borne attacks inside <style> (@import, remote url()).
    this.purify.addHook('afterSanitizeElements', (node) => {
      const el = node as Element;
      if (el.tagName?.toLowerCase() === 'style' && el.textContent) {
        el.textContent = el.textContent
          .replace(/@import[^;]+;?/gi, '')
          .replace(/url\(\s*['"]?\s*(?:https?:|\/\/|data:)[^)]*\)/gi, 'none');
      }
    });
  }

  async sanitize(raw: Buffer): Promise<SanitizedSvg> {
    if (raw.byteLength === 0) throw new SvgRejectedError('invalid_svg', 'Empty file');
    if (raw.byteLength > MAX_SVG_UPLOAD_BYTES) {
      throw new SvgRejectedError('too_large', 'SVG exceeds the maximum size');
    }
    this.assertNotBinary(raw);

    const text = raw.toString('utf8');
    this.assertLooksLikeSvg(text);
    this.assertNoDoctypeOrEntities(text);
    this.assertComplexityWithinLimits(text);

    const cleaned = this.purify.sanitize(text, {
      USE_PROFILES: { svg: true, svgFilters: true },
      FORBID_TAGS: ['script', 'foreignObject', 'image', 'a'],
      FORBID_ATTR: EVENT_HANDLER_ATTRS,
      WHOLE_DOCUMENT: false,
      ADD_ATTR: ['viewBox'],
    });
    if (!/<svg[\s>]/i.test(cleaned)) {
      throw new SvgRejectedError('invalid_svg', 'No <svg> root after sanitization');
    }
    this.scanForMaliciousPatterns(cleaned);

    const optimized = this.optimize(cleaned);
    this.scanForMaliciousPatterns(optimized);

    const { width, height } = this.extractDimensions(optimized);
    const svg = Buffer.from(optimized, 'utf8');
    const checksum = createHash('sha256').update(svg).digest('hex');
    return { svg, checksum, width, height };
  }

  // ---- validation steps ----

  private assertNotBinary(raw: Buffer): void {
    for (const sig of BINARY_SIGNATURES) {
      if (raw.length >= sig.length && sig.every((byte, i) => raw[i] === byte)) {
        throw new SvgRejectedError('invalid_svg', 'File is a binary, not an SVG');
      }
    }
  }

  private assertLooksLikeSvg(text: string): void {
    const head = text.replace(/^\uFEFF/, '').trimStart().slice(0, 1000).toLowerCase();
    if (head.startsWith('<html') || head.startsWith('<!doctype html')) {
      throw new SvgRejectedError('invalid_svg', 'File is HTML, not an SVG');
    }
    if (!text.toLowerCase().includes('<svg')) {
      throw new SvgRejectedError('invalid_svg', 'No <svg> element found');
    }
  }

  private assertNoDoctypeOrEntities(text: string): void {
    // Icons never need a DTD; rejecting it outright kills the XXE / billion-laughs class.
    if (/<!DOCTYPE/i.test(text) || /<!ENTITY/i.test(text)) {
      throw new SvgRejectedError('unsafe_content', 'DOCTYPE/entity declarations are not allowed');
    }
  }

  private assertComplexityWithinLimits(text: string): void {
    const elementCount = (text.match(/<[a-zA-Z]/g) ?? []).length;
    if (elementCount > MAX_ELEMENTS) {
      throw new SvgRejectedError('too_complex', 'Too many elements');
    }
    const pathDataChars = (text.match(/\sd\s*=\s*"[^"]*"/g) ?? []).reduce(
      (sum, m) => sum + m.length,
      0,
    );
    if (pathDataChars > MAX_PATH_DATA_CHARS) {
      throw new SvgRejectedError('too_complex', 'Path data too large');
    }
    if (this.maxNestingDepth(text) > MAX_DEPTH) {
      throw new SvgRejectedError('too_complex', 'Element nesting too deep');
    }
  }

  private maxNestingDepth(text: string): number {
    let depth = 0;
    let max = 0;
    const tagRe = /<\/?([a-zA-Z][\w:-]*)(\s[^>]*)?(\/?)>/g;
    let match: RegExpExecArray | null;
    while ((match = tagRe.exec(text)) !== null) {
      const isClosing = match[0].startsWith('</');
      const isSelfClosing = match[3] === '/';
      if (isClosing) depth = Math.max(0, depth - 1);
      else if (!isSelfClosing) {
        depth += 1;
        max = Math.max(max, depth);
      }
    }
    return max;
  }

  private scanForMaliciousPatterns(svg: string): void {
    for (const [pattern, code] of MALICIOUS_PATTERNS) {
      if (pattern.test(svg)) {
        throw new SvgRejectedError(code, `Rejected by safety scan: ${pattern}`);
      }
    }
  }

  private optimize(svg: string): string {
    try {
      const result = optimize(svg, {
        multipass: true,
        plugins: [
          {
            name: 'preset-default',
            params: {
              // Never drop viewBox — we derive width/height from it.
              overrides: { removeViewBox: false },
            },
          },
          'removeScriptElement',
          'removeStyleElement',
          { name: 'removeDimensions' }, // drop width/height attrs, keep viewBox
        ],
      });
      return result.data;
    } catch (err) {
      // svgo is optimization only; never let it fail an otherwise-safe upload.
      this.logger.warn(`svgo optimization failed, using sanitized output: ${(err as Error).message}`);
      return svg;
    }
  }

  private extractDimensions(svg: string): { width: number; height: number } {
    const viewBox = /viewBox\s*=\s*"([^"]+)"/i.exec(svg)?.[1];
    if (viewBox) {
      const parts = viewBox.trim().split(/[\s,]+/).map(Number);
      if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
        const width = Math.ceil(parts[2]);
        const height = Math.ceil(parts[3]);
        if (width > 0 && height > 0) return { width, height };
      }
    }
    const w = this.parseLength(/\swidth\s*=\s*"([^"]+)"/i.exec(svg)?.[1]);
    const h = this.parseLength(/\sheight\s*=\s*"([^"]+)"/i.exec(svg)?.[1]);
    if (w && h) return { width: w, height: h };
    throw new SvgRejectedError('invalid_svg', 'Could not determine SVG dimensions');
  }

  private parseLength(value: string | undefined): number | null {
    if (!value) return null;
    const n = parseFloat(value);
    return Number.isFinite(n) && n > 0 ? Math.ceil(n) : null;
  }
}
