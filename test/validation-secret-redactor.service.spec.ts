import { ValidationSecretRedactorService } from '../src/modules/validation/application/validation-secret-redactor.service';

describe('ValidationSecretRedactorService', () => {
  const redactor = new ValidationSecretRedactorService();

  it('redacts password assignments without retaining the value', () => {
    const result = redactor.redact('String password = "synthetic-password";');

    expect(result.content).toBe('String password = "[REDACTED:SECRET]";');
    expect(result.content).not.toContain('synthetic-password');
    expect(result.redactionCount).toBe(1);
  });

  it('redacts bearer tokens', () => {
    const result = redactor.redact('Authorization: Bearer synthetic-token-value');

    expect(result.content).toBe('Authorization: Bearer [REDACTED:BEARER_TOKEN]');
    expect(result.content).not.toContain('synthetic-token-value');
    expect(result.redactionCount).toBe(1);
  });

  it('redacts URI credentials as one secret occurrence', () => {
    const result = redactor.redact('jdbc:postgresql://synthetic-user:synthetic-pass@db.test/app');

    expect(result.content).toBe(
      'jdbc:postgresql://[REDACTED:URI_CREDENTIALS]@db.test/app',
    );
    expect(result.content).not.toContain('synthetic-user');
    expect(result.content).not.toContain('synthetic-pass');
    expect(result.redactionCount).toBe(1);
  });

  it('redacts a complete private key block', () => {
    const result = redactor.redact(
      [
        'before',
        '-----BEGIN PRIVATE KEY-----',
        'SYNTHETIC-PRIVATE-KEY-MATERIAL',
        '-----END PRIVATE KEY-----',
        'after',
      ].join('\n'),
    );

    expect(result.content).toBe('before\n[REDACTED:PRIVATE_KEY]\nafter');
    expect(result.content).not.toContain('SYNTHETIC-PRIVATE-KEY-MATERIAL');
    expect(result.redactionCount).toBe(1);
  });

  it('leaves ordinary COBOL and Java source unchanged', () => {
    const source = [
      'IDENTIFICATION DIVISION.',
      'PROGRAM-ID. CUSTOMER.',
      'public class Customer { int balance = 1; }',
    ].join('\n');

    expect(redactor.redact(source)).toEqual({ content: source, redactionCount: 0 });
  });
});
