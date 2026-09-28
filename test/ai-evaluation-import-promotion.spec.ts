import {
  ValidationFindingCategory,
  ValidationFindingSeverity,
} from '../src/modules/validation/domain/validation-finding.types';
import {
  EXTERNAL_IMPORT_SCHEMA_VERSION,
  ImportedCandidateManifest,
  ImportedReviewManifest,
} from '../evaluation/ai-validation/src/external-import.types';
import {
  calculateContextCompatibility,
  sha256,
} from '../evaluation/ai-validation/src/external-import.utils';
import { promoteImportedCases } from '../evaluation/ai-validation/src/promote-imported-cases';
import { validateDataset } from '../evaluation/ai-validation/src/evaluation.validator';

describe('imported evaluation candidate promotion', () => {
  const sourceFiles = [{ path: 'source/example.cbl', content: 'IDENTIFICATION DIVISION.' }];
  const targetFiles = [{ path: 'target/Example.java', content: 'final class Example {}' }];
  const metadata = {
    datasetId: 'reviewed-external-test',
    version: '1.0.0',
    description: 'Human-reviewed external fixture.',
    creationMethodology: 'Two-person review fixture.',
    limitations: ['Test-only fixture.'],
  };
  const candidates = (
    sourceDataset: 'COBOL_JAVATRANS' | 'AWS_CARDDEMO' = 'COBOL_JAVATRANS',
  ): ImportedCandidateManifest => ({
    schemaVersion: EXTERNAL_IMPORT_SCHEMA_VERSION,
    sourceDataset,
    licenseStatus: 'RECORDED',
    candidateCount: 1,
    candidates: [
      {
        candidateId: `external-${sourceDataset === 'COBOL_JAVATRANS' ? 'cjt' : 'aws'}-example`,
        sourceDataset,
        sourceFiles,
        ...(sourceDataset === 'COBOL_JAVATRANS' ? { targetFiles } : {}),
        provenance: {
          upstreamRepository: 'example/source',
          upstreamRepositoryUrl: 'https://github.com/example/source',
          upstreamCommit: 'a'.repeat(40),
          upstreamPath: 'source/example.cbl',
          ...(sourceDataset === 'COBOL_JAVATRANS' ? { upstreamCaseId: 'Example/1' } : {}),
          fileIntegrity: [
            {
              candidatePath: sourceFiles[0].path,
              upstreamPath: 'source/example.cbl',
              upstreamBlobSha: 'b'.repeat(40),
              contentSha256: sha256(sourceFiles[0].content),
            },
            ...(sourceDataset === 'COBOL_JAVATRANS'
              ? [
                  {
                    candidatePath: targetFiles[0].path,
                    upstreamPath: 'source/example.jsonl',
                    upstreamBlobSha: 'b'.repeat(40),
                    contentSha256: sha256(targetFiles[0].content),
                  },
                ]
              : []),
          ],
          licenseSpdx: 'Apache-2.0',
          licensePath: 'LICENSE.upstream.txt',
          retrievedAt: '2026-09-25T00:00:00.000Z',
        },
        ...(sourceDataset === 'AWS_CARDDEMO'
          ? {
              dependencyStatus: 'RESOLVED' as const,
              copybookDependencies: [],
              unresolvedDependencies: [],
              selectionReason: 'Test selection.',
            }
          : {}),
        contextCompatibility: calculateContextCompatibility(
          sourceFiles,
          sourceDataset === 'COBOL_JAVATRANS' ? targetFiles : [],
        ),
        groundTruthStatus:
          sourceDataset === 'COBOL_JAVATRANS'
            ? 'PENDING_ALSM_REVIEW'
            : 'SOURCE_ONLY_PENDING_CONVERSION',
        scorable: false,
        humanReviewRequired: true,
      },
    ],
  });
  const reviews = (
    sourceDataset: 'COBOL_JAVATRANS' | 'AWS_CARDDEMO' = 'COBOL_JAVATRANS',
  ): ImportedReviewManifest => ({
    schemaVersion: EXTERNAL_IMPORT_SCHEMA_VERSION,
    sourceDataset,
    reviews: [
      {
        candidateId: `external-${sourceDataset === 'COBOL_JAVATRANS' ? 'cjt' : 'aws'}-example`,
        reviewStatus: 'APPROVED',
        reviewers: ['alice@example.com', 'bob@example.com'],
        title: 'Reviewed example',
        description: 'Explicitly reviewed external example.',
        difficulty: 'EASY',
        isClean: true,
        expectedFindings: [],
        mutations: null,
        notes: 'Reviewed independently.',
        targetJavaStatus: sourceDataset === 'COBOL_JAVATRANS' ? 'UPSTREAM_PRESENT' : 'MISSING',
        ...(sourceDataset === 'AWS_CARDDEMO'
          ? { targetFiles: null, targetJavaProvenance: null }
          : {}),
      },
    ],
  });

  it('rejects an unreviewed candidate', () => {
    const value = reviews();
    value.reviews[0] = {
      ...value.reviews[0],
      reviewStatus: 'PENDING',
      reviewers: [],
      title: null,
      description: null,
      difficulty: null,
      isClean: null,
      expectedFindings: null,
      mutations: null,
      notes: null,
    };
    expect(() => promoteImportedCases(candidates(), value, metadata)).toThrow(
      'not explicitly APPROVED',
    );
  });

  it('rejects one reviewer and non-human reviewer identifiers', () => {
    const oneReviewer = reviews();
    oneReviewer.reviews[0].reviewers = ['alice@example.com'];
    expect(() => promoteImportedCases(candidates(), oneReviewer, metadata)).toThrow(
      'two distinct reviewers',
    );
    const aiReviewer = reviews();
    aiReviewer.reviews[0].reviewers = ['alice@example.com', 'Codex'];
    expect(() => promoteImportedCases(candidates(), aiReviewer, metadata)).toThrow(
      'non-human reviewer',
    );
  });

  it.each([
    ['isClean', { isClean: null }],
    ['expectedFindings', { expectedFindings: null }],
  ])('rejects a missing explicit %s decision', (_name, override) => {
    const value = reviews();
    Object.assign(value.reviews[0], override);
    expect(() => promoteImportedCases(candidates(), value, metadata)).toThrow('Promotion blocked');
  });

  it('accepts a clean case only with explicit empty findings and passes Phase 6 validation', () => {
    const promoted = promoteImportedCases(candidates(), reviews(), metadata);
    expect(promoted.type).toBe('human-reviewed-external');
    expect(promoted.cases[0]).toMatchObject({ isClean: true, expectedFindings: [] });
    expect(validateDataset(promoted)).toBeDefined();
  });

  it('accepts explicitly reviewed defective findings and mutations', () => {
    const value = reviews();
    value.reviews[0].isClean = false;
    value.reviews[0].mutations = [
      {
        mutationId: 'reviewed-mutation',
        operator: 'HUMAN_REVIEWED_DIFFERENCE',
        description: 'Reviewed change.',
        observableImpact: 'Reviewed behavior impact.',
      },
    ];
    value.reviews[0].expectedFindings = [
      {
        findingId: 'reviewed-finding',
        category: ValidationFindingCategory.LOGIC_MISMATCH,
        severity: ValidationFindingSeverity.HIGH,
        allowCategoryOnly: true,
        description: 'Human-reviewed finding.',
        mutationId: 'reviewed-mutation',
      },
    ];
    expect(promoteImportedCases(candidates(), value, metadata).cases[0].isClean).toBe(false);
  });

  it('blocks promotion while license metadata requires review', () => {
    const value = candidates();
    value.licenseStatus = 'REVIEW_REQUIRED';
    expect(() => promoteImportedCases(value, reviews(), metadata)).toThrow('license status');
  });

  it('rejects an AWS candidate without Java and with unverified Java', () => {
    const missing = reviews('AWS_CARDDEMO');
    expect(() => promoteImportedCases(candidates('AWS_CARDDEMO'), missing, metadata)).toThrow(
      'requires verified target Java',
    );
    missing.reviews[0].targetJavaStatus = 'VERIFIED';
    missing.reviews[0].targetFiles = targetFiles;
    expect(() => promoteImportedCases(candidates('AWS_CARDDEMO'), missing, metadata)).toThrow(
      'requires verified target Java',
    );
  });

  it('accepts AWS only after explicit target provenance and verification', () => {
    const value = reviews('AWS_CARDDEMO');
    value.reviews[0].targetJavaStatus = 'VERIFIED';
    value.reviews[0].targetFiles = targetFiles;
    value.reviews[0].targetJavaProvenance = {
      generationSource: 'HUMAN_IMPLEMENTATION',
      toolVersion: 'human-reviewed-v1',
      sourceCommit: 'review-commit',
      verificationStatus: 'VERIFIED',
      verificationEvidence: ['Behavioral tests reviewed by the named team members.'],
      humanReviewers: ['alice@example.com', 'bob@example.com'],
      fileIntegrity: [{ path: targetFiles[0].path, contentSha256: sha256(targetFiles[0].content) }],
    };
    expect(
      promoteImportedCases(candidates('AWS_CARDDEMO'), value, metadata).cases[0].targetFiles,
    ).toEqual(targetFiles);
  });
});
