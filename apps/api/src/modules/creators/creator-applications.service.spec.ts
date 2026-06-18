import { ConflictException, NotFoundException } from '@nestjs/common';
import type { CreatorApplication } from '@prisma/client';
import type { MailerService } from '../../mailer/mailer.service';
import type { PrismaService } from '../../prisma/prisma.service';
import { CreatorApplicationsService } from './creator-applications.service';

function application(
  partial: Partial<CreatorApplication> & Pick<CreatorApplication, 'id' | 'userId'>,
): CreatorApplication {
  return {
    id: partial.id,
    userId: partial.userId,
    status: partial.status ?? 'PENDING',
    portfolioUrl: partial.portfolioUrl ?? null,
    message: partial.message ?? null,
    reviewedBy: partial.reviewedBy ?? null,
    reviewNote: partial.reviewNote ?? null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

function setup() {
  const prisma = {
    creator: { findUnique: jest.fn(), count: jest.fn(), create: jest.fn() },
    creatorApplication: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    user: { update: jest.fn() },
    $transaction: jest.fn(),
  };
  // Run the interactive transaction callback against the same mock object.
  prisma.$transaction.mockImplementation(async (cb: (tx: typeof prisma) => unknown) => cb(prisma));
  const mailer = {
    sendCreatorApproved: jest.fn().mockResolvedValue(undefined),
    sendCreatorRejected: jest.fn().mockResolvedValue(undefined),
  };
  const service = new CreatorApplicationsService(
    prisma as unknown as PrismaService,
    mailer as unknown as MailerService,
  );
  return { service, prisma, mailer };
}

describe('CreatorApplicationsService', () => {
  describe('apply', () => {
    it('creates a PENDING application', async () => {
      const { service, prisma } = setup();
      prisma.creator.findUnique.mockResolvedValue(null);
      prisma.creatorApplication.findFirst.mockResolvedValue(null);
      prisma.creatorApplication.create.mockResolvedValue(
        application({ id: 'app1', userId: 'u1', message: 'hi' }),
      );

      const dto = await service.apply('u1', { message: 'hi' });

      expect(dto.status).toBe('PENDING');
    });

    it('rejects applying when already a creator', async () => {
      const { service, prisma } = setup();
      prisma.creator.findUnique.mockResolvedValue({ id: 'c1' });

      await expect(service.apply('u1', {})).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects a second pending application', async () => {
      const { service, prisma } = setup();
      prisma.creator.findUnique.mockResolvedValue(null);
      prisma.creatorApplication.findFirst.mockResolvedValue(application({ id: 'p', userId: 'u1' }));

      await expect(service.apply('u1', {})).rejects.toBeInstanceOf(ConflictException);
    });

    it('allows reapplying after a rejection (no pending app)', async () => {
      const { service, prisma } = setup();
      prisma.creator.findUnique.mockResolvedValue(null);
      // No PENDING app — a prior REJECTED one does not block.
      prisma.creatorApplication.findFirst.mockResolvedValue(null);
      prisma.creatorApplication.create.mockResolvedValue(application({ id: 'app2', userId: 'u1' }));

      await expect(service.apply('u1', {})).resolves.toMatchObject({ status: 'PENDING' });
    });
  });

  describe('approve', () => {
    it('creates a creator, promotes the user to CREATOR, and marks APPROVED', async () => {
      const { service, prisma, mailer } = setup();
      prisma.creatorApplication.findUnique.mockResolvedValue({
        ...application({ id: 'app1', userId: 'u1', status: 'PENDING' }),
        user: { id: 'u1', name: 'Aziza K.', email: 'aziza@example.com' },
      });
      prisma.creator.findUnique.mockResolvedValue(null);
      prisma.creator.count.mockResolvedValue(0);
      prisma.creator.create.mockResolvedValue({ id: 'c1', slug: 'aziza-k', displayName: 'Aziza K.' });
      prisma.creatorApplication.update.mockResolvedValue(
        application({ id: 'app1', userId: 'u1', status: 'APPROVED', reviewedBy: 'admin1' }),
      );

      const result = await service.approve('app1', 'admin1');

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { role: 'CREATOR' },
      });
      expect(result.creator).toEqual({ id: 'c1', slug: 'aziza-k', displayName: 'Aziza K.' });
      expect(result.application.status).toBe('APPROVED');
      expect(mailer.sendCreatorApproved).toHaveBeenCalledWith('aziza@example.com', 'aziza-k');
    });

    it('rejects approving an already-reviewed application', async () => {
      const { service, prisma } = setup();
      prisma.creatorApplication.findUnique.mockResolvedValue({
        ...application({ id: 'app1', userId: 'u1', status: 'APPROVED' }),
        user: { id: 'u1', name: 'X', email: 'x@example.com' },
      });

      await expect(service.approve('app1', 'admin1')).rejects.toBeInstanceOf(ConflictException);
    });

    it('404s when the application does not exist', async () => {
      const { service, prisma } = setup();
      prisma.creatorApplication.findUnique.mockResolvedValue(null);

      await expect(service.approve('missing', 'admin1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('reject', () => {
    it('marks REJECTED with the review note and notifies the applicant', async () => {
      const { service, prisma, mailer } = setup();
      prisma.creatorApplication.findUnique.mockResolvedValue({
        ...application({ id: 'app1', userId: 'u1', status: 'PENDING' }),
        user: { email: 'u1@example.com' },
      });
      prisma.creatorApplication.update.mockResolvedValue(
        application({ id: 'app1', userId: 'u1', status: 'REJECTED', reviewNote: 'Need more samples' }),
      );

      const dto = await service.reject('app1', 'admin1', 'Need more samples');

      expect(dto.status).toBe('REJECTED');
      expect(dto.reviewNote).toBe('Need more samples');
      expect(mailer.sendCreatorRejected).toHaveBeenCalledWith('u1@example.com', 'Need more samples');
    });

    it('rejects rejecting an already-reviewed application', async () => {
      const { service, prisma } = setup();
      prisma.creatorApplication.findUnique.mockResolvedValue({
        ...application({ id: 'app1', userId: 'u1', status: 'REJECTED' }),
        user: { email: 'u1@example.com' },
      });

      await expect(service.reject('app1', 'admin1', 'note')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });
});
