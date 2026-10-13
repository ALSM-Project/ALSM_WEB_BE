export enum ConversionQualityReviewStatus {
  PENDING = 'PENDING',
  ACCEPTED = 'ACCEPTED',
  NEEDS_REWORK = 'NEEDS_REWORK',
  FLAGGED = 'FLAGGED',
}

/** Statuses that a human reviewer may set via the API (PENDING is never a valid target). */
export type HumanQualityReviewTargetStatus = Exclude<ConversionQualityReviewStatus, 'PENDING'>;

export interface ConversionQualityReviewRecord {
  id: string;
  organizationId: string;
  projectId: string;
  conversionJobId: string;
  screenId?: string;
  status: ConversionQualityReviewStatus;
  /** Required when status is NEEDS_REWORK or FLAGGED; optional when ACCEPTED. Max 2000 chars. */
  reviewNote?: string;
  /** Optional 1–5 star quality rating provided by the reviewer. */
  qualityScore?: number;
  reviewedBy?: string;
  reviewedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertQualityReviewInput {
  organizationId: string;
  projectId: string;
  conversionJobId: string;
  screenId?: string;
  status: HumanQualityReviewTargetStatus;
  reviewNote?: string;
  qualityScore?: number;
  reviewedBy: string;
  reviewedAt: Date;
  /** If provided, the upsert is conditional on the current status matching this value. */
  expectedStatus?: ConversionQualityReviewStatus;
}

export type UpsertQualityReviewOutcome = 'CREATED' | 'UPDATED' | 'CONFLICT';

export interface ConversionQualityReviewRepository {
  findByConversionJob(
    conversionJobId: string,
    projectId: string,
    organizationId: string,
  ): Promise<ConversionQualityReviewRecord | null>;

  upsert(input: UpsertQualityReviewInput): Promise<{
    outcome: UpsertQualityReviewOutcome;
    record: ConversionQualityReviewRecord;
  }>;
}

export const CONVERSION_QUALITY_REVIEW_REPOSITORY = Symbol('CONVERSION_QUALITY_REVIEW_REPOSITORY');

export const MAX_QUALITY_REVIEW_NOTE_LENGTH = 2000;
export const QUALITY_SCORE_MIN = 1;
export const QUALITY_SCORE_MAX = 5;

const ALLOWED_TRANSITIONS: Record<ConversionQualityReviewStatus, HumanQualityReviewTargetStatus[]> =
  {
    [ConversionQualityReviewStatus.PENDING]: [
      ConversionQualityReviewStatus.ACCEPTED,
      ConversionQualityReviewStatus.NEEDS_REWORK,
      ConversionQualityReviewStatus.FLAGGED,
    ],
    [ConversionQualityReviewStatus.ACCEPTED]: [
      ConversionQualityReviewStatus.NEEDS_REWORK,
      ConversionQualityReviewStatus.FLAGGED,
    ],
    [ConversionQualityReviewStatus.NEEDS_REWORK]: [
      ConversionQualityReviewStatus.ACCEPTED,
      ConversionQualityReviewStatus.FLAGGED,
    ],
    [ConversionQualityReviewStatus.FLAGGED]: [
      ConversionQualityReviewStatus.ACCEPTED,
      ConversionQualityReviewStatus.NEEDS_REWORK,
    ],
  };

export function isAllowedQualityReviewTransition(
  from: ConversionQualityReviewStatus,
  to: HumanQualityReviewTargetStatus,
): boolean {
  return (ALLOWED_TRANSITIONS[from] as string[]).includes(to);
}

export function isHumanQualityReviewTargetStatus(
  status: string,
): status is HumanQualityReviewTargetStatus {
  return (
    status === ConversionQualityReviewStatus.ACCEPTED ||
    status === ConversionQualityReviewStatus.NEEDS_REWORK ||
    status === ConversionQualityReviewStatus.FLAGGED
  );
}

export function requiresReviewNote(status: HumanQualityReviewTargetStatus): boolean {
  return (
    status === ConversionQualityReviewStatus.NEEDS_REWORK ||
    status === ConversionQualityReviewStatus.FLAGGED
  );
}
