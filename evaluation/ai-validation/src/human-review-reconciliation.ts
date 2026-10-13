import { ImportedReviewManifest } from './external-import.types';
import {
  validateImportedCandidateManifest,
  validateImportedReviewManifest,
} from './external-import.validator';
import { validatePilotSelection } from './human-review-selection';
import {
  COBOL_JAVATRANS_PILOT_ID,
  EquivalenceDecision,
  HUMAN_REVIEW_PILOT_SCHEMA_VERSION,
  PilotComparison,
  PilotFinalizationFile,
  PilotReviewDecision,
  PilotReviewFile,
  PilotSelectionManifest,
  ReviewComparisonState,
} from './human-review.types';

const NON_HUMAN_REVIEWER =
  /(?:^|[^a-z0-9])(?:ai|openai|chatgpt|codex|llm|language[\s_-]*model|anthropic|gemini|bedrock|static[\s_-]*analy[sz]er|automat(?:ed|ion)|bot)(?:[^a-z0-9]|$)/i;
const sha256Pattern = /^[a-f0-9]{64}$/;

export interface ReviewValidationSummary {
  reviewerRole: 'A' | 'B';
  completedDecisions: number;
  incompleteDecisions: number;
}

export function validatePilotReview(
  value: unknown,
  selection: PilotSelectionManifest,
  expectedRole?: 'A' | 'B',
  requireComplete = false,
): { review: PilotReviewFile; summary: ReviewValidationSummary } {
  if (!isRecord(value)) throw new Error('Invalid pilot review: expected an object');
  const review = value as unknown as PilotReviewFile;
  if (
    review.schemaVersion !== HUMAN_REVIEW_PILOT_SCHEMA_VERSION ||
    review.pilotId !== selection.pilotId ||
    review.selectionHash !== selection.selectionHash ||
    !['A', 'B'].includes(review.reviewerRole) ||
    (expectedRole && review.reviewerRole !== expectedRole) ||
    !Array.isArray(review.decisions)
  ) {
    throw new Error('Invalid pilot review: pilot, selection hash, role, or decisions mismatch');
  }
  const selected = new Map(
    selection.selectedCandidates.map((candidate) => [candidate.candidateId, candidate]),
  );
  const seen = new Set<string>();
  let completedDecisions = 0;
  for (const decision of review.decisions) {
    if (!isRecord(decision) || typeof decision.candidateId !== 'string') {
      throw new Error('Invalid pilot review: malformed decision');
    }
    if (seen.has(decision.candidateId)) {
      throw new Error(`Invalid pilot review: duplicate candidate decision ${decision.candidateId}`);
    }
    seen.add(decision.candidateId);
    const candidate = selected.get(decision.candidateId);
    if (!candidate) {
      throw new Error(`Invalid pilot review: unknown candidate ${decision.candidateId}`);
    }
    if (
      decision.sourceSha256 !== candidate.sourceSha256 ||
      decision.targetSha256 !== candidate.targetSha256
    ) {
      throw new Error(
        `Invalid pilot review: source/target hash mismatch for ${decision.candidateId}`,
      );
    }
    assertNullableString(decision.reviewerId, 'reviewerId', decision.candidateId);
    assertNullableString(decision.reviewedAt, 'reviewedAt', decision.candidateId);
    assertNullableString(decision.notes, 'notes', decision.candidateId, true);
    if (
      decision.equivalenceDecision !== null &&
      decision.equivalenceDecision !== 'CLEAN' &&
      decision.equivalenceDecision !== 'NOT_CLEAN_OR_UNCERTAIN'
    ) {
      throw new Error(`Invalid pilot review: invalid decision for ${decision.candidateId}`);
    }
    if (decision.reviewerId && NON_HUMAN_REVIEWER.test(decision.reviewerId)) {
      throw new Error(`Invalid pilot review: non-human reviewer ID for ${decision.candidateId}`);
    }
    if (decision.reviewedAt && !isIsoDate(decision.reviewedAt)) {
      throw new Error(`Invalid pilot review: reviewedAt is not ISO for ${decision.candidateId}`);
    }
    if (isCompleteDecision(decision)) completedDecisions += 1;
  }
  const incompleteDecisions = selection.selectedCandidates.length - completedDecisions;
  if (requireComplete) {
    if (review.decisions.length !== selection.selectedCandidates.length) {
      throw new Error('Invalid pilot review: every selected candidate requires a decision');
    }
    const incomplete = selection.selectedCandidates.find((candidate) => {
      const decision = review.decisions.find(
        (entry) => entry.candidateId === candidate.candidateId,
      );
      return !decision || !isCompleteDecision(decision);
    });
    if (incomplete) {
      throw new Error(
        `Invalid pilot review: missing reviewer ID, reviewedAt, or decision for ${incomplete.candidateId}`,
      );
    }
  }
  return {
    review,
    summary: { reviewerRole: review.reviewerRole, completedDecisions, incompleteDecisions },
  };
}

