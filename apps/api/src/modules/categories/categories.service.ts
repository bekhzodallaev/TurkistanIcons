import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  CategoryDetail,
  CategoryNode,
  CreateCategoryInput,
  UpdateCategoryInput,
} from '@turkistan/types';
import type { Category, Prisma } from '@prisma/client';
import { slugify } from '../../common/util/slug.util';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';

const TREE_CACHE_KEY = 'cache:categories:tree';
const TREE_CACHE_TTL_SECONDS = 60 * 60;

@Injectable()
export class CategoriesService {
  private readonly logger = new Logger(CategoriesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Full nested category tree. Cache-aside in Redis (docs/M3): served from cache
   * when warm, rebuilt from Postgres on miss, and invalidated on every write.
   * Falls back to Postgres if Redis is unavailable so browsing never hard-fails.
   */
  async getTree(): Promise<CategoryNode[]> {
    const cached = await this.readCache();
    if (cached) return cached;
    const tree = await this.buildTree();
    await this.writeCache(tree);
    return tree;
  }

  async getBySlug(slug: string): Promise<CategoryDetail> {
    const category = await this.prisma.category.findUnique({
      where: { slug },
      include: {
        children: { orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] },
      },
    });
    if (!category) throw new NotFoundException(`Category "${slug}" not found`);
    return {
      ...this.toNode(category),
      children: category.children.map((child) => this.toNode(child)),
    };
  }

  // ---- Admin CRUD ----

  async create(dto: CreateCategoryInput): Promise<CategoryNode> {
    if (dto.parentId) await this.assertExists(dto.parentId);
    const slug = await this.uniqueSlug(slugify(dto.name));
    const category = await this.prisma.category.create({
      data: {
        name: dto.name,
        slug,
        parentId: dto.parentId ?? null,
        description: dto.description ?? null,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
    await this.invalidate();
    return this.toTreeLeaf(category);
  }

  async update(id: string, dto: UpdateCategoryInput): Promise<CategoryNode> {
    const existing = await this.prisma.category.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Category not found');

    const data: Prisma.CategoryUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;
    if (dto.description !== undefined) data.description = dto.description;

    if (dto.parentId !== undefined) {
      await this.assertReparentable(id, dto.parentId);
      data.parent = dto.parentId
        ? { connect: { id: dto.parentId } }
        : { disconnect: true };
    }

    const category = await this.prisma.category.update({ where: { id }, data });
    await this.invalidate();
    return this.toTreeLeaf(category);
  }

  async remove(id: string): Promise<void> {
    const category = await this.prisma.category.findUnique({ where: { id } });
    if (!category) throw new NotFoundException('Category not found');
    if (category.iconCount > 0) {
      throw new ConflictException(
        'Cannot delete a category that still contains icons; reassign them first',
      );
    }
    // Children re-parent to root automatically (FK onDelete: SetNull).
    await this.prisma.category.delete({ where: { id } });
    await this.invalidate();
  }

  /** Drop the cached tree — call after icon_count changes (e.g. publish). */
  invalidateTree(): Promise<void> {
    return this.invalidate();
  }

  // ---- internals ----

  private async buildTree(): Promise<CategoryNode[]> {
    const rows = await this.prisma.category.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    const nodes = new Map<string, CategoryNode>();
    for (const row of rows) nodes.set(row.id, this.toTreeLeaf(row));

    const roots: CategoryNode[] = [];
    for (const row of rows) {
      const node = nodes.get(row.id);
      if (!node) continue;
      const parent = row.parentId ? nodes.get(row.parentId) : undefined;
      if (parent) parent.children.push(node);
      else roots.push(node);
    }
    return roots;
  }

  /** Reject a re-parent that would create a cycle (self or descendant). */
  private async assertReparentable(id: string, parentId: string | null): Promise<void> {
    if (parentId === null) return;
    if (parentId === id) {
      throw new ConflictException('A category cannot be its own parent');
    }
    await this.assertExists(parentId);
    const descendants = await this.descendantIds(id);
    if (descendants.has(parentId)) {
      throw new ConflictException('Cannot move a category under one of its own descendants');
    }
  }

  private async descendantIds(rootId: string): Promise<Set<string>> {
    const all = await this.prisma.category.findMany({
      select: { id: true, parentId: true },
    });
    const childrenByParent = new Map<string, string[]>();
    for (const { id, parentId } of all) {
      if (!parentId) continue;
      const list = childrenByParent.get(parentId) ?? [];
      list.push(id);
      childrenByParent.set(parentId, list);
    }
    const result = new Set<string>();
    const stack = [rootId];
    while (stack.length) {
      const current = stack.pop() as string;
      for (const child of childrenByParent.get(current) ?? []) {
        if (!result.has(child)) {
          result.add(child);
          stack.push(child);
        }
      }
    }
    return result;
  }

  private async assertExists(id: string): Promise<void> {
    const count = await this.prisma.category.count({ where: { id } });
    if (count === 0) throw new NotFoundException(`Parent category ${id} not found`);
  }

  private async uniqueSlug(base: string): Promise<string> {
    let candidate = base;
    let suffix = 2;
    // citext-unique; loop until free. Bounded by the small admin-managed taxonomy.
    while ((await this.prisma.category.count({ where: { slug: candidate } })) > 0) {
      candidate = `${base}-${suffix++}`;
    }
    return candidate;
  }

  private async invalidate(): Promise<void> {
    try {
      await this.redis.del(TREE_CACHE_KEY);
    } catch (err) {
      this.logger.warn(`Failed to invalidate category cache: ${(err as Error).message}`);
    }
  }

  private async readCache(): Promise<CategoryNode[] | null> {
    try {
      return await this.redis.cacheGetJson<CategoryNode[]>(TREE_CACHE_KEY);
    } catch {
      return null; // fail open to Postgres
    }
  }

  private async writeCache(tree: CategoryNode[]): Promise<void> {
    try {
      await this.redis.cacheSetJson(TREE_CACHE_KEY, tree, TREE_CACHE_TTL_SECONDS);
    } catch {
      // best-effort cache; ignore write failures
    }
  }

  private toTreeLeaf(category: Category): CategoryNode {
    return { ...this.toNode(category), children: [] };
  }

  private toNode(category: Category): Omit<CategoryNode, 'children'> {
    return {
      id: category.id,
      parentId: category.parentId,
      name: category.name,
      slug: category.slug,
      description: category.description,
      iconCount: category.iconCount,
      sortOrder: category.sortOrder,
    };
  }
}
