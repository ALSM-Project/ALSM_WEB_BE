import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AUDIT_REPOSITORY, AuditRepository } from '../../audit/domain/audit.repository';
import {
  ORGANIZATION_REPOSITORY,
  OrganizationRepository,
} from '../../organizations/domain/organization.repository';
import { OrganizationRole, OrganizationType } from '../../organizations/domain/organization.types';
import {
  ConversionType,
  PROJECT_REPOSITORY,
  ProjectRecord,
  ProjectRepository,
  ProjectStatus,
} from '../../projects/domain/project.types';
import { PARTNER_REPOSITORY, PartnerRepository } from '../domain/partner.types';

export interface CreatePartnerProjectInput {
  name: string;
  description?: string;
  conversionType: ConversionType;
}

@Injectable()
export class CreatePartnerProjectService {
  constructor(
    @Inject(PARTNER_REPOSITORY) private readonly partners: PartnerRepository,
    @Inject(ORGANIZATION_REPOSITORY) private readonly organizations: OrganizationRepository,
    @Inject(PROJECT_REPOSITORY) private readonly projects: ProjectRepository,
    @Inject(AUDIT_REPOSITORY) private readonly audit: AuditRepository,
  ) {}

  async execute(userId: string, partnerId: string, input: CreatePartnerProjectInput): Promise<ProjectRecord> {
    const name = input.name?.trim();
    if (!name) {
      throw new BadRequestException({ code: 'PROJECT_NAME_REQUIRED', message: 'Project name is required' });
    }
    if (!Object.values(ConversionType).includes(input.conversionType)) {
      throw new BadRequestException({
        code: 'INVALID_CONVERSION_TYPE',
        message: `conversionType must be one of: ${Object.values(ConversionType).join(', ')}`,
      });
    }

    const partner = await this.partners.findById(partnerId);
    if (!partner) {
      throw new NotFoundException({ code: 'PARTNER_NOT_FOUND', message: `Partner '${partnerId}' not found` });
    }

    // A Partner has no workspace until the first project is created for it - every other
    // Organization-scoped concept in this platform (screens, conversions, quotas, billing)
    // needs a real Organization to live under, so one is provisioned here, lazily, exactly
    // once, rather than at Partner-creation time (UC-44) when there may never be a project.
    let organizationId = partner.organizationId;
    if (!organizationId) {
      const organization = await this.organizations.create({
        name: `${partner.name} Workspace`,
        type: OrganizationType.ENTERPRISE,
        members: [{ userId, role: OrganizationRole.OWNER }],
      });
      organizationId = organization.id;
      await this.partners.setOrganizationId(partner.id, organizationId);
    }

    const project = await this.projects.create({
      organizationId,
      name,
      description: input.description?.trim() || undefined,
      conversionType: input.conversionType,
      status: ProjectStatus.DRAFT,
      createdBy: userId,
    });

    await this.audit.append({
      actorUserId: userId,
      organizationId,
      action: 'PARTNER_PROJECT_CREATED',
      resourceType: 'PROJECT',
      resourceId: project.id,
      metadata: { partnerId: partner.id },
    });

    return project;
  }
}
