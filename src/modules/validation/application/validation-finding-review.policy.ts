import { ValidationFindingStatus } from '../domain/validation-finding.types';

export const MAX_REVIEW_NOTE_LENGTH = 1000;

export const HUMAN_REVIEW_TARGET_STATUSES = [
  ValidationFindingStatus.NEEDS_CORRECTION,
  ValidationFindingStatus.MANUAL_REVIEW,
  ValidationFindingStatus.NOT_APPLICABLE,
  ValidationFindingStatus.RESOLVED,
] as const;

export type HumanReviewTargetStatus = (typeof HUMAN_REVIEW_TARGET_STATUSES)[number];

const ALLOWED_TRANSITIONS: Readonly<
  Record<ValidationFindingStatus, readonly HumanReviewTargetStatus[]>
> = {
  [ValidationFindingStatus.PENDING]: [
    ValidationFindingStatus.NEEDS_CORRECTION,
    ValidationFindingStatus.MANUAL_REVIEW,
    ValidationFindingStatus.NOT_APPLICABLE,
  ],
  [ValidationFindingStatus.NEEDS_CORRECTION]: [
    ValidationFindingStatus.RESOLVED,
    ValidationFindingStatus.MANUAL_REVIEW,
  ],
  [ValidationFindingStatus.MANUAL_REVIEW]: [
    ValidationFindingStatus.NEEDS_CORRECTION,
    ValidationFindingStatus.NOT_APPLICABLE,
    ValidationFindingStatus.RESOLVED,
  ],
  [ValidationFindingStatus.NOT_APPLICABLE]: [ValidationFindingStatus.MANUAL_REVIEW],
  [ValidationFindingStatus.RESOLVED]: [ValidationFindingStatus.MANUAL_REVIEW],
};

export function isHumanReviewTargetStatus(
  status: ValidationFindingStatus,
): status is HumanReviewTargetStatus {
  return HUMAN_REVIEW_TARGET_STATUSES.some((candidate) => candidate === status);
}

export function isAllowedHumanReviewTransition(
  currentStatus: ValidationFindingStatus,
  newStatus: HumanReviewTargetStatus,
): boolean {
  return ALLOWED_TRANSITIONS[currentStatus].includes(newStatus);
}
