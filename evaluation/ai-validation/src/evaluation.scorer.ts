import { ValidationFindingSeverity } from '../../../src/modules/validation/domain/validation-finding.types';
import { FindingMatch, matchFindings } from './evaluation.matcher';
import {
  AiEvaluationCase,
  AiEvaluationDataset,
  AiEvaluationPredictions,
  EVALUATION_CATEGORIES,
  EvaluationCategory,
  EvaluationPredictionCase,
} from './evaluation.types';

export interface CountMetrics {
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  precision: number;
  recall: number;
  f1: number;
}

export interface CategoryMetrics extends CountMetrics {
  category: EvaluationCategory;
  expectedCount: number;
  predictedCount: number;
}

export interface MetricSet {
  micro: CountMetrics;
  categories: CategoryMetrics[];
  macro: {
    includedCategories: EvaluationCategory[];
    precision: number;
    recall: number;
    f1: number;
  };
}

export interface EvaluationCaseScore {
  caseId: string;
  kind: 'CLEAN' | 'MUTATED';
  status: EvaluationPredictionCase['status'] | 'MISSING_RESULT';
  expectedCount: number;
  predictedCount: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  matchedPairs: Array<{
    expectedFindingId: string;
    predictedIndex: number;
    primaryCategoryExact: boolean;
    severityExact: boolean;
  }>;
  unmatchedExpectedFindingIds: string[];
  unmatchedPredictedIndexes: number[];
  latencyMs?: number;
}

export interface EvaluationScore {
  metadata: {
    datasetId: string;
    datasetVersion: string;
    evaluatorVersion: string;
    provider: string;
    model: string;
    promptVersion: string;
    generatedAt: string;
    locationToleranceLines: number;
    matchingPolicyVersion: string;
  };
  execution: {
    totalCases: number;
    successfulCases: number;
    failedCases: number;
    missingCases: number;
    failuresByStatus: Record<string, number>;
  };
  successfulCases: MetricSet;
  conservative: MetricSet;
  cleanCases: {
    successfulCleanCases: number;
    cleanCasesWithAnyPrediction: number;
    cleanCaseFalsePositiveRate: number;
    totalFindingsOnCleanCases: number;
  };
  mutationDetection: {
    successful: { mutatedCases: number; mutatedCasesDetected: number; mutationDetectionRate: number };
    conservative: { mutatedCases: number; mutatedCasesDetected: number; mutationDetectionRate: number };
    mutations: { total: number; detected: number; detectionRate: number };
  };
  severityAgreement: {
    exactMatches: number;
    totalMatchedFindings: number;
    severityAgreementRate: number;
    confusionMatrix: Record<string, Record<string, number>>;
  };
  categoryAgreement: {
    primaryCategoryExactMatches: number;
    acceptedCategoryMatches: number;
    totalMatchedFindings: number;
    primaryCategoryExactRate: number;
  };
  locationAgreement: {
    source: LocationAgreement;
    target: LocationAgreement;
  };
  cases: EvaluationCaseScore[];
}

interface LocationAgreement {
  comparable: number;
  exact: number;
  tolerant: number;
  exactRate: number;
  tolerantRate: number;
}

interface MutableCounts {
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  expectedCount: number;
  predictedCount: number;
}

