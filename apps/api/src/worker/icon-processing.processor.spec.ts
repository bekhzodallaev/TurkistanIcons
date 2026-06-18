import { Job, UnrecoverableError } from 'bullmq';
import type { IconStateService } from '../modules/icons/icon-state.service';
import type { IconProcessingJob } from '../modules/uploads/icon-processing.producer';
import type { PreviewRendererService } from '../modules/uploads/preview-renderer.service';
import {
  SvgRejectedError,
  type SvgSanitizerService,
} from '../modules/uploads/svg-sanitizer.service';
import type { R2Service } from '../storage/r2.service';
import { IconProcessingProcessor } from './icon-processing.processor';

const JOB_DATA: IconProcessingJob = {
  iconId: 'icon-1',
  rawKey: 'quarantine/c1/icon-1/x.svg',
  creatorId: 'c1',
};

function setup() {
  const r2 = {
    getRawCapped: jest.fn().mockResolvedValue(Buffer.from('<svg/>')),
    putSanitizedSvg: jest.fn().mockResolvedValue('public/icons/icon-1/icon.svg'),
    putPreviewPng: jest
      .fn()
      .mockImplementation((id: string, variant: string) =>
        Promise.resolve(`public/icons/${id}/${variant}.png`),
      ),
  };
  const sanitizer = {
    sanitize: jest.fn().mockResolvedValue({
      svg: Buffer.from('<svg clean/>'),
      checksum: 'abc123',
      width: 24,
      height: 24,
    }),
  };
  const renderer = {
    render: jest.fn().mockResolvedValue({ png: Buffer.from('png'), thumb: Buffer.from('thumb') }),
  };
  const icons = {
    currentStatus: jest.fn().mockResolvedValue('PROCESSING'),
    findPublishedByChecksum: jest.fn().mockResolvedValue(null),
    completeProcessing: jest.fn().mockResolvedValue(undefined),
    failProcessing: jest.fn().mockResolvedValue(undefined),
  };
  const processor = new IconProcessingProcessor(
    r2 as unknown as R2Service,
    sanitizer as unknown as SvgSanitizerService,
    renderer as unknown as PreviewRendererService,
    icons as unknown as IconStateService,
  );
  return { processor, r2, sanitizer, renderer, icons };
}

function job(data: IconProcessingJob = JOB_DATA, opts: { attempts?: number } = {}, attemptsMade = 0) {
  return { data, opts: { attempts: opts.attempts ?? 4 }, attemptsMade } as unknown as Job<IconProcessingJob>;
}

describe('IconProcessingProcessor.process', () => {
  it('runs the full pipeline and promotes to PENDING_REVIEW', async () => {
    const { processor, r2, renderer, icons } = setup();

    await processor.process(job());

    expect(renderer.render).toHaveBeenCalled();
    expect(r2.putSanitizedSvg).toHaveBeenCalledWith('icon-1', expect.any(Buffer));
    expect(r2.putPreviewPng).toHaveBeenCalledWith('icon-1', 'preview', expect.any(Buffer));
    expect(r2.putPreviewPng).toHaveBeenCalledWith('icon-1', 'thumb', expect.any(Buffer));
    expect(icons.completeProcessing).toHaveBeenCalledWith(
      'icon-1',
      expect.objectContaining({ checksum: 'abc123', width: 24, height: 24 }),
    );
  });

  it('is idempotent: skips when the icon is no longer PROCESSING', async () => {
    const { processor, r2, icons } = setup();
    icons.currentStatus.mockResolvedValue('PENDING_REVIEW');

    await processor.process(job());

    expect(r2.getRawCapped).not.toHaveBeenCalled();
    expect(icons.completeProcessing).not.toHaveBeenCalled();
  });

  it('throws UnrecoverableError (no retry) on unsafe content', async () => {
    const { processor, sanitizer } = setup();
    sanitizer.sanitize.mockRejectedValue(new SvgRejectedError('unsafe_content', 'bad'));

    await expect(processor.process(job())).rejects.toBeInstanceOf(UnrecoverableError);
  });

  it('throws UnrecoverableError on a checksum duplicate', async () => {
    const { processor, icons } = setup();
    icons.findPublishedByChecksum.mockResolvedValue({ id: 'existing' });

    await expect(processor.process(job())).rejects.toThrow('duplicate');
  });
});

describe('IconProcessingProcessor.onFailed', () => {
  it('marks the icon REJECTED with the reason on an unrecoverable failure', async () => {
    const { processor, icons } = setup();

    await processor.onFailed(job(), new UnrecoverableError('unsafe_content'));

    expect(icons.failProcessing).toHaveBeenCalledWith('icon-1', 'unsafe_content');
  });

  it('does not reject yet while transient retries remain', async () => {
    const { processor, icons } = setup();

    await processor.onFailed(job(JOB_DATA, { attempts: 4 }, 1), new Error('r2 timeout'));

    expect(icons.failProcessing).not.toHaveBeenCalled();
  });

  it('maps an unknown error to render_failed after retries are exhausted', async () => {
    const { processor, icons } = setup();

    await processor.onFailed(job(JOB_DATA, { attempts: 4 }, 4), new Error('boom'));

    expect(icons.failProcessing).toHaveBeenCalledWith('icon-1', 'render_failed');
  });
});
