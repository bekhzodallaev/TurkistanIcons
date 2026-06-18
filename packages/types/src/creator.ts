import { z } from 'zod';

/**
 * Creator application + profile contracts. See docs/API.md (§5 Creators public,
 * §20 Creator dashboard, §21 Admin) and docs/DATABASE.md (creators,
 * creator_applications). Enum string values mirror the Prisma enums exactly.
 */

export const CREATOR_APP_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;
export const creatorAppStatusSchema = z.enum(CREATOR_APP_STATUSES);
export type CreatorAppStatus = z.infer<typeof creatorAppStatusSchema>;

export const ICON_STATUSES = [
  'DRAFT',
  'PROCESSING',
  'PENDING_REVIEW',
  'PUBLISHED',
  'REJECTED',
  'ARCHIVED',
] as const;
export const iconStatusSchema = z.enum(ICON_STATUSES);
export type IconStatus = z.infer<typeof iconStatusSchema>;

// ---- Apply ----

export const applyCreatorSchema = z.object({
  portfolioUrl: z.string().trim().url().max(500).optional(),
  message: z.string().trim().min(1).max(2000).optional(),
});
export type ApplyCreatorInput = z.infer<typeof applyCreatorSchema>;

export interface CreatorApplicationDto {
  id: string;
  status: CreatorAppStatus;
  portfolioUrl: string | null;
  message: string | null;
  reviewNote: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---- Public profile ----

export interface PublicCreatorProfile {
  id: string;
  slug: string;
  displayName: string;
  bio: string | null;
  website: string | null;
  country: string | null;
  totalDownloads: number;
  iconCount: number;
  createdAt: string;
}

/** Compact creator reference embedded in other payloads. */
export interface CreatorRef {
  id: string;
  slug: string;
  displayName: string;
}

// ---- Creator dashboard (shell) ----

export interface CreatorDashboard {
  creator: CreatorRef;
  /** Count of own icons per status (all six statuses always present). */
  statusCounts: Record<IconStatus, number>;
  totals: {
    iconCount: number;
    /** Placeholder counters until the download/payment pipelines land (M8/M10). */
    downloads: number;
    revenueCents: number;
    currency: string;
  };
}

export interface CreatorIconSummary {
  id: string;
  name: string;
  slug: string;
  status: IconStatus;
  priceType: 'FREE' | 'PREMIUM';
  downloadCount: number;
  createdAt: string;
}

export const listCreatorIconsQuerySchema = z.object({
  status: iconStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListCreatorIconsQuery = z.infer<typeof listCreatorIconsQuerySchema>;

// ---- Admin review ----

export const listApplicationsQuerySchema = z.object({
  status: creatorAppStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListApplicationsQuery = z.infer<typeof listApplicationsQuerySchema>;

export const rejectApplicationSchema = z.object({
  reviewNote: z.string().trim().min(1).max(2000),
});
export type RejectApplicationInput = z.infer<typeof rejectApplicationSchema>;

export interface AdminApplicationDto extends CreatorApplicationDto {
  applicant: { id: string; name: string; email: string };
}
