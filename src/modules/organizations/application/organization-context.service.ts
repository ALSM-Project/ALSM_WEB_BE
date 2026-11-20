import { ForbiddenException, Inject, Injectable, Optional } from '@nestjs/common';
import { OrganizationRole, OrganizationType } from '../domain/organization.types';
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

  async isInternalOrAdmin(userId: string): Promise<boolean> {
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
        user.role === 'CONVERSION_STAFF' ||
        user.roles?.includes('CONVERSION_STAFF') ||
        user.role === 'INTERNAL_SUPPORT' ||
        user.roles?.includes('INTERNAL_SUPPORT') ||
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
      const memberOrg = await this.organizations.findForMember(requestedOrganizationId, userId);
      if (memberOrg) return memberOrg;
      if (await this.isInternalOrAdmin(userId)) {
        const org = await this.organizations.findById(requestedOrganizationId);
        if (org) {
          return { ...org, members: [...org.members, { userId, role: OrganizationRole.MEMBER }] };
        }
      }
      throw new ForbiddenException({
        code: 'ORGANIZATION_ACCESS_DENIED',
        message: 'You do not have access to this organization',
      });
    }

    let organization = await this.organizations.findFirstForMember(userId);
    if (!organization) {
      if (this.users) {
        const user = await this.users.findById(userId);
        if (user && typeof this.organizations.create === 'function') {
          const orgName = user.fullName ? `${user.fullName}'s Workspace` : 'Personal Workspace';
          const created = await this.organizations.create({
            name: orgName,
            type: OrganizationType.SELF_SERVICE,
            members: [{ userId, role: OrganizationRole.OWNER }],
          });
          if (created) return created;
        }
      }
      throw new ForbiddenException({
        code: 'ORGANIZATION_ACCESS_DENIED',
        message: 'You do not have access to this organization',
      });
    }
    return organization;
  }

  private async organizationOfAllocatedProject(
    userId: string,
    projectId: string,
  ): Promise<OrganizationRecord | null> {
    if (!this.projects) return null;
    let project = (this.projects as any).findUnscopedById
      ? await (this.projects as any).findUnscopedById(projectId)
      : await this.projects.findById(projectId);
    if (!project && this.projects.findAll) {
      const all = await this.projects.findAll();
      project = all.find((p) => p.id === projectId || (p as any).name === projectId) ?? null;
    }
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
