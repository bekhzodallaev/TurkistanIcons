import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthUser, Role } from '@turkistan/types';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { RolesGuard } from './roles.guard';

function makeContext(user: AuthUser | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

function makeGuard(required: Role[] | undefined, isPublic = false): RolesGuard {
  const reflector = {
    getAllAndOverride: (key: string) => (key === ROLES_KEY ? required : key === IS_PUBLIC_KEY ? isPublic : undefined),
  } as unknown as Reflector;
  return new RolesGuard(reflector);
}

function user(role: Role): AuthUser {
  return { id: 'u1', role, email: 'u1@example.com' };
}

describe('RolesGuard', () => {
  it('allows any authenticated user when no @Roles is set', () => {
    expect(makeGuard(undefined).canActivate(makeContext(user('USER')))).toBe(true);
  });

  it('rejects a USER calling a CREATOR route with 403', () => {
    const guard = makeGuard(['CREATOR']);
    expect(() => guard.canActivate(makeContext(user('USER')))).toThrow(ForbiddenException);
  });

  it('rejects a VISITOR calling an ADMIN route with 403', () => {
    const guard = makeGuard(['ADMIN']);
    expect(() => guard.canActivate(makeContext(user('VISITOR')))).toThrow(ForbiddenException);
  });

  it('admits the exact required role', () => {
    expect(makeGuard(['CREATOR']).canActivate(makeContext(user('CREATOR')))).toBe(true);
  });

  it('admits a higher role (hierarchy: ADMIN >= CREATOR)', () => {
    expect(makeGuard(['CREATOR']).canActivate(makeContext(user('ADMIN')))).toBe(true);
  });

  it('throws 403 when no user is attached but a role is required', () => {
    expect(() => makeGuard(['USER']).canActivate(makeContext(undefined))).toThrow(
      ForbiddenException,
    );
  });

  it('bypasses role checks on @Public() routes', () => {
    expect(makeGuard(['ADMIN'], true).canActivate(makeContext(undefined))).toBe(true);
  });
});
