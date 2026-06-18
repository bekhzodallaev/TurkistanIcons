import { SvgRejectedError, SvgSanitizerService } from './svg-sanitizer.service';

const CLEAN_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M4 4h16v16H4z"/></svg>';

/** Assert sanitized output contains none of the known dangerous constructs. */
function expectNeutralized(svg: string): void {
  const lower = svg.toLowerCase();
  expect(lower).not.toContain('<script');
  expect(lower).not.toContain('<foreignobject');
  expect(lower).not.toContain('<image');
  expect(lower).not.toMatch(/\son\w+\s*=/);
  expect(lower).not.toContain('javascript:');
  expect(lower).not.toContain('<!entity');
  expect(lower).not.toContain('<!doctype');
  expect(lower).not.toContain('evil.com');
  expect(lower).not.toContain('@import');
}

describe('SvgSanitizerService', () => {
  let sanitizer: SvgSanitizerService;

  beforeAll(() => {
    sanitizer = new SvgSanitizerService();
  });

  describe('accepts clean SVG', () => {
    it('sanitizes a valid icon and derives dimensions from viewBox', async () => {
      const result = await sanitizer.sanitize(Buffer.from(CLEAN_SVG));
      expect(result.width).toBe(24);
      expect(result.height).toBe(24);
      expect(result.svg.toString('utf8').toLowerCase()).toContain('<svg');
      expect(result.checksum).toMatch(/^[0-9a-f]{64}$/);
    });

    it('produces a deterministic checksum (dedupe basis)', async () => {
      const a = await sanitizer.sanitize(Buffer.from(CLEAN_SVG));
      const b = await sanitizer.sanitize(Buffer.from(CLEAN_SVG));
      expect(a.checksum).toBe(b.checksum);
    });
  });

  describe('neutralizes hostile SVG (corpus)', () => {
    // Each entry embeds a payload in an otherwise-valid icon; sanitize must
    // either strip the danger or throw — never return something exploitable.
    const stripCases: Array<{ name: string; svg: string }> = [
      {
        name: 'inline <script>',
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><script>alert(1)</script><path d="M0 0h24v24H0z"/></svg>`,
      },
      {
        name: 'onload event handler',
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" onload="alert(1)"><path d="M0 0h24v24H0z"/></svg>`,
      },
      {
        name: 'onclick on a child',
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" onclick="steal()"/></svg>`,
      },
      {
        name: '<foreignObject> HTML smuggling',
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><foreignObject><body xmlns="http://www.w3.org/1999/xhtml"><img src=x onerror="alert(1)"></body></foreignObject></svg>`,
      },
      {
        name: 'remote xlink:href on <use>',
        svg: `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 24 24"><use xlink:href="https://evil.com/x.svg#a"/></svg>`,
      },
      {
        name: 'javascript: href on <a>',
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><a href="javascript:alert(1)"><rect width="24" height="24"/></a></svg>`,
      },
      {
        name: 'remote <image>',
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><image href="https://evil.com/track.png" width="24" height="24"/></svg>`,
      },
      {
        name: '<style> with @import',
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><style>@import url("https://evil.com/x.css");</style><path d="M0 0h24v24H0z"/></svg>`,
      },
      {
        name: 'animate with javascript values',
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24"><set attributeName="onload" to="alert(1)"/></rect></svg>`,
      },
    ];

    it.each(stripCases)('neutralizes $name', async ({ svg }) => {
      try {
        const result = await sanitizer.sanitize(Buffer.from(svg));
        expectNeutralized(result.svg.toString('utf8'));
      } catch (err) {
        // Rejecting outright is also an acceptable outcome.
        expect(err).toBeInstanceOf(SvgRejectedError);
      }
    });
  });

  describe('rejects invalid / dangerous payloads outright', () => {
    it('rejects a DOCTYPE/ENTITY (XXE / billion laughs)', async () => {
      const xxe = `<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><text>&xxe;</text></svg>`;
      await expect(sanitizer.sanitize(Buffer.from(xxe))).rejects.toMatchObject({
        code: 'unsafe_content',
      });
    });

    it('rejects a renamed binary (PNG magic bytes)', async () => {
      const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
      await expect(sanitizer.sanitize(png)).rejects.toMatchObject({ code: 'invalid_svg' });
    });

    it('rejects an HTML document', async () => {
      const html = Buffer.from('<!doctype html><html><body><svg></svg></body></html>');
      await expect(sanitizer.sanitize(html)).rejects.toBeInstanceOf(SvgRejectedError);
    });

    it('rejects an empty file', async () => {
      await expect(sanitizer.sanitize(Buffer.alloc(0))).rejects.toMatchObject({
        code: 'invalid_svg',
      });
    });

    it('rejects a non-SVG text file', async () => {
      await expect(sanitizer.sanitize(Buffer.from('just some text'))).rejects.toBeInstanceOf(
        SvgRejectedError,
      );
    });

    it('rejects an over-complex SVG (too many elements)', async () => {
      const many = `<rect/>`.repeat(20_000);
      const bomb = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${many}</svg>`;
      await expect(sanitizer.sanitize(Buffer.from(bomb))).rejects.toMatchObject({
        code: 'too_complex',
      });
    });
  });
});
