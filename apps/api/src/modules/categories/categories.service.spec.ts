import { ConflictException } from '@nestjs/common';
import type { CategoryNode } from '@turkistan/types';
import type { Category } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import type { RedisService } from '../../redis/redis.service';
import { CategoriesService } from './categories.service';

function category(partial: Partial<Category> & Pick<Category, 'id'>): Category {
  return {
    id: partial.id,
    parentId: partial.parentId ?? null,
    name: partial.name ?? partial.id,
    slug: partial.slug ?? partial.id,
    description: partial.description ?? null,
    iconCount: partial.iconCount ?? 0,
    sortOrder: partial.sortOrder ?? 0,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

interface Mocks {
  service: CategoriesService;
  prisma: { category: Record<string, jest.Mock> };
  redis: { cacheGetJson: jest.Mock; cacheSetJson: jest.Mock; del: jest.Mock };
}

function setup(): Mocks {
  const prisma = {
    category: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
  };
  const redis = {
    cacheGetJson: jest.fn().mockResolvedValue(null),
    cacheSetJson: jest.fn().mockResolvedValue(undefined),
    del: jest.fn().mockResolvedValue(undefined),
  };
  const service = new CategoriesService(
    prisma as unknown as PrismaService,
    redis as unknown as RedisService,
  );
  return { service, prisma, redis };
}

describe('CategoriesService', () => {
  describe('getTree', () => {
    it('builds a nested tree from flat rows and caches it on a miss', async () => {
      const { service, prisma, redis } = setup();
      prisma.category.findMany.mockResolvedValue([
        category({ id: 'root', name: 'Architecture' }),
        category({ id: 'child', parentId: 'root', name: 'Registan' }),
      ]);

      const tree = await service.getTree();

      expect(tree).toHaveLength(1);
      expect(tree[0].id).toBe('root');
      expect(tree[0].children.map((c: CategoryNode) => c.id)).toEqual(['child']);
      expect(redis.cacheSetJson).toHaveBeenCalledTimes(1);
    });

    it('serves from cache without hitting Postgres on a hit', async () => {
      const { service, prisma, redis } = setup();
      const cached: CategoryNode[] = [
        {
          id: 'x',
          parentId: null,
          name: 'X',
          slug: 'x',
          description: null,
          iconCount: 0,
          sortOrder: 0,
          children: [],
        },
      ];
      redis.cacheGetJson.mockResolvedValue(cached);

      const tree = await service.getTree();

      expect(tree).toBe(cached);
      expect(prisma.category.findMany).not.toHaveBeenCalled();
    });
  });

  describe('create', () => {
    it('generates a unique slug and invalidates the cache', async () => {
      const { service, prisma, redis } = setup();
      prisma.category.count.mockResolvedValue(0); // slug is free
      prisma.category.create.mockResolvedValue(category({ id: 'new', name: 'Cuisine', slug: 'cuisine' }));

      const created = await service.create({ name: 'Cuisine' });

      expect(created.slug).toBe('cuisine');
      expect(prisma.category.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ slug: 'cuisine' }) }),
      );
      expect(redis.del).toHaveBeenCalledTimes(1);
    });
  });

  describe('update (re-parent)', () => {
    it('rejects moving a category under its own descendant (cycle)', async () => {
      const { service, prisma } = setup();
      // Tree: A -> B. Try to move A under B.
      prisma.category.findUnique.mockResolvedValue(category({ id: 'A' }));
      prisma.category.count.mockResolvedValue(1); // parent B exists
      prisma.category.findMany.mockResolvedValue([
        category({ id: 'A' }),
        category({ id: 'B', parentId: 'A' }),
      ]);

      await expect(service.update('A', { parentId: 'B' })).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(prisma.category.update).not.toHaveBeenCalled();
    });

    it('rejects making a category its own parent', async () => {
      const { service, prisma } = setup();
      prisma.category.findUnique.mockResolvedValue(category({ id: 'A' }));

      await expect(service.update('A', { parentId: 'A' })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('remove', () => {
    it('refuses to delete a category that still has icons', async () => {
      const { service, prisma } = setup();
      prisma.category.findUnique.mockResolvedValue(category({ id: 'A', iconCount: 3 }));

      await expect(service.remove('A')).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.category.delete).not.toHaveBeenCalled();
    });

    it('deletes an empty category and invalidates the cache', async () => {
      const { service, prisma, redis } = setup();
      prisma.category.findUnique.mockResolvedValue(category({ id: 'A', iconCount: 0 }));
      prisma.category.delete.mockResolvedValue(category({ id: 'A' }));

      await service.remove('A');

      expect(prisma.category.delete).toHaveBeenCalledWith({ where: { id: 'A' } });
      expect(redis.del).toHaveBeenCalledTimes(1);
    });
  });
});
