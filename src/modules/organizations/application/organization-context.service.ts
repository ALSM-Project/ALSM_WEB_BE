import { ForbiddenException, Inject, Injectable, Optional } from '@nestjs/common';
import { OrganizationRole } from '../domain/organization.types';
import { PROJECT_REPOSITORY, ProjectRepository } from '../../projects/domain/project.types';
import {
  ORGANIZATION_REPOSITORY,
  OrganizationRepository,
  OrganizationRecord,
} from '../domain/organization.repository';
import { USER_REPOSITORY, UserRepository } from '../../users/domain/user.repository';

@Injectable()
export class OrganizationContextService {
  constructor(
    @Inject(ORGANIZATION_REPOSITORY) private readonly organizations: OrganizationRepository,
    @Optional() @Inject(PROJECT_REPOSITORY) private readonly projects?: ProjectRepository,
    @Optional() @Inject(USER_REPOSITORY) private readonly users?: UserRepository,
  ) {}

  private async isInternalOrAdmin(userId: string): Promise<boolean> {
    if (!this.users) return false;
    try {
      const user = await this.users.findById(userId);
      if (!user) return false;
      return Boolean(
        user.isPlatformAdmin ||
        user.role === 'ADMIN' ||
        user.role === 'PLATFORM_ADMIN' ||
        user.roles?.includes('ADMIN') ||
        user.roles?.includes('PLATFORM_ADMIN') ||
        user.role === 'STAFF' ||
        user.roles?.includes('STAFF') ||
        user.role === 'TEAM_LEAD' ||
        user.roles?.includes('TEAM_LEAD')
      );
    } catch {
      return false;
    }
  }

  /**
   * The organization a request acts in. When the request is about one project and a Team Lead
   * allocated that project to this very person (UC-86), or when the user is a Platform Admin / ALSM Staff,
   * the project's own organization is used, with the person counted as a member for this request only: the
   * project may belong to a customer organization they are not a member of, and they still have to do the work.
   * Nobody else gets this, and nothing is stored.
   */
  async resolve(
    userId: string,
    requestedOrganizationId?: string,
    projectId?: string,
  ): Promise<OrganizationRecord> {
    const allocated = projectId ? await this.organizationOfAllocatedProject(userId, projectId) : null;
    if (allocated) return allocated;

    if (requestedOrganizationId) {
      const org = await this.organizations.findById(requestedOrganizationId);
      if (org) {
        if (org.members.some((m) => m.userId === userId)) return org;
        if (await this.isInternalOrAdmin(userId)) {
          return { ...org, members: [...org.members, { userId, role: OrganizationRole.MEMBER }] };
        }
      }
    }

    const organization = requestedOrganizationId
      ? await this.organizations.findForMember(requestedOrganizationId, userId)
      : await this.organizations.findFirstForMember(userId);
    if (!organization)
      throw new ForbiddenException({
        code: 'ORGANIZATION_ACCESS_DENIED',
        message: 'You do not have access to this organization',
      });
    return organization;
  }

  private async organizationOfAllocatedProject(
    userId: string,
    projectId: string,
  ): Promise<OrganizationRecord | null> {
    if (!this.projects) return null;
    const project = await this.projects.findById(projectId);
    if (!project || project.deletedAt) return null;

    const isInternal = await this.isInternalOrAdmin(userId);
    const isAllocated =
      isInternal ||
      (project as any).assignedTeamLeadId === userId ||
      (project as any).assignedStaffId === userId ||
      (Array.isArray((project as any).assignedStaff) && (project as any).assignedStaff.includes(userId));
    if (!isAllocated) return null;
    const organization = await this.organizations.findById(project.organizationId);
    if (!organization) return null;
    if (organization.members.some((m) => m.userId === userId)) return organization;
    return { ...organization, members: [...organization.members, { userId, role: OrganizationRole.MEMBER }] };
  }
}
