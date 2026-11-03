import { DiagnosticReadTransaction } from '../../../shared/application/diagnostic-read.port';
import { SupportContextEntity } from '../domain/support-context.entity';
import { SupportContextScope } from '../domain/support-context.repository';

export const SUPPORT_INSPECTION = Symbol('SUPPORT_INSPECTION');
export interface SupportInspection {
  scoped(scope: SupportContextScope): Promise<SupportContextEntity | null>;
  latest(scope: Omit<SupportContextScope, 'id'>): Promise<SupportContextEntity | null>;
  snapshot<T>(work: (transaction: DiagnosticReadTransaction) => Promise<T>): Promise<T>;
}
