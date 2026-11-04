import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest');
import { SupportPatchController } from '../src/modules/conversions/presentation/support-patch.controller';
import { ConversionSupportPatchService } from '../src/modules/conversions/application/conversion-support-patch.service';
import { EffectivePermissionsService } from '../src/modules/rbac/application/effective-permissions.service';
import { JwtAuthGuard } from '../src/shared/security/jwt-auth.guard';
import { ApiExceptionFilter } from '../src/shared/errors/api-exception.filter';

const JOB = '6650ee00ee00ee00ee00ee01';
const BODY = {
  rules: [{ sourceField: 'CUST_BAL_AMT', targetProperty: 'currentBalance', dataType: 'BigDecimal' }],
  note: 'Balance is a decimal',
};

describe('Conversion support patch endpoints (HTTP)', () => {
  let app: INestApplication;
  const service = { get: jest.fn(), apply: jest.fn() };
  const permissions = { getEffectivePermissions: jest.fn() };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [SupportPatchController],
      providers: [
        { provide: ConversionSupportPatchService, useValue: service },
        { provide: EffectivePermissionsService, useValue: permissions },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: { switchToHttp: () => { getRequest: () => { user?: unknown } } }) => {
          context.switchToHttp().getRequest().user = { userId: 'staff-1' };
          return true;
        },
      })
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    permissions.getEffectivePermissions.mockResolvedValue([
      'conversions.troubleshoot.view',
      'conversions.support_patch.apply',
    ]);
    service.apply.mockResolvedValue({ job: { id: JOB, status: 'QUEUED' }, patch: { id: 'p1' }, warnings: [] });
    service.get.mockResolvedValue({ job: { id: JOB }, rules: [], history: [] });
  });

  it('applies a patch with 201 for staff holding conversions.support_patch.apply', async () => {
    const response = await request(app.getHttpServer())
      .post(`/conversions/${JOB}/support-patch`)
      .set('x-organization-id', 'org-a')
      .send(BODY);

    expect(response.status).toBe(201);
    expect(response.body.job.status).toBe('QUEUED');
    expect(service.apply).toHaveBeenCalledWith('staff-1', 'org-a', JOB, BODY);
  });

  it('returns 403 without the apply permission, but still allows reading', async () => {
    permissions.getEffectivePermissions.mockResolvedValue(['conversions.troubleshoot.view']);
    const server = app.getHttpServer();

    const apply = await request(server).post(`/conversions/${JOB}/support-patch`).send(BODY);
    const read = await request(server).get(`/conversions/${JOB}/support-patch`);

    expect(apply.status).toBe(403);
    expect(service.apply).not.toHaveBeenCalled();
    expect(read.status).toBe(200);
  });

  it('rejects a missing note, an unknown data type and extra fields with 400', async () => {
    const server = app.getHttpServer();
    const url = `/conversions/${JOB}/support-patch`;

    const responses = [
      await request(server).post(url).send({ rules: BODY.rules, note: '' }),
      await request(server)
        .post(url)
        .send({ ...BODY, rules: [{ ...BODY.rules[0], dataType: 'money' }] }),
      await request(server)
        .post(url)
        .send({ ...BODY, rules: [{ ...BODY.rules[0], status: 'COMPLETED' }] }),
    ];

    for (const response of responses) expect(response.status).toBe(400);
    expect(service.apply).not.toHaveBeenCalled();
  });
});
