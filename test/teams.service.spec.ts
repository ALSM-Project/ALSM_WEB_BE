import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { TeamAccessService } from '../src/modules/teams/application/team-access.service';
import { SaveTeamService } from '../src/modules/teams/application/save-team.service';
import { ListManagedTeamsService } from '../src/modules/teams/application/list-managed-teams.service';
import { TeamKind, TeamRepository } from '../src/modules/teams/domain/team.types';
import { OrganizationContextService } from '../src/modules/organizations/application/organization-context.service';
import { OrganizationAuthorizationService } from '../src/modules/organizations/application/organization-authorization.service';
import { OrganizationRole } from '../src/modules/organizations/domain/organization.types';
import { UserRepository } from '../src/modules/users/domain/user.repository';
import { EffectivePermissionsService } from '../src/modules/rbac/application/effective-permissions.service';
import { ProjectRepository } from '../src/modules/projects/domain/project.types';
import { AuditRepository } from '../src/modules/audit/domain/audit.repository';

const owner = '111111111111111111111111';
const manager = '222222222222222222222222';
const member = '333333333333333333333333';
const organizationId = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const id = 'bbbbbbbbbbbbbbbbbbbbbbbb';
function setup() {
  const organization = {
    id: organizationId,
    members: [owner, manager, member].map((userId) => ({
      userId,
      role: userId === owner ? OrganizationRole.OWNER : OrganizationRole.MEMBER,
    })),
  };
  const context = { resolve: jest.fn().mockResolvedValue(organization) };
  const users = { findById: jest.fn().mockResolvedValue({ isActive: true }) };
  const permissions = { getEffectivePermissions: jest.fn().mockResolvedValue(['users.manage']) };
  const teams = {
    findManaged: jest.fn(),
    listManaged: jest.fn().mockResolvedValue([]),
    save: jest.fn().mockImplementation(async (input) => ({ ...input, id, revision: 1 })),
  };
  const access = new TeamAccessService(
    context as unknown as OrganizationContextService,
    new OrganizationAuthorizationService(),
    users as unknown as UserRepository,
    permissions as unknown as EffectivePermissionsService,
    teams as unknown as TeamRepository,
  );
  const projects = { findById: jest.fn().mockResolvedValue({ organizationId }) };
  const audit = { append: jest.fn().mockResolvedValue(undefined) };
  const save = new SaveTeamService(
    access,
    teams as unknown as TeamRepository,
    users as unknown as UserRepository,
    projects as unknown as ProjectRepository,
    audit as AuditRepository,
  );
  const input = {
    name: 'Sales',
    kind: TeamKind.SALES,
    memberIds: [member],
    managerIds: [manager],
    projectAssignments: [],
    expectedRevision: 0,
  };
  return { access, save, context, users, permissions, teams, projects, audit, organization, input };
}

