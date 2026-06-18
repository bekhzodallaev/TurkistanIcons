import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';

/** Global audit-trail module. */
@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
