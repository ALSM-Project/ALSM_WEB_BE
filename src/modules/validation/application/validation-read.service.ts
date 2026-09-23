import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { OrganizationContextService } from '../../organizations/application/organization-context.service';
import { ProjectService } from '../../projects/application/project.service';
import {
  CONVERSION_JOB_REPOSITORY,
  ConversionJobRepository,
} from '../../conversions/domain/conversion-job.types';
import {
  VALIDATION_FINDING_REPOSITORY,
  ValidationFindingRepository,
} from '../domain/validation-finding.repository';
import { ValidationFindingRecord } from '../domain/validation-finding.types';
import {
  VALIDATION_RUN_REPOSITORY,
  ValidationRunRepository,
} from '../domain/validation-run.repository';
import { ValidationRunRecord } from '../domain/validation-run.types';

@Injectable()
export class ValidationReadService {
  constructor(
    @Inject(VALIDATION_RUN_REPOSITORY)
    private readonly validationRuns: ValidationRunRepository,
    @Inject(VALIDATION_FINDING_REPOSITORY)
    private readonly validationFindings: ValidationFindingRepository,
    @Inject(CONVERSION_JOB_REPOSITORY)
    private readonly conversionJobs: ConversionJobRepository,
    private readonly organizationContext: OrganizationContextService,
    private readonly projects: ProjectService,
  ) {}

  async listRuns(
    userId: string,
    organizationHeader: string | undefined,
    projectId: string,
    conversionJobId: string,
  ): Promise<ValidationRunRecord[]> {
    const organizationId = await this.resolveProjectAccess(userId, organizationHeader, projectId);
    const conversion = await this.conversionJobs.findById(conversionJobId, organizationId);
    if (!conversion || conversion.projectId !== projectId) {
      throw new NotFoundException({
        code: 'VALIDATION_CONVERSION_NOT_FOUND',
        message: 'Conversion job was not found for validation',
      });
    }
    return this.validationRuns.listByConversionJob(conversionJobId, projectId, organizationId);
  }

  async getRun(
    userId: string,
    organizationHeader: string | undefined,
    projectId: string,
    validationRunId: string,
  ): Promise<ValidationRunRecord> {
    const organizationId = await this.resolveProjectAccess(userId, organizationHeader, projectId);
    return this.requireRun(validationRunId, projectId, organizationId);
  }

  async listFindings(
    userId: string,
    organizationHeader: string | undefined,
    projectId: string,
    validationRunId: string,
  ): Promise<ValidationFindingRecord[]> {
    const organizationId = await this.resolveProjectAccess(userId, organizationHeader, projectId);
    await this.requireRun(validationRunId, projectId, organizationId);
    return this.validationFindings.listByRun(validationRunId, projectId, organizationId);
  }

  private async resolveProjectAccess(
    userId: string,
    organizationHeader: string | undefined,
    projectId: string,
  ): Promise<string> {
    const organization = await this.organizationContext.resolve(userId, organizationHeader);
    await this.projects.getForOrganization(projectId, organization.id);
    return organization.id;
  }

  private async requireRun(
    validationRunId: string,
    projectId: string,
    organizationId: string,
  ): Promise<ValidationRunRecord> {
    const run = await this.validationRuns.findById(validationRunId, projectId, organizationId);
    if (!run || run.projectId !== projectId || run.organizationId !== organizationId) {
      throw new NotFoundException({
        code: 'VALIDATION_RUN_NOT_FOUND',
        message: 'Validation run was not found',
      });
    }
    return run;
  }
}
