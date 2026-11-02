export enum ConversionType {
  BMS_DSPF_TO_FRONTEND = 'BMS_DSPF_TO_FRONTEND',
  COBOL_TO_JAVA = 'COBOL_TO_JAVA',
}
export enum ProjectStatus {
  DRAFT = 'DRAFT',
  ACTIVE = 'ACTIVE',
  /** The converted code bundle has been released to the partner (UC-48). */
  COMPLETED = 'COMPLETED',
  ARCHIVED = 'ARCHIVED',
}
export interface ProjectRecord {
  id: string;
  organizationId: string;
  name: string;
  description?: string;
  conversionType: ConversionType;
  status: ProjectStatus;
  createdBy: string;
  isDemo?: boolean;
  assignedTeamLeadId?: string;
  /** The Conversion Staff member the Team Lead allocated the project to (UC-86). */
  assignedStaffId?: string;
  assignedStaffName?: string;
  /** Technical briefing the Team Lead wrote when allocating. */
  staffAssignmentNote?: string;
  staffAssignedBy?: string;
  staffAssignedAt?: Date;
  isExported?: boolean;
  exportedAt?: Date;
  exportedBundleName?: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
}
export interface ProjectRepository {
  create(
    input: Omit<ProjectRecord, 'id' | 'createdAt' | 'updatedAt'> & { id?: string },
  ): Promise<ProjectRecord>;
  findById(id: string, organizationId?: string): Promise<ProjectRecord | null>;
  findAll(organizationId?: string): Promise<ProjectRecord[]>;
  update(
    id: string,
    organizationId: string,
    input: Partial<Pick<ProjectRecord, 'name' | 'description' | 'status' | 'assignedTeamLeadId'>>,
  ): Promise<ProjectRecord | null>;
  assignTeamLead(id: string, teamLeadId: string): Promise<ProjectRecord | null>;
  /** Projects a Team Lead allocated to this staff member (UC-86), optionally within one organization. */
  findByAssignedStaff(staffId: string, organizationId?: string): Promise<ProjectRecord[]>;
  assignStaff(
    id: string,
    staff: { staffId: string; staffName: string; note?: string; assignedBy: string },
  ): Promise<ProjectRecord | null>;
  softDelete(id: string, organizationId: string): Promise<boolean>;
}
export const PROJECT_REPOSITORY = Symbol('PROJECT_REPOSITORY');
