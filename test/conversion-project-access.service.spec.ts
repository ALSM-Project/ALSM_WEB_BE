import { ForbiddenException } from '@nestjs/common';
import { ConversionProjectAccessService } from '../src/modules/conversions/application/conversion-project-access.service';
import { OrganizationContextService } from '../src/modules/organizations/application/organization-context.service';
import { OrganizationRepository } from '../src/modules/organizations/domain/organization.repository';
import { ProjectRepository } from '../src/modules/projects/domain/project.types';
import { EffectivePermissionsService } from '../src/modules/rbac/application/effective-permissions.service';
import { TeamKind, TeamRecord, TeamRepository } from '../src/modules/teams/domain/team.types';

describe('Conversion Staff project authorization', () => {
  const permissions = { getUserRoles: jest.fn(), getEffectivePermissions: jest.fn() };
  const teams = { listForMember: jest.fn() };
  const organizations = { findForMember: jest.fn() };
  const projects = { findById: jest.fn(), findAll: jest.fn() };
  const context = { resolve: jest.fn() };
  const service = new ConversionProjectAccessService(
    permissions as unknown as EffectivePermissionsService,
    teams as unknown as TeamRepository,
    organizations as unknown as OrganizationRepository,
    projects as unknown as ProjectRepository,
    context as unknown as OrganizationContextService,
  );
  const team: TeamRecord = {
    id: 'team-a',
    organizationId: 'org-a',
    name: 'Conversion Team',
    kind: TeamKind.CONVERSION,
    memberIds: ['staff'],
    managerIds: ['manager'],
    revision: 1,
    projectAssignments: [{ projectId: 'project-a', memberIds: ['staff'] }],
  };
  beforeEach(() => {
    jest.resetAllMocks();
    permissions.getUserRoles.mockResolvedValue(['CONVERSION_STAFF']);
    permissions.getEffectivePermissions.mockResolvedValue(['conversions.queue.view']);
    teams.listForMember.mockResolvedValue([team]);
    organizations.findForMember.mockResolvedValue({ id: 'org-a' });
    projects.findById.mockImplementation((id: string, organizationId: string) =>
      Promise.resolve({ id, organizationId, name: id }),
    );
    context.resolve.mockResolvedValue({ id: 'org-a' });
  });
  it('requires an explicit project assignment even for an organization owner', async () => {
    teams.listForMember.mockResolvedValue([]);
    await expect(service.requireAssignment('staff', 'org-a', 'project-a')).rejects.toMatchObject({
      response: { code: 'CONVERSION_PROJECT_ASSIGNMENT_REQUIRED' },
    });
  });
  it.each([['conversion_staff'], ['ADMIN', 'CONVERSION_STAFF']])(
    'does not bypass assignment checks for legacy or additional roles: %j',
    async (...roles) => {
      permissions.getUserRoles.mockResolvedValue(roles);
      teams.listForMember.mockResolvedValue([]);
      await expect(service.requireAssignment('staff', 'org-a', 'project-a')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    },
  );
  it('permits the assigned project and re-reads persistence after revocation', async () => {
    await expect(service.requireAssignment('staff', 'org-a', 'project-a')).resolves.toBeUndefined();
    teams.listForMember.mockResolvedValue([{ ...team, projectAssignments: [] }]);
    await expect(service.requireAssignment('staff', 'org-a', 'project-a')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(teams.listForMember).toHaveBeenCalledTimes(2);
  });
  it.each([
    { ...team, organizationId: 'org-b' },
    { ...team, kind: TeamKind.SALES },
    { ...team, memberIds: [] },
    {
      ...team,
      projectAssignments: [
        { projectId: 'project-a', memberIds: ['other'] },
        { projectId: 'project-b', memberIds: ['staff'] },
      ],
    },
  ])('rejects mismatched tenant/team/member/assignment pairs', async (invalidTeam) => {
    teams.listForMember.mockResolvedValue([invalidTeam]);
    await expect(service.requireAssignment('staff', 'org-a', 'project-a')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
  it('does not change existing non-staff customer authorization', async () => {
    permissions.getUserRoles.mockResolvedValue(['CUSTOMER']);
    await expect(
      service.requireAssignment('customer', 'org-a', 'project-a'),
    ).resolves.toBeUndefined();
    expect(teams.listForMember).not.toHaveBeenCalled();
  });
  it('lists only explicit assignments across verified member organizations, deduplicating projects', async () => {
    teams.listForMember.mockResolvedValue([
      team,
      team,
      {
        ...team,
        organizationId: 'org-b',
        projectAssignments: [{ projectId: 'project-b', memberIds: ['staff'] }],
      },
    ]);
    const listed = await service.listQueueProjects('staff');
    expect(listed.map((project) => project.id)).toEqual(['project-a', 'project-b']);
    expect(projects.findAll).not.toHaveBeenCalled();
  });
  it('excludes revoked organization membership and projects from another tenant', async () => {
    organizations.findForMember.mockResolvedValue(null);
    expect(await service.listQueueProjects('staff')).toEqual([]);
    expect(projects.findById).not.toHaveBeenCalled();
    organizations.findForMember.mockResolvedValue({ id: 'org-a' });
    projects.findById.mockResolvedValue({
      id: 'project-a',
      name: 'Foreign project',
      organizationId: 'org-b',
    });
    expect(await service.listQueueProjects('staff')).toEqual([]);
  });
  it('omits soft-deleted projects and refuses an unauthorized explicit organization header', async () => {
    projects.findById.mockResolvedValue({
      id: 'project-a',
      name: 'Deleted',
      organizationId: 'org-a',
      deletedAt: new Date(),
    });
    expect(await service.listQueueProjects('staff')).toEqual([]);
    context.resolve.mockRejectedValue(new ForbiddenException());
    await expect(service.listQueueProjects('staff', 'foreign')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
  it('does not allow queue project discovery without a queue or review permission', async () => {
    permissions.getEffectivePermissions.mockResolvedValue([]);
    await expect(service.listQueueProjects('staff')).rejects.toBeInstanceOf(ForbiddenException);
    expect(teams.listForMember).not.toHaveBeenCalled();
  });
  it('preserves current organization scope for non-staff reviewers', async () => {
    permissions.getUserRoles.mockResolvedValue(['ADMIN']);
    permissions.getEffectivePermissions.mockResolvedValue(['quality-review.manage']);
    projects.findAll.mockResolvedValue([{ id: 'project-a' }]);
    expect(await service.listQueueProjects('admin', 'org-a')).toEqual([{ id: 'project-a' }]);
    expect(projects.findAll).toHaveBeenCalledWith('org-a');
  });
  it('propagates persistence failures instead of falling back to membership or sample data', async () => {
    teams.listForMember.mockRejectedValue(new Error('storage unavailable'));
    await expect(service.requireAssignment('staff', 'org-a', 'project-a')).rejects.toThrow(
      'storage unavailable',
    );
    await expect(service.listQueueProjects('staff')).rejects.toThrow('storage unavailable');
  });
});