export function comparePilotReviews(
  selectionValue: unknown,
  reviewAValue: unknown,
  reviewBValue: unknown,
): PilotComparison {
  const selection = validatePilotSelection(selectionValue);
  const reviewA = validatePilotReview(reviewAValue, selection, 'A').review;
  const reviewB = validatePilotReview(reviewBValue, selection, 'B').review;
  const byA = new Map(reviewA.decisions.map((decision) => [decision.candidateId, decision]));
  const byB = new Map(reviewB.decisions.map((decision) => [decision.candidateId, decision]));
  const counts: Record<ReviewComparisonState, number> = {
    READY_CLEAN: 0,
    DISAGREEMENT: 0,
    NEEDS_REVIEW: 0,
    NOT_CLEAN_OR_UNCERTAIN: 0,
  };
  const cases = selection.selectedCandidates.map((candidate) => {
    const reviewerA = byA.get(candidate.candidateId) ?? null;
    const reviewerB = byB.get(candidate.candidateId) ?? null;
    if (
      reviewerA?.reviewerId &&
      reviewerB?.reviewerId &&
      normalizeReviewerId(reviewerA.reviewerId) === normalizeReviewerId(reviewerB.reviewerId)
    ) {
      throw new Error(
        `Invalid pilot reviews: ${candidate.candidateId} requires two distinct human reviewers`,
      );
    }
    const state = comparisonState(reviewerA, reviewerB);
    counts[state] += 1;
    return { candidateId: candidate.candidateId, state, reviewerA, reviewerB };
  });
  return {
    schemaVersion: HUMAN_REVIEW_PILOT_SCHEMA_VERSION,
    pilotId: COBOL_JAVATRANS_PILOT_ID,
    selectionHash: selection.selectionHash,
    cases,
    counts,
  };
}

export function finalizeCleanReviewManifest(
  candidateValue: unknown,
  sourceCandidateManifestHash: string,
  selectionValue: unknown,
  reviewAValue: unknown,
  reviewBValue: unknown,
  finalizationValue: unknown,
): ImportedReviewManifest | null {
  const candidates = validateImportedCandidateManifest(candidateValue);
  const selection = validatePilotSelection(selectionValue, candidates, sourceCandidateManifestHash);
  if (candidates.licenseStatus !== 'RECORDED') {
    throw new Error('Clean finalization requires licenseStatus RECORDED');
  }
  const reviewA = validatePilotReview(reviewAValue, selection, 'A').review;
  const reviewB = validatePilotReview(reviewBValue, selection, 'B').review;
  const comparison = comparePilotReviews(selection, reviewA, reviewB);
  const ready = comparison.cases.filter((entry) => entry.state === 'READY_CLEAN');
  if (ready.length === 0) return null;
  const finalization = validateFinalization(finalizationValue, selection);
  const finalizedById = new Map(finalization.cases.map((entry) => [entry.candidateId, entry]));

  const reviews = ready.map((entry) => {
    const metadata = finalizedById.get(entry.candidateId);
    if (!metadata?.title?.trim() || !metadata.description?.trim() || !metadata.difficulty) {
      throw new Error(`Clean finalization requires human metadata for ${entry.candidateId}`);
    }
    return {
      candidateId: entry.candidateId,
      reviewStatus: 'APPROVED' as const,
      reviewers: [entry.reviewerA!.reviewerId!.trim(), entry.reviewerB!.reviewerId!.trim()],
      title: metadata.title,
      description: metadata.description,
      difficulty: metadata.difficulty,
      isClean: true,
      expectedFindings: [],
      mutations: null,
      notes: null,
      targetJavaStatus: 'UPSTREAM_PRESENT' as const,
    };
  });
  return validateImportedReviewManifest(
    {
      schemaVersion: '1.0.0',
      sourceDataset: 'COBOL_JAVATRANS',
      reviews,
    },
    candidates,
  );
}

