import { Inject, Injectable } from '@nestjs/common';
import { AUDIT_REPOSITORY, AuditRepository } from '../../audit/domain/audit.repository';
import { OrganizationAuthorizationService } from '../../organizations/application/organization-authorization.service';
import { OrganizationContextService } from '../../organizations/application/organization-context.service';
import { OrganizationRole } from '../../organizations/domain/organization.types';
import { ProjectService } from '../../projects/application/project.service';
import {
  FIELD_MAPPING_REPOSITORY,
  FieldMappingEntry,
  FieldMappingRecord,
  FieldMappingRepository,
} from '../domain/field-mapping.types';

export interface SaveFieldMappingInput {
  userId: string;
  organizationHeader: string | undefined;
  projectId: string;
  screenId: string;
  mappings: FieldMappingEntry[];
}

@Injectable()
export class SaveFieldMappingService {
  constructor(
    @Inject(FIELD_MAPPING_REPOSITORY) private readonly fieldMappings: FieldMappingRepository,
    private readonly projects: ProjectService,
    private readonly organizationContext: OrganizationContextService,
    private readonly authorization: OrganizationAuthorizationService,
    @Inject(AUDIT_REPOSITORY) private readonly audit: AuditRepository,
  ) {}

  async execute(input: SaveFieldMappingInput): Promise<FieldMappingRecord> {
    const organization = await this.organizationContext.resolve(
      input.userId,
      input.organizationHeader,
    );
    this.authorization.require(organization, input.userId, [
      OrganizationRole.OWNER,
      OrganizationRole.ADMIN,
      OrganizationRole.MEMBER,
    ]);
    const project = await this.projects.getForOrganization(input.projectId, organization.id);

    const record = await this.fieldMappings.upsert({
      organizationId: organization.id,
      projectId: project.id,
      screenId: input.screenId,
      mappings: input.mappings,
      updatedBy: input.userId,
    });

    await this.audit.append({
      actorUserId: input.userId,
      organizationId: organization.id,
      action: 'FIELD_MAPPING_UPDATED',
      resourceType: 'FIELD_MAPPING',
      resourceId: `${project.id}:${input.screenId}`,
    });

    return record;
  }
}
