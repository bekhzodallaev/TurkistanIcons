import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  AdminApplicationDto,
  ApplyCreatorInput,
  CreatorApplicationDto,
  CreatorRef,
  ListApplicationsQuery,
} from '@turkistan/types';
import type { CreatorApplication } from '@prisma/client';
import { slugify } from '../../common/util/slug.util';
import { MailerService } from '../../mailer/mailer.service';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class CreatorApplicationsService {
  private readonly logger = new Logger(CreatorApplicationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailer: MailerService,
  ) {}

  /** A USER submits an application. Reapplying after rejection is allowed. */
  async apply(userId: string, dto: ApplyCreatorInput): Promise<CreatorApplicationDto> {
    const creator = await this.prisma.creator.findUnique({ where: { userId } });
    if (creator) throw new ConflictException('You are already a creator');

    const pending = await this.prisma.creatorApplication.findFirst({
      where: { userId, status: 'PENDING' },
    });
    if (pending) throw new ConflictException('You already have a pending application');

    const application = await this.prisma.creatorApplication.create({
      data: {
        userId,
        portfolioUrl: dto.portfolioUrl ?? null,
        message: dto.message ?? null,
      },
    });
    return this.toDto(application);
  }

  /** The applicant's most recent application (status + reviewer note). */
  async getOwnLatest(userId: string): Promise<CreatorApplicationDto> {
    const application = await this.prisma.creatorApplication.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    if (!application) throw new NotFoundException('You have not applied yet');
    return this.toDto(application);
  }

  // ---- Admin review queue ----

  async list(query: ListApplicationsQuery): Promise<AdminApplicationDto[]> {
    const apps = await this.prisma.creatorApplication.findMany({
      where: query.status ? { status: query.status } : {},
      orderBy: { createdAt: 'desc' },
      take: query.limit,
      include: { user: { select: { id: true, name: true, email: true } } },
    });
    return apps.map((app) => ({
      ...this.toDto(app),
      applicant: { id: app.user.id, name: app.user.name, email: app.user.email },
    }));
  }

  /**
   * Approve: create the creators row, promote the user to CREATOR, and mark the
   * application APPROVED — atomically. The role change takes effect on the
   * applicant's next token refresh. Notification email is best-effort.
   */
  async approve(
    applicationId: string,
    adminId: string,
  ): Promise<{ application: CreatorApplicationDto; creator: CreatorRef }> {
    const app = await this.prisma.creatorApplication.findUnique({
      where: { id: applicationId },
      include: { user: { select: { id: true, name: true, email: true } } },
    });
    if (!app) throw new NotFoundException('Application not found');
    if (app.status !== 'PENDING') {
      throw new ConflictException('Application has already been reviewed');
    }
    const existing = await this.prisma.creator.findUnique({ where: { userId: app.userId } });
    if (existing) throw new ConflictException('User is already a creator');

    const slug = await this.uniqueCreatorSlug(slugify(app.user.name));

    const { creator, application } = await this.prisma.$transaction(async (tx) => {
      const creator = await tx.creator.create({
        data: { userId: app.userId, displayName: app.user.name, slug },
      });
      await tx.user.update({ where: { id: app.userId }, data: { role: 'CREATOR' } });
      const application = await tx.creatorApplication.update({
        where: { id: applicationId },
        data: { status: 'APPROVED', reviewedBy: adminId, reviewNote: null },
      });
      return { creator, application };
    });

    await this.notify(() => this.mailer.sendCreatorApproved(app.user.email, slug));

    return {
      application: this.toDto(application),
      creator: { id: creator.id, slug: creator.slug, displayName: creator.displayName },
    };
  }

  async reject(
    applicationId: string,
    adminId: string,
    reviewNote: string,
  ): Promise<CreatorApplicationDto> {
    const app = await this.prisma.creatorApplication.findUnique({
      where: { id: applicationId },
      include: { user: { select: { email: true } } },
    });
    if (!app) throw new NotFoundException('Application not found');
    if (app.status !== 'PENDING') {
      throw new ConflictException('Application has already been reviewed');
    }
    const updated = await this.prisma.creatorApplication.update({
      where: { id: applicationId },
      data: { status: 'REJECTED', reviewedBy: adminId, reviewNote },
    });
    await this.notify(() => this.mailer.sendCreatorRejected(app.user.email, reviewNote));
    return this.toDto(updated);
  }

  // ---- internals ----

  private async uniqueCreatorSlug(base: string): Promise<string> {
    let candidate = base;
    let suffix = 2;
    while ((await this.prisma.creator.count({ where: { slug: candidate } })) > 0) {
      candidate = `${base}-${suffix++}`;
    }
    return candidate;
  }

  private async notify(send: () => Promise<void>): Promise<void> {
    try {
      await send();
    } catch (err) {
      // Email delivery must never fail the review action.
      this.logger.warn(`Creator notification email failed: ${(err as Error).message}`);
    }
  }

  private toDto(app: CreatorApplication): CreatorApplicationDto {
    return {
      id: app.id,
      status: app.status,
      portfolioUrl: app.portfolioUrl,
      message: app.message,
      reviewNote: app.reviewNote,
      createdAt: app.createdAt.toISOString(),
      updatedAt: app.updatedAt.toISOString(),
    };
  }
}
