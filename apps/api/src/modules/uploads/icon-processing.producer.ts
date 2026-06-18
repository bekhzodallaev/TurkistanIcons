import { Injectable, Logger } from '@nestjs/common';

export interface IconProcessingJob {
  iconId: string;
  rawKey: string;
  creatorId: string;
}

/**
 * Seam between the upload API and the processing worker. M5a ships a no-op stub
 * so finalize works end-to-end at the API layer; M5b replaces this provider with
 * a BullMQ producer (jobId = iconId for dedupe) without touching callers.
 */
export abstract class IconProcessingProducer {
  abstract enqueue(job: IconProcessingJob): Promise<void>;
}

@Injectable()
export class LoggingIconProcessingProducer extends IconProcessingProducer {
  private readonly logger = new Logger('IconProcessingProducer');

  enqueue(job: IconProcessingJob): Promise<void> {
    this.logger.log(
      `[stub] icon-processing enqueue skipped (worker arrives in M5b): icon=${job.iconId}`,
    );
    return Promise.resolve();
  }
}
