import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import {
  TEAM_REPOSITORY,
  TeamKind,
  TeamProjectAssignment,
  TeamRepository,
} from '../domain/team.types';
import { TeamAccessService, teamId } from './team-access.service';
import { USER_REPOSITORY, UserRepository } from '../../users/domain/user.repository';
import { PROJECT_REPOSITORY, ProjectRepository } from '../../projects/domain/project.types';
import { AUDIT_REPOSITORY, AuditRepository } from '../../audit/domain/audit.repository';
import { OrganizationRole } from '../../organizations/domain/organization.types';

export interface SaveTeamCommand {
  name: string;
  kind: TeamKind;
  memberIds: string[];
  managerIds: string[];
  projectAssignments: TeamProjectAssignment[];
  expectedRevision: number;
}

@Injectable()
export class SaveTeamService {
  constructor(
    private readonly access: TeamAccessService,
    @Inject(TEAM_REPOSITORY) private readonly teams: TeamRepository,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(PROJECT_REPOSITORY) private readonly projects: ProjectRepository,
    @Inject(AUDIT_REPOSITORY) private readonly audit: AuditRepository,
  ) {}

  async execute(
    userId: string,
    organizationHeader: string | undefined,
    input: SaveTeamCommand,
    id?: string,
  ) {
    const organization = await this.access.administer(userId, organizationHeader);
    if (
      !Object.values(TeamKind).includes(input.kind) ||
      !input.name.trim() ||
      input.name.trim().length > 120 ||
      !Number.isSafeInteger(input.expectedRevision) ||
      input.expectedRevision < 0 ||
      (!id && input.expectedRevision !== 0)
    ) {
      throw new BadRequestException({ code: 'INVALID_TEAM', message: 'Invalid team or revision' });
    }
    const uniqueIds = (values: string[]) => {
      const normalized = values.map(teamId);
      if (values.length > 100 || new Set(normalized).size !== values.length)
        throw new BadRequestException({
          code: 'INVALID_TEAM',
          message: 'Team assignments must be unique and limited to 100',
        });
      return normalized;
    };
    const memberIds = uniqueIds(input.memberIds);
    const managerIds = uniqueIds(input.managerIds);
    for (const target of new Set([...memberIds, ...managerIds])) {
      const membership = organization.members.find((m) => m.userId === target);
      if (
        !membership ||
        (managerIds.includes(target) && membership.role === OrganizationRole.VIEWER) ||
        !(await this.users.findById(target))?.isActive
      ) {
        throw new BadRequestException({
          code: 'INVALID_TEAM_MEMBER',
          message:
            'Only active members of this organization may be assigned; viewers cannot manage teams',
        });
      }
    }
    if (input.kind === TeamKind.SALES && input.projectAssignments.length)
      throw new BadRequestException({
        code: 'INVALID_TEAM',
        message: 'Project workload assignments require a Conversion Team',
      });
    uniqueIds(input.projectAssignments.map((p) => p.projectId));
    const projectAssignments: TeamProjectAssignment[] = [];
    for (const assignment of input.projectAssignments) {
      const projectId = teamId(assignment.projectId);
      const project = await this.projects.findById(projectId, organization.id);
      const assignedMembers = uniqueIds(assignment.memberIds);
      if (
        !project ||
        project.id !== projectId ||
        project.organizationId !== organization.id ||
        project.deletedAt ||
        assignedMembers.some((m) => !memberIds.includes(m))
      )
        throw new BadRequestException({
          code: 'INVALID_TEAM_PROJECT',
          message: 'Projects must belong to this organization and assignees must be team members',
        });
      projectAssignments.push({ projectId, memberIds: assignedMembers });
    }
    await this.audit.append({
      actorUserId: userId,
      organizationId: organization.id,
      action: 'TEAM_SAVE_REQUESTED',
      resourceType: 'team',
      resourceId: id,
      metadata: { expectedRevision: String(input.expectedRevision) },
    });
    const result = await this.teams.save({
      ...input,
      id: id ? teamId(id) : undefined,
      name: input.name.trim(),
      organizationId: organization.id,
      actorUserId: userId,
      memberIds,
      managerIds,
      projectAssignments,
    });
    if (!result)
      throw new ConflictException({
        code: 'TEAM_REVISION_CONFLICT',
        message: 'Team changed, has a different type, or is unavailable; reload before retrying',
      });
    await this.audit.append({
      actorUserId: userId,
      organizationId: organization.id,
      action: 'TEAM_SAVED',
      resourceType: 'team',
      resourceId: result.id,
      metadata: { revision: String(result.revision) },
    });
    return result;
  }
}
