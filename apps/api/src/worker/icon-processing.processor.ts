import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import {
  MAX_SVG_UPLOAD_BYTES,
  UPLOAD_REJECTION_REASONS,
  type UploadRejectionReason,
} from '@turkistan/types';
import { Job, UnrecoverableError } from 'bullmq';
import { ICON_PROCESSING_QUEUE } from '../infra/queue/queue.constants';
import { IconStateService } from '../modules/icons/icon-state.service';
import type { IconProcessingJob } from '../modules/uploads/icon-processing.producer';
import { PreviewRendererService } from '../modules/uploads/preview-renderer.service';
import {
  SvgRejectedError,
  SvgSanitizerService,
} from '../modules/uploads/svg-sanitizer.service';
import { R2Service } from '../storage/r2.service';

const REJECTION_REASONS = new Set<string>(UPLOAD_REJECTION_REASONS);

/**
 * Consumes `icon-processing` jobs: download quarantined SVG → sanitize → dedupe
 * → render previews → promote to public → writeback (PROCESSING → PENDING_REVIEW).
 *
 * Idempotent: assets are written to deterministic per-icon keys (overwrite, no
 * duplication) and the status writeback is conditional, so replaying a job is a
 * no-op. Permanent failures throw UnrecoverableError (no retry) and land the icon
 * in REJECTED with a machine-readable reason. See docs/UPLOAD-PIPELINE.md §4–7.
 */
@Processor(ICON_PROCESSING_QUEUE, { concurrency: 4 })
export class IconProcessingProcessor extends WorkerHost {
  private readonly logger = new Logger(IconProcessingProcessor.name);

  constructor(
    private readonly r2: R2Service,
    private readonly sanitizer: SvgSanitizerService,
    private readonly renderer: PreviewRendererService,
    private readonly icons: IconStateService,
  ) {
    super();
  }

  async process(job: Job<IconProcessingJob>): Promise<void> {
    const { iconId, rawKey, creatorId } = job.data;

    // Idempotency: only act while the icon is still PROCESSING.
    const status = await this.icons.currentStatus(iconId);
    if (status !== 'PROCESSING') {
      this.logger.log(`Skipping ${iconId}: status is ${status ?? 'missing'}, not PROCESSING`);
      return;
    }

    const raw = await this.r2.getRawCapped(rawKey, MAX_SVG_UPLOAD_BYTES);

    let clean;
    try {
      clean = await this.sanitizer.sanitize(raw);
    } catch (err) {
      if (err instanceof SvgRejectedError) throw new UnrecoverableError(err.code);
      throw err; // transient (e.g. OOM) → allow retry
    }

    const duplicate = await this.icons.findPublishedByChecksum(creatorId, clean.checksum);
    if (duplicate) throw new UnrecoverableError('duplicate');

    const { png, thumb } = await this.renderer.render(clean.svg);

    // Deterministic keys → overwrite-safe on replay.
    const svgKey = await this.r2.putSanitizedSvg(iconId, clean.svg);
    const pngKey = await this.r2.putPreviewPng(iconId, 'preview', png);
    const thumbKey = await this.r2.putPreviewPng(iconId, 'thumb', thumb);

    await this.icons.completeProcessing(iconId, {
      svgKey,
      pngKey,
      thumbKey,
      width: clean.width,
      height: clean.height,
      fileSize: clean.svg.byteLength,
      checksum: clean.checksum,
    });
    this.logger.log(`Processed ${iconId} → PENDING_REVIEW`);
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<IconProcessingJob>, err: Error): Promise<void> {
    const attempts = job.opts.attempts ?? 1;
    const exhausted = err instanceof UnrecoverableError || job.attemptsMade >= attempts;
    if (!exhausted) return; // transient; BullMQ will retry
    await this.icons.failProcessing(job.data.iconId, this.reasonFrom(err));
    this.logger.warn(`Icon ${job.data.iconId} rejected: ${this.reasonFrom(err)}`);
  }

  private reasonFrom(err: Error): UploadRejectionReason {
    if (REJECTION_REASONS.has(err.message)) return err.message as UploadRejectionReason;
    return 'render_failed';
  }
}
