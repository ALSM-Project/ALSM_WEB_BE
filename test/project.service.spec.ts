import { ProjectService } from '../src/modules/projects/application/project.service'; import { ConversionType, ProjectRepository, ProjectStatus } from '../src/modules/projects/domain/project.types'; import { OrganizationContextService } from '../src/modules/organizations/application/organization-context.service'; import { OrganizationAuthorizationService } from '../src/modules/organizations/application/organization-authorization.service'; import { AuditRepository } from '../src/modules/audit/domain/audit.repository';
describe('ProjectService organization isolation', () => { const project = { id: 'project-a', organizationId: 'org-a', name: 'A', conversionType: ConversionType.COBOL_TO_JAVA, status: ProjectStatus.DRAFT, createdBy: 'user-a', createdAt: new Date(), updatedAt: new Date() }; const projects = { create: jest.fn(), findById: jest.fn(), findAll: jest.fn(), update: jest.fn(), softDelete: jest.fn() }; const organizations = { resolve: jest.fn() }; const authorization = { require: jest.fn() }; const audit = { append: jest.fn() }; const service = new ProjectService(projects as unknown as ProjectRepository, organizations as unknown as OrganizationContextService, authorization as unknown as OrganizationAuthorizationService, audit as unknown as AuditRepository);
  beforeEach(() => jest.clearAllMocks());
  it('creates a project in the validated organization, never a body-provided one', async () => { organizations.resolve.mockResolvedValue({ id: 'org-a', members: [{ userId: 'user-a', role: 'OWNER' }] }); projects.create.mockResolvedValue(project); await service.create('user-a', 'org-a', { name: 'A', conversionType: ConversionType.COBOL_TO_JAVA }); expect(projects.create).toHaveBeenCalledWith(expect.objectContaining({ organizationId: 'org-a', createdBy: 'user-a' })); });
  it('does not expose an Organization B project through Organization A scope', async () => {
    organizations.resolve.mockResolvedValue({ id: 'org-a' });
    projects.findById.mockResolvedValue(null);
    projects.create.mockResolvedValue({ ...project, id: 'project-b', organizationId: 'org-a' });
    const res = await service.get('user-a', 'org-a', 'project-b');
    expect(res.organizationId).toBe('org-a');
    expect(projects.findById).toHaveBeenCalledWith('project-b', 'org-a');
  });
});
