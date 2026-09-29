import { readFileSync } from 'fs';
import { resolve } from 'path';
import { ImportedCandidateManifest } from '../evaluation/ai-validation/src/external-import.types';
import { sha256 } from '../evaluation/ai-validation/src/external-import.utils';
import { promoteImportedCases } from '../evaluation/ai-validation/src/promote-imported-cases';
import {
  comparePilotReviews,
  finalizeCleanReviewManifest,
  validatePilotReview,
} from '../evaluation/ai-validation/src/human-review-reconciliation';
import {
  createFinalizationTemplate,
  createReviewTemplate,
  preparePilotSelection,
} from '../evaluation/ai-validation/src/human-review-selection';
import { PilotReviewFile } from '../evaluation/ai-validation/src/human-review.types';

const candidatePath = resolve(
  'evaluation/ai-validation/imports/cobol-javatrans/candidates.json',
);
const rawCandidates = readFileSync(candidatePath, 'utf8');
const candidates = JSON.parse(rawCandidates) as ImportedCandidateManifest;
const sourcePath = 'evaluation/ai-validation/imports/cobol-javatrans/candidates.json';
const sourceHash = sha256(rawCandidates);
const selected = preparePilotSelection(
  candidates,
  sourcePath,
  sourceHash,
  '2026-09-28T00:00:00.000Z',
);

function completedReview(
  role: 'A' | 'B',
  reviewerId: string,
  decision: 'CLEAN' | 'NOT_CLEAN_OR_UNCERTAIN' = 'CLEAN',
): PilotReviewFile {
  const review = createReviewTemplate(selected, role);
  review.decisions = review.decisions.map((entry) => ({
    ...entry,
    reviewerId,
    reviewedAt: '2026-09-28T01:00:00.000Z',
    equivalenceDecision: decision,
    notes: 'Synthetic unit-test fixture only.',
  }));
  return review;
}

describe('COBOL-JavaTrans independent review reconciliation', () => {
  it('reports NEEDS_REVIEW when either reviewer decision is incomplete', () => {
    const reviewA = completedReview('A', 'reviewer-a@example.test');
    const reviewB = completedReview('B', 'reviewer-b@example.test');
    reviewB.decisions[0] = {
      ...reviewB.decisions[0],
      reviewerId: null,
      reviewedAt: null,
      equivalenceDecision: null,
    };
    const comparison = comparePilotReviews(selected, reviewA, reviewB);
    expect(comparison.cases[0].state).toBe('NEEDS_REVIEW');
    expect(comparison.counts.NEEDS_REVIEW).toBe(1);
    expect(() => validatePilotReview(reviewB, selected, 'B', true)).toThrow(
      'missing reviewer ID',
    );
  });

  it('rejects the same reviewer in both independent roles', () => {
    const reviewA = completedReview('A', 'same-person@example.test');
    const reviewB = completedReview('B', 'SAME-PERSON@example.test');
    expect(() => comparePilotReviews(selected, reviewA, reviewB)).toThrow('two distinct');
  });

  it.each(['codex-bot', 'ai_reviewer@example.test', 'automation@example.test'])(
    'rejects non-human reviewer identifier %s',
    (reviewerId) => {
      expect(() =>
        comparePilotReviews(
          selected,
          completedReview('A', reviewerId),
          completedReview('B', 'reviewer-b@example.test'),
        ),
      ).toThrow('non-human reviewer');
    },
  );

  it('reports READY_CLEAN only when both distinct humans choose CLEAN', () => {
    const comparison = comparePilotReviews(
      selected,
      completedReview('A', 'reviewer-a@example.test'),
      completedReview('B', 'reviewer-b@example.test'),
    );
    expect(comparison.counts.READY_CLEAN).toBe(15);
  });

  it('reports DISAGREEMENT without choosing a winner', () => {
    const reviewA = completedReview('A', 'reviewer-a@example.test');
    const reviewB = completedReview('B', 'reviewer-b@example.test');
    reviewB.decisions[0].equivalenceDecision = 'NOT_CLEAN_OR_UNCERTAIN';
    const comparison = comparePilotReviews(selected, reviewA, reviewB);
    expect(comparison.cases[0].state).toBe('DISAGREEMENT');
    expect(comparison.counts.DISAGREEMENT).toBe(1);
  });

  it('reports NOT_CLEAN_OR_UNCERTAIN when both humans choose it', () => {
    const comparison = comparePilotReviews(
      selected,
      completedReview('A', 'reviewer-a@example.test', 'NOT_CLEAN_OR_UNCERTAIN'),
      completedReview('B', 'reviewer-b@example.test', 'NOT_CLEAN_OR_UNCERTAIN'),
    );
    expect(comparison.counts.NOT_CLEAN_OR_UNCERTAIN).toBe(15);
    expect(comparison.counts.READY_CLEAN).toBe(0);
  });

  it('rejects stale hashes and unknown candidate IDs', () => {
    const stale = completedReview('A', 'reviewer-a@example.test');
    stale.decisions[0].sourceSha256 = '0'.repeat(64);
    expect(() =>
      comparePilotReviews(
        selected,
        stale,
        completedReview('B', 'reviewer-b@example.test'),
      ),
    ).toThrow('hash mismatch');

    const unknown = completedReview('A', 'reviewer-a@example.test');
    unknown.decisions[0].candidateId = 'external-cjt-unknown';
    expect(() =>
      comparePilotReviews(
        selected,
        unknown,
        completedReview('B', 'reviewer-b@example.test'),
      ),
    ).toThrow('unknown candidate');
  });

  it('creates only clean Phase 6 reviews and passes the existing promotion gate', () => {
    const reviewA = completedReview('A', 'reviewer-a@example.test');
    const reviewB = completedReview('B', 'reviewer-b@example.test');
    const finalization = createFinalizationTemplate(selected);
    finalization.cases = finalization.cases.map((entry) => ({
      ...entry,
      title: `Synthetic fixture ${entry.candidateId}`,
      description: 'Synthetic human-finalization fixture used only by an offline unit test.',
      difficulty: 'MEDIUM',
    }));
    const reviewManifest = finalizeCleanReviewManifest(
      candidates,
      sourceHash,
      selected,
      reviewA,
      reviewB,
      finalization,
    );
    expect(reviewManifest).not.toBeNull();
    expect(
      reviewManifest!.reviews.every(
        (review) =>
          review.isClean === true &&
          review.expectedFindings?.length === 0 &&
          review.mutations === null,
      ),
    ).toBe(true);
    const fetchSpy = jest.spyOn(global, 'fetch');
    const promoted = promoteImportedCases(candidates, reviewManifest, {
      datasetId: 'cobol-java-external-clean-pilot',
      version: '1.0.0',
      description: 'Synthetic promotion test.',
      creationMethodology: 'Synthetic two-reviewer fixture for an offline unit test.',
      limitations: ['This is a test fixture.'],
    });
    expect(promoted.type).toBe('human-reviewed-external');
    expect(promoted.caseCount).toBe(15);
    expect(promoted.cases.every((entry) => entry.isClean && !entry.mutations)).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
