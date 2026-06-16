import { z } from 'zod';

/**
 * Authorization roles, ordered from least to most privileged.
 * Enforced server-side on the API — never trust a client-supplied role.
 * See CLAUDE.md ("Roles") and docs/SECURITY.md.
 */
export const ROLES = ['VISITOR', 'USER', 'CREATOR', 'ADMIN'] as const;

export const roleSchema = z.enum(ROLES);
export type Role = z.infer<typeof roleSchema>;

/** Privilege rank used by the API's RolesGuard for `>=` comparisons. */
export const ROLE_RANK: Record<Role, number> = {
  VISITOR: 0,
  USER: 1,
  CREATOR: 2,
  ADMIN: 3,
};

export function hasAtLeastRole(role: Role, required: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[required];
}
