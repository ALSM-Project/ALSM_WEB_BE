import { AiProviderDiagnostics, sanitizeProviderDiagnostics } from './ai-provider-diagnostics';

export class AiValidatorError extends Error {
  declare readonly diagnostics?: AiProviderDiagnostics;

  constructor(
    public readonly code: string,
    message: string,
    diagnostics?: AiProviderDiagnostics,
  ) {
    super(message);
    this.name = 'AiValidatorError';
    if (diagnostics) {
      Object.defineProperty(this, 'diagnostics', {
        value: Object.freeze(sanitizeProviderDiagnostics(diagnostics)),
        enumerable: false,
      });
    }
  }
}