function validateFinalization(
  value: unknown,
  selection: PilotSelectionManifest,
): PilotFinalizationFile {
  if (!isRecord(value)) throw new Error('Invalid finalization: expected an object');
  const finalization = value as unknown as PilotFinalizationFile;
  if (
    finalization.schemaVersion !== HUMAN_REVIEW_PILOT_SCHEMA_VERSION ||
    finalization.pilotId !== selection.pilotId ||
    finalization.selectionHash !== selection.selectionHash ||
    !Array.isArray(finalization.cases)
  ) {
    throw new Error('Invalid finalization: pilot or selection hash mismatch');
  }
  const selected = new Map(
    selection.selectedCandidates.map((candidate) => [candidate.candidateId, candidate]),
  );
  const seen = new Set<string>();
  for (const entry of finalization.cases) {
    if (!isRecord(entry) || typeof entry.candidateId !== 'string') {
      throw new Error('Invalid finalization: malformed case');
    }
    if (seen.has(entry.candidateId)) {
      throw new Error(`Invalid finalization: duplicate candidate ${entry.candidateId}`);
    }
    seen.add(entry.candidateId);
    const candidate = selected.get(entry.candidateId);
    if (!candidate) throw new Error(`Invalid finalization: unknown candidate ${entry.candidateId}`);
    if (
      entry.sourceSha256 !== candidate.sourceSha256 ||
      entry.targetSha256 !== candidate.targetSha256
    ) {
      throw new Error(`Invalid finalization: source/target hash mismatch for ${entry.candidateId}`);
    }
    assertNullableString(entry.title, 'title', entry.candidateId);
    assertNullableString(entry.description, 'description', entry.candidateId);
    if (entry.difficulty !== null && !['EASY', 'MEDIUM', 'HARD'].includes(entry.difficulty)) {
      throw new Error(`Invalid finalization: invalid difficulty for ${entry.candidateId}`);
    }
  }
  return finalization;
}

function comparisonState(
  reviewerA: PilotReviewDecision | null,
  reviewerB: PilotReviewDecision | null,
): ReviewComparisonState {
  if (
    !reviewerA ||
    !reviewerB ||
    !isCompleteDecision(reviewerA) ||
    !isCompleteDecision(reviewerB)
  ) {
    return 'NEEDS_REVIEW';
  }
  if (reviewerA.equivalenceDecision !== reviewerB.equivalenceDecision) return 'DISAGREEMENT';
  return reviewerA.equivalenceDecision === 'CLEAN' ? 'READY_CLEAN' : 'NOT_CLEAN_OR_UNCERTAIN';
}

function isCompleteDecision(decision: PilotReviewDecision): decision is PilotReviewDecision & {
  reviewerId: string;
  reviewedAt: string;
  equivalenceDecision: EquivalenceDecision;
} {
  return Boolean(decision.reviewerId && decision.reviewedAt && decision.equivalenceDecision);
}

function normalizeReviewerId(value: string): string {
  return value.trim().toLowerCase();
}

function assertNullableString(
  value: unknown,
  name: string,
  candidateId: string,
  allowEmpty = false,
): asserts value is string | null {
  if (value !== null && typeof value !== 'string') {
    throw new Error(`Invalid pilot review: ${name} must be a string or null for ${candidateId}`);
  }
  if (typeof value === 'string' && !allowEmpty && !value.trim()) {
    throw new Error(`Invalid pilot review: ${name} cannot be blank for ${candidateId}`);
  }
}

function isIsoDate(value: string): boolean {
  return !Number.isNaN(Date.parse(value)) && /^\d{4}-\d{2}-\d{2}T/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function assertSelectionHash(value: string): void {
  if (!sha256Pattern.test(value)) throw new Error('Invalid SHA-256 hash');
}
