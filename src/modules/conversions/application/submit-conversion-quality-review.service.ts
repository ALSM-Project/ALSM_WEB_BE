import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AUDIT_REPOSITORY, AuditRepository } from '../../audit/domain/audit.repository';
import { OrganizationAuthorizationService } from '../../organizations/application/organization-authorization.service';
import { OrganizationContextService } from '../../organizations/application/organization-context.service';
import { OrganizationRole } from '../../organizations/domain/organization.types';
import { ProjectService } from '../../projects/application/project.service';
import {
  CONVERSION_JOB_REPOSITORY,
  ConversionJobRepository,
  ConversionJobStatus,
} from '../domain/conversion-job.types';
import {
  CONVERSION_QUALITY_REVIEW_REPOSITORY,
  ConversionQualityReviewRecord,
  ConversionQualityReviewRepository,
  ConversionQualityReviewStatus,
  HumanQualityReviewTargetStatus,
  MAX_QUALITY_REVIEW_NOTE_LENGTH,
  QUALITY_SCORE_MAX,
  QUALITY_SCORE_MIN,
  isAllowedQualityReviewTransition,
  isHumanQualityReviewTargetStatus,
  requiresReviewNote,
} from '../domain/conversion-quality-review.types';

export interface SubmitQualityReviewCommand {
  userId: string;
  organizationHeader: string | undefined;
  projectId: string;
  conversionJobId: string;
  status: string;
  reviewNote?: string;
  qualityScore?: number;
}

@Injectable()
export class SubmitConversionQualityReviewService {
  constructor(
    @Inject(CONVERSION_JOB_REPOSITORY) private readonly jobs: ConversionJobRepository,
    @Inject(CONVERSION_QUALITY_REVIEW_REPOSITORY)
    private readonly qualityReviews: ConversionQualityReviewRepository,
    private readonly organizationContext: OrganizationContextService,
    private readonly authorization: OrganizationAuthorizationService,
    private readonly projects: ProjectService,
    @Inject(AUDIT_REPOSITORY) private readonly audit: AuditRepository,
  ) {}

  async execute(input: SubmitQualityReviewCommand): Promise<ConversionQualityReviewRecord> {
    const organization = await this.organizationContext.resolve(
      input.userId,
      input.organizationHeader,
    );

    this.authorization.require(organization, input.userId, [
      OrganizationRole.OWNER,
      OrganizationRole.ADMIN,
      OrganizationRole.MEMBER,
    ]);

    await this.projects.getForOrganization(input.projectId, organization.id);

    const job = await this.jobs.findById(input.conversionJobId, organization.id);
    if (!job || job.projectId !== input.projectId) {
      throw new NotFoundException({
        code: 'CONVERSION_JOB_NOT_FOUND',
        message: 'Conversion job was not found',
      });
    }

    if (job.status !== ConversionJobStatus.COMPLETED) {
      throw new BadRequestException({
        code: 'CONVERSION_NOT_COMPLETED',
        message: 'Conversion job has not completed successfully yet',
      });
    }

    const targetStatus = this.requireTargetStatus(input.status);
    const reviewNote = this.normalizeReviewNote(input.reviewNote, targetStatus);
    this.validateQualityScore(input.qualityScore);

    // Load current review to determine transition validity
    const existing = await this.qualityReviews.findByConversionJob(
      input.conversionJobId,
      input.projectId,
      organization.id,
    );
    const currentStatus = existing?.status ?? ConversionQualityReviewStatus.PENDING;

    if (!isAllowedQualityReviewTransition(currentStatus, targetStatus)) {
      throw new BadRequestException({
        code: 'QUALITY_REVIEW_TRANSITION_INVALID',
        message: `Quality review cannot transition from ${currentStatus} to ${targetStatus}`,
      });
    }

    const reviewedAt = new Date();
    const result = await this.qualityReviews.upsert({
      organizationId: organization.id,
      projectId: input.projectId,
      conversionJobId: input.conversionJobId,
      screenId: job.screenId,
      status: targetStatus,
      reviewNote,
      qualityScore: input.qualityScore,
      reviewedBy: input.userId,
      reviewedAt,
      expectedStatus: currentStatus,
    });

    if (result.outcome === 'CONFLICT') {
      throw new ConflictException({
        code: 'QUALITY_REVIEW_CONFLICT',
        message: 'Quality review was updated concurrently — please reload and try again',
      });
    }

    await this.audit.append({
      actorUserId: input.userId,
      organizationId: organization.id,
      action: 'CONVERSION_QUALITY_REVIEW_SUBMITTED',
      resourceType: 'conversion_quality_review',
      resourceId: result.record.id || input.conversionJobId,
      metadata: {
        conversionJobId: input.conversionJobId,
        projectId: input.projectId,
        previousStatus: currentStatus,
        newStatus: targetStatus,
        ...(input.qualityScore !== undefined ? { qualityScore: String(input.qualityScore) } : {}),
        reviewNoteProvided: String(reviewNote !== undefined),
      },
    });

    return result.record;
  }

  private requireTargetStatus(status: string): HumanQualityReviewTargetStatus {
    if (!isHumanQualityReviewTargetStatus(status)) {
      throw new BadRequestException({
        code: 'QUALITY_REVIEW_STATUS_INVALID',
        message: `"${status}" is not an allowed quality review target status`,
      });
    }
    return status;
  }

  private normalizeReviewNote(
    rawNote: string | undefined,
    targetStatus: HumanQualityReviewTargetStatus,
  ): string | undefined {
    if (rawNote !== undefined && rawNote.length > MAX_QUALITY_REVIEW_NOTE_LENGTH) {
      throw new BadRequestException({
        code: 'QUALITY_REVIEW_NOTE_TOO_LONG',
        message: `Review note must not exceed ${MAX_QUALITY_REVIEW_NOTE_LENGTH} characters`,
      });
    }
    const note = rawNote?.trim() || undefined;
    if (requiresReviewNote(targetStatus) && !note) {
      throw new BadRequestException({
        code: 'QUALITY_REVIEW_NOTE_REQUIRED',
        message: 'Review note is required when status is NEEDS_REWORK or FLAGGED',
      });
    }
    return note;
  }

  private validateQualityScore(score: number | undefined): void {
    if (score === undefined) return;
    if (!Number.isInteger(score) || score < QUALITY_SCORE_MIN || score > QUALITY_SCORE_MAX) {
      throw new BadRequestException({
        code: 'QUALITY_SCORE_INVALID',
        message: `Quality score must be an integer between ${QUALITY_SCORE_MIN} and ${QUALITY_SCORE_MAX}`,
      });
    }
  }
}
