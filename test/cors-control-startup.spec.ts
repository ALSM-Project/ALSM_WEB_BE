import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

interface Startup {
  name: string;
  mode: string;
  listenAttempted: boolean;
  realHttpListening: boolean;
  rejected: boolean;
  serverClosed: boolean;
  error?: string;
  http?: Record<string, string | number | null>;
}
function startup(name: string, mode = 'joi'): Startup {
  const environment: NodeJS.ProcessEnv = {};
  for (const key of ['SystemRoot', 'WINDIR', 'PATH', 'PATHEXT', 'TEMP', 'TMP'])
    if (process.env[key] !== undefined) environment[key] = process.env[key];
  Object.assign(environment, {
    NODE_ENV: 'production',
    MONGODB_URI: 'mongodb://localhost/unused-cors-startup',
    REDIS_HOST: 'localhost',
    JWT_ACCESS_SECRET: 'a'.repeat(32),
    JWT_REFRESH_SECRET: 'b'.repeat(32),
    MFA_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
  });
  const output = execFileSync(
    process.execPath,
    [join(__dirname, 'cors-control-startup.fixture.cjs'), name, mode],
    {
      cwd: join(__dirname, '..'),
      env: environment,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 30000,
    },
  );
  const marker = output.split(/\r?\n/).find((line) => line.startsWith('CORS_STARTUP_RESULT '));
  if (!marker) throw new Error('Real Nest startup fixture returned no evidence');
  return JSON.parse(marker.slice('CORS_STARTUP_RESULT '.length)) as Startup;
}

describe('CORS control validation before production bootstrap listen (real Nest child processes)', () => {
  jest.setTimeout(40000);
  it('starts a real loopback HTTP server for valid whitespace/case/default-port/IDN configuration', () => {
    const result = startup('valid');
    expect(result).toMatchObject({
      rejected: false,
      listenAttempted: true,
      realHttpListening: true,
      serverClosed: true,
    });
    expect(result.http).toMatchObject({
      approvedStatus: 200,
      approvedOrigin: 'https://frontend.example.invalid',
      approvedCredentials: 'true',
      deniedOrigin: null,
      deniedCredentials: null,
      preflightStatus: 204,
      preflightOrigin: 'https://frontend.example.invalid',
      preflightHeaders: 'authorization,content-type',
    });
  });
  it.each(['control1', 'control31', 'inside', 'mixed', 'wildcard'])(
    'Joi rejects %s before listen',
    (name) => {
      const result = startup(name);
      expect(result).toMatchObject({
        rejected: true,
        listenAttempted: false,
        realHttpListening: false,
        serverClosed: true,
      });
      expect(result.error).toContain('CORS_ORIGINS');
    },
  );
  it.each(['control1', 'mixed'])(
    'production factory independently rejects %s before listen',
    (name) => {
      const result = startup(name, 'factory');
      expect(result).toMatchObject({
        rejected: true,
        listenAttempted: false,
        realHttpListening: false,
        serverClosed: true,
      });
      expect(result.error).toContain('CORS_ORIGINS');
    },
  );
});
