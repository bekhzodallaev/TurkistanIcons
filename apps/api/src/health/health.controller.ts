import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  MemoryHealthIndicator,
} from '@nestjs/terminus';
import { Public } from '../common/decorators/public.decorator';

/**
 * Health endpoints. Served outside the `api` global prefix and unversioned so
 * probes hit `/health` directly. Public so the global JwtAuthGuard does not
 * gate liveness/readiness. Datastore (DB/Redis) readiness indicators are added
 * as those dependencies come online in later milestones.
 */
@Public()
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly memory: MemoryHealthIndicator,
  ) {}

  /** Liveness: trivially returns 200 if the process is up. */
  @Get('live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /** Readiness: aggregate check. Returns 200 when all indicators pass. */
  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.memory.checkHeap('memory_heap', 512 * 1024 * 1024),
    ]);
  }
}
