import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import { IconStateService } from './icon-state.service';

function setup() {
  const prisma = {
    icon: {
      updateMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      findFirst: jest.fn(),
    },
  };
  const service = new IconStateService(prisma as unknown as PrismaService);
  return { service, prisma };
}

describe('IconStateService.transition', () => {
  it('applies a legal transition guarded by the current status', async () => {
    const { service, prisma } = setup();
    prisma.icon.updateMany.mockResolvedValue({ count: 1 });

    await service.transition('i1', 'DRAFT', 'PROCESSING', { fileSize: 100 });

    expect(prisma.icon.updateMany).toHaveBeenCalledWith({
      where: { id: 'i1', status: 'DRAFT' },
      data: { status: 'PROCESSING', fileSize: 100 },
    });
  });

  it('throws on an illegal transition pair without touching the DB', async () => {
    const { service, prisma } = setup();

    await expect(service.transition('i1', 'DRAFT', 'PUBLISHED')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.icon.updateMany).not.toHaveBeenCalled();
  });

  it('throws when the row is no longer in the expected state (stale)', async () => {
    const { service, prisma } = setup();
    prisma.icon.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.transition('i1', 'DRAFT', 'PROCESSING')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});

describe('IconStateService.findOwned', () => {
  it('returns the icon when the caller owns it', async () => {
    const { service, prisma } = setup();
    prisma.icon.findUnique.mockResolvedValue({
      id: 'i1',
      deletedAt: null,
      creator: { userId: 'u1' },
    });

    await expect(service.findOwned('i1', 'u1')).resolves.toMatchObject({ id: 'i1' });
  });

  it('403s when another user owns the icon', async () => {
    const { service, prisma } = setup();
    prisma.icon.findUnique.mockResolvedValue({
      id: 'i1',
      deletedAt: null,
      creator: { userId: 'other' },
    });

    await expect(service.findOwned('i1', 'u1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('404s for a missing or soft-deleted icon', async () => {
    const { service, prisma } = setup();
    prisma.icon.findUnique.mockResolvedValue(null);
    await expect(service.findOwned('i1', 'u1')).rejects.toBeInstanceOf(NotFoundException);

    prisma.icon.findUnique.mockResolvedValue({
      id: 'i1',
      deletedAt: new Date(),
      creator: { userId: 'u1' },
    });
    await expect(service.findOwned('i1', 'u1')).rejects.toBeInstanceOf(NotFoundException);
  });
});
