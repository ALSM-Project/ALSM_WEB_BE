import { INestApplication, UnprocessableEntityException, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest');
import { PartnerExportController } from '../src/modules/conversions/presentation/partner-export.controller';
import { PartnerBundleService } from '../src/modules/conversions/application/partner-bundle.service';
import { PublishPartnerExportService } from '../src/modules/conversions/application/publish-partner-export.service';
import { EffectivePermissionsService } from '../src/modules/rbac/application/effective-permissions.service';
import { JwtAuthGuard } from '../src/shared/security/jwt-auth.guard';
import { ApiExceptionFilter } from '../src/shared/errors/api-exception.filter';

const PROJECT = '6650aa00aa00aa00aa00aa01';
const BUNDLE = '6650ee00ee00ee00ee00ee01';
const OPTIONS = {
  selectedScreenIds: [],
  includeTypeScript: true,
  includeUnitTests: true,
  includeDocumentation: true,
};

describe('UC-48 partner export endpoints (HTTP)', () => {
  let app: INestApplication;
  const built = {
    packageName: 'core-banking-modernized-bundle-v1.zip',
    summary: { screensIncluded: 1, programsIncluded: 0, excludedItems: [] },
    metrics: { totalFiles: 3, totalLoc: 10, estimatedSizeKb: 1 },
    fileTree: [{ path: 'a.tsx', name: 'a.tsx', size: '1 KB', type: 'file', content: 'secret' }],
  };
  const bundles = {
    build: jest.fn(),
    assertHasContent: jest.fn(),
    zip: jest.fn(),
    outline: jest.fn(),
  };
  const publisher = {
    publish: jest.fn(),
    list: jest.fn(),
    download: jest.fn(),
    retryNotification: jest.fn(),
  };
  const permissions = { getEffectivePermissions: jest.fn() };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [PartnerExportController],
      providers: [
        { provide: PartnerBundleService, useValue: bundles },
        { provide: PublishPartnerExportService, useValue: publisher },
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
    permissions.getEffectivePermissions.mockResolvedValue([
      'conversion_result.export',
      'conversion_result.notify_partner',
    ]);
    bundles.build.mockResolvedValue(built);
    bundles.assertHasContent.mockImplementation(() => undefined);
    bundles.zip.mockResolvedValue(Buffer.from('PK-zip'));
    bundles.outline.mockReturnValue([{ path: 'a.tsx', name: 'a.tsx', size: '1 KB', type: 'file' }]);
    publisher.publish.mockResolvedValue({ id: BUNDLE, notificationStatus: 'SENT' });
  });

  it('previews the bundle without file contents', async () => {
    const response = await request(app.getHttpServer())
      .post(`/projects/${PROJECT}/partner-export/preview`)
      .send(OPTIONS);

    expect(response.status).toBe(200);
    expect(response.body.packageName).toBe(built.packageName);
    expect(JSON.stringify(response.body)).not.toContain('secret');
    expect(bundles.build).toHaveBeenCalledWith('staff-1', undefined, PROJECT, OPTIONS);
  });

  it('streams the ZIP with a Content-Disposition attachment header', async () => {
    const response = await request(app.getHttpServer())
      .post(`/projects/${PROJECT}/partner-export/download`)
      .send(OPTIONS)
      .buffer(true)
      .parse((res: NodeJS.ReadableStream, done: (err: Error | null, body: Buffer) => void) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      });

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('application/zip');
    expect(response.headers['content-disposition']).toBe(
      'attachment; filename="core-banking-modernized-bundle-v1.zip"',
    );
    expect(response.body.toString()).toBe('PK-zip');
  });

  it('answers 422 with the excluded items when there is nothing to download', async () => {
    bundles.assertHasContent.mockImplementation(() => {
      throw new UnprocessableEntityException({
        code: 'NO_COMPLETED_ITEMS',
        message: 'None of the selected screens or programs has a completed conversion to export',
      });
    });

    const response = await request(app.getHttpServer())
      .post(`/projects/${PROJECT}/partner-export/download`)
      .send(OPTIONS);

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('NO_COMPLETED_ITEMS');
  });

  it('publishes and notifies with 201 for staff holding both permissions', async () => {
    const response = await request(app.getHttpServer())
      .post(`/projects/${PROJECT}/partner-export/publish-and-notify`)
      .set('x-organization-id', 'org-a')
      .send({ partnerEmail: 'jreynolds@pacificbanking.com', customNotes: 'Ready.', options: OPTIONS });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ id: BUNDLE, notificationStatus: 'SENT' });
    expect(publisher.publish).toHaveBeenCalledWith('staff-1', 'org-a', PROJECT, {
      partnerEmail: 'jreynolds@pacificbanking.com',
      customNotes: 'Ready.',
      options: OPTIONS,
    });
  });

  it('requires conversion_result.notify_partner to publish, but not to download', async () => {
    permissions.getEffectivePermissions.mockResolvedValue(['conversion_result.export']);

    const publish = await request(app.getHttpServer())
      .post(`/projects/${PROJECT}/partner-export/publish-and-notify`)
      .send({ partnerEmail: 'a@b.io', options: OPTIONS });
    const download = await request(app.getHttpServer())
      .post(`/projects/${PROJECT}/partner-export/download`)
      .send(OPTIONS);

    expect(publish.status).toBe(403);
    expect(publisher.publish).not.toHaveBeenCalled();
    expect(download.status).toBe(200);
  });

  it('returns 403 on every export route without conversion_result.export', async () => {
    permissions.getEffectivePermissions.mockResolvedValue(['conversion_result.view']);
    const server = app.getHttpServer();

    const responses = await Promise.all([
      request(server).post(`/projects/${PROJECT}/partner-export/preview`).send(OPTIONS),
      request(server).post(`/projects/${PROJECT}/partner-export/download`).send(OPTIONS),
      request(server).get(`/projects/${PROJECT}/partner-export/bundles`),
      request(server).get(`/projects/${PROJECT}/partner-export/bundles/${BUNDLE}/download`),
    ]);

    for (const response of responses) expect(response.status).toBe(403);
    expect(bundles.build).not.toHaveBeenCalled();
  });

  it('rejects an invalid email, oversized notes or unknown fields with 400', async () => {
    const server = app.getHttpServer();
    const url = `/projects/${PROJECT}/partner-export/publish-and-notify`;

    const responses = await Promise.all([
      request(server).post(url).send({ partnerEmail: 'not-an-email', options: OPTIONS }),
      request(server).post(url).send({ partnerEmail: 'a@b.io', customNotes: 'x'.repeat(2001), options: OPTIONS }),
      request(server).post(url).send({ partnerEmail: 'a@b.io' }),
      request(server)
        .post(url)
        .send({ partnerEmail: 'a@b.io', options: { ...OPTIONS, storageReference: '../../etc' } }),
    ]);

    for (const response of responses) expect(response.status).toBe(400);
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it('retries a notification with notify_partner only', async () => {
    permissions.getEffectivePermissions.mockResolvedValue(['conversion_result.notify_partner']);
    publisher.retryNotification.mockResolvedValue({ id: BUNDLE, notificationStatus: 'SENT' });

    const response = await request(app.getHttpServer()).post(
      `/projects/${PROJECT}/partner-export/bundles/${BUNDLE}/notify`,
    );

    expect(response.status).toBe(200);
    expect(publisher.retryNotification).toHaveBeenCalledWith('staff-1', undefined, PROJECT, BUNDLE);
  });
});
