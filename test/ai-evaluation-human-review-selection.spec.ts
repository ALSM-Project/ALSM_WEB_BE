import { readFileSync } from 'fs';
import { resolve } from 'path';
import { ImportedCandidateManifest } from '../evaluation/ai-validation/src/external-import.types';
import { sha256 } from '../evaluation/ai-validation/src/external-import.utils';
import {
  createReviewTemplate,
  isEligiblePilotCandidate,
  preparePilotSelection,
  validatePilotSelection,
} from '../evaluation/ai-validation/src/human-review-selection';

const candidatePath = resolve('evaluation/ai-validation/imports/cobol-javatrans/candidates.json');
const rawCandidates = readFileSync(candidatePath, 'utf8');
const candidates = JSON.parse(rawCandidates) as ImportedCandidateManifest;

function selection() {
  return preparePilotSelection(
    candidates,
    'evaluation/ai-validation/imports/cobol-javatrans/candidates.json',
    sha256(rawCandidates),
    '2026-09-28T00:00:00.000Z',
  );
}

describe('COBOL-JavaTrans human review pilot selection', () => {
  it('selects exactly five candidates from each size stratum', () => {
    const prepared = selection();
    expect(prepared.selectedCandidates).toHaveLength(15);
    expect(
      prepared.selectedCandidates.filter((candidate) => candidate.sizeStratum === 'SMALL'),
    ).toHaveLength(5);
    expect(
      prepared.selectedCandidates.filter((candidate) => candidate.sizeStratum === 'MEDIUM'),
    ).toHaveLength(5);
    expect(
      prepared.selectedCandidates.filter((candidate) => candidate.sizeStratum === 'LARGE'),
    ).toHaveLength(5);
  });

  it('is deterministic and has a stable selection hash', () => {
    const first = selection();
    const second = selection();
    expect(second.selectedCandidates).toEqual(first.selectedCandidates);
    expect(second.selectionHash).toBe(first.selectionHash);
    expect(validatePilotSelection(first, candidates, sha256(rawCandidates))).toEqual(first);
  });

  it('filters candidates that violate pilot eligibility without assigning semantic labels', () => {
    const base = candidates.candidates[0];
    expect(isEligiblePilotCandidate(base)).toBe(true);
    expect(
      isEligiblePilotCandidate({ ...base, groundTruthStatus: 'SOURCE_ONLY_PENDING_CONVERSION' }),
    ).toBe(false);
    expect(
      isEligiblePilotCandidate({
        ...base,
        contextCompatibility: { ...base.contextCompatibility, status: 'TOTAL_TOO_LARGE' },
      }),
    ).toBe(false);
    expect(isEligiblePilotCandidate({ ...base, targetFiles: undefined })).toBe(false);
    expect(
      isEligiblePilotCandidate({
        ...base,
        provenance: {
          ...base.provenance,
          fileIntegrity: base.provenance.fileIntegrity.map((entry, index) =>
            index === 0 ? { ...entry, contentSha256: '0'.repeat(64) } : entry,
          ),
        },
      }),
    ).toBe(false);
  });

  it('creates identity-free and decision-free independent review templates', () => {
    const prepared = selection();
    for (const role of ['A', 'B'] as const) {
      const template = createReviewTemplate(prepared, role);
      expect(template.reviewerRole).toBe(role);
      expect(template.decisions).toHaveLength(15);
      expect(template.decisions.every((decision) => decision.reviewerId === null)).toBe(true);
      expect(template.decisions.every((decision) => decision.reviewedAt === null)).toBe(true);
      expect(template.decisions.every((decision) => decision.equivalenceDecision === null)).toBe(
        true,
      );
    }
  });
});
