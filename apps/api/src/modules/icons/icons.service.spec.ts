import { ConflictException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import type { IconStateService } from './icon-state.service';
import { IconsService } from './icons.service';

function setup() {
  const prisma = {
    category: { count: jest.fn().mockResolvedValue(1) },
    $transaction: jest.fn(),
  };
  const icons = { findOwned: jest.fn() };
  const service = new IconsService(
    prisma as unknown as PrismaService,
    icons as unknown as IconStateService,
  );
  return { service, prisma, icons };
}

describe('IconsService.updateMetadata', () => {
  it('rejects editing an icon that is already PUBLISHED', async () => {
    const { service, icons } = setup();
    icons.findOwned.mockResolvedValue({ id: 'i1', status: 'PUBLISHED' });

    await expect(service.updateMetadata('i1', 'u1', { name: 'New' })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('updates an editable (DRAFT) icon and returns the metadata', async () => {
    const { service, icons, prisma } = setup();
    icons.findOwned.mockResolvedValue({ id: 'i1', status: 'DRAFT' });
    const tx = {
      iconTag: { deleteMany: jest.fn(), createMany: jest.fn() },
      tag: { findUnique: jest.fn(), create: jest.fn() },
      icon: {
        update: jest.fn().mockResolvedValue({
          id: 'i1',
          name: 'New name',
          slug: 'doppi',
          description: null,
          status: 'DRAFT',
          categoryId: 'cat1',
          priceType: 'FREE',
          priceCents: 0,
          license: 'FREE_ATTRIBUTION',
          iconTags: [],
        }),
      },
    };
    prisma.$transaction.mockImplementation(async (cb: (t: typeof tx) => unknown) => cb(tx));

    const dto = await service.updateMetadata('i1', 'u1', { name: 'New name' });

    expect(tx.icon.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'i1' }, data: expect.objectContaining({ name: 'New name' }) }),
    );
    expect(dto).toMatchObject({ id: 'i1', name: 'New name', status: 'DRAFT', tags: [] });
  });
});
