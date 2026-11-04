import { Controller, Get, INestApplication, Post, UseGuards } from '@nestjs/common';
import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import * as dns from 'node:dns';
import { JwtAuthGuard } from '../src/shared/security/jwt-auth.guard';
import { RequireCurrentSessionService } from '../src/modules/auth/application/require-current-session.service';
import type { SessionRepository } from '../src/modules/auth/domain/session.repository';
import type { UserRepository } from '../src/modules/users/domain/user.repository';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest');

// Capture the ACTUAL bootstrap options without loading .env, AppModule or external stores.
jest.mock('../src/app.module', () => ({ AppModule: class AppModule {} }));
async function productionCors(origins: string, environment: string): Promise<CorsOptions> {
  const savedOrigins = process.env.CORS_ORIGINS,
    savedEnvironment = process.env.NODE_ENV;
  let options: CorsOptions | undefined;
  try {
    process.env.CORS_ORIGINS = origins;
    process.env.NODE_ENV = environment;
    await jest.isolateModulesAsync(async () => {
      const { NestFactory } = await import('@nestjs/core');
      const { SwaggerModule } = await import('@nestjs/swagger');
      let ready!: () => void;
      const listening = new Promise<void>((resolve) => {
        ready = resolve;
      });
      const app = {
        enableShutdownHooks: jest.fn(),
        use: jest.fn(),
        setGlobalPrefix: jest.fn(),
        useGlobalPipes: jest.fn(),
        useGlobalFilters: jest.fn(),
        enableCors: jest.fn((value: CorsOptions) => {
          options = value;
        }),
        listen: jest.fn(async () => {
          ready();
        }),
        get: jest.fn(() => ({ start: jest.fn() })),
      };
      jest.spyOn(NestFactory, 'create').mockResolvedValue(app as unknown as INestApplication);
      jest.spyOn(SwaggerModule, 'createDocument').mockReturnValue({} as never);
      jest.spyOn(SwaggerModule, 'setup').mockImplementation(() => {});
      await import('../src/main');
      await listening;
    });
    if (!options) throw new Error('Production bootstrap did not install CORS');
    return options;
  } finally {
    jest.restoreAllMocks();
    if (savedOrigins === undefined) delete process.env.CORS_ORIGINS;
    else process.env.CORS_ORIGINS = savedOrigins;
    if (savedEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = savedEnvironment;
  }
}

@Controller('cors-probe')
class CorsProbeController {
  @Get('private')
  @UseGuards(JwtAuthGuard)
  read() {
    return { ok: true };
  }
  @Post('private')
  @UseGuards(JwtAuthGuard)
  write() {
    return { ok: true };
  }
}

describe('Production CORS bootstrap + installed middleware + ordinary JWT/session admission', () => {
  let app: INestApplication, development: INestApplication, token: string;
  const frontend = 'https://frontend.example.invalid';
  const userId = '111111111111111111111111',
    sessionId = '222222222222222222222222';
  const previousDnsOrder = dns.getDefaultResultOrder();
  async function createApp(options: CorsOptions) {
    const secret = `cors-fixture-${randomUUID()}`;
    const jwt = new JwtService({ secret });
    token = jwt.sign({
      sub: userId,
      sid: sessionId,
      sv: 'cors-test-generation',
      email: 'cors@example.invalid',
    });
    const current = new RequireCurrentSessionService(
      {
        findActiveByUserId: async () => [
          {
            id: sessionId,
            userId,
            accessVersion: 'cors-test-generation',
            expiresAt: new Date(Date.now() + 60000),
          },
        ],
      } as unknown as SessionRepository,
      {
        findById: async () => ({
          id: userId,
          isActive: true,
          isLocked: false,
          isEmailVerified: true,
          mustChangePassword: false,
        }),
      } as unknown as UserRepository,
    );
    const module = await Test.createTestingModule({
      controllers: [CorsProbeController],
      providers: [
        { provide: JwtService, useValue: jwt },
        { provide: ConfigService, useValue: { getOrThrow: () => secret } },
        { provide: RequireCurrentSessionService, useValue: current },
      ],
    }).compile();
    const result = module.createNestApplication({ logger: false });
    result.enableCors(options);
    await result.init();
    return { app: result, token };
  }
  let developmentToken: string;
  beforeAll(async () => {
    const prod = await createApp(await productionCors(frontend, 'production'));
    app = prod.app;
    const dev = await createApp(await productionCors('http://localhost:3002', 'development'));
    development = dev.app;
    developmentToken = dev.token;
    token = prod.token;
  });
  afterAll(async () => {
    await app?.close();
    await development?.close();
    dns.setDefaultResultOrder(previousDnsOrder);
  });
  const authenticated = (instance = app, credential = token) =>
    request(instance.getHttpServer())
      .get('/cors-probe/private')
      .auth(credential, { type: 'bearer' });
  function denied(response: { headers: Record<string, string> }) {
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    expect(response.headers['access-control-allow-credentials']).toBeUndefined();
  }

  it('allows the explicitly configured Frontend and its Authorization-bearing request', async () => {
    const response = await authenticated().set('Origin', frontend).expect(200);
    expect(response.body).toEqual({ ok: true });
    expect(response.headers['access-control-allow-origin']).toBe(frontend);
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });
  it('keeps no-Origin API clients working without granting CORS headers', async () => {
    denied(await authenticated().expect(200));
  });
  it('does not turn an approved Origin into authentication', async () => {
    await request(app.getHttpServer())
      .get('/cors-probe/private')
      .set('Origin', frontend)
      .expect(401);
    await authenticated(app, 'invalid-token').set('Origin', frontend).expect(401);
  });
  it.each([
    'https://unconfigured.example.invalid',
    'https://frontend.example.invalid.attacker.invalid',
    'https://attacker-frontend.example.invalid',
    'http://localhost:3002',
    'http://localhost:9999',
    'http://127.0.0.1:3002',
    'http://127.0.0.1.attacker.invalid:3002',
    'http://[::1]:3002',
    'http://192.168.1.10:3002',
    'http://localhost:3002@attacker.invalid',
    'https://frontend.example.invalid@attacker.invalid',
    'https://frontend.example.invalid/path',
    'https://frontend.example.invalid?query',
    'https://frontend.example.invalid#fragment',
    'https://frontend.example.invalid\\attacker.invalid',
    'not-an-origin',
    'null',
    '*',
    '',
  ])(
    'denies CORS for unapproved/malformed Origin %j without changing API authentication',
    async (origin) => {
      denied(await authenticated().set('Origin', origin).expect(200));
    },
  );
  it('returns credentialed preflight methods and Authorization/Content-Type headers to the approved origin', async () => {
    const response = await request(app.getHttpServer())
      .options('/cors-probe/private')
      .set('Origin', frontend)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'authorization,content-type,x-request-id')
      .expect(204);
    expect(response.headers['access-control-allow-origin']).toBe(frontend);
    expect(response.headers['access-control-allow-credentials']).toBe('true');
    expect(response.headers['access-control-allow-methods']).toContain('POST');
    expect(response.headers['access-control-allow-headers']).toBe(
      'authorization,content-type,x-request-id',
    );
    await request(app.getHttpServer())
      .post('/cors-probe/private')
      .set('Origin', frontend)
      .auth(token, { type: 'bearer' })
      .send({})
      .expect(201);
  });
  it('does not grant credentialed preflight to an unapproved origin', async () => {
    denied(
      await request(app.getHttpServer())
        .options('/cors-probe/private')
        .set('Origin', 'https://unconfigured.example.invalid')
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'authorization,content-type'),
    );
  });
  it('allows development access only when that exact origin is explicitly configured', async () => {
    const response = await authenticated(development, developmentToken)
      .set('Origin', 'http://localhost:3002')
      .expect(200);
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:3002');
    denied(
      await authenticated(development, developmentToken)
        .set('Origin', 'http://localhost:3003')
        .expect(200),
    );
  });
});