describe('explicit organization-owned teams', () => {
  it('creates only explicitly supplied memberships and records actor audit', async () => {
    const f = setup();
    const result = await f.save.execute(owner, organizationId, f.input);
    expect(result.memberIds).toEqual([member]);
    expect(f.teams.save).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId,
        actorUserId: owner,
        managerIds: [manager],
        memberIds: [member],
      }),
    );
    expect(f.audit.append).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: 'TEAM_SAVED', actorUserId: owner, organizationId }),
    );
  });
  it('requires both organization administration and existing RBAC permission', async () => {
    const f = setup();
    await expect(f.save.execute(member, organizationId, f.input)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    f.permissions.getEffectivePermissions.mockResolvedValue([]);
    await expect(f.save.execute(owner, organizationId, f.input)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(f.teams.save).not.toHaveBeenCalled();
  });
  it('does not let a global permission bypass organization isolation', async () => {
    const f = setup();
    f.context.resolve.mockRejectedValue(new ForbiddenException());
    await expect(f.save.execute(owner, 'cccccccccccccccccccccccc', f.input)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(f.teams.save).not.toHaveBeenCalled();
  });
  it('rejects inactive actors before any team lookup', async () => {
    const f = setup();
    f.users.findById.mockResolvedValue({ isActive: false });
    await expect(
      f.access.managed(manager, organizationId, id, TeamKind.SALES),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(f.teams.findManaged).not.toHaveBeenCalled();
  });
  it('requires an exact persisted manager/team/type relationship', async () => {
    const f = setup();
    f.teams.findManaged.mockResolvedValue(null);
    await expect(
      f.access.managed(member, organizationId, id, TeamKind.SALES),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(f.teams.findManaged).toHaveBeenCalledWith(id, organizationId, member, TeamKind.SALES);
  });
  it('lists only manager-scoped teams and returns no membership or history fields', async () => {
    const f = setup();
    f.teams.listManaged.mockResolvedValue([
      {
        id,
        organizationId,
        name: 'Sales',
        kind: TeamKind.SALES,
        memberIds: [member],
        changes: ['private'],
        revision: 1,
      },
    ]);
    const result = await new ListManagedTeamsService(
      f.access,
      f.teams as unknown as TeamRepository,
    ).execute(manager, organizationId, TeamKind.SALES);
    expect(result).toEqual([
      { id, organizationId, name: 'Sales', kind: TeamKind.SALES, revision: 1 },
    ]);
    expect(f.teams.listManaged).toHaveBeenCalledWith(organizationId, manager, TeamKind.SALES);
  });
  it('rejects foreign members and viewers as managers', async () => {
    const f = setup();
    await expect(
      f.save.execute(owner, organizationId, {
        ...f.input,
        memberIds: ['cccccccccccccccccccccccc'],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    f.organization.members[1].role = OrganizationRole.VIEWER;
    await expect(f.save.execute(owner, organizationId, f.input)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(f.teams.save).not.toHaveBeenCalled();
  });
  it('denies a former manager downgraded to an organization viewer', async () => {
    const f = setup();
    f.organization.members[1].role = OrganizationRole.VIEWER;
    await expect(
      f.access.managed(manager, organizationId, id, TeamKind.SALES),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      new ListManagedTeamsService(f.access, f.teams as unknown as TeamRepository).execute(
        manager,
        organizationId,
        TeamKind.SALES,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(f.teams.findManaged).not.toHaveBeenCalled();
    expect(f.teams.listManaged).not.toHaveBeenCalled();
  });
  it('rejects duplicate memberships, malformed identifiers and nonzero creation revisions', async () => {
    const f = setup();
    for (const input of [
      { ...f.input, memberIds: [member, member] },
      { ...f.input, managerIds: ['alias'] },
      { ...f.input, expectedRevision: 1 },
    ]) {
      await expect(f.save.execute(owner, organizationId, input)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    }
    expect(f.teams.save).not.toHaveBeenCalled();
  });
  it('validates active project ownership and team membership before assignments', async () => {
    const f = setup();
    const input = {
      ...f.input,
      kind: TeamKind.CONVERSION,
      projectAssignments: [{ projectId: id, memberIds: [member] }],
    };
    await f.save.execute(owner, organizationId, input);
    expect(f.projects.findById).toHaveBeenCalledWith(id, organizationId);
    f.projects.findById.mockResolvedValue(null);
    await expect(f.save.execute(owner, organizationId, input)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
  it('fails closed before mutation if requested-action audit is unavailable', async () => {
    const f = setup();
    f.audit.append.mockRejectedValue(new Error('audit unavailable'));
    await expect(f.save.execute(owner, organizationId, f.input)).rejects.toThrow(
      'audit unavailable',
    );
    expect(f.teams.save).not.toHaveBeenCalled();
  });
  it('surfaces compare-and-set conflicts without reporting a saved outcome', async () => {
    const f = setup();
    f.teams.save.mockResolvedValue(null);
    await expect(
      f.save.execute(owner, organizationId, { ...f.input, expectedRevision: 3 }, id),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(f.audit.append).toHaveBeenCalledTimes(1);
  });
});
