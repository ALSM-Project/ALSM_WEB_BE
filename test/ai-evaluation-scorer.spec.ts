import {
  ValidationFindingCategory as Category,
  ValidationFindingSeverity as Severity,
} from '../src/modules/validation/domain/validation-finding.types';
import { matchFindings } from '../evaluation/ai-validation/src/evaluation.matcher';
import { scoreEvaluation } from '../evaluation/ai-validation/src/evaluation.scorer';
import {
  AiEvaluationDataset,
  AiEvaluationPredictions,
  ExpectedEvaluationFinding,
  PredictedEvaluationFinding,
} from '../evaluation/ai-validation/src/evaluation.types';

describe('AI evaluation matcher and scorer', () => {
  const expected = (
    overrides: Partial<ExpectedEvaluationFinding> = {},
  ): ExpectedEvaluationFinding => ({
    findingId: 'expected-1',
    category: Category.LOGIC_MISMATCH,
    severity: Severity.HIGH,
    sourceLocation: { file: 'PROGRAM.cbl', startLine: 10, endLine: 12 },
    targetLocation: { file: 'Program.java', startLine: 20, endLine: 22 },
    description: 'Synthetic ground truth.',
    mutationId: 'mutation-1',
    ...overrides,
  });
  const predicted = (
    overrides: Partial<PredictedEvaluationFinding> = {},
  ): PredictedEvaluationFinding => ({
    category: Category.LOGIC_MISMATCH,
    severity: Severity.HIGH,
    title: 'Detected mismatch',
    explanation: 'Synthetic prediction.',
    sourceLocation: { file: './program.cbl', startLine: 10, endLine: 12 },
    targetLocation: { file: 'Program.java', startLine: 20, endLine: 22 },
    ...overrides,
  });

  it.each<[string, Partial<PredictedEvaluationFinding>, boolean]>([
    ['exact locations', {}, true],
    [
      'overlapping range',
      { sourceLocation: { file: 'PROGRAM.cbl', startLine: 11, endLine: 13 } },
      true,
    ],
    [
      'two-line tolerance',
      { sourceLocation: { file: 'PROGRAM.cbl', startLine: 14, endLine: 15 } },
      true,
    ],
    [
      'outside tolerance',
      { sourceLocation: { file: 'PROGRAM.cbl', startLine: 15, endLine: 16 } },
      false,
    ],
    ['category mismatch', { category: Category.FILE_IO_MISMATCH }, false],
  ])('handles %s deterministically', (_name, overrides, matches) => {
    expect(matchFindings([expected()], [predicted(overrides)], 2).matches).toHaveLength(
      matches ? 1 : 0,
    );
  });

  it('supports accepted category aliases and distinguishes them from exact agreement', () => {
    const result = matchFindings(
      [
        expected({
          acceptedCategories: [Category.POTENTIAL_BEHAVIOR_CHANGE],
          acceptedCategoryJustification: 'Ambiguous boundary behavior.',
        }),
      ],
      [predicted({ category: Category.POTENTIAL_BEHAVIOR_CHANGE })],
      2,
    );
    expect(result.matches[0]).toEqual(
      expect.objectContaining({ primaryCategoryExact: false, acceptedCategoryMatch: true }),
    );
  });

  it('supports source-only, target-only, and explicit category-only ground truth', () => {
    expect(
      matchFindings(
        [expected({ targetLocation: undefined })],
        [predicted({ targetLocation: undefined })],
        2,
      ).matches,
    ).toHaveLength(1);
    expect(
      matchFindings(
        [expected({ sourceLocation: undefined })],
        [predicted({ sourceLocation: undefined })],
        2,
      ).matches,
    ).toHaveLength(1);
    expect(
      matchFindings(
        [
          expected({
            sourceLocation: undefined,
            targetLocation: undefined,
            allowCategoryOnly: true,
          }),
        ],
        [predicted({ sourceLocation: undefined, targetLocation: undefined })],
        2,
      ).matches,
    ).toHaveLength(1);
  });

  it('enforces one-to-one matching in both directions', () => {
    expect(
      matchFindings([expected(), expected({ findingId: 'expected-2' })], [predicted()], 2).matches,
    ).toHaveLength(1);
    expect(matchFindings([expected()], [predicted(), predicted()], 2).matches).toHaveLength(1);
  });

  it('finds the maximum matching in the adversarial greedy case', () => {
    const groundTruth = [
      expected({
        findingId: 'expected-1',
        sourceLocation: { file: 'PROGRAM.cbl', startLine: 10, endLine: 10 },
        targetLocation: undefined,
      }),
      expected({
        findingId: 'expected-2',
        sourceLocation: { file: 'PROGRAM.cbl', startLine: 14, endLine: 14 },
        targetLocation: undefined,
      }),
    ];
    const predictions = [
      predicted({
        sourceLocation: { file: 'PROGRAM.cbl', startLine: 12, endLine: 12 },
        targetLocation: undefined,
      }),
      predicted({
        sourceLocation: { file: 'PROGRAM.cbl', startLine: 10, endLine: 10 },
        targetLocation: undefined,
      }),
    ];
    const result = matchFindings(groundTruth, predictions, 2);
    expect(result.matches).toHaveLength(2);
    expect(result.matches.find((match) => match.predictedIndex === 1)?.expectedIndex).toBe(0);
  });

  it('prefers the strongest exact-location match when cardinality is unchanged', () => {
    const result = matchFindings(
      [expected({ targetLocation: undefined })],
      [
        predicted({
          sourceLocation: { file: 'PROGRAM.cbl', startLine: 12, endLine: 12 },
          targetLocation: undefined,
        }),
        predicted({
          sourceLocation: { file: 'PROGRAM.cbl', startLine: 10, endLine: 12 },
          targetLocation: undefined,
        }),
      ],
      2,
    );
    expect(result.matches).toEqual([
      expect.objectContaining({ predictedIndex: 1, expectedIndex: 0 }),
    ]);
  });

  it('computes perfect, zero-denominator, and severity-independent detection metrics', () => {
    const score = scoreEvaluation(
      dataset(),
      predictionFile([
        { caseId: 'mutated', status: 'SUCCESS', findings: [predicted({ severity: Severity.LOW })] },
        { caseId: 'clean', status: 'SUCCESS', findings: [] },
      ]),
    );
    expect(score.successfulCases.micro).toEqual({
      truePositives: 1,
      falsePositives: 0,
      falseNegatives: 0,
      precision: 1,
      recall: 1,
      f1: 1,
    });
    expect(score.severityAgreement).toEqual(
      expect.objectContaining({
        exactMatches: 0,
        totalMatchedFindings: 1,
        severityAgreementRate: 0,
      }),
    );
    expect(score.cleanCases.cleanCaseFalsePositiveRate).toBe(0);
    expect(score.severityAgreement.confusionMatrix.HIGH.LOW).toBe(1);
  });

  it('handles no predictions with finite zero-denominator metrics', () => {
    const score = scoreEvaluation(
      dataset(),
      predictionFile([
        { caseId: 'mutated', status: 'SUCCESS', findings: [] },
        { caseId: 'clean', status: 'SUCCESS', findings: [] },
      ]),
    );
    expect(score.successfulCases.micro).toEqual({
      truePositives: 0,
      falsePositives: 0,
      falseNegatives: 1,
      precision: 0,
      recall: 0,
      f1: 0,
    });
  });

  it('counts every clean-case prediction as a false positive', () => {
    const score = scoreEvaluation(
      dataset(),
      predictionFile([
        { caseId: 'clean', status: 'SUCCESS', findings: [predicted(), predicted()] },
      ]),
    );
    expect(score.successfulCases.micro).toEqual({
      truePositives: 0,
      falsePositives: 2,
      falseNegatives: 0,
      precision: 0,
      recall: 0,
      f1: 0,
    });
    expect(score.cleanCases.cleanCaseFalsePositiveRate).toBe(1);
  });

  it('computes mixed TP, FP, FN, per-category, macro, clean, and mutation metrics', () => {
    const score = scoreEvaluation(
      dataset(true),
      predictionFile([
        {
          caseId: 'mutated',
          status: 'SUCCESS',
          findings: [
            predicted(),
            predicted({
              category: Category.FILE_IO_MISMATCH,
              sourceLocation: undefined,
              targetLocation: undefined,
            }),
          ],
        },
        {
          caseId: 'clean',
          status: 'SUCCESS',
          findings: [predicted({ sourceLocation: undefined, targetLocation: undefined })],
        },
      ]),
    );
    expect(score.successfulCases.micro).toEqual(
      expect.objectContaining({ truePositives: 1, falsePositives: 2, falseNegatives: 1 }),
    );
    expect(score.cleanCases).toEqual({
      successfulCleanCases: 1,
      cleanCasesWithAnyPrediction: 1,
      cleanCaseFalsePositiveRate: 1,
      totalFindingsOnCleanCases: 1,
    });
    expect(score.mutationDetection.successful).toEqual({
      mutatedCases: 1,
      mutatedCasesDetected: 1,
      mutationDetectionRate: 1,
    });
    expect(
      score.successfulCases.categories.find(
        (metric) => metric.category === Category.LOGIC_MISMATCH,
      ),
    ).toEqual(expect.objectContaining({ expectedCount: 2, truePositives: 1, falseNegatives: 1 }));
    expect(score.successfulCases.macro.includedCategories).toEqual([Category.LOGIC_MISMATCH]);
  });

  it('separates provider failures from empty success and adds conservative false negatives', () => {
    const score = scoreEvaluation(
      dataset(),
      predictionFile([
        {
          caseId: 'mutated',
          status: 'PROVIDER_FAILED',
          failure: { code: 'TIMEOUT', message: 'Synthetic timeout' },
        },
        { caseId: 'clean', status: 'SUCCESS', findings: [] },
      ]),
    );
    expect(score.execution).toEqual(
      expect.objectContaining({ successfulCases: 1, failedCases: 1, missingCases: 0 }),
    );
    expect(score.successfulCases.micro.falseNegatives).toBe(0);
    expect(score.conservative.micro.falseNegatives).toBe(1);
    expect(score.mutationDetection.conservative.mutationDetectionRate).toBe(0);
  });

  function dataset(twoFindings = false): AiEvaluationDataset {
    const findings = [expected()];
    const mutations = [
      {
        mutationId: 'mutation-1',
        operator: 'REVERSE_CONDITION',
        description: 'Reversed condition.',
        observableImpact: 'Opposite branch.',
      },
    ];
    if (twoFindings) {
      findings.push(
        expected({
          findingId: 'expected-2',
          mutationId: 'mutation-2',
          sourceLocation: { file: 'PROGRAM.cbl', startLine: 30, endLine: 30 },
          targetLocation: { file: 'Program.java', startLine: 30, endLine: 30 },
        }),
      );
      mutations.push({
        mutationId: 'mutation-2',
        operator: 'OMIT_BRANCH',
        description: 'Omitted branch.',
        observableImpact: 'Operation skipped.',
      });
    }
    return {
      datasetId: 'test',
      version: '1.0.0',
      type: 'synthetic-curated',
      description: 'test',
      caseCount: 2,
      creationMethodology: 'test',
      limitations: ['test'],
      cases: [
        {
          caseId: 'mutated',
          title: 'Mutated',
          description: 'Mutated',
          sourceFiles: [{ path: 'PROGRAM.cbl', content: Array(40).fill('line').join('\n') }],
          targetFiles: [{ path: 'Program.java', content: Array(40).fill('line').join('\n') }],
          expectedFindings: findings,
          isClean: false,
          difficulty: 'MEDIUM',
          mutations,
          tags: [],
        },
        {
          caseId: 'clean',
          title: 'Clean',
          description: 'Clean',
          sourceFiles: [{ path: 'CLEAN.cbl', content: 'line' }],
          targetFiles: [{ path: 'Clean.java', content: 'line' }],
          expectedFindings: [],
          isClean: true,
          difficulty: 'EASY',
          tags: [],
        },
      ],
    };
  }

  function predictionFile(cases: AiEvaluationPredictions['cases']): AiEvaluationPredictions {
    return {
      datasetId: 'test',
      datasetVersion: '1.0.0',
      evaluatorVersion: '1.0.0',
      generatedAt: '2026-09-25T00:00:00.000Z',
      provider: 'sample',
      model: 'sample',
      promptVersion: 'sample',
      locationToleranceLines: 2,
      matchingPolicyVersion: '1.0.0',
      cases,
    };
  }
});
