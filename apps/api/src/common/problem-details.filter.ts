import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { ProblemDetails } from '@turkistan/types';
import type { Request, Response } from 'express';

/**
 * Translates any thrown error into an RFC 7807 problem+json response.
 * Never leaks stack traces to clients (see CLAUDE.md security rules); the full
 * error is logged server-side with the request id for correlation.
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { id?: string }>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const problem: ProblemDetails = {
      type: 'about:blank',
      title: HttpStatus[status] ?? 'Error',
      status,
      instance: req.originalUrl,
      requestId: req.id,
    };

    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      if (typeof body === 'string') {
        problem.detail = body;
      } else if (body && typeof body === 'object') {
        const obj = body as Record<string, unknown>;
        if (typeof obj.message === 'string') problem.detail = obj.message;
        else if (Array.isArray(obj.message)) problem.detail = obj.message.join('; ');
        if (obj.errors && typeof obj.errors === 'object') {
          problem.errors = obj.errors as Record<string, string[]>;
        }
      }
    } else {
      // Unexpected error: log the real cause, return a generic message.
      this.logger.error(
        exception instanceof Error ? exception.stack ?? exception.message : String(exception),
      );
      problem.detail = 'Internal server error';
    }

    res.status(status).type('application/problem+json').json(problem);
  }
}
