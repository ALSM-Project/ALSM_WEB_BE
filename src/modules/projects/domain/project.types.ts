export enum ConversionType { BMS_DSPF_TO_FRONTEND = 'BMS_DSPF_TO_FRONTEND', COBOL_TO_JAVA = 'COBOL_TO_JAVA' }
export enum ProjectStatus { DRAFT = 'DRAFT', ACTIVE = 'ACTIVE', ARCHIVED = 'ARCHIVED' }
export interface ProjectRecord { id: string; organizationId: string; name: string; description?: string; conversionType: ConversionType; status: ProjectStatus; createdBy: string; createdAt: Date; updatedAt: Date; deletedAt?: Date; }
export interface ProjectRepository { create(input: Omit<ProjectRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<ProjectRecord>; findById(id: string, organizationId: string): Promise<ProjectRecord | null>; findAll(organizationId: string): Promise<ProjectRecord[]>; update(id: string, organizationId: string, input: Partial<Pick<ProjectRecord, 'name' | 'description' | 'status'>>): Promise<ProjectRecord | null>; softDelete(id: string, organizationId: string): Promise<boolean>; }
export const PROJECT_REPOSITORY = Symbol('PROJECT_REPOSITORY');
