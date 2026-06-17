import {
  Injectable,
  type PipeTransform,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { ZodSchema } from 'zod';

/**
 * Validates and parses an inbound value against a zod schema (CLAUDE.md: "zod at
 * the edges"). On failure it throws a 422 carrying flattened field errors; the
 * global ProblemDetailsFilter renders that as RFC-7807 problem+json with an
 * `errors` map. The handler receives the fully typed, parsed value.
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      const flat = result.error.flatten();
      const errors: Record<string, string[]> = { ...flat.fieldErrors } as Record<
        string,
        string[]
      >;
      if (flat.formErrors.length) errors._ = flat.formErrors;
      throw new UnprocessableEntityException({ message: 'Validation failed', errors });
    }
    return result.data;
  }
}
