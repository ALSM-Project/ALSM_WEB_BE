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
}

export interface ScreenRepository {
  create(input: Omit<ScreenRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<ScreenRecord>;
  findById(id: string, organizationId: string): Promise<ScreenRecord | null>;
  listByProject(projectId: string, organizationId: string): Promise<ScreenRecord[]>;
  updateStatus(id: string, organizationId: string, status: ScreenStatus): Promise<void>;
}

export const SCREEN_REPOSITORY = Symbol('SCREEN_REPOSITORY');
