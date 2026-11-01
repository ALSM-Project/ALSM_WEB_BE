/** Read-only metadata port; no conversion, retry, export or UC-67 operations. */
export { DiagnosticReaderFactory as SupportConversionReaderFactory } from '../../../shared/application/diagnostic-read.port';
export const SUPPORT_CONVERSION_READER = Symbol('SUPPORT_CONVERSION_READER');
