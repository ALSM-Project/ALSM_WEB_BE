import { ForbiddenException, Inject, Injectable, Optional } from '@nestjs/common';
import { OrganizationRole } from '../domain/organization.types';
import { PROJECT_REPOSITORY, ProjectRepository } from '../../projects/domain/project.types';
import {
  ORGANIZATION_REPOSITORY,
  OrganizationRepository,
  OrganizationRecord,
} from '../domain/organization.repository';
@Injectable()
export class OrganizationContextService {
  constructor(
    @Inject(ORGANIZATION_REPOSITORY) private readonly organizations: OrganizationRepository,
    @Optional() @Inject(PROJECT_REPOSITORY) private readonly projects?: ProjectRepository,
  ) {}

  /**
   * The organization a request acts in. When the request is about one project and a Team Lead
   * allocated that project to this very person (UC-86), the project's own organization is used,
   * with the person counted as a member for this request only: the project may belong to a
   * customer organization they are not a member of, and they still have to do the work.
   * Nobody else gets this, and nothing is stored.
   */
  async resolve(
    userId: string,
    requestedOrganizationId?: string,
    projectId?: string,
  ): Promise<OrganizationRecord> {
    const allocated = projectId ? await this.organizationOfAllocatedProject(userId, projectId) : null;
    if (allocated) return allocated;

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
    if (!project || project.deletedAt || project.assignedStaffId !== userId) return null;
    const organization = await this.organizations.findById(project.organizationId);
    if (!organization) return null;
    if (organization.members.some((m) => m.userId === userId)) return organization;
    return { ...organization, members: [...organization.members, { userId, role: OrganizationRole.MEMBER }] };
  }
}
