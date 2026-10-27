import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AUDIT_REPOSITORY, AuditRepository } from '../../audit/domain/audit.repository';
import { OrganizationAuthorizationService } from '../../organizations/application/organization-authorization.service';
import { OrganizationContextService } from '../../organizations/application/organization-context.service';
import { OrganizationRole } from '../../organizations/domain/organization.types';
import { ProjectService } from '../../projects/application/project.service';
import { ConversionType } from '../../projects/domain/project.types';
import {
  CONVERSION_JOB_REPOSITORY,
  CONVERSION_QUEUE,
  ConversionJobRecord,
  ConversionJobRepository,
  ConversionJobStatus,
  ConversionPriority,
  ConversionQueuePort,
} from '../domain/conversion-job.types';
import {
  SUPPORT_PATCH_REPOSITORY,
  SupportPatchRecord,
  SupportPatchRepository,
  SupportPatchRule,
  countChangedRules,
  validateSupportPatchRules,
} from '../domain/support-patch.types';

export const CONVERSION_SUPPORT_PATCH_APPLIED = 'CONVERSION_SUPPORT_PATCH_APPLIED';

export interface SupportPatchView {
  job: ConversionJobRecord;
  /** The rules currently in force for the job (those of the latest patch), empty if none. */
  rules: SupportPatchRule[];
  /** Every patch applied to the job, newest first. */
  history: SupportPatchRecord[];
}

export interface ApplySupportPatchResult {
  job: ConversionJobRecord;
  patch: SupportPatchRecord;
  warnings: string[];
}

const RETRYABLE = new Set([ConversionJobStatus.FAILED, ConversionJobStatus.DEAD]);

/** tool2java's output has no data model class to hold field types, so the rules cannot reach the Java code. */
export const COBOL_PATCH_NOT_APPLIED_WARNING =
  'The rules were saved and the job re-queued, but the COBOL to Java converter cannot apply mapping rules yet: its output does not include the data model class where field names and types are declared.';

/**
 * Conversion Support Patch (Web 2): Conversion Staff correct the field-mapping rules of a
 * failed job, the rules are stored on the server, and the job goes back to the queue at
 * HIGH priority with its attempts reset - recorded in the audit log with the staff note.
 */
@Injectable()
export class ConversionSupportPatchService {
  private readonly logger = new Logger(ConversionSupportPatchService.name);

  constructor(
    @Inject(CONVERSION_JOB_REPOSITORY) private readonly jobs: ConversionJobRepository,
    @Inject(CONVERSION_QUEUE) private readonly queue: ConversionQueuePort,
    @Inject(SUPPORT_PATCH_REPOSITORY) private readonly patches: SupportPatchRepository,
    @Inject(AUDIT_REPOSITORY) private readonly audit: AuditRepository,
    private readonly organizationContext: OrganizationContextService,
    private readonly authorization: OrganizationAuthorizationService,
    private readonly projects: ProjectService,
  ) {}

  async get(
    userId: string,
    organizationHeader: string | undefined,
    jobId: string,
  ): Promise<SupportPatchView> {
    const { job, organizationId } = await this.requireJob(userId, organizationHeader, jobId);
    const history = await this.patches.listByJob(job.id, organizationId);
    return { job, rules: history[0]?.rules ?? [], history };
  }

  async apply(
    userId: string,
    organizationHeader: string | undefined,
    jobId: string,
    input: { rules: SupportPatchRule[]; note: string },
  ): Promise<ApplySupportPatchResult> {
    const { job, organizationId } = await this.requireJob(userId, organizationHeader, jobId);
    if (!RETRYABLE.has(job.status)) {
      throw new ConflictException({
        code: 'JOB_NOT_PATCHABLE',
        message: `Only failed jobs can be patched; this job is ${job.status}`,
      });
    }

    const rules = input.rules.map((r) => ({
      sourceField: r.sourceField.trim().toUpperCase(),
      targetProperty: r.targetProperty.trim(),
      dataType: r.dataType,
      ...(r.transformRule?.trim() ? { transformRule: r.transformRule.trim() } : {}),
    }));
    const note = input.note.trim();
    const { errors, warnings } = validateSupportPatchRules(rules);
    if (errors.length > 0) {
      throw new BadRequestException({
        code: 'SUPPORT_PATCH_INVALID',
        message: 'The mapping rules have errors; fix them before applying the patch',
        details: errors,
      });
    }

    const [previous] = await this.patches.listByJob(job.id, organizationId);
    const patch = await this.patches.create({
      organizationId,
      projectId: job.projectId,
      jobId: job.id,
      screenId: job.screenId,
      rules,
      note,
      changedRuleCount: countChangedRules(previous?.rules ?? [], rules),
      appliedBy: userId,
      appliedAt: new Date(),
    });

    const requeued = await this.jobs.retry(job.id, organizationId, {
      priority: ConversionPriority.HIGH,
    });
    if (!requeued) {
      // Someone retried it between our read and this write. The patch stays on record.
      throw new ConflictException({
        code: 'JOB_NOT_PATCHABLE',
        message: 'The job was re-queued by someone else in the meantime; reload it',
      });
    }

    try {
      await this.queue.enqueue(requeued.id, ConversionPriority.HIGH, requeued.executionGeneration ?? 0);
    } catch (error) {
      await this.jobs.markFailed(
        requeued.id,
        'CONVERSION_QUEUE_UNAVAILABLE',
        'Conversion job could not be queued',
      );
      this.logger.error(`Failed to enqueue patched conversion job ${requeued.id}: ${String(error)}`);
      throw new BadRequestException({
        code: 'CONVERSION_QUEUE_UNAVAILABLE',
        message: 'The patch was saved but the job could not be queued. Try again in a moment.',
      });
    }

    await this.audit.append({
      actorUserId: userId,
      organizationId,
      action: CONVERSION_SUPPORT_PATCH_APPLIED,
      resourceType: 'CONVERSION_JOB',
      resourceId: requeued.id,
      metadata: {
        patchId: patch.id,
        note,
        ruleCount: String(rules.length),
        changedRuleCount: String(patch.changedRuleCount),
        previousStatus: job.status,
      },
    });

    return {
      job: requeued,
      patch,
      warnings:
        job.conversionType === ConversionType.COBOL_TO_JAVA
          ? [...warnings, COBOL_PATCH_NOT_APPLIED_WARNING]
          : warnings,
    };
  }

  private async requireJob(userId: string, organizationHeader: string | undefined, jobId: string) {
    const organization = await this.organizationContext.resolve(userId, organizationHeader);
    this.authorization.require(organization, userId, [
      OrganizationRole.OWNER,
      OrganizationRole.ADMIN,
      OrganizationRole.MEMBER,
    ]);
    const job = await this.jobs.findById(jobId, organization.id);
    if (!job) {
      throw new NotFoundException({ code: 'JOB_NOT_FOUND', message: 'Conversion job was not found' });
    }
    await this.projects.getForOrganization(job.projectId, organization.id);
    return { job, organizationId: organization.id };
  }
}
