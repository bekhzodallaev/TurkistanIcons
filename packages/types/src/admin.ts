import { z } from 'zod';
import { roleSchema } from './roles';
import { iconStatusSchema } from './creator';

/**
 * Admin moderation + user-management contracts. See docs/API.md (§21 Admin) and
 * docs/UPLOAD-PIPELINE.md §8. Enum string values mirror the Prisma enums.
 */

export const MODERATION_ACTIONS = ['APPROVE', 'REJECT', 'REQUEST_CHANGES'] as const;
export const moderationActionSchema = z.enum(MODERATION_ACTIONS);
export type ModerationAction = z.infer<typeof moderationActionSchema>;

/** Reject and request-changes require a reason the creator will see. */
export const moderationReasonSchema = z.object({
  reason: z.string().trim().min(1).max(2000),
});
export type ModerationReasonInput = z.infer<typeof moderationReasonSchema>;

export const listModerationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListModerationQuery = z.infer<typeof listModerationQuerySchema>;

export interface ModerationQueueItem {
  id: string;
  name: string;
  slug: string;
  status: z.infer<typeof iconStatusSchema>;
  previewUrl: string | null;
  creator: { id: string; slug: string; displayName: string };
  createdAt: string;
}

// ---- Admin user management ----

export const USER_STATUSES = ['active', 'suspended'] as const;
export const userStatusSchema = z.enum(USER_STATUSES);
export type UserStatus = z.infer<typeof userStatusSchema>;

export const listUsersQuerySchema = z.object({
  q: z.string().trim().min(1).max(160).optional(),
  role: roleSchema.optional(),
  status: userStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

export const updateUserSchema = z
  .object({
    role: roleSchema.optional(),
    status: userStatusSchema.optional(),
  })
  .refine((dto) => dto.role !== undefined || dto.status !== undefined, {
    message: 'Provide a role and/or status to update',
  });
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export interface AdminUserDto {
  id: string;
  email: string;
  name: string;
  role: z.infer<typeof roleSchema>;
  status: string;
  emailVerifiedAt: string | null;
  createdAt: string;
}
