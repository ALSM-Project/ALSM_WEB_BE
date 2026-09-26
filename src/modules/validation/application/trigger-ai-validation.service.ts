import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  CONVERSION_JOB_REPOSITORY,
  ConversionJobRepository,
  ConversionJobStatus,
} from '../../conversions/domain/conversion-job.types';
import { OrganizationAuthorizationService } from '../../organizations/application/organization-authorization.service';
import { OrganizationContextService } from '../../organizations/application/organization-context.service';
import { OrganizationRole } from '../../organizations/domain/organization.types';
import { ProjectService } from '../../projects/application/project.service';
import { ConversionType } from '../../projects/domain/project.types';
import { VALIDATION_QUEUE, ValidationQueuePort } from '../domain/validation-queue.port';
import {
  VALIDATION_RUN_REPOSITORY,
  ValidationRunRepository,
} from '../domain/validation-run.repository';
import { ValidationRunRecord, ValidationRunStatus } from '../domain/validation-run.types';
import { AiValidationRuntimeGuard } from './ai-validation-runtime.guard';

export interface TriggerAiValidationResult {
  run: ValidationRunRecord;
  created: boolean;
}

@Injectable()
export class TriggerAiValidationService {
  constructor(
    @Inject(VALIDATION_RUN_REPOSITORY)
    private readonly validationRuns: ValidationRunRepository,
    @Inject(VALIDATION_QUEUE) private readonly queue: ValidationQueuePort,
    @Inject(CONVERSION_JOB_REPOSITORY)
    private readonly conversionJobs: ConversionJobRepository,
    private readonly organizationContext: OrganizationContextService,
    private readonly authorization: OrganizationAuthorizationService,
    private readonly projects: ProjectService,
    private readonly runtimeGuard: AiValidationRuntimeGuard,
  ) {}

  async execute(
    userId: string,
    organizationHeader: string | undefined,
    projectId: string,
    conversionJobId: string,
  ): Promise<TriggerAiValidationResult> {
    const organization = await this.organizationContext.resolve(userId, organizationHeader);
    this.authorization.require(organization, userId, [
      OrganizationRole.OWNER,
      OrganizationRole.ADMIN,
      OrganizationRole.MEMBER,
    ]);
    await this.projects.getForOrganization(projectId, organization.id);

    const conversion = await this.conversionJobs.findById(conversionJobId, organization.id);
    if (!conversion || conversion.projectId !== projectId) {
      throw new NotFoundException({
        code: 'VALIDATION_CONVERSION_NOT_FOUND',
        message: 'Conversion job was not found for validation',
      });
    }
    if (conversion.status !== ConversionJobStatus.COMPLETED) {
      throw new BadRequestException({
        code: 'VALIDATION_CONVERSION_NOT_READY',
        message: 'Conversion job must be completed before AI validation',
      });
    }
    if (conversion.conversionType !== ConversionType.COBOL_TO_JAVA) {
      throw new BadRequestException({
        code: 'VALIDATION_UNSUPPORTED_CONVERSION_TYPE',
        message: 'AI semantic validation currently supports COBOL_TO_JAVA only',
      });
    }

    const metadata = this.runtimeGuard.assertAvailable();
    const claim = await this.validationRuns.createOrGetActiveAiRun({
      organizationId: organization.id,
      projectId,
      conversionJobId,
      screenId: conversion.screenId,
      status: ValidationRunStatus.QUEUED,
      ruleValidationEnabled: false,
      aiValidationEnabled: true,
      findingCount: 0,
      provider: metadata.provider,
      model: metadata.model,
      promptVersion: metadata.promptVersion,
    });

    if (!claim.created) return claim;

    try {
      await this.queue.enqueue({
        validationRunId: claim.run.id,
        organizationId: organization.id,
        projectId,
        conversionJobId,
      });
    } catch {
      await this.failEnqueue(claim.run);
      throw new ServiceUnavailableException({
        code: 'VALIDATION_QUEUE_ENQUEUE_FAILED',
        message: 'AI validation could not be queued',
      });
    }

    return claim;
  }

  private async failEnqueue(run: ValidationRunRecord): Promise<void> {
    try {
      await this.validationRuns.markFailed(run.id, run.projectId, run.organizationId, {
        failureCode: 'VALIDATION_QUEUE_ENQUEUE_FAILED',
        failureMessage: 'AI validation could not be queued',
      });
    } catch {
      // The public error remains sanitized even if terminal persistence is unavailable.
    }
  }
}
