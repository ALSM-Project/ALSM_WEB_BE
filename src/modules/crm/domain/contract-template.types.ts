export interface ContractTemplateSection {
  heading: string;
  body: string;
}

export type ContractTemplateStatus = 'DRAFT' | 'APPROVED' | 'REJECTED';

export interface ContractTemplateVersion {
  id: string;
  templateId: string;
  versionNumber: number;
  title: string;
  locale: 'vi' | 'en' | 'vi-en';
  sections: ContractTemplateSection[];
  status: ContractTemplateStatus;
  contentDigest: string;
  createdByUserId: string;
  approvedByUserId?: string;
  approvedAt?: Date;
  rejectedByUserId?: string;
  rejectedAt?: Date;
  rejectionReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ContractTemplateRepository {
  findApprovedById(id: string): Promise<ContractTemplateVersion | null>;
  listApproved(): Promise<ContractTemplateVersion[]>;
  listAllVersions(): Promise<ContractTemplateVersion[]>;
  listByTemplateId(templateId: string): Promise<ContractTemplateVersion[]>;
  latestVersion(templateId: string): Promise<ContractTemplateVersion | null>;
  createVersion(input: {
    templateId: string;
    versionNumber: number;
    title: string;
    locale: 'vi' | 'en' | 'vi-en';
    sections: ContractTemplateSection[];
    contentDigest: string;
    createdByUserId: string;
    now: Date;
  }): Promise<ContractTemplateVersion>;
  approve(input: { id: string; reviewerUserId: string; now: Date }): Promise<ContractTemplateVersion | null>;
  reject(input: { id: string; reviewerUserId: string; reason: string; now: Date }): Promise<ContractTemplateVersion | null>;
}

export const CONTRACT_TEMPLATE_REPOSITORY = Symbol('CONTRACT_TEMPLATE_REPOSITORY');
