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

    if (!record || !record.mappings || record.mappings.length === 0) {
      return {
        projectId: project.id,
        screenId: input.screenId,
        mappings: this.generateDefaultMappings(input.screenId),
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

  private generateDefaultMappings(screenId: string): FieldMappingEntry[] {
    return [
      {
        legacyField: {
          name: 'ACCTNO',
          type: 'ALPHA_NUMERIC',
          length: 16,
          position: 'Ln 05, Col 21',
        },
        componentMapping: {
          componentType: 'Text Field',
          labelText: 'Account Number (ACCTNO)',
          isRequired: true,
          minLength: 10,
          maxLength: 16,
          regexPattern: '^[0-9-]+$',
        },
      },
      {
        legacyField: {
          name: 'CUSTID',
          type: 'ALPHA_NUMERIC',
          length: 10,
          position: 'Ln 05, Col 50',
        },
        componentMapping: {
          componentType: 'Text Field',
          labelText: 'Customer ID (CUSTID)',
          isRequired: true,
          minLength: 4,
          maxLength: 10,
          regexPattern: '^[A-Z0-9-]+$',
        },
      },
      {
        legacyField: {
          name: 'CUSTNAME',
          type: 'ALPHABETIC',
          length: 30,
          position: 'Ln 07, Col 21',
        },
        componentMapping: {
          componentType: 'Text Field',
          labelText: 'Customer Name (CUSTNAME)',
          isRequired: true,
          minLength: 2,
          maxLength: 30,
          regexPattern: '',
        },
      },
      {
        legacyField: {
          name: 'ACCTSTAT',
          type: 'ALPHA_NUMERIC',
          length: 8,
          position: 'Ln 09, Col 21',
        },
        componentMapping: {
          componentType: 'Text Field',
          labelText: 'Account Status (ACCTSTAT)',
          isRequired: true,
          minLength: 1,
          maxLength: 8,
          regexPattern: '',
        },
      },
      {
        legacyField: {
          name: 'CRDLIMIT',
          type: 'NUMERIC',
          length: 12,
          position: 'Ln 09, Col 50',
        },
        componentMapping: {
          componentType: 'Text Field',
          labelText: 'Credit Limit (CRDLIMIT)',
          isRequired: true,
          minLength: 1,
          maxLength: 12,
          regexPattern: '^[0-9.]+$',
        },
      },
      {
        legacyField: {
          name: 'PASSWD',
          type: 'ALPHA_NUMERIC',
          length: 8,
          position: 'Ln 11, Col 21',
        },
        componentMapping: {
          componentType: 'Password Input',
          labelText: 'Password (PASSWD)',
          isRequired: true,
          minLength: 6,
          maxLength: 8,
          regexPattern: '',
        },
      },
    ];
  }
}
