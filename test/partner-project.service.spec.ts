import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CreatePartnerProjectService } from '../src/modules/partners/application/create-partner-project.service';
import { ListPartnerProjectsService } from '../src/modules/partners/application/list-partner-projects.service';
import { GetPartnerService } from '../src/modules/partners/application/get-partner.service';
import { PartnerRepository, PartnerStatus } from '../src/modules/partners/domain/partner.types';
import { OrganizationRepository } from '../src/modules/organizations/domain/organization.repository';
import { OrganizationRole, OrganizationType } from '../src/modules/organizations/domain/organization.types';
import { ConversionType, ProjectRepository, ProjectStatus } from '../src/modules/projects/domain/project.types';
import { AuditRepository } from '../src/modules/audit/domain/audit.repository';

const existingPartner = {
  id: 'partner-1',
  name: 'Acme Vendor',
  contactEmail: 'partner@vendor.com',
  status: PartnerStatus.ACTIVE,
  createdBy: 'staff-0',
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('CreatePartnerProjectService (UC-45)', () => {
  let partners: jest.Mocked<PartnerRepository>;
  let organizations: jest.Mocked<OrganizationRepository>;
  let projects: jest.Mocked<ProjectRepository>;
  let audit: jest.Mocked<AuditRepository>;
  let service: CreatePartnerProjectService;

  beforeEach(() => {
    partners = {
      findByEmail: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
      list: jest.fn(),
      setOrganizationId: jest.fn(),
    } as unknown as jest.Mocked<PartnerRepository>;
    organizations = {
      create: jest.fn(),
      findForMember: jest.fn(),
      findFirstForMember: jest.fn(),
    } as unknown as jest.Mocked<OrganizationRepository>;
    projects = {
      create: jest.fn(),
      findById: jest.fn(),
      findAll: jest.fn(),
      update: jest.fn(),
      softDelete: jest.fn(),
    } as unknown as jest.Mocked<ProjectRepository>;
    audit = { append: jest.fn() } as unknown as jest.Mocked<AuditRepository>;
    service = new CreatePartnerProjectService(partners, organizations, projects, audit);
  });

  it('rejects a missing project name', async () => {
    partners.findById.mockResolvedValue(existingPartner);
    await expect(
      service.execute('staff-1', 'partner-1', { name: '  ', conversionType: ConversionType.COBOL_TO_JAVA }),
    ).rejects.toThrow(BadRequestException);
    expect(projects.create).not.toHaveBeenCalled();
  });

  it('rejects an invalid conversionType', async () => {
    partners.findById.mockResolvedValue(existingPartner);
    await expect(
      service.execute('staff-1', 'partner-1', { name: 'CardDemo Modernization', conversionType: 'NOT_REAL' as ConversionType }),
    ).rejects.toThrow(BadRequestException);
    expect(projects.create).not.toHaveBeenCalled();
  });

  it('rejects a non-existent partner with 404', async () => {
    partners.findById.mockResolvedValue(null);
    await expect(
      service.execute('staff-1', 'missing-partner', {
        name: 'CardDemo Modernization',
        conversionType: ConversionType.COBOL_TO_JAVA,
      }),
    ).rejects.toThrow(NotFoundException);
    expect(organizations.create).not.toHaveBeenCalled();
  });

  it("provisions a real Organization on the partner's first project and links it back", async () => {
    partners.findById.mockResolvedValue({ ...existingPartner, organizationId: undefined });
    organizations.create.mockResolvedValue({
      id: 'org-new',
      name: 'Acme Vendor Workspace',
      type: OrganizationType.ENTERPRISE,
      members: [{ userId: 'staff-1', role: OrganizationRole.OWNER }],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    projects.create.mockResolvedValue({
      id: 'project-1',
      organizationId: 'org-new',
      name: 'CardDemo Modernization',
      conversionType: ConversionType.COBOL_TO_JAVA,
      status: ProjectStatus.DRAFT,
      createdBy: 'staff-1',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await service.execute('staff-1', 'partner-1', {
      name: 'CardDemo Modernization',
      conversionType: ConversionType.COBOL_TO_JAVA,
    });

    expect(organizations.create).toHaveBeenCalledWith({
      name: 'Acme Vendor Workspace',
      type: OrganizationType.ENTERPRISE,
      members: [{ userId: 'staff-1', role: OrganizationRole.OWNER }],
    });
    expect(partners.setOrganizationId).toHaveBeenCalledWith('partner-1', 'org-new');
    expect(projects.create).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'org-new', name: 'CardDemo Modernization' }),
    );
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'PARTNER_PROJECT_CREATED',
        organizationId: 'org-new',
        metadata: { partnerId: 'partner-1' },
      }),
    );
    expect(result.id).toBe('project-1');
  });

  it('reuses the existing Organization for a second project, without re-provisioning one', async () => {
    partners.findById.mockResolvedValue({ ...existingPartner, organizationId: 'org-existing' });
    projects.create.mockResolvedValue({
      id: 'project-2',
      organizationId: 'org-existing',
      name: 'Second Project',
      conversionType: ConversionType.BMS_DSPF_TO_FRONTEND,
      status: ProjectStatus.DRAFT,
      createdBy: 'staff-1',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await service.execute('staff-1', 'partner-1', {
      name: 'Second Project',
      conversionType: ConversionType.BMS_DSPF_TO_FRONTEND,
    });

    expect(organizations.create).not.toHaveBeenCalled();
    expect(partners.setOrganizationId).not.toHaveBeenCalled();
    expect(projects.create).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'org-existing' }),
    );
  });
});

