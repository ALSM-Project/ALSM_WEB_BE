export enum ErrorLogSeverity {
  FATAL = 'FATAL',
  ERROR = 'ERROR',
  WARNING = 'WARNING',
}

export enum ErrorLogStatus {
  UNRESOLVED = 'UNRESOLVED',
  RESOLVED = 'RESOLVED',
  IGNORED = 'IGNORED',
}

export interface SuggestedPatch {
  offendingLine: string;
  suggestedLine: string;
  reason: string;
}

export interface ErrorLogRecord {
  id: string;
  projectId: string;
  organizationId: string;
  screenName: string;
  errorCode: string;
  severity: ErrorLogSeverity;
  status: ErrorLogStatus;
  lineNumber: number;
  offendingCode: string;
  suggestedPatch: SuggestedPatch;
  createdAt: Date;
  resolvedAt?: Date;
  resolvedBy?: string;
}

export interface ErrorLogSummary {
  total: number;
  fatal: number;
  error: number;
  warning: number;
  resolved: number;
  unresolved: number;
  ignored: number;
}

export interface ErrorLogListQuery {
  severity?: ErrorLogSeverity;
  status?: ErrorLogStatus;
  search?: string;
  page?: number;
  limit?: number;
}

export interface PaginatedErrorLogs {
  data: ErrorLogRecord[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ErrorLogRepository {
  create(input: Omit<ErrorLogRecord, 'id' | 'createdAt'>): Promise<ErrorLogRecord>;
  findById(id: string, projectId: string, organizationId: string): Promise<ErrorLogRecord | null>;
  list(projectId: string, organizationId: string, query: ErrorLogListQuery): Promise<PaginatedErrorLogs>;
  resolve(id: string, projectId: string, organizationId: string, userId: string): Promise<ErrorLogRecord | null>;
  ignore(id: string, projectId: string, organizationId: string): Promise<ErrorLogRecord | null>;
  getSummary(projectId: string, organizationId: string): Promise<ErrorLogSummary>;
}

export const ERROR_LOG_REPOSITORY = Symbol('ERROR_LOG_REPOSITORY');