export function scoreEvaluation(
  dataset: AiEvaluationDataset,
  predictions: AiEvaluationPredictions,
): EvaluationScore {
  const successfulCounts = emptyCategoryCounts();
  const conservativeCounts = emptyCategoryCounts();
  const predictionByCase = new Map(predictions.cases.map((result) => [result.caseId, result]));
  const caseScores: EvaluationCaseScore[] = [];
  const failureCounts: Record<string, number> = {};
  const severityMatrix = emptySeverityMatrix();
  const sourceAgreement = mutableLocationAgreement();
  const targetAgreement = mutableLocationAgreement();
  let successfulCases = 0;
  let failedCases = 0;
  let missingCases = 0;
  let severityExact = 0;
  let categoryExact = 0;
  let acceptedCategory = 0;
  let totalMatches = 0;
  let successfulCleanCases = 0;
  let cleanCasesWithAnyPrediction = 0;
  let totalFindingsOnCleanCases = 0;
  let successfulMutatedCases = 0;
  let successfulMutatedDetected = 0;
  let conservativeMutatedDetected = 0;
  let totalMutations = 0;
  let detectedMutations = 0;

  for (const benchmarkCase of dataset.cases) {
    const result = predictionByCase.get(benchmarkCase.caseId);
    totalMutations += benchmarkCase.mutations?.length ?? 0;
    if (!result || result.status !== 'SUCCESS') {
      const status = result?.status ?? 'MISSING_RESULT';
      if (!result) missingCases += 1;
      else failedCases += 1;
      failureCounts[status] = (failureCounts[status] ?? 0) + 1;
      for (const expected of benchmarkCase.expectedFindings) {
        addExpected(conservativeCounts, expected.category, false);
      }
      caseScores.push(failedCaseScore(benchmarkCase, result));
      continue;
    }

    successfulCases += 1;
    const findings = result.findings ?? [];
    const matching = matchFindings(
      benchmarkCase.expectedFindings,
      findings,
      predictions.locationToleranceLines,
    );
    const matchedMutationIds = new Set<string>();

    for (const match of matching.matches) {
      const expected = benchmarkCase.expectedFindings[match.expectedIndex];
      const predicted = findings[match.predictedIndex];
      addMatch(successfulCounts, expected.category);
      addMatch(conservativeCounts, expected.category);
      if (expected.mutationId) matchedMutationIds.add(expected.mutationId);
      totalMatches += 1;
      if (expected.severity === predicted.severity) severityExact += 1;
      severityMatrix[expected.severity][predicted.severity] += 1;
      if (match.primaryCategoryExact) categoryExact += 1;
      else acceptedCategory += 1;
      collectLocation(sourceAgreement, match, 'source');
      collectLocation(targetAgreement, match, 'target');
    }
    for (const expectedIndex of matching.unmatchedExpectedIndexes) {
      const category = benchmarkCase.expectedFindings[expectedIndex].category;
      addExpected(successfulCounts, category, false);
      addExpected(conservativeCounts, category, false);
    }
    for (const predictedIndex of matching.unmatchedPredictedIndexes) {
      const category = findings[predictedIndex].category;
      addPrediction(successfulCounts, category, false);
      addPrediction(conservativeCounts, category, false);
    }

    if (benchmarkCase.isClean) {
      successfulCleanCases += 1;
      totalFindingsOnCleanCases += findings.length;
      if (findings.length > 0) cleanCasesWithAnyPrediction += 1;
    } else {
      successfulMutatedCases += 1;
      if (matching.matches.length > 0) {
        successfulMutatedDetected += 1;
        conservativeMutatedDetected += 1;
      }
      detectedMutations += matchedMutationIds.size;
    }

    caseScores.push(successfulCaseScore(benchmarkCase, result, matching.matches, matching.unmatchedExpectedIndexes, matching.unmatchedPredictedIndexes));
  }

  const successfulMetrics = finalizeMetricSet(successfulCounts);
  const conservativeMetrics = finalizeMetricSet(conservativeCounts);
  const totalMutatedCases = dataset.cases.filter((benchmarkCase) => !benchmarkCase.isClean).length;

  return {
    metadata: {
      datasetId: predictions.datasetId,
      datasetVersion: predictions.datasetVersion,
      evaluatorVersion: predictions.evaluatorVersion,
      provider: predictions.provider,
      model: predictions.model,
      promptVersion: predictions.promptVersion,
      generatedAt: predictions.generatedAt,
      locationToleranceLines: predictions.locationToleranceLines,
      matchingPolicyVersion: predictions.matchingPolicyVersion,
    },
    execution: {
      totalCases: dataset.cases.length,
      successfulCases,
      failedCases,
      missingCases,
      failuresByStatus: failureCounts,
    },
    successfulCases: successfulMetrics,
    conservative: conservativeMetrics,
    cleanCases: {
      successfulCleanCases,
      cleanCasesWithAnyPrediction,
      cleanCaseFalsePositiveRate: ratio(cleanCasesWithAnyPrediction, successfulCleanCases),
      totalFindingsOnCleanCases,
    },
    mutationDetection: {
      successful: {
        mutatedCases: successfulMutatedCases,
        mutatedCasesDetected: successfulMutatedDetected,
        mutationDetectionRate: ratio(successfulMutatedDetected, successfulMutatedCases),
      },
      conservative: {
        mutatedCases: totalMutatedCases,
        mutatedCasesDetected: conservativeMutatedDetected,
        mutationDetectionRate: ratio(conservativeMutatedDetected, totalMutatedCases),
      },
      mutations: {
        total: totalMutations,
        detected: detectedMutations,
        detectionRate: ratio(detectedMutations, totalMutations),
      },
    },
    severityAgreement: {
      exactMatches: severityExact,
      totalMatchedFindings: totalMatches,
      severityAgreementRate: ratio(severityExact, totalMatches),
      confusionMatrix: severityMatrix,
    },
    categoryAgreement: {
      primaryCategoryExactMatches: categoryExact,
      acceptedCategoryMatches: acceptedCategory,
      totalMatchedFindings: totalMatches,
      primaryCategoryExactRate: ratio(categoryExact, totalMatches),
    },
    locationAgreement: {
      source: finalizeLocationAgreement(sourceAgreement),
      target: finalizeLocationAgreement(targetAgreement),
    },
    cases: caseScores,
  };
}

