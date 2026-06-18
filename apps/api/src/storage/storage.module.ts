import { Global, Module } from '@nestjs/common';
import { R2Service } from './r2.service';

/** Global storage module (Cloudflare R2 / S3-compatible). */
@Global()
@Module({
  providers: [R2Service],
  exports: [R2Service],
})
export class StorageModule {}
