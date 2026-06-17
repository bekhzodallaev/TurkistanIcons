import { z } from 'zod';

/**
 * RFC 7807 "problem details" shape returned by the API on errors.
 * The API never leaks stack traces; clients can rely on this contract.
 */
export const problemDetailsSchema = z.object({
  type: z.string().default('about:blank'),
  title: z.string(),
  status: z.number().int().min(100).max(599),
  detail: z.string().optional(),
  instance: z.string().optional(),
  /** Per-field validation messages, keyed by field path. */
  errors: z.record(z.string(), z.array(z.string())).optional(),
  /** Correlates a response with structured logs. */
  requestId: z.string().optional(),
});

export type ProblemDetails = z.infer<typeof problemDetailsSchema>;
