import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import type { TokenService } from '../auth/token.service';
import { AdminUsersService } from './admin-users.service';

function user(overrides: Record<string, unknown> = {}) {
  return {
    id: 'u1',
    email: 'u1@example.com',
    name: 'User One',
    role: 'USER',
    status: 'active',
    emailVerifiedAt: null,
    createdAt: new Date(0),
    ...overrides,
  };
}

function setup() {
  const prisma = {
    user: { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn() },
  };
  const tokens = { revokeAllSessions: jest.fn().mockResolvedValue(undefined) };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new AdminUsersService(
    prisma as unknown as PrismaService,
    tokens as unknown as TokenService,
    audit as unknown as AuditService,
  );
  return { service, prisma, tokens, audit };
}

describe('AdminUsersService.update', () => {
  it('prevents an admin from changing their own role/status', async () => {
    const { service } = setup();
    await expect(service.update('admin-1', 'admin-1', { status: 'suspended' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('404s for an unknown user', async () => {
    const { service, prisma } = setup();
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(service.update('u1', 'admin-1', { role: 'CREATOR' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('suspends a user, revokes their sessions, and audits the action', async () => {
    const { service, prisma, tokens, audit } = setup();
    prisma.user.findUnique.mockResolvedValue(user());
    prisma.user.update.mockResolvedValue(user({ status: 'suspended' }));

    const dto = await service.update('u1', 'admin-1', { status: 'suspended' });

    expect(tokens.revokeAllSessions).toHaveBeenCalledWith('u1');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: 'admin-1', action: 'user.update', entityId: 'u1' }),
    );
    expect(dto.status).toBe('suspended');
  });

  it('changes a role without revoking sessions', async () => {
    const { service, prisma, tokens } = setup();
    prisma.user.findUnique.mockResolvedValue(user());
    prisma.user.update.mockResolvedValue(user({ role: 'CREATOR' }));

    const dto = await service.update('u1', 'admin-1', { role: 'CREATOR' });

    expect(tokens.revokeAllSessions).not.toHaveBeenCalled();
    expect(dto.role).toBe('CREATOR');
  });
});
