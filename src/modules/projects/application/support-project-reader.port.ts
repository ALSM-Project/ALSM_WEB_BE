/** Public owner-module port: safe project diagnostics, bound to the caller's transaction. */
export { DiagnosticReaderFactory as SupportProjectReaderFactory } from '../../../shared/application/diagnostic-read.port';
export const SUPPORT_PROJECT_READER = Symbol('SUPPORT_PROJECT_READER');
