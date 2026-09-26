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
  VALIDATION_FINDING_REPOSITORY,
  ValidationFindingRepository,
} from '../domain/validation-finding.repository';
import {
  ValidationFindingRecord,
  ValidationFindingStatus,
} from '../domain/validation-finding.types';
import {
  VALIDATION_RUN_REPOSITORY,
  ValidationRunRepository,
} from '../domain/validation-run.repository';
import {
  HumanReviewTargetStatus,
  MAX_REVIEW_NOTE_LENGTH,
  isAllowedHumanReviewTransition,
  isHumanReviewTargetStatus,
} from './validation-finding-review.policy';

export interface ReviewValidationFindingCommand {
  userId: string;
  organizationHeader: string | undefined;
  projectId: string;
  validationRunId: string;
  findingId: string;
  status: ValidationFindingStatus;
  reviewNote?: string;
}

@Injectable()
export class ReviewValidationFindingService {
  constructor(
    @Inject(VALIDATION_FINDING_REPOSITORY)
    private readonly validationFindings: ValidationFindingRepository,
    @Inject(VALIDATION_RUN_REPOSITORY)
    private readonly validationRuns: ValidationRunRepository,
    private readonly organizationContext: OrganizationContextService,
    private readonly authorization: OrganizationAuthorizationService,
    private readonly projects: ProjectService,
    @Inject(AUDIT_REPOSITORY) private readonly audit: AuditRepository,
  ) {}

  async execute(input: ReviewValidationFindingCommand): Promise<ValidationFindingRecord> {
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

    const run = await this.validationRuns.findById(
      input.validationRunId,
      input.projectId,
      organization.id,
    );
    if (!run || run.projectId !== input.projectId || run.organizationId !== organization.id) {
      throw this.runNotFound();
    }

    const finding = await this.validationFindings.findById(
      input.findingId,
      input.validationRunId,
      input.projectId,
      organization.id,
    );
    if (
      !finding ||
      finding.validationRunId !== input.validationRunId ||
      finding.projectId !== input.projectId ||
      finding.organizationId !== organization.id ||
      finding.conversionJobId !== run.conversionJobId
    ) {
      throw this.findingNotFound();
    }

    const targetStatus = this.requireTargetStatus(input.status);
    if (!isAllowedHumanReviewTransition(finding.status, targetStatus)) {
      throw new BadRequestException({
        code: 'VALIDATION_FINDING_TRANSITION_INVALID',
        message: `Validation finding cannot transition from ${finding.status} to ${targetStatus}`,
      });
    }
    const reviewNote = this.normalizeReviewNote(input.reviewNote, targetStatus);
    const reviewedAt = new Date();
    const result = await this.validationFindings.reviewFinding({
      findingId: input.findingId,
      validationRunId: input.validationRunId,
      projectId: input.projectId,
      organizationId: organization.id,
      expectedStatus: finding.status,
      newStatus: targetStatus,
      reviewedBy: input.userId,
      reviewedAt,
      reviewNote,
    });

    if (result.outcome === 'NOT_FOUND') throw this.findingNotFound();
    if (result.outcome === 'CONFLICT') {
      throw new ConflictException({
        code: 'VALIDATION_FINDING_REVIEW_CONFLICT',
        message: 'Validation finding changed while it was being reviewed',
      });
    }

    await this.audit.append({
      actorUserId: input.userId,
      organizationId: organization.id,
      action: 'VALIDATION_FINDING_REVIEWED',
      resourceType: 'validation_finding',
      resourceId: input.findingId,
      metadata: {
        validationRunId: input.validationRunId,
        conversionJobId: run.conversionJobId,
        projectId: input.projectId,
        previousStatus: finding.status,
        newStatus: targetStatus,
        reviewNoteProvided: String(reviewNote !== undefined),
      },
    });

    return result.finding;
  }

  private requireTargetStatus(status: ValidationFindingStatus): HumanReviewTargetStatus {
    if (!isHumanReviewTargetStatus(status)) {
      throw new BadRequestException({
        code: 'VALIDATION_FINDING_REVIEW_STATUS_INVALID',
        message: 'PENDING is not an allowed human-review target status',
      });
    }
    return status;
  }

  private normalizeReviewNote(
    rawReviewNote: string | undefined,
    targetStatus: HumanReviewTargetStatus,
  ): string | undefined {
    if (rawReviewNote !== undefined && rawReviewNote.length > MAX_REVIEW_NOTE_LENGTH) {
      throw new BadRequestException({
        code: 'VALIDATION_FINDING_REVIEW_NOTE_TOO_LONG',
        message: `Review note must not exceed ${MAX_REVIEW_NOTE_LENGTH} characters`,
      });
    }
    const reviewNote = rawReviewNote?.trim() || undefined;
    if (targetStatus === ValidationFindingStatus.NOT_APPLICABLE && !reviewNote) {
      throw new BadRequestException({
        code: 'VALIDATION_FINDING_REVIEW_NOTE_REQUIRED',
        message: 'Review note is required when marking a finding not applicable',
      });
    }
    return reviewNote;
  }

  private runNotFound(): NotFoundException {
    return new NotFoundException({
      code: 'VALIDATION_RUN_NOT_FOUND',
      message: 'Validation run was not found',
    });
  }

  private findingNotFound(): NotFoundException {
    return new NotFoundException({
      code: 'VALIDATION_FINDING_NOT_FOUND',
      message: 'Validation finding was not found',
    });
  }
}
