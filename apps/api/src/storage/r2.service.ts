import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Readable } from 'node:stream';
import type { Env } from '../config/env';

export interface HeadResult {
  size: number;
  contentType: string | undefined;
}

/**
 * Cloudflare R2 (S3-compatible) access. Raw + sanitized user SVGs live in the
 * dedicated SVG bucket (separate origin, never inlined into app HTML); PNG
 * previews live in the public asset bucket. See docs/SECURITY.md §1 and
 * docs/UPLOAD-PIPELINE.md.
 *
 * Storage is optional at boot; when unconfigured, upload routes return 503.
 */
@Injectable()
export class R2Service {
  private readonly logger = new Logger(R2Service.name);
  private readonly client: S3Client | null;
  private readonly svgBucket: string;
  private readonly assetBucket: string;
  private readonly publicBaseUrl: string;

  constructor(config: ConfigService<Env, true>) {
    const accessKeyId = config.get('R2_ACCESS_KEY_ID', { infer: true });
    const secretAccessKey = config.get('R2_SECRET_ACCESS_KEY', { infer: true });
    const accountId = config.get('R2_ACCOUNT_ID', { infer: true });
    const endpoint =
      config.get('R2_ENDPOINT', { infer: true }) ??
      (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : undefined);
    const forcePathStyle = config.get('R2_FORCE_PATH_STYLE', { infer: true });

    this.svgBucket = config.get('R2_SVG_BUCKET', { infer: true });
    this.assetBucket = config.get('R2_BUCKET', { infer: true });
    this.publicBaseUrl = config.get('R2_PUBLIC_BASE_URL', { infer: true });

    if (accessKeyId && secretAccessKey && endpoint) {
      this.client = new S3Client({
        region: 'auto',
        endpoint,
        credentials: { accessKeyId, secretAccessKey },
        // MinIO (dev) needs path-style addressing; R2 works with either.
        forcePathStyle: forcePathStyle ?? Boolean(config.get('R2_ENDPOINT', { infer: true })),
      });
    } else {
      this.client = null;
      this.logger.warn('R2 not configured; upload endpoints will return 503 until set');
    }
  }

  isConfigured(): boolean {
    return this.client !== null;
  }

  /** Short-lived signed PUT pinned to a key + content type (quarantine bucket). */
  signRawUploadUrl(key: string, contentType: string, expiresInSeconds: number): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.svgBucket,
      Key: key,
      ContentType: contentType,
    });
    return getSignedUrl(this.requireClient(), command, { expiresIn: expiresInSeconds });
  }

  /** HEAD a quarantine object; null when it does not exist. */
  async headRaw(key: string): Promise<HeadResult | null> {
    try {
      const res = await this.requireClient().send(
        new HeadObjectCommand({ Bucket: this.svgBucket, Key: key }),
      );
      return { size: res.ContentLength ?? 0, contentType: res.ContentType };
    } catch (err) {
      if (this.isNotFound(err)) return null;
      throw err;
    }
  }

  /** Stream a quarantine object into a buffer, enforcing a hard byte cap. */
  async getRawCapped(key: string, maxBytes: number): Promise<Buffer> {
    const res = await this.requireClient().send(
      new GetObjectCommand({ Bucket: this.svgBucket, Key: key }),
    );
    const stream = res.Body as Readable | undefined;
    if (!stream) throw new Error('Empty object body');

    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of stream) {
      const buf = chunk as Buffer;
      total += buf.byteLength;
      if (total > maxBytes) {
        stream.destroy();
        throw new Error(`Object exceeds the ${maxBytes}-byte cap`);
      }
      chunks.push(buf);
    }
    return Buffer.concat(chunks);
  }

  /** Write the sanitized SVG to the public prefix of the SVG bucket. */
  async putSanitizedSvg(iconId: string, svg: Buffer): Promise<string> {
    const key = `public/icons/${iconId}/icon.svg`;
    await this.requireClient().send(
      new PutObjectCommand({
        Bucket: this.svgBucket,
        Key: key,
        Body: svg,
        ContentType: 'image/svg+xml',
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );
    return key;
  }

  /** Write a PNG preview to the public asset bucket. */
  async putPreviewPng(iconId: string, variant: 'preview' | 'thumb', png: Buffer): Promise<string> {
    const key = `public/icons/${iconId}/${variant}.png`;
    await this.requireClient().send(
      new PutObjectCommand({
        Bucket: this.assetBucket,
        Key: key,
        Body: png,
        ContentType: 'image/png',
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );
    return key;
  }

  publicUrl(key: string): string {
    return `${this.publicBaseUrl}/${key}`;
  }

  private requireClient(): S3Client {
    if (!this.client) {
      throw new ServiceUnavailableException('Storage is not configured');
    }
    return this.client;
  }

  private isNotFound(err: unknown): boolean {
    const meta = (err as { $metadata?: { httpStatusCode?: number }; name?: string });
    return meta.$metadata?.httpStatusCode === 404 || meta.name === 'NotFound';
  }
}
