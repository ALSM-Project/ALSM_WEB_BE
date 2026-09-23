import type { DependencyEntry, ProgramDependencyStatus } from '../../conversions/domain/copybook-dependency.types';

export enum ScreenSourceType {
  BMS = 'BMS',
  DSPF = 'DSPF',
  COBOL = 'COBOL',
}

export enum ScreenStatus {
  READY = 'READY',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  REVIEW_REQUIRED = 'REVIEW_REQUIRED',
  FAILED = 'FAILED',
}

export interface ScreenDependencyDiagnostics {
  status: ProgramDependencyStatus;
  dependencies: DependencyEntry[];
  analyzedAt: Date;
}

export interface ScreenRecord {
  id: string;
  organizationId: string;
  projectId: string;
  name: string;
  sourceType: ScreenSourceType;
  status: ScreenStatus;
  inputReference: string;
  sizeBytes?: number;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  dependencyStatus?: ProgramDependencyStatus;
  dependencies?: DependencyEntry[];
  dependencyAnalyzedAt?: Date;
}

export interface ScreenRepository {
  create(input: Omit<ScreenRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<ScreenRecord>;
  findById(id: string, organizationId: string): Promise<ScreenRecord | null>;
  listByProject(projectId: string, organizationId: string): Promise<ScreenRecord[]>;
  updateStatus(id: string, organizationId: string, status: ScreenStatus): Promise<void>;
  updateDependencyDiagnostics(id: string, organizationId: string, diagnostics: ScreenDependencyDiagnostics): Promise<void>;
}

export const SCREEN_REPOSITORY = Symbol('SCREEN_REPOSITORY');
