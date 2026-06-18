import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  AdminUserDto,
  ListUsersQuery,
  UpdateUserInput,
} from '@turkistan/types';
import type { Prisma, User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { TokenService } from '../auth/token.service';

@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListUsersQuery): Promise<AdminUserDto[]> {
    const where: Prisma.UserWhereInput = {
      ...(query.role ? { role: query.role } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.q
        ? {
            OR: [
              { email: { contains: query.q } }, // citext → case-insensitive
              { name: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const users = await this.prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: query.limit,
    });
    return users.map((u) => this.toDto(u));
  }

  async get(id: string): Promise<AdminUserDto> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    return this.toDto(user);
  }

  async update(id: string, adminId: string, dto: UpdateUserInput): Promise<AdminUserDto> {
    // Guard against an admin locking themselves out or self-escalating.
    if (id === adminId) {
      throw new BadRequestException('You cannot change your own role or status');
    }
    const existing = await this.prisma.user.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('User not found');

    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        ...(dto.role !== undefined ? { role: dto.role } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
      },
    });

    // Suspending revokes all active sessions immediately.
    if (dto.status === 'suspended') {
      await this.tokens.revokeAllSessions(id);
    }

    await this.audit.record({
      actorId: adminId,
      action: 'user.update',
      entity: 'user',
      entityId: id,
      metadata: { role: dto.role ?? null, status: dto.status ?? null },
    });

    return this.toDto(updated);
  }

  private toDto(user: User): AdminUserDto {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      status: user.status,
      emailVerifiedAt: user.emailVerifiedAt ? user.emailVerifiedAt.toISOString() : null,
      createdAt: user.createdAt.toISOString(),
    };
  }
}
