import { readFileSync } from 'fs';
import { join } from 'path';
import {
  buildCobolJavaTransImport,
  parseJsonl,
} from '../evaluation/ai-validation/src/import-cobol-javatrans';
import { sha256 } from '../evaluation/ai-validation/src/external-import.utils';

describe('COBOL-JavaTrans importer', () => {
  const fixture = readFileSync(
    join(process.cwd(), 'test', 'fixtures', 'ai-evaluation-import', 'cobol-javatrans.jsonl'),
    'utf8',
  );
  const importFixture = () =>
    buildCobolJavaTransImport({
      jsonl: fixture,
      commit: 'a'.repeat(40),
      datasetBlobSha: 'b'.repeat(40),
      retrievedAt: '2026-09-25T00:00:00.000Z',
    });

  it('maps actual-style fields and preserves upstream evidence without ground truth', () => {
    const result = importFixture();
    expect(result.statistics).toMatchObject({
      actualRecordCount: 2,
      importedCandidateCount: 1,
      rejectedCount: 1,
      testEvidenceCount: 1,
    });
    const candidate = result.manifest.candidates[0];
    expect(candidate.candidateId).toBe('external-cjt-humaneval-7');
    expect(candidate.sourceFiles[0]).toMatchObject({ path: 'source/humaneval-7.cbl' });
    expect(candidate.targetFiles?.[0]).toMatchObject({ path: 'target/humaneval-7.java' });
    expect(candidate.upstreamEvidence?.structuredTests).toEqual([{ test: [1, 2], result: [1, 2] }]);
    expect(candidate.upstreamEvidence?.javaTestSource).toBe('assert true;');
    expect(candidate.provenance.upstreamCaseId).toBe('HumanEval/7');
    expect(candidate.provenance.fileIntegrity[0].contentSha256).toBe(
      sha256(candidate.sourceFiles[0].content),
    );
    expect(candidate.groundTruthStatus).toBe('PENDING_ALSM_REVIEW');
    expect(candidate.scorable).toBe(false);
    expect(result.manifest.licenseStatus).toBe('REVIEW_REQUIRED');
    expect(candidate).not.toHaveProperty('isClean');
    expect(candidate).not.toHaveProperty('expectedFindings');
    expect(result.reviews.reviews[0]).toMatchObject({
      reviewStatus: 'PENDING',
      reviewers: [],
      isClean: null,
      expectedFindings: null,
      targetJavaStatus: 'UPSTREAM_PRESENT',
    });
  });

  it('records license evidence only for the audited revision without making candidates scorable', () => {
    const result = buildCobolJavaTransImport({
      jsonl: fixture,
      commit: '2b14b7bf7e55556205654c6f7657fa60e36251fa',
      datasetBlobSha: 'b29ce552a209e6a12cb5b31e130188404ccf8958',
      retrievedAt: '2026-09-25T00:00:00.000Z',
    });

    expect(result.manifest.licenseStatus).toBe('RECORDED');
    expect(result.manifest.candidates[0]).toMatchObject({
      groundTruthStatus: 'PENDING_ALSM_REVIEW',
      scorable: false,
      humanReviewRequired: true,
    });
  });

  it('creates a stable hash-based ID when task_id is missing', () => {
    const record = JSON.stringify({
      COBOL_canonical_solution: 'IDENTIFICATION DIVISION.',
      Java_canonical_solution: 'final class Example {}',
      tests: [],
    });
    const first = buildCobolJavaTransImport({
      jsonl: record,
      commit: 'a'.repeat(40),
      datasetBlobSha: 'b'.repeat(40),
      retrievedAt: '2026-09-25T00:00:00.000Z',
    });
    const second = buildCobolJavaTransImport({
      jsonl: record,
      commit: 'a'.repeat(40),
      datasetBlobSha: 'b'.repeat(40),
      retrievedAt: '2026-09-25T00:00:00.000Z',
    });
    expect(first.manifest.candidates[0].candidateId).toBe(
      second.manifest.candidates[0].candidateId,
    );
    expect(first.manifest.candidates[0].provenance.upstreamCaseId).toBeUndefined();
  });

  it('rejects duplicate stable IDs', () => {
    const duplicated = `${fixture.split(/\r?\n/)[0]}\n${fixture.split(/\r?\n/)[0]}\n`;
    expect(() =>
      buildCobolJavaTransImport({
        jsonl: duplicated,
        commit: 'a'.repeat(40),
        datasetBlobSha: 'b'.repeat(40),
        retrievedAt: '2026-09-25T00:00:00.000Z',
      }),
    ).toThrow('Duplicate COBOL-JavaTrans candidate ID');
  });

  it('rejects malformed JSONL', () => {
    expect(() => parseJsonl('{"task_id":')).toThrow('Malformed COBOL-JavaTrans JSONL');
  });

  it.each([
    ['missing COBOL', { task_id: 'x', Java_canonical_solution: 'class X {}' }],
    ['missing Java', { task_id: 'x', COBOL_canonical_solution: 'IDENTIFICATION DIVISION.' }],
  ])('skips %s records according to importer policy', (_name, record) => {
    expect(() =>
      buildCobolJavaTransImport({
        jsonl: JSON.stringify(record),
        commit: 'a'.repeat(40),
        datasetBlobSha: 'b'.repeat(40),
        retrievedAt: '2026-09-25T00:00:00.000Z',
      }),
    ).toThrow('candidates');
  });
});
