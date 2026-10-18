export type DependencyStatus =
  | 'RESOLVED'
  | 'MISSING'
  | 'AMBIGUOUS'
  | 'CIRCULAR_DEPENDENCY'
  | 'PARSE_ERROR'
  /** IBM-supplied system copybook (CICS DFH*, MQ CMQ*) provided by the runtime — never
   * expected in a user upload, so it does not block conversion. */
  | 'SYSTEM_PROVIDED';
export type ProgramDependencyStatus = 'READY_FOR_CONVERSION' | 'BLOCKED' | 'NOT_ANALYZED';

export interface DependencyEntry {
  copyName: string;
  resolvedFile?: string;
  status: DependencyStatus;
  candidates?: string[];
  message?: string;
  lineNumber?: number;
  dependencies?: DependencyEntry[];
}

export interface ProgramAnalysis {
  program: string;
  status: ProgramDependencyStatus;
  dependencies: DependencyEntry[];
}
