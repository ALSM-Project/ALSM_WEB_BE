import { ProjectService } from '../src/modules/projects/application/project.service';
import {
  ConversionType,
  ProjectRepository,
  ProjectStatus,
} from '../src/modules/projects/domain/project.types';
import { OrganizationContextService } from '../src/modules/organizations/application/organization-context.service';
import { OrganizationAuthorizationService } from '../src/modules/organizations/application/organization-authorization.service';
import { AuditRepository } from '../src/modules/audit/domain/audit.repository';
describe('ProjectService organization isolation', () => {
  const project = {
    id: 'project-a',
    organizationId: 'org-a',
    name: 'A',
    conversionType: ConversionType.COBOL_TO_JAVA,
    status: ProjectStatus.DRAFT,
    createdBy: 'user-a',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const projects = {
    create: jest.fn(),
    findById: jest.fn(),
    findAll: jest.fn(),
    update: jest.fn(),
    softDelete: jest.fn(),
  };
  const organizations = { resolve: jest.fn() };
  const authorization = { require: jest.fn() };
  const audit = { append: jest.fn() };
  const service = new ProjectService(
    projects as unknown as ProjectRepository,
    organizations as unknown as OrganizationContextService,
    authorization as unknown as OrganizationAuthorizationService,
    audit as unknown as AuditRepository,
  );
  beforeEach(() => jest.resetAllMocks());
  it('creates a project in the validated organization, never a body-provided one', async () => {
    organizations.resolve.mockResolvedValue({
      id: 'org-a',
      members: [{ userId: 'user-a', role: 'OWNER' }],
    });
    projects.create.mockResolvedValue(project);
    await service.create('user-a', 'org-a', {
      name: 'A',
      conversionType: ConversionType.COBOL_TO_JAVA,
    });
    expect(projects.create).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'org-a', createdBy: 'user-a' }),
    );
  });
  it('returns an empty list without creating a project or audit record', async () => {
    organizations.resolve.mockResolvedValue({ id: 'org-a' });
    projects.findAll.mockResolvedValue([]);
    await expect(service.list('user-a', 'org-a')).resolves.toEqual([]);
    expect(projects.findAll).toHaveBeenCalledWith('org-a');
    expect(projects.create).not.toHaveBeenCalled();
    expect(audit.append).not.toHaveBeenCalled();
  });

  describe.each(['get', 'getForOrganization'] as const)('%s', (method) => {
    const read = (id: string) =>
      method === 'get'
        ? service.get('user-a', 'org-a', id)
        : service.getForOrganization(id, 'org-a');

    it.each(['project-b', 'missing-project'])(
      'denies %s without writes or an unscoped retry',
      async (id) => {
        organizations.resolve.mockResolvedValue({ id: 'org-a' });
        projects.findById.mockResolvedValue(null);
        projects.create.mockRejectedValue({ code: 11000 });
        await expect(read(id)).rejects.toMatchObject({
          status: 404,
          response: { code: 'PROJECT_NOT_FOUND' },
        });
        expect(projects.findById).toHaveBeenCalledTimes(1);
        expect(projects.findById).toHaveBeenCalledWith(id, 'org-a');
        expect(projects.create).not.toHaveBeenCalled();
        expect(audit.append).not.toHaveBeenCalled();
      },
    );

    it('returns an existing scoped project without writes', async () => {
      organizations.resolve.mockResolvedValue({ id: 'org-a' });
      projects.findById.mockResolvedValue(project);
      await expect(read(project.id)).resolves.toEqual(project);
      expect(projects.findById).toHaveBeenCalledWith(project.id, 'org-a');
      expect(projects.create).not.toHaveBeenCalled();
      expect(audit.append).not.toHaveBeenCalled();
    });
  });
});
