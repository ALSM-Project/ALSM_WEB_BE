import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { OrganizationContextService } from '../../organizations/application/organization-context.service';
import {
  ORGANIZATION_REPOSITORY,
  OrganizationRepository,
} from '../../organizations/domain/organization.repository';
import {
  PROJECT_REPOSITORY,
  ProjectRecord,
  ProjectRepository,
} from '../../projects/domain/project.types';
import { EffectivePermissionsService } from '../../rbac/application/effective-permissions.service';
import { TEAM_REPOSITORY, TeamKind, TeamRepository } from '../../teams/domain/team.types';

/** Conversion Staff access is the intersection of current organization membership,
 * current Conversion Team membership, and an explicit member/project assignment.
 * Re-read persisted relationships on every request; no permission/assignment cache. */
@Injectable()
export class ConversionProjectAccessService {
  constructor(
    private readonly permissions: EffectivePermissionsService,
    @Inject(TEAM_REPOSITORY) private readonly teams: TeamRepository,
    @Inject(ORGANIZATION_REPOSITORY) private readonly organizations: OrganizationRepository,
    @Inject(PROJECT_REPOSITORY) private readonly projects: ProjectRepository,
    private readonly context: OrganizationContextService,
  ) {}

  async requireAssignment(
    userId: string,
    organizationId: string,
    projectId: string,
  ): Promise<void> {
    if (!(await this.isConversionStaff(userId))) return; // Existing customer/admin contract.
    const teams = await this.teams.listForMember(userId, organizationId);
    if (
      !teams.some(
        (team) =>
          team.kind === TeamKind.CONVERSION &&
          team.organizationId === organizationId &&
          team.memberIds.includes(userId) &&
          team.projectAssignments.some(
            (assignment) =>
              assignment.projectId === projectId && assignment.memberIds.includes(userId),
          ),
      )
    ) {
      throw new ForbiddenException({
        code: 'CONVERSION_PROJECT_ASSIGNMENT_REQUIRED',
        message: 'You are not assigned to this conversion project',
      });
    }
  }

  async listQueueProjects(userId: string, organizationHeader?: string): Promise<ProjectRecord[]> {
    const permissions = await this.permissions.getEffectivePermissions(userId);
    if (
      !permissions.some((permission) =>
        ['conversions.queue.view', 'quality-review.manage'].includes(permission),
      )
    ) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'You do not have permission to view this queue',
      });
    }
    if (!(await this.isConversionStaff(userId))) {
      const organization = await this.context.resolve(userId, organizationHeader);
      return this.projects.findAll(organization.id);
    }
    // An explicit header still has to pass tenant membership checks.
    const organization = organizationHeader
      ? await this.context.resolve(userId, organizationHeader)
      : undefined;
    const teams = await this.teams.listForMember(userId, organization?.id);
    const projects = new Map<string, ProjectRecord>();
    for (const team of teams) {
      if (
        team.kind !== TeamKind.CONVERSION ||
        !team.memberIds.includes(userId) ||
        (organization && team.organizationId !== organization.id) ||
        !(await this.organizations.findForMember(team.organizationId, userId))
      )
        continue;
      for (const assignment of team.projectAssignments) {
        if (!assignment.memberIds.includes(userId)) continue;
        const project = await this.projects.findById(assignment.projectId, team.organizationId);
        if (
          project &&
          project.id === assignment.projectId &&
          project.organizationId === team.organizationId &&
          !project.deletedAt
        ) {
          projects.set(project.id, project);
        }
      }
    }
    return [...projects.values()].sort(
      (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
    );
  }

  private async isConversionStaff(userId: string): Promise<boolean> {
    return (await this.permissions.getUserRoles(userId)).some(
      (role) => role.toUpperCase() === 'CONVERSION_STAFF',
    );
  }
}