describe('ListPartnerProjectsService (UC-45)', () => {
  it('returns an honest empty list when the partner has no workspace/projects yet', async () => {
    const partners = {
      findById: jest.fn().mockResolvedValue({ ...existingPartner, organizationId: undefined }),
    } as unknown as jest.Mocked<PartnerRepository>;
    const projects = { findAll: jest.fn() } as unknown as jest.Mocked<ProjectRepository>;

    const service = new ListPartnerProjectsService(partners, projects);
    const result = await service.execute('partner-1');

    expect(result).toEqual([]);
    expect(projects.findAll).not.toHaveBeenCalled();
  });

  it('lists real projects once the partner has a workspace', async () => {
    const partners = {
      findById: jest.fn().mockResolvedValue({ ...existingPartner, organizationId: 'org-existing' }),
    } as unknown as jest.Mocked<PartnerRepository>;
    const projects = {
      findAll: jest.fn().mockResolvedValue([
        {
          id: 'project-1',
          organizationId: 'org-existing',
          name: 'CardDemo Modernization',
          conversionType: ConversionType.COBOL_TO_JAVA,
          status: ProjectStatus.DRAFT,
          createdBy: 'staff-1',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]),
    } as unknown as jest.Mocked<ProjectRepository>;

    const service = new ListPartnerProjectsService(partners, projects);
    const result = await service.execute('partner-1');

    expect(projects.findAll).toHaveBeenCalledWith('org-existing');
    expect(result).toHaveLength(1);
  });

  it('throws 404 for a non-existent partner', async () => {
    const partners = { findById: jest.fn().mockResolvedValue(null) } as unknown as jest.Mocked<PartnerRepository>;
    const projects = { findAll: jest.fn() } as unknown as jest.Mocked<ProjectRepository>;
    const service = new ListPartnerProjectsService(partners, projects);

    await expect(service.execute('missing')).rejects.toThrow(NotFoundException);
  });
});

describe('GetPartnerService (UC-45)', () => {
  it('returns the real partner record', async () => {
    const partners = { findById: jest.fn().mockResolvedValue(existingPartner) } as unknown as jest.Mocked<PartnerRepository>;
    const service = new GetPartnerService(partners);
    const result = await service.execute('partner-1');
    expect(result).toBe(existingPartner);
  });

  it('throws 404 for a non-existent partner', async () => {
    const partners = { findById: jest.fn().mockResolvedValue(null) } as unknown as jest.Mocked<PartnerRepository>;
    const service = new GetPartnerService(partners);
    await expect(service.execute('missing')).rejects.toThrow(NotFoundException);
  });
});
