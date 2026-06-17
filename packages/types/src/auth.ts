import { z } from 'zod';
import { roleSchema } from './roles';

/**
 * Shared auth contracts (zod schemas + inferred types).
 * The API validates inbound bodies with these at the edge; the web app reuses
 * the same schemas for forms/server actions so client and server never drift.
 * See docs/API.md (§3 Auth) and docs/SECURITY.md (§2 Authentication).
 */

/** Normalized email: trimmed + lower-cased so uniqueness matches the citext column. */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(254)
  .email();

/**
 * Password policy: long enough to resist brute force, with at least one letter
 * and one digit. argon2id hashing happens server-side (never store plaintext).
 */
export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be at most 128 characters')
  .regex(/[A-Za-z]/, 'Password must contain a letter')
  .regex(/[0-9]/, 'Password must contain a number');

export const nameSchema = z.string().trim().min(1).max(120);

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: nameSchema,
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  // Login does not re-validate password strength — only presence — so policy
  // changes never lock out existing accounts.
  password: z.string().min(1).max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;

/** Refresh token may arrive via httpOnly cookie (web) or body (programmatic). */
export const refreshSchema = z.object({
  refreshToken: z.string().min(1).optional(),
});
export type RefreshInput = z.infer<typeof refreshSchema>;

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: passwordSchema,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const verifyEmailSchema = z.object({
  token: z.string().min(1),
});
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;

export const resendVerificationSchema = z.object({
  email: emailSchema,
});
export type ResendVerificationInput = z.infer<typeof resendVerificationSchema>;

/** Public-safe user projection returned by auth/login/register and /auth/me. */
export interface PublicUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  role: z.infer<typeof roleSchema>;
  emailVerifiedAt: string | null;
}

/** Response body for register/login/refresh (refresh token is set as a cookie). */
export interface AuthTokensResponse {
  user: PublicUser;
  accessToken: string;
  /** Access-token lifetime in seconds. */
  expiresIn: number;
}

/** The authenticated principal attached to a request after JwtAuthGuard. */
export interface AuthUser {
  id: string;
  role: z.infer<typeof roleSchema>;
  email: string;
}
