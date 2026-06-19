import { z } from 'zod';

/**
 * Shared category + tag (taxonomy) contracts. The public read API returns the
 * tree/list shapes; admin CRUD validates with the zod schemas. See docs/API.md
 * (§10 Categories, §11 Tags) and docs/DATABASE.md (categories, tags).
 */

/** A category as a node in the nested tree (children populated recursively). */
export interface CategoryNode {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
  description: string | null;
  iconCount: number;
  sortOrder: number;
  children: CategoryNode[];
}

/** Category detail (one level of children, not the full subtree). */
export interface CategoryDetail {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
  description: string | null;
  iconCount: number;
  sortOrder: number;
  children: Omit<CategoryNode, 'children'>[];
}

export interface TagDto {
  id: string;
  name: string;
  slug: string;
  usageCount: number;
}

const categoryName = z.string().trim().min(1).max(120);
const categoryDescription = z.string().trim().max(500);
const sortOrder = z.number().int().min(0).max(1_000_000);

export const createCategorySchema = z.object({
  name: categoryName,
  parentId: z.string().uuid().nullish(),
  sortOrder: sortOrder.optional(),
  description: categoryDescription.nullish(),
});
export type CreateCategoryInput = z.infer<typeof createCategorySchema>;

export const updateCategorySchema = z
  .object({
    name: categoryName.optional(),
    // `null` re-parents to root; omitted leaves the parent unchanged.
    parentId: z.string().uuid().nullable().optional(),
    sortOrder: sortOrder.optional(),
    description: categoryDescription.nullable().optional(),
  })
  .refine((obj) => Object.keys(obj).length > 0, {
    message: 'Provide at least one field to update',
  });
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;

const tagName = z.string().trim().min(1).max(60);

export const createTagSchema = z.object({ name: tagName });
export type CreateTagInput = z.infer<typeof createTagSchema>;

export const updateTagSchema = z.object({ name: tagName });
export type UpdateTagInput = z.infer<typeof updateTagSchema>;

export const listTagsQuerySchema = z.object({
  /** Prefix filter on tag name. */
  q: z.string().trim().min(1).max(60).optional(),
  sort: z.enum(['usage', 'name']).default('usage'),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
export type ListTagsQuery = z.infer<typeof listTagsQuerySchema>;
