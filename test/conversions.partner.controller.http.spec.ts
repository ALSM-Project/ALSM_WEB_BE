import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest');
import { ConversionsController } from '../src/modules/conversions/presentation/conversions.controller';
import { ConversionJobService } from '../src/modules/conversions/application/conversion-job.service';
import { GetConversionResultService } from '../src/modules/conversions/application/get-conversion-result.service';
import { EffectivePermissionsService } from '../src/modules/rbac/application/effective-permissions.service';
import { JwtAuthGuard } from '../src/shared/security/jwt-auth.guard';
import { ApiExceptionFilter } from '../src/shared/errors/api-exception.filter';

const PROJECT = '6650aa00aa00aa00aa00aa01';
const SCREEN = '6650bb00bb00bb00bb00bb0a';

describe('UC-47 partner conversion endpoints (HTTP)', () => {
  let app: INestApplication;
  const conversions = { startForPartner: jest.fn(), startBulkForPartner: jest.fn() };
  const permissions = { getEffectivePermissions: jest.fn() };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ConversionsController],
      providers: [
        { provide: ConversionJobService, useValue: conversions },
        { provide: GetConversionResultService, useValue: {} },
        { provide: EffectivePermissionsService, useValue: permissions },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: {
          switchToHttp: () => { getRequest: () => { user?: unknown } };
        }) => {
          context.switchToHttp().getRequest().user = { userId: 'staff-1' };
          return true;
        },
      })
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    permissions.getEffectivePermissions.mockResolvedValue(['partner_project.start_conversion']);
    conversions.startForPartner.mockResolvedValue({ id: 'job-1', status: 'QUEUED' });
    conversions.startBulkForPartner.mockResolvedValue({ jobs: [{ id: 'job-1' }], skipped: [] });
  });

  it('queues a single conversion with 201 for staff holding partner_project.start_conversion', async () => {
    const response = await request(app.getHttpServer())
      .post(`/projects/${PROJECT}/conversions/jobs`)
      .set('x-organization-id', 'org-a')
      .send({ screenId: SCREEN, priority: 'HIGH' });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ id: 'job-1', status: 'QUEUED' });
    expect(conversions.startForPartner).toHaveBeenCalledWith('staff-1', 'org-a', PROJECT, {
      screenId: SCREEN,
      priority: 'HIGH',
    });
  });

  it('returns 403 without the permission and never reaches the service', async () => {
    permissions.getEffectivePermissions.mockResolvedValue(['partner_project.view']);

    const single = await request(app.getHttpServer())
      .post(`/projects/${PROJECT}/conversions/jobs`)
      .send({ screenId: SCREEN });
    const bulk = await request(app.getHttpServer())
      .post(`/projects/${PROJECT}/conversions/jobs/bulk`)
      .send({ screenIds: [SCREEN] });

    expect(single.status).toBe(403);
    expect(bulk.status).toBe(403);
    expect(conversions.startForPartner).not.toHaveBeenCalled();
    expect(conversions.startBulkForPartner).not.toHaveBeenCalled();
  });

  it('rejects an invalid screen id, unknown priority or a client-supplied inputReference with 400', async () => {
    const badId = await request(app.getHttpServer())
      .post(`/projects/${PROJECT}/conversions/jobs`)
      .send({ screenId: 'not-an-object-id' });
    const badPriority = await request(app.getHttpServer())
      .post(`/projects/${PROJECT}/conversions/jobs`)
      .send({ screenId: SCREEN, priority: 'URGENT' });
    const injected = await request(app.getHttpServer())
      .post(`/projects/${PROJECT}/conversions/jobs`)
      .send({ screenId: SCREEN, inputReference: 'sources/other-org/secret' });
    const badBulk = await request(app.getHttpServer())
      .post(`/projects/${PROJECT}/conversions/jobs/bulk`)
      .send({ screenIds: [SCREEN, 'nope'] });
    const emptyBulk = await request(app.getHttpServer())
      .post(`/projects/${PROJECT}/conversions/jobs/bulk`)
      .send({ screenIds: [] });

    for (const response of [badId, badPriority, injected, badBulk, emptyBulk]) {
      expect(response.status).toBe(400);
    }
    expect(conversions.startForPartner).not.toHaveBeenCalled();
    expect(conversions.startBulkForPartner).not.toHaveBeenCalled();
  });

  it('runs all conversions and returns the queued jobs and skipped screens', async () => {
    conversions.startBulkForPartner.mockResolvedValue({
      jobs: [{ id: 'job-1', screenId: SCREEN }],
      skipped: [
        {
          screenId: '6650bb00bb00bb00bb00bb0b',
          code: 'CONVERSION_ALREADY_IN_PROGRESS',
          message: 'x',
        },
      ],
    });

    const response = await request(app.getHttpServer())
      .post(`/projects/${PROJECT}/conversions/jobs/bulk`)
      .send({ screenIds: [SCREEN, '6650bb00bb00bb00bb00bb0b'] });

    expect(response.status).toBe(201);
    expect(response.body.jobs).toHaveLength(1);
    expect(response.body.skipped[0].code).toBe('CONVERSION_ALREADY_IN_PROGRESS');
  });
});
