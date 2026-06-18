import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import {
  IconProcessingProducer,
  type IconProcessingJob,
} from '../../modules/uploads/icon-processing.producer';
import { ICON_PROCESSING_JOB, ICON_PROCESSING_QUEUE } from './queue.constants';

/**
 * BullMQ-backed producer (replaces the M5a no-op stub). `jobId = iconId` makes
 * enqueue idempotent: a re-finalize of the same icon does not duplicate the job.
 */
@Injectable()
export class BullIconProcessingProducer extends IconProcessingProducer {
  constructor(
    @InjectQueue(ICON_PROCESSING_QUEUE) private readonly queue: Queue<IconProcessingJob>,
  ) {
    super();
  }

  async enqueue(job: IconProcessingJob): Promise<void> {
    await this.queue.add(ICON_PROCESSING_JOB, job, {
      jobId: job.iconId,
      attempts: 4,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: { age: 3600, count: 1000 },
      removeOnFail: false,
    });
  }
}
