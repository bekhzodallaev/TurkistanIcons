import { ConflictException, NotFoundException } from '@nestjs/common';
import type { CategoriesService } from '../categories/categories.service';
import type { AuditService } from '../audit/audit.service';
import type { MailerService } from '../../mailer/mailer.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { R2Service } from '../../storage/r2.service';
import { ModerationService } from './moderation.service';

function pendingIcon(overrides: Record<string, unknown> = {}) {
  return {
    id: 'icon-1',
    name: "Do'ppi",
    status: 'PENDING_REVIEW',
    deletedAt: null,
    categoryId: 'cat-1',
    pngKey: 'public/icons/icon-1/preview.png',
    creator: { user: { email: 'creator@example.com' } },
    iconTags: [{ tagId: 'tag-1' }, { tagId: 'tag-2' }],
    ...overrides,
  };
}

function setup() {
  const tx = {
    icon: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    category: { update: jest.fn() },
    tag: { updateMany: jest.fn() },
    moderationEvent: { create: jest.fn() },
  };
  const prisma = {
    icon: { findUnique: jest.fn() },
    $transaction: jest.fn().mockImplementation(async (cb: (t: typeof tx) => unknown) => cb(tx)),
  };
  const r2 = { publicUrl: jest.fn((k: string) => `https://cdn/${k}`) };
  const mailer = {
    sendIconApproved: jest.fn().mockResolvedValue(undefined),
    sendIconRejected: jest.fn().mockResolvedValue(undefined),
    sendIconChangesRequested: jest.fn().mockResolvedValue(undefined),
  };
  const audit = { recordTx: jest.fn().mockResolvedValue(undefined) };
  const categories = { invalidateTree: jest.fn().mockResolvedValue(undefined) };

  const service = new ModerationService(
    prisma as unknown as PrismaService,
    r2 as unknown as R2Service,
    mailer as unknown as MailerService,
    audit as unknown as AuditService,
    categories as unknown as CategoriesService,
  );
  return { service, prisma, tx, mailer, audit, categories };
}

describe('ModerationService.approve', () => {
  it('publishes the icon, bumps counters, records the event + audit, invalidates cache', async () => {
    const { service, prisma, tx, audit, categories, mailer } = setup();
    prisma.icon.findUnique.mockResolvedValue(pendingIcon());

    const res = await service.approve('icon-1', 'admin-1');

    expect(tx.icon.updateMany).toHaveBeenCalledWith({
      where: { id: 'icon-1', status: 'PENDING_REVIEW' },
      data: expect.objectContaining({ status: 'PUBLISHED', publishedAt: expect.any(Date) }),
    });
    expect(tx.category.update).toHaveBeenCalledWith({
      where: { id: 'cat-1' },
      data: { iconCount: { increment: 1 } },
    });
    expect(tx.tag.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['tag-1', 'tag-2'] } },
      data: { usageCount: { increment: 1 } },
    });
    expect(tx.moderationEvent.create).toHaveBeenCalledWith({
      data: { iconId: 'icon-1', moderatorId: 'admin-1', action: 'APPROVE' },
    });
    expect(audit.recordTx).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ actorId: 'admin-1', action: 'icon.approve', entityId: 'icon-1' }),
    );
    expect(categories.invalidateTree).toHaveBeenCalled();
    expect(mailer.sendIconApproved).toHaveBeenCalledWith('creator@example.com', "Do'ppi");
    expect(res).toEqual({ id: 'icon-1', status: 'PUBLISHED' });
  });

  it('409s when the icon is not pending review', async () => {
    const { service, prisma } = setup();
    prisma.icon.findUnique.mockResolvedValue(pendingIcon({ status: 'PUBLISHED' }));
    await expect(service.approve('icon-1', 'admin-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('404s when the icon does not exist', async () => {
    const { service, prisma } = setup();
    prisma.icon.findUnique.mockResolvedValue(null);
    await expect(service.approve('icon-1', 'admin-1')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('ModerationService.reject', () => {
  it('rejects with a reason and records the event + audit', async () => {
    const { service, prisma, tx, audit, mailer } = setup();
    prisma.icon.findUnique.mockResolvedValue(pendingIcon());

    const res = await service.reject('icon-1', 'admin-1', 'low quality');

    expect(tx.icon.updateMany).toHaveBeenCalledWith({
      where: { id: 'icon-1', status: 'PENDING_REVIEW' },
      data: { status: 'REJECTED', rejectionReason: 'low quality' },
    });
    expect(tx.moderationEvent.create).toHaveBeenCalledWith({
      data: { iconId: 'icon-1', moderatorId: 'admin-1', action: 'REJECT', reason: 'low quality' },
    });
    expect(audit.recordTx).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ action: 'icon.reject', metadata: { reason: 'low quality' } }),
    );
    expect(mailer.sendIconRejected).toHaveBeenCalledWith('creator@example.com', "Do'ppi", 'low quality');
    expect(res).toEqual({ id: 'icon-1', status: 'REJECTED' });
  });
});

describe('ModerationService.requestChanges', () => {
  it('keeps PENDING_REVIEW and records the decision', async () => {
    const { service, prisma, tx, mailer } = setup();
    prisma.icon.findUnique.mockResolvedValue(pendingIcon());

    const res = await service.requestChanges('icon-1', 'admin-1', 'fix the viewBox');

    expect(tx.icon.updateMany).not.toHaveBeenCalled();
    expect(tx.moderationEvent.create).toHaveBeenCalledWith({
      data: { iconId: 'icon-1', moderatorId: 'admin-1', action: 'REQUEST_CHANGES', reason: 'fix the viewBox' },
    });
    expect(mailer.sendIconChangesRequested).toHaveBeenCalledWith(
      'creator@example.com',
      "Do'ppi",
      'fix the viewBox',
    );
    expect(res).toEqual({ id: 'icon-1', status: 'PENDING_REVIEW' });
  });
});
