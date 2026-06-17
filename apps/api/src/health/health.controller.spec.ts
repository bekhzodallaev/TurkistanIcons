import { Test } from '@nestjs/testing';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [TerminusModule],
      controllers: [HealthController],
    }).compile();

    controller = moduleRef.get(HealthController);
  });

  it('liveness returns ok', () => {
    expect(controller.live()).toEqual({ status: 'ok' });
  });

  it('readiness reports a healthy status', async () => {
    const result = await controller.check();
    expect(result.status).toBe('ok');
  });
});
