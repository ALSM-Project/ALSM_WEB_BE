import { NotFoundException } from '@nestjs/common';
import { GetFieldMappingService } from '../src/modules/conversions/application/get-field-mapping.service';
import { SaveFieldMappingService } from '../src/modules/conversions/application/save-field-mapping.service';
import { FieldMappingRepository } from '../src/modules/conversions/domain/field-mapping.types';
import { OrganizationContextService } from '../src/modules/organizations/application/organization-context.service';
import { OrganizationAuthorizationService } from '../src/modules/organizations/application/organization-authorization.service';
import { ProjectService } from '../src/modules/projects/application/project.service';
import { AuditRepository } from '../src/modules/audit/domain/audit.repository';
import { ConversionType, ProjectStatus } from '../src/modules/projects/domain/project.types';

describe('Field mapping organization isolation', () => {
  const project = {
    id: 'project-a',
    organizationId: 'org-a',
    name: 'A',
    conversionType: ConversionType.BMS_DSPF_TO_FRONTEND,
    status: ProjectStatus.ACTIVE,
    createdBy: 'user-a',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const fieldMappings = { findByScreen: jest.fn(), upsert: jest.fn() };
  const sampleEntry = {
    legacyField: { name: 'USER-ID', type: 'Alphanumeric', length: 20, position: 'R10, C15' },
    componentMapping: {
      componentType: 'Text Field',
      labelText: 'Username',
      isRequired: true,
      minLength: 4,
      maxLength: 20,
      regexPattern: '',
    },
  };
  const organizations = { resolve: jest.fn() };
  const authorization = { require: jest.fn() };
  const projects = { getForOrganization: jest.fn() };
  const audit = { append: jest.fn() };

  const getService = new GetFieldMappingService(
    fieldMappings as unknown as FieldMappingRepository,
    projects as unknown as ProjectService,
    organizations as unknown as OrganizationContextService,
  );
  const saveService = new SaveFieldMappingService(
    fieldMappings as unknown as FieldMappingRepository,
    projects as unknown as ProjectService,
    organizations as unknown as OrganizationContextService,
    authorization as unknown as OrganizationAuthorizationService,
    audit as unknown as AuditRepository,
  );

  beforeEach(() => jest.clearAllMocks());

  it('returns an empty mapping view when nothing has been saved yet', async () => {
    organizations.resolve.mockResolvedValue({ id: 'org-a' });
    projects.getForOrganization.mockResolvedValue(project);
    fieldMappings.findByScreen.mockResolvedValue(null);

    const result = await getService.execute({
      userId: 'user-a',
      organizationHeader: 'org-a',
      projectId: 'project-a',
      screenId: 'scr-login',
    });

    expect(result).toEqual({
      projectId: 'project-a',
      screenId: 'scr-login',
      mappings: [],
      updatedBy: null,
      updatedAt: null,
    });
    expect(projects.getForOrganization).toHaveBeenCalledWith('project-a', 'org-a');
  });

  it('does not resolve a project from Organization B through Organization A scope', async () => {
    organizations.resolve.mockResolvedValue({ id: 'org-a' });
    projects.getForOrganization.mockRejectedValue(
      new NotFoundException({ code: 'PROJECT_NOT_FOUND' }),
    );

    await expect(
      getService.execute({
        userId: 'user-a',
        organizationHeader: 'org-a',
        projectId: 'project-b',
        screenId: 'scr-login',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(fieldMappings.findByScreen).not.toHaveBeenCalled();
  });

  it('saves the mapping under the resolved organization/project, not a client-supplied one', async () => {
    organizations.resolve.mockResolvedValue({ id: 'org-a' });
    projects.getForOrganization.mockResolvedValue(project);
    fieldMappings.upsert.mockResolvedValue({
      id: 'fm-1',
      organizationId: 'org-a',
      projectId: 'project-a',
      screenId: 'scr-login',
      mappings: [sampleEntry],
      updatedBy: 'user-a',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await saveService.execute({
      userId: 'user-a',
      organizationHeader: 'org-a',
      projectId: 'project-a',
      screenId: 'scr-login',
      mappings: [sampleEntry],
    });

    expect(authorization.require).toHaveBeenCalledWith(
      { id: 'org-a' },
      'user-a',
      expect.arrayContaining(['OWNER', 'ADMIN', 'MEMBER']),
    );
    expect(fieldMappings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'org-a', projectId: 'project-a' }),
    );
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'FIELD_MAPPING_UPDATED', organizationId: 'org-a' }),
    );
  });

  it('rejects saving a mapping for a project outside the caller organization', async () => {
    organizations.resolve.mockResolvedValue({ id: 'org-a' });
    projects.getForOrganization.mockRejectedValue(
      new NotFoundException({ code: 'PROJECT_NOT_FOUND' }),
    );

    await expect(
      saveService.execute({
        userId: 'user-a',
        organizationHeader: 'org-a',
        projectId: 'project-b',
        screenId: 'scr-login',
        mappings: [],
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(fieldMappings.upsert).not.toHaveBeenCalled();
  });
});
