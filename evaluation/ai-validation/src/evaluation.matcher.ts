import {
  ExpectedEvaluationFinding,
  PredictedEvaluationFinding,
  EvaluationLocation,
} from './evaluation.types';
import { normalizePath } from './evaluation.validator';

export interface LocationMatchDetail {
  comparable: boolean;
  exact: boolean;
  compatible: boolean;
}

export interface FindingMatch {
  expectedIndex: number;
  predictedIndex: number;
  score: number;
  primaryCategoryExact: boolean;
  acceptedCategoryMatch: boolean;
  source: LocationMatchDetail;
  target: LocationMatchDetail;
}

type CandidateMatch = FindingMatch;

export interface FindingMatchingResult {
  matches: FindingMatch[];
  unmatchedExpectedIndexes: number[];
  unmatchedPredictedIndexes: number[];
}

export function matchFindings(
  expected: ExpectedEvaluationFinding[],
  predicted: PredictedEvaluationFinding[],
  toleranceLines: number,
): FindingMatchingResult {
  const candidates = predicted.map((prediction, predictedIndex) =>
    expected
      .map((groundTruth, expectedIndex) =>
        buildCandidate(groundTruth, prediction, expectedIndex, predictedIndex, toleranceLines),
      )
      .filter((candidate): candidate is CandidateMatch => candidate !== undefined)
      .sort(compareCandidates),
  );

  const predictionOrder = predicted
    .map((_value, index) => index)
    .sort((left, right) => {
      const candidateCount = candidates[left].length - candidates[right].length;
      if (candidateCount !== 0) return candidateCount;
      const strongestLeft = candidates[left][0]?.score ?? -1;
      const strongestRight = candidates[right][0]?.score ?? -1;
      return strongestRight - strongestLeft || left - right;
    });
  const expectedToPrediction = new Map<number, number>();

  const augment = (predictedIndex: number, visited: Set<number>): boolean => {
    for (const candidate of candidates[predictedIndex]) {
      if (visited.has(candidate.expectedIndex)) continue;
      visited.add(candidate.expectedIndex);
      const incumbent = expectedToPrediction.get(candidate.expectedIndex);
      if (incumbent === undefined || augment(incumbent, visited)) {
        expectedToPrediction.set(candidate.expectedIndex, predictedIndex);
        return true;
      }
    }
    return false;
  };

  for (const predictedIndex of predictionOrder) augment(predictedIndex, new Set<number>());

  const matches = [...expectedToPrediction.entries()]
    .map(([expectedIndex, predictedIndex]) =>
      candidates[predictedIndex].find((candidate) => candidate.expectedIndex === expectedIndex),
    )
    .filter((candidate): candidate is CandidateMatch => candidate !== undefined)
    .sort((left, right) => left.expectedIndex - right.expectedIndex);
  const matchedExpected = new Set(matches.map((match) => match.expectedIndex));
  const matchedPredicted = new Set(matches.map((match) => match.predictedIndex));

  return {
    matches,
    unmatchedExpectedIndexes: expected
      .map((_value, index) => index)
      .filter((index) => !matchedExpected.has(index)),
    unmatchedPredictedIndexes: predicted
      .map((_value, index) => index)
      .filter((index) => !matchedPredicted.has(index)),
  };
}

function buildCandidate(
  expected: ExpectedEvaluationFinding,
  predicted: PredictedEvaluationFinding,
  expectedIndex: number,
  predictedIndex: number,
  toleranceLines: number,
): CandidateMatch | undefined {
  const primaryCategoryExact = expected.category === predicted.category;
  const acceptedCategoryMatch = expected.acceptedCategories?.includes(predicted.category) ?? false;
  if (!primaryCategoryExact && !acceptedCategoryMatch) return undefined;

  const source = compareLocation(expected.sourceLocation, predicted.sourceLocation, toleranceLines);
  const target = compareLocation(expected.targetLocation, predicted.targetLocation, toleranceLines);
  if (!source.compatible || !target.compatible) return undefined;
  if (!expected.sourceLocation && !expected.targetLocation && !expected.allowCategoryOnly) return undefined;

  return {
    expectedIndex,
    predictedIndex,
    primaryCategoryExact,
    acceptedCategoryMatch,
    source,
    target,
    score:
      (primaryCategoryExact ? 100 : 50) +
      locationScore(source) +
      locationScore(target),
  };
}

export function compareLocation(
  expected: EvaluationLocation | undefined,
  predicted: EvaluationLocation | undefined,
  toleranceLines: number,
): LocationMatchDetail {
  if (!expected) return { comparable: false, exact: false, compatible: true };
  if (!predicted || normalizePath(expected.file) !== normalizePath(predicted.file)) {
    return { comparable: true, exact: false, compatible: false };
  }
  const exact =
    expected.startLine === predicted.startLine && expected.endLine === predicted.endLine;
  const overlaps =
    expected.startLine <= predicted.endLine && predicted.startLine <= expected.endLine;
  const gap =
    predicted.endLine < expected.startLine
      ? expected.startLine - predicted.endLine
      : expected.endLine < predicted.startLine
        ? predicted.startLine - expected.endLine
        : 0;
  return {
    comparable: true,
    exact,
    compatible: overlaps || gap <= toleranceLines,
  };
}

function locationScore(detail: LocationMatchDetail): number {
  if (!detail.comparable) return 0;
  return detail.exact ? 20 : detail.compatible ? 10 : 0;
}

function compareCandidates(left: CandidateMatch, right: CandidateMatch): number {
  return right.score - left.score || left.expectedIndex - right.expectedIndex;
}
