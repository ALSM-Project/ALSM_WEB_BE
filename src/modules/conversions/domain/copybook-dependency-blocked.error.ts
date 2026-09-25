/** Thrown by CobolJavaConversionAdapter when a screen's persisted copybook dependency
 * analysis (see copybook-dependency-resolver.ts) is BLOCKED — the conversion is never even
 * shelled out to tool2java in that case. Distinguished from a generic engine failure so the
 * worker can surface a specific, actionable error code. */
export class CopybookDependencyBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CopybookDependencyBlockedError';
  }
}
