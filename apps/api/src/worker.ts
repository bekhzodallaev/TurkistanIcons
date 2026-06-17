import 'reflect-metadata';
import pino from 'pino';

/**
 * Upload worker entrypoint (placeholder).
 *
 * The real BullMQ consumer that validates/sanitizes SVGs and renders PNG
 * previews arrives in M5 (Icon Upload Pipeline). This stub exists so the
 * worker process, its Dockerfile, and deploy wiring are in place from M0.
 */
const logger = pino({ name: 'upload-worker' });

async function main(): Promise<void> {
  logger.info('upload worker placeholder started; BullMQ consumer arrives in M5');
  // Keep the process alive so container orchestration treats it as a long-running service.
  await new Promise<void>(() => {});
}

void main();
