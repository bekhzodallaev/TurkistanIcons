import { z } from 'zod';
import { iconStatusSchema } from './creator';

/**
 * Upload (signed-PUT) contracts. See docs/API.md (§13 Uploads) and
 * docs/UPLOAD-PIPELINE.md. The client inits an upload, PUTs the raw SVG straight
 * to R2 (quarantine), then finalizes to enqueue sanitization/processing.
 */

/** Hard cap on a single SVG upload (re-enforced server-side during processing). */
export const MAX_SVG_UPLOAD_BYTES = 2 * 1024 * 1024; // 2 MiB

export const PRICE_TYPES = ['FREE', 'PREMIUM'] as const;
export const priceTypeSchema = z.enum(PRICE_TYPES);
export type PriceType = z.infer<typeof priceTypeSchema>;

export const LICENSE_TYPES = [
  'FREE_ATTRIBUTION',
  'PREMIUM_STANDARD',
  'PREMIUM_EXTENDED',
] as const;
export const licenseTypeSchema = z.enum(LICENSE_TYPES);
export type LicenseType = z.infer<typeof licenseTypeSchema>;

export const uploadInitSchema = z
  .object({
    fileName: z.string().trim().min(1).max(255),
    // Declared by the client; the worker re-validates by content, not extension.
    contentType: z.literal('image/svg+xml'),
    fileSize: z.number().int().positive().max(MAX_SVG_UPLOAD_BYTES),
    name: z.string().trim().min(1).max(160),
    categoryId: z.string().uuid(),
    priceType: priceTypeSchema.default('FREE'),
    priceCents: z.number().int().min(0).max(1_000_000).default(0),
    license: licenseTypeSchema.default('FREE_ATTRIBUTION'),
    tags: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  })
  .superRefine((dto, ctx) => {
    if (dto.priceType === 'PREMIUM' && dto.priceCents <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['priceCents'],
        message: 'Premium icons require a price greater than 0',
      });
    }
    if (dto.priceType === 'FREE' && dto.priceCents !== 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['priceCents'],
        message: 'Free icons must have a price of 0',
      });
    }
    if (dto.priceType === 'FREE' && dto.license !== 'FREE_ATTRIBUTION') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['license'],
        message: 'Free icons must use the FREE_ATTRIBUTION license',
      });
    }
  });
export type UploadInitInput = z.infer<typeof uploadInitSchema>;

export interface UploadInitResponse {
  icon: { id: string; status: 'DRAFT'; slug: string };
  upload: {
    url: string;
    method: 'PUT';
    headers: Record<string, string>;
    maxBytes: number;
    expiresIn: number;
  };
}

export interface UploadStatusDto {
  id: string;
  status: z.infer<typeof iconStatusSchema>;
  checksum: string | null;
  previewUrl: string | null;
  rejectionReason: string | null;
}

/** Machine-readable reasons an icon can be REJECTED by the pipeline. */
export const UPLOAD_REJECTION_REASONS = [
  'invalid_svg',
  'unsafe_content',
  'too_large',
  'too_complex',
  'duplicate',
  'render_failed',
  'r2_error',
  'zip_bomb',
  'finalize_timeout',
] as const;
export type UploadRejectionReason = (typeof UPLOAD_REJECTION_REASONS)[number];
