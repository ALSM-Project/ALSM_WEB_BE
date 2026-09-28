import {
  AwsRepositoryFile,
  buildAwsCardDemoImport,
  parseCopyDependencies,
  scanCobolFeatures,
} from '../evaluation/ai-validation/src/import-aws-carddemo';
import { PHASE_3_CONTEXT_LIMITS } from '../evaluation/ai-validation/src/external-import.types';

describe('AWS CardDemo importer', () => {
  const file = (path: string, content: string, blob = 'a'): AwsRepositoryFile => ({
    path,
    content,
    blobSha: blob.repeat(40),
  });

  it('scans objective COBOL constructs without treating comments as features', () => {
    const tags = scanCobolFeatures(`       IDENTIFICATION DIVISION.
       ENVIRONMENT DIVISION.
       INPUT-OUTPUT SECTION.
       FILE-CONTROL.
       DATA DIVISION.
       01 AMOUNT PIC S9(7)V99 COMP-3.
       01 ALT REDEFINES AMOUNT PIC X(5).
       01 ITEMS OCCURS 1 TO 10 TIMES DEPENDING ON ITEM-COUNT.
       PROCEDURE DIVISION.
           EXEC CICS READ FILE('X') END-EXEC
           EXEC SQL SELECT 1 END-EXEC
           READ INPUT-FILE
           WRITE OUTPUT-RECORD
           REWRITE OUTPUT-RECORD
           START INPUT-FILE
           CALL 'MQOPEN'
           PERFORM WORK
           GO TO EXIT-PARA.
      *    COPY COMMENTED.
           COPY ACTIVE.`);
    expect(tags).toEqual(
      expect.arrayContaining([
        'EXEC_CICS',
        'EXEC_SQL',
        'READ',
        'WRITE',
        'REWRITE',
        'START',
        'CALL',
        'COPY',
        'COMP_3',
        'REDEFINES',
        'OCCURS',
        'OCCURS_DEPENDING_ON',
        'PERFORM',
        'GO_TO',
        'FILE_CONTROL',
        'MQ_CALLS',
      ]),
    );
    expect(parseCopyDependencies('      * COPY COMMENTED.\n       COPY ACTIVE.')).toEqual([
      'ACTIVE',
    ]);
  });

  it('resolves repository copybooks and creates source-only unscorable candidates', () => {
    const result = buildAwsCardDemoImport({
      files: [
        file('app/cbl/PROGRAM.cbl', '       COPY LOCAL.\n       PERFORM WORK.'),
        file('app/cpy/LOCAL.cpy', '       01 VALUE-A PIC X.'),
      ],
      commit: 'b'.repeat(40),
      retrievedAt: '2026-09-25T00:00:00.000Z',
      subsetSize: 1,
    });
    const candidate = result.manifest.candidates[0];
    expect(candidate.dependencyStatus).toBe('RESOLVED');
    expect(candidate.copybookDependencies).toEqual(['app/cpy/LOCAL.cpy']);
    expect(candidate.sourceFiles).toHaveLength(2);
    expect(candidate.targetFiles).toBeUndefined();
    expect(candidate.targetJavaProvenance).toBeUndefined();
    expect(candidate.groundTruthStatus).toBe('SOURCE_ONLY_PENDING_CONVERSION');
    expect(candidate).not.toHaveProperty('expectedFindings');
    expect(result.reviews.reviews[0]).toMatchObject({
      targetJavaStatus: 'MISSING',
      isClean: null,
      expectedFindings: null,
    });
  });

  it('marks unresolved COPY dependencies and reports them', () => {
    const result = buildAwsCardDemoImport({
      files: [file('app/cbl/PROGRAM.cbl', '       COPY MISSING.\n       STOP RUN.')],
      commit: 'b'.repeat(40),
      retrievedAt: '2026-09-25T00:00:00.000Z',
      subsetSize: 1,
    });
    expect(result.manifest.candidates[0]).toMatchObject({
      dependencyStatus: 'UNRESOLVED',
      unresolvedDependencies: ['MISSING'],
    });
    expect(result.statistics.unresolvedDependencyCount).toBe(1);
  });

  it('selects deterministically for structural diversity', () => {
    const files = Array.from({ length: 12 }, (_value, index) =>
      file(
        `app/cbl/P${String(index).padStart(2, '0')}.cbl`,
        index === 0
          ? "       EXEC CICS READ FILE('X') END-EXEC"
          : index === 1
            ? '       EXEC SQL SELECT 1 END-EXEC'
            : index === 2
              ? "       CALL 'MQOPEN'"
              : `       PERFORM WORK-${index}.`,
        String((index % 9) + 1),
      ),
    );
    const input = {
      files,
      commit: 'b'.repeat(40),
      retrievedAt: '2026-09-25T00:00:00.000Z',
      subsetSize: 10,
    };
    const first = buildAwsCardDemoImport(input);
    const second = buildAwsCardDemoImport(input);
    expect(first.manifest.candidates.map((candidate) => candidate.candidateId)).toEqual(
      second.manifest.candidates.map((candidate) => candidate.candidateId),
    );
    expect(first.manifest.candidates).toHaveLength(10);
  });

  it('excludes credential-flagged programs without exposing the matched value', () => {
    const result = buildAwsCardDemoImport({
      files: [
        file('app/cbl/SAFE.cbl', '       PERFORM WORK.'),
        file('app/cbl/FLAGGED.cbl', "       MOVE 'AKIA1234567890ABCDEF' TO ACCESS-KEY."),
      ],
      commit: 'b'.repeat(40),
      retrievedAt: '2026-09-25T00:00:00.000Z',
      subsetSize: 1,
    });
    expect(result.manifest.candidates[0].provenance.upstreamPath).toBe('app/cbl/SAFE.cbl');
    expect(result.securityFlags).toEqual([
      { path: 'app/cbl/FLAGGED.cbl', patternType: 'AWS_ACCESS_KEY' },
    ]);
    expect(JSON.stringify(result.securityFlags)).not.toContain('1234567890ABCDEF');
  });

  it('excludes a program when an included copybook is credential-flagged', () => {
    const result = buildAwsCardDemoImport({
      files: [
        file('app/cbl/SAFE.cbl', '       PERFORM WORK.'),
        file('app/cbl/USESFLAG.cbl', '       COPY FLAGGED.'),
        file(
          'app/cpy/FLAGGED.cpy',
          "       01 SECRET-VALUE PIC X(20) VALUE 'AKIA1234567890ABCDEF'.",
        ),
      ],
      commit: 'b'.repeat(40),
      retrievedAt: '2026-09-25T00:00:00.000Z',
      subsetSize: 1,
    });
    expect(result.manifest.candidates[0].provenance.upstreamPath).toBe('app/cbl/SAFE.cbl');
    expect(result.securityFlags).toEqual([
      { path: 'app/cpy/FLAGGED.cpy', patternType: 'AWS_ACCESS_KEY' },
    ]);
  });

  it('records Phase 3 file-size incompatibility metadata', () => {
    const result = buildAwsCardDemoImport({
      files: [file('app/cbl/LARGE.cbl', 'X'.repeat(PHASE_3_CONTEXT_LIMITS.maxFileCharacters + 1))],
      commit: 'b'.repeat(40),
      retrievedAt: '2026-09-25T00:00:00.000Z',
      subsetSize: 1,
    });
    expect(result.manifest.candidates[0].contextCompatibility.status).toBe('FILE_TOO_LARGE');
  });
});
