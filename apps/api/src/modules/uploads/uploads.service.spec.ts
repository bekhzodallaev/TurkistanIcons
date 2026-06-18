import {
  ConflictException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { UploadInitInput, UploadInitResponse } from '@turkistan/types';
import type { PrismaService } from '../../prisma/prisma.service';
import type { RedisService } from '../../redis/redis.service';
import type { R2Service } from '../../storage/r2.service';
import type { IconStateService } from '../icons/icon-state.service';
import type { IconProcessingProducer } from './icon-processing.producer';
import { UploadsService } from './uploads.service';

function setup() {
  const prisma = {
    creator: { findUnique: jest.fn() },
    category: { count: jest.fn().mockResolvedValue(1) },
    tag: { findUnique: jest.fn(), create: jest.fn() },
    icon: { update: jest.fn(), count: jest.fn().mockResolvedValue(0) },
  };
  const redis = {
    cacheGetJson: jest.fn().mockResolvedValue(null),
    cacheSetJson: jest.fn().mockResolvedValue(undefined),
  };
  const r2 = {
    isConfigured: jest.fn().mockReturnValue(true),
    signRawUploadUrl: jest.fn().mockResolvedValue('https://r2.example/signed'),
    headRaw: jest.fn(),
    publicUrl: jest.fn((k: string) => `https://cdn/${k}`),
  };
  const icons = {
    createDraft: jest.fn(),
    findOwned: jest.fn(),
    transition: jest.fn().mockResolvedValue(undefined),
  };
  const producer = { enqueue: jest.fn().mockResolvedValue(undefined) };

  const service = new UploadsService(
    prisma as unknown as PrismaService,
    redis as unknown as RedisService,
    r2 as unknown as R2Service,
    icons as unknown as IconStateService,
    producer as unknown as IconProcessingProducer,
  );
  return { service, prisma, redis, r2, icons, producer };
}

const dto: UploadInitInput = {
  fileName: 'doppi.svg',
  contentType: 'image/svg+xml',
  fileSize: 1000,
  name: "Do'ppi",
  categoryId: '00000000-0000-0000-0000-000000000001',
  priceType: 'FREE',
  priceCents: 0,
  license: 'FREE_ATTRIBUTION',
  tags: [],
};

describe('UploadsService.init', () => {
  it('503s when storage is not configured', async () => {
    const { service, r2 } = setup();
    r2.isConfigured.mockReturnValue(false);
    await expect(service.init('u1', dto, 'idem-1')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('403s when the caller has no creator profile', async () => {
    const { service, prisma } = setup();
    prisma.creator.findUnique.mockResolvedValue(null);
    await expect(service.init('u1', dto, 'idem-1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('returns the cached response for a repeated Idempotency-Key', async () => {
    const { service, prisma, redis, icons } = setup();
    prisma.creator.findUnique.mockResolvedValue({ id: 'c1' });
    const cached: UploadInitResponse = {
      icon: { id: 'i1', status: 'DRAFT', slug: 'doppi' },
      upload: { url: 'u', method: 'PUT', headers: {}, maxBytes: 1, expiresIn: 300 },
    };
    redis.cacheGetJson.mockResolvedValue(cached);

    const res = await service.init('u1', dto, 'idem-1');

    expect(res).toBe(cached);
    expect(icons.createDraft).not.toHaveBeenCalled();
  });

  it('creates a DRAFT, signs a PUT, and caches the response', async () => {
    const { service, prisma, r2, icons, redis } = setup();
    prisma.creator.findUnique.mockResolvedValue({ id: 'c1' });
    icons.createDraft.mockResolvedValue({ id: 'i1' });

    const res = await service.init('u1', dto, 'idem-1');

    expect(res.icon.id).toBe('i1');
    expect(res.upload.url).toBe('https://r2.example/signed');
    // svgRawKey is patched in with the new icon id.
    expect(prisma.icon.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'i1' } }),
    );
    expect(r2.signRawUploadUrl).toHaveBeenCalled();
    expect(redis.cacheSetJson).toHaveBeenCalled();
  });
});

describe('UploadsService.finalize', () => {
  it('is idempotent: a non-DRAFT icon returns its current status', async () => {
    const { service, icons, r2 } = setup();
    icons.findOwned.mockResolvedValue({
      id: 'i1',
      status: 'PROCESSING',
      creatorId: 'c1',
      svgRawKey: 'k',
    });

    const res = await service.finalize('i1', 'u1');

    expect(res).toEqual({ id: 'i1', status: 'PROCESSING' });
    expect(r2.headRaw).not.toHaveBeenCalled();
    expect(icons.transition).not.toHaveBeenCalled();
  });

  it('409s when the quarantine object is missing', async () => {
    const { service, icons, r2 } = setup();
    icons.findOwned.mockResolvedValue({
      id: 'i1',
      status: 'DRAFT',
      creatorId: 'c1',
      svgRawKey: 'k',
    });
    r2.headRaw.mockResolvedValue(null);

    await expect(service.finalize('i1', 'u1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('transitions DRAFT → PROCESSING and enqueues the job', async () => {
    const { service, icons, r2, producer } = setup();
    icons.findOwned.mockResolvedValue({
      id: 'i1',
      status: 'DRAFT',
      creatorId: 'c1',
      svgRawKey: 'quarantine/c1/i1/x.svg',
    });
    r2.headRaw.mockResolvedValue({ size: 2048, contentType: 'image/svg+xml' });

    const res = await service.finalize('i1', 'u1');

    expect(icons.transition).toHaveBeenCalledWith('i1', 'DRAFT', 'PROCESSING', { fileSize: 2048 });
    expect(producer.enqueue).toHaveBeenCalledWith({
      iconId: 'i1',
      rawKey: 'quarantine/c1/i1/x.svg',
      creatorId: 'c1',
    });
    expect(res).toEqual({ id: 'i1', status: 'PROCESSING' });
  });
});
