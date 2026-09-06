import { Inject, Injectable } from '@nestjs/common';
import { OrganizationContextService } from '../../organizations/application/organization-context.service';
import { ProjectService } from '../../projects/application/project.service';
import {
  FIELD_MAPPING_REPOSITORY,
  FieldMappingEntry,
  FieldMappingRepository,
} from '../domain/field-mapping.types';

export interface GetFieldMappingInput {
  userId: string;
  organizationHeader: string | undefined;
  projectId: string;
  screenId: string;
}

export interface FieldMappingView {
  projectId: string;
  screenId: string;
  mappings: FieldMappingEntry[];
  updatedBy: string | null;
  updatedAt: Date | null;
}

@Injectable()
export class GetFieldMappingService {
  constructor(
    @Inject(FIELD_MAPPING_REPOSITORY) private readonly fieldMappings: FieldMappingRepository,
    private readonly projects: ProjectService,
    private readonly organizationContext: OrganizationContextService,
  ) {}

  async execute(input: GetFieldMappingInput): Promise<FieldMappingView> {
    const organization = await this.organizationContext.resolve(
      input.userId,
      input.organizationHeader,
    );
    const project = await this.projects.getForOrganization(input.projectId, organization.id);
    const record = await this.fieldMappings.findByScreen(
      project.id,
      input.screenId,
      organization.id,
    );

    if (!record) {
      return {
        projectId: project.id,
        screenId: input.screenId,
        mappings: [],
        updatedBy: null,
        updatedAt: null,
      };
    }

    return {
      projectId: record.projectId,
      screenId: record.screenId,
      mappings: record.mappings,
      updatedBy: record.updatedBy,
      updatedAt: record.updatedAt,
    };
  }
}
