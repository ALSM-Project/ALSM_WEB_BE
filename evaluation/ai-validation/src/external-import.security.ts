export interface ImportSecurityFlag {
  path: string;
  patternType: string;
}

const SECURITY_PATTERNS: Array<{ patternType: string; pattern: RegExp }> = [
  { patternType: 'PRIVATE_KEY', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i },
  { patternType: 'AWS_ACCESS_KEY', pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/ },
  {
    patternType: 'JWT_LIKE_TOKEN',
    pattern: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/,
  },
  { patternType: 'BEARER_TOKEN', pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{16,}/i },
  {
    patternType: 'CREDENTIAL_URI',
    pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:]+:[^\s/@]+@/i,
  },
  {
    patternType: 'PASSWORD_ASSIGNMENT',
    pattern: /\b(?:password|passwd|pwd)\b\s*[:=]\s*["'][^"']{4,}["']/i,
  },
  {
    patternType: 'TOKEN_ASSIGNMENT',
    pattern: /\b(?:api[_-]?key|access[_-]?token|secret[_-]?key)\b\s*[:=]\s*["'][^"']{8,}["']/i,
  },
];

export function scanImportedText(path: string, content: string): ImportSecurityFlag[] {
  return SECURITY_PATTERNS.filter(({ pattern }) => pattern.test(content)).map(
    ({ patternType }) => ({
      path,
      patternType,
    }),
  );
}