function emptyCategoryCounts(): Map<EvaluationCategory, MutableCounts> {
  return new Map(
    EVALUATION_CATEGORIES.map((category) => [
      category,
      { truePositives: 0, falsePositives: 0, falseNegatives: 0, expectedCount: 0, predictedCount: 0 },
    ]),
  );
}

function addMatch(counts: Map<EvaluationCategory, MutableCounts>, category: EvaluationCategory): void {
  const value = counts.get(category)!;
  value.truePositives += 1;
  value.expectedCount += 1;
  value.predictedCount += 1;
}

function addExpected(
  counts: Map<EvaluationCategory, MutableCounts>,
  category: EvaluationCategory,
  matched: boolean,
): void {
  const value = counts.get(category)!;
  value.expectedCount += 1;
  if (!matched) value.falseNegatives += 1;
}

function addPrediction(
  counts: Map<EvaluationCategory, MutableCounts>,
  category: EvaluationCategory,
  matched: boolean,
): void {
  const value = counts.get(category)!;
  value.predictedCount += 1;
  if (!matched) value.falsePositives += 1;
}

function finalizeMetricSet(counts: Map<EvaluationCategory, MutableCounts>): MetricSet {
  const categories = EVALUATION_CATEGORIES.map((category) => {
    const count = counts.get(category)!;
    return { category, ...count, ...calculate(count.truePositives, count.falsePositives, count.falseNegatives) };
  });
  const totals = categories.reduce(
    (sum, category) => ({
      truePositives: sum.truePositives + category.truePositives,
      falsePositives: sum.falsePositives + category.falsePositives,
      falseNegatives: sum.falseNegatives + category.falseNegatives,
    }),
    { truePositives: 0, falsePositives: 0, falseNegatives: 0 },
  );
  const included = categories.filter((category) => category.expectedCount > 0);
  return {
    micro: { ...totals, ...calculate(totals.truePositives, totals.falsePositives, totals.falseNegatives) },
    categories,
    macro: {
      includedCategories: included.map((category) => category.category),
      precision: average(included.map((category) => category.precision)),
      recall: average(included.map((category) => category.recall)),
      f1: average(included.map((category) => category.f1)),
    },
  };
}

