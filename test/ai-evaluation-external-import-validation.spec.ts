import {
  EXTERNAL_IMPORT_SCHEMA_VERSION,
  ImportedCandidateManifest,
  ImportedReviewManifest,
} from '../evaluation/ai-validation/src/external-import.types';
import {
  validateImportedCandidateManifest,
  validateImportedReviewManifest,
} from '../evaluation/ai-validation/src/external-import.validator';
import {
  calculateContextCompatibility,
  sha256,
} from '../evaluation/ai-validation/src/external-import.utils';

describe('external evaluation import validation', () => {
  const candidateManifest = (): ImportedCandidateManifest => {
    const sourceFiles = [{ path: 'source/example.cbl', content: 'IDENTIFICATION DIVISION.' }];
    const targetFiles = [{ path: 'target/Example.java', content: 'final class Example {}' }];
    return {
      schemaVersion: EXTERNAL_IMPORT_SCHEMA_VERSION,
      sourceDataset: 'COBOL_JAVATRANS',
      licenseStatus: 'RECORDED',
      candidateCount: 1,
      candidates: [
        {
          candidateId: 'external-cjt-example',
          sourceDataset: 'COBOL_JAVATRANS',
          sourceFiles,
          targetFiles,
          provenance: {
            upstreamRepository: 'example/source',
            upstreamRepositoryUrl: 'https://github.com/example/source',
            upstreamCommit: 'a'.repeat(40),
            upstreamPath: 'evaluation/data/examples.jsonl',
            upstreamCaseId: 'Example/1',
            upstreamBlobSha: 'b'.repeat(40),
            fileIntegrity: [
              {
                candidatePath: sourceFiles[0].path,
                upstreamPath: 'evaluation/data/examples.jsonl',
                upstreamBlobSha: 'b'.repeat(40),
                contentSha256: sha256(sourceFiles[0].content),
              },
              {
                candidatePath: targetFiles[0].path,
                upstreamPath: 'evaluation/data/examples.jsonl',
                upstreamBlobSha: 'b'.repeat(40),
                contentSha256: sha256(targetFiles[0].content),
              },
            ],
            licenseSpdx: 'Apache-2.0',
            licensePath: 'LICENSE.upstream.txt',
            retrievedAt: '2026-09-25T00:00:00.000Z',
          },
          contextCompatibility: calculateContextCompatibility(sourceFiles, targetFiles),
          groundTruthStatus: 'PENDING_ALSM_REVIEW',
          scorable: false,
          humanReviewRequired: true,
        },
      ],
    };
  };

  const reviewManifest = (): ImportedReviewManifest => ({
    schemaVersion: EXTERNAL_IMPORT_SCHEMA_VERSION,
    sourceDataset: 'COBOL_JAVATRANS',
    reviews: [
      {
        candidateId: 'external-cjt-example',
        reviewStatus: 'PENDING',
        reviewers: [],
        title: null,
        description: null,
        difficulty: null,
        isClean: null,
        expectedFindings: null,
        mutations: null,
        notes: null,
        targetJavaStatus: 'UPSTREAM_PRESENT',
      },
    ],
  });

  it('accepts a separate unscorable candidate and pending review template', () => {
    const candidates = validateImportedCandidateManifest(candidateManifest());
    const reviews = validateImportedReviewManifest(reviewManifest(), candidates);
    expect(candidates.candidates[0]).not.toHaveProperty('isClean');
    expect(candidates.candidates[0]).not.toHaveProperty('expectedFindings');
    expect(candidates.candidates[0].scorable).toBe(false);
    expect(reviews.reviews[0].isClean).toBeNull();
  });

  it('rejects duplicate candidate IDs', () => {
    const value = candidateManifest();
    value.candidates.push(structuredClone(value.candidates[0]));
    value.candidateCount = 2;
    expect(() => validateImportedCandidateManifest(value)).toThrow('duplicate candidateId');
  });

  it('rejects modified content whose SHA-256 no longer matches', () => {
    const value = candidateManifest();
    value.candidates[0].sourceFiles[0].content += ' changed';
    expect(() => validateImportedCandidateManifest(value)).toThrow('content hash mismatch');
  });

  it.each(['../escape.cbl', '/absolute.cbl', 'C:\\absolute.cbl', 'bad\0path.cbl'])(
    'rejects unsafe imported path %s',
    (unsafePath) => {
      const value = candidateManifest();
      value.candidates[0].sourceFiles[0].path = unsafePath;
      expect(() => validateImportedCandidateManifest(value)).toThrow();
    },
  );

  it('rejects candidate ground-truth fields even when supplied dynamically', () => {
    const value: unknown = {
      ...candidateManifest(),
      candidates: [
        {
          ...candidateManifest().candidates[0],
          isClean: true,
          expectedFindings: [],
        },
      ],
    };
    expect(() => validateImportedCandidateManifest(value)).toThrow('not allowed');
  });

  it('rejects a review for an unknown candidate', () => {
    const reviews = reviewManifest();
    reviews.reviews[0].candidateId = 'missing';
    expect(() => validateImportedReviewManifest(reviews, candidateManifest())).toThrow(
      'unknown candidateId',
    );
  });
});
