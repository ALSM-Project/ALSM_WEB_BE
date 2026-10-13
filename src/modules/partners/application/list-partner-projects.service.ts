import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PROJECT_REPOSITORY, ProjectRecord, ProjectRepository } from '../../projects/domain/project.types';
import { PARTNER_REPOSITORY, PartnerRepository } from '../domain/partner.types';

@Injectable()
export class ListPartnerProjectsService {
  constructor(
    @Inject(PARTNER_REPOSITORY) private readonly partners: PartnerRepository,
    @Inject(PROJECT_REPOSITORY) private readonly projects: ProjectRepository,
  ) {}

  async execute(partnerId: string): Promise<ProjectRecord[]> {
    const partner = await this.partners.findById(partnerId);
    if (!partner) {
      throw new NotFoundException({ code: 'PARTNER_NOT_FOUND', message: `Partner '${partnerId}' not found` });
    }
    // No project has ever been created for this Partner yet, so no Organization/workspace
    // exists either (see CreatePartnerProjectService) - an honest empty list, not an error.
    if (!partner.organizationId) {
      return [];
    }
    return this.projects.findAll(partner.organizationId);
  }
}