function calculate(truePositives: number, falsePositives: number, falseNegatives: number): Omit<CountMetrics, 'truePositives' | 'falsePositives' | 'falseNegatives'> {
  const precision = ratio(truePositives, truePositives + falsePositives);
  const recall = ratio(truePositives, truePositives + falseNegatives);
  return { precision, recall, f1: ratio(2 * precision * recall, precision + recall) };
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function average(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function emptySeverityMatrix(): Record<string, Record<string, number>> {
  return Object.fromEntries(
    Object.values(ValidationFindingSeverity).map((expected) => [
      expected,
      Object.fromEntries(Object.values(ValidationFindingSeverity).map((predicted) => [predicted, 0])),
    ]),
  );
}

function mutableLocationAgreement(): { comparable: number; exact: number; tolerant: number } {
  return { comparable: 0, exact: 0, tolerant: 0 };
}

function collectLocation(
  output: { comparable: number; exact: number; tolerant: number },
  match: FindingMatch,
  key: 'source' | 'target',
): void {
  const detail = match[key];
  if (!detail.comparable) return;
  output.comparable += 1;
  if (detail.exact) output.exact += 1;
  if (detail.compatible) output.tolerant += 1;
}

function finalizeLocationAgreement(value: { comparable: number; exact: number; tolerant: number }): LocationAgreement {
  return {
    ...value,
    exactRate: ratio(value.exact, value.comparable),
    tolerantRate: ratio(value.tolerant, value.comparable),
  };
}

function failedCaseScore(
  benchmarkCase: AiEvaluationCase,
  result: EvaluationPredictionCase | undefined,
): EvaluationCaseScore {
  return {
    caseId: benchmarkCase.caseId,
    kind: benchmarkCase.isClean ? 'CLEAN' : 'MUTATED',
    status: result?.status ?? 'MISSING_RESULT',
    expectedCount: benchmarkCase.expectedFindings.length,
    predictedCount: 0,
    truePositives: 0,
    falsePositives: 0,
    falseNegatives: benchmarkCase.expectedFindings.length,
    matchedPairs: [],
    unmatchedExpectedFindingIds: benchmarkCase.expectedFindings.map((finding) => finding.findingId),
    unmatchedPredictedIndexes: [],
    ...(result?.latencyMs === undefined ? {} : { latencyMs: result.latencyMs }),
  };
}

function successfulCaseScore(
  benchmarkCase: AiEvaluationCase,
  result: EvaluationPredictionCase,
  matches: FindingMatch[],
  unmatchedExpectedIndexes: number[],
  unmatchedPredictedIndexes: number[],
): EvaluationCaseScore {
  const findings = result.findings ?? [];
  return {
    caseId: benchmarkCase.caseId,
    kind: benchmarkCase.isClean ? 'CLEAN' : 'MUTATED',
    status: 'SUCCESS',
    expectedCount: benchmarkCase.expectedFindings.length,
    predictedCount: findings.length,
    truePositives: matches.length,
    falsePositives: unmatchedPredictedIndexes.length,
    falseNegatives: unmatchedExpectedIndexes.length,
    matchedPairs: matches.map((match) => ({
      expectedFindingId: benchmarkCase.expectedFindings[match.expectedIndex].findingId,
      predictedIndex: match.predictedIndex,
      primaryCategoryExact: match.primaryCategoryExact,
      severityExact:
        benchmarkCase.expectedFindings[match.expectedIndex].severity ===
        findings[match.predictedIndex].severity,
    })),
    unmatchedExpectedFindingIds: unmatchedExpectedIndexes.map(
      (index) => benchmarkCase.expectedFindings[index].findingId,
    ),
    unmatchedPredictedIndexes,
    ...(result.latencyMs === undefined ? {} : { latencyMs: result.latencyMs }),
  };
}
