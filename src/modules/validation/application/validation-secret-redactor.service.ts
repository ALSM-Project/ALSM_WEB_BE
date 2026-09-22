import { Injectable } from '@nestjs/common';

export interface SecretRedactionResult {
  content: string;
  redactionCount: number;
}

interface RedactionRule {
  pattern: RegExp;
  replace: (...matches: string[]) => string;
}

const REDACTION_RULES: RedactionRule[] = [
  {
    pattern:
      /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g,
    replace: (match) => {
      const newlineCount = match.match(/\r\n|\n|\r/g)?.length ?? 0;
      return `[REDACTED:PRIVATE_KEY]${'\n'.repeat(newlineCount)}`;
    },
  },
  {
    pattern: /(\bAuthorization\s*[:=]\s*Bearer\s+)([^\s"',;]+)/gi,
    replace: (_match, prefix) => `${prefix}[REDACTED:BEARER_TOKEN]`,
  },
  {
    pattern: /\bBearer\s+([A-Za-z0-9._~+/-]+=*)/gi,
    replace: () => 'Bearer [REDACTED:BEARER_TOKEN]',
  },
  {
    pattern: /\b([a-z][a-z0-9+.-]*:\/\/)([^\s/@:]+):([^\s/@]+)@/gi,
    replace: (_match, scheme) => `${scheme}[REDACTED:URI_CREDENTIALS]@`,
  },
  {
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    replace: () => '[REDACTED:JWT]',
  },
  {
    pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
    replace: () => '[REDACTED:CLOUD_CREDENTIAL]',
  },
  {
    pattern: /\bAIza[0-9A-Za-z_-]{30,}\b/g,
    replace: () => '[REDACTED:CLOUD_CREDENTIAL]',
  },
  {
    pattern: /\b(?:ghp|github_pat|sk)-[A-Za-z0-9_-]{16,}\b/g,
    replace: () => '[REDACTED:API_KEY]',
  },
  {
    pattern:
      /(["']?\b(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?token|client[_-]?secret)\b["']?\s*[:=]\s*)(["'])(.*?)\2/gi,
    replace: (_match, prefix, quote) => `${prefix}${quote}[REDACTED:SECRET]${quote}`,
  },
  {
    pattern:
      /(["']?\b(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?token|client[_-]?secret)\b["']?\s*[:=]\s*)([^\s"',;]+)/gi,
    replace: (_match, prefix) => `${prefix}[REDACTED:SECRET]`,
  },
];

@Injectable()
export class ValidationSecretRedactorService {
  redact(content: string): SecretRedactionResult {
    let redacted = content;
    let redactionCount = 0;

    for (const rule of REDACTION_RULES) {
      redacted = redacted.replace(rule.pattern, (...matches: string[]) => {
        redactionCount += 1;
        return rule.replace(...matches);
      });
    }

    return { content: redacted, redactionCount };
  }
}
