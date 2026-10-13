import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  UploadConversionSourceService,
  UploadConversionSourceResult,
  UploadedSourceFile,
} from '../../conversions/application/upload-conversion-source.service';
import { PARTNER_REPOSITORY, PartnerRepository } from '../domain/partner.types';

/**
 * Staff-facing equivalent of UploadConversionSourceService.execute() (the customer
 * self-service upload used by Web 1). A Partner has no membership concept, so the
 * membership-based org resolution/authorization that flow relies on
 * (OrganizationContextService / OrganizationAuthorizationService) does not apply here -
 * this resolves the Partner's own Organization directly instead, and is authorized by the
 * partners.manage RBAC permission at the controller, same as the rest of UC-44/UC-45.
 */
@Injectable()
export class UploadPartnerProjectSourceService {
  constructor(
    @Inject(PARTNER_REPOSITORY) private readonly partners: PartnerRepository,
    private readonly uploadConversionSource: UploadConversionSourceService,
  ) {}

  async execute(
    userId: string,
    partnerId: string,
    projectId: string,
    files: UploadedSourceFile[],
  ): Promise<UploadConversionSourceResult> {
    const partner = await this.partners.findById(partnerId);
    if (!partner) {
      throw new NotFoundException({ code: 'PARTNER_NOT_FOUND', message: `Partner '${partnerId}' not found` });
    }
    if (!partner.organizationId) {
      // No project has ever been created for this partner (see CreatePartnerProjectService),
      // so there is no workspace to upload into yet - a real, specific reason, not a generic
      // "project not found" that would wrongly suggest the projectId itself was the problem.
      throw new NotFoundException({
        code: 'PARTNER_HAS_NO_PROJECTS',
        message: `Partner '${partner.name}' has no projects yet - create a project for this partner first`,
      });
    }
    // getForOrganization (inside executeForOrganization) 404s if projectId doesn't actually
    // belong to partner.organizationId, so a staff member can't accidentally (or otherwise)
    // upload into a different partner's project by guessing/reusing a projectId.
    return this.uploadConversionSource.executeForOrganization(partner.organizationId, userId, projectId, files);
  }
}
