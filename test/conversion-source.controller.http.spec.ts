import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest');
import { ConversionSourceController } from '../src/modules/conversions/presentation/conversion-source.controller';
import { UploadConversionSourceService } from '../src/modules/conversions/application/upload-conversion-source.service';
import { JwtAuthGuard } from '../src/shared/security/jwt-auth.guard';

describe('POST /projects/:projectId/conversion-sources (HTTP)', () => {
  let app: INestApplication;
  const upload = { execute: jest.fn() };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ConversionSourceController],
      providers: [{ provide: UploadConversionSourceService, useValue: upload }],
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
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    upload.execute.mockReset();
    upload.execute.mockResolvedValue({
      inputReference: 'sources/p1/uuid',
      files: [{ name: 'LOGIN.bms', sizeBytes: 5 }],
      screens: [{ id: 'scr-1', name: 'LOGIN.bms', sourceType: 'BMS', status: 'READY' }],
      ignoredEntries: [],
    });
  });

  it('answers 201 Created for a multipart upload and passes the files to the service', async () => {
    const response = await request(app.getHttpServer())
      .post('/projects/6650aa00aa00aa00aa00aa01/conversion-sources')
      .set('x-organization-id', 'org-1')
      .attach('files', Buffer.from('DFHMSD'), 'LOGIN.bms')
      .attach('files', Buffer.from('DFHMSD'), 'MENU.bms');

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      inputReference: 'sources/p1/uuid',
      screens: [{ name: 'LOGIN.bms', status: 'READY' }],
    });
    const [userId, organizationId, projectId, files] = upload.execute.mock.calls[0];
    expect(userId).toBe('staff-1');
    expect(organizationId).toBe('org-1');
    expect(projectId).toBe('6650aa00aa00aa00aa00aa01');
    expect(files.map((f: { originalname: string }) => f.originalname)).toEqual([
      'LOGIN.bms',
      'MENU.bms',
    ]);
    expect(files[0].buffer.toString()).toBe('DFHMSD');
  });

  it('hands an empty request to the service, which rejects it with 400', async () => {
    upload.execute.mockRejectedValue(
      Object.assign(new Error('At least one file is required'), {
        getStatus: () => 400,
        getResponse: () => ({ code: 'NO_FILES_UPLOADED' }),
      }),
    );

    await request(app.getHttpServer())
      .post('/projects/6650aa00aa00aa00aa00aa01/conversion-sources')
      .expect((res: { status: number }) => expect(res.status).toBeGreaterThanOrEqual(400));
    expect(upload.execute.mock.calls[0][3]).toEqual([]);
  });
});
