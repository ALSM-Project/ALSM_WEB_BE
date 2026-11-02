import { createCorsOptions, parseCorsOrigins } from '../src/config/cors-policy';
import { environmentValidationSchema } from '../src/config/environment.validation';

const frontend = 'https://frontend.example.invalid';
function allowed(configuration: string, origin: string | undefined): Promise<boolean> {
  const callback = createCorsOptions(configuration).origin;
  if (typeof callback !== 'function') throw new Error('Expected production origin callback');
  return new Promise((resolve, reject) => {
    callback(origin, (error, result) => (error ? reject(error) : resolve(result === true)));
  });
}
const environment = {
  MONGODB_URI: 'mongodb://localhost/unused-cors-test',
  REDIS_HOST: 'localhost',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
  MFA_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
};

describe('Explicit normalized CORS configuration and fail-closed startup validation', () => {
  it('normalizes configuration whitespace, host/scheme case and default ports, then deduplicates', async () => {
    const configuration = ` HTTPS://FRONTEND.EXAMPLE.INVALID:443 , ${frontend} , http://localhost:3002 `;
    expect(parseCorsOrigins(configuration)).toEqual([frontend, 'http://localhost:3002']);
    expect(await allowed(configuration, frontend)).toBe(true);
    expect(await allowed(configuration, 'https://FRONTEND.example.invalid:443')).toBe(true);
    const result = environmentValidationSchema.validate({
      ...environment,
      CORS_ORIGINS: configuration,
    });
    expect(result.error).toBeUndefined();
  });
  it('uses exact scheme/host/port tuples including explicitly configured IPv6 and IDN origins', async () => {
    expect(parseCorsOrigins('https://[::1]:444,https://bücher.example.invalid')).toEqual([
      'https://[::1]:444',
      'https://xn--bcher-kva.example.invalid',
    ]);
    expect(await allowed('https://[::1]:444', 'https://[::1]:444')).toBe(true);
    expect(await allowed('https://[::1]:444', 'https://[::1]:445')).toBe(false);
    expect(await allowed(frontend, 'http://frontend.example.invalid')).toBe(false);
  });
  it('does not infer development trust from loopback/private addresses', async () => {
    for (const origin of [
      'http://localhost:3002',
      'http://127.0.0.1:3002',
      'http://192.168.1.10:3002',
    ])
      expect(await allowed(frontend, origin)).toBe(false);
    expect(await allowed('http://localhost:3002', 'http://localhost:3002')).toBe(true);
    expect(await allowed('http://localhost:3002', 'http://127.0.0.1:3002')).toBe(false);
  });
  it.each([
    undefined,
    '',
    ' ',
    '*',
    'null',
    'https://*.example.invalid',
    'file:///tmp/site',
    'data:text/html,test',
    'ws://frontend.example.invalid',
    'http://',
    'https://frontend.example.invalid:',
    'https://frontend.example.invalid:99999',
    `${frontend}/`,
    `${frontend}/api/v1`,
    `${frontend}?query`,
    `${frontend}#fragment`,
    'https://user:password@frontend.example.invalid',
    `${frontend}\\path`,
    'https://%66rontend.example.invalid',
    'https://front\nend.example.invalid',
    `${frontend},`,
    `,${frontend}`,
    `${frontend},,http://localhost:3002`,
    `${frontend},invalid`,
  ])('rejects invalid/mixed configuration %j before granting any CORS access', (configuration) => {
    expect(() => parseCorsOrigins(configuration)).toThrow('CORS_ORIGINS');
    expect(() => createCorsOptions(configuration)).toThrow('CORS_ORIGINS');
    const result = environmentValidationSchema.validate({
      ...environment,
      CORS_ORIGINS: configuration,
    });
    expect(result.error?.details.some((detail) => detail.path.includes('CORS_ORIGINS'))).toBe(true);
  });
  it.each([
    undefined,
    '',
    'null',
    '*',
    `${frontend}/`,
    `${frontend}\r\n`,
    `${frontend}\n`,
    ` ${frontend}`,
    'https://%66rontend.example.invalid',
    'https://frontend.example.invalid:',
  ])('does not grant CORS to absent or malformed request Origin %j', async (origin) => {
    expect(await allowed(frontend, origin)).toBe(false);
  });
});
