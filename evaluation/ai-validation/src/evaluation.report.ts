import { EvaluationScore } from './evaluation.scorer';

export function renderEvaluationReport(score: EvaluationScore): string {
  const successful = score.successfulCases.micro;
  const conservative = score.conservative.micro;
  const lines = [
    '# ALSM AI Validation Evaluation',
    '',
    score.metadata.provider.startsWith('sample')
      ? '> SAMPLE / TEST PREDICTIONS ONLY — this is not a real model benchmark.'
      : '> AI findings and benchmark labels remain advisory and require human review.',
    '',
    '## Run metadata',
    '',
    `- Dataset: \`${score.metadata.datasetId}\` \`${score.metadata.datasetVersion}\``,
    `- Evaluator: \`${score.metadata.evaluatorVersion}\``,
    `- Matching policy: \`${score.metadata.matchingPolicyVersion}\``,
    `- Provider/model: \`${score.metadata.provider}\` / \`${score.metadata.model}\``,
    `- Prompt: \`${score.metadata.promptVersion}\``,
    `- Generated at: ${score.metadata.generatedAt}`,
    `- Location tolerance: ±${score.metadata.locationToleranceLines} lines`,
    '',
    '## Detection metrics',
    '',
    '| Population | TP | FP | FN | Precision | Recall | F1 |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    metricRow('Successful cases', successful),
    metricRow('Conservative end-to-end', conservative),
    '',
    `Successful cases exclude ${score.execution.failedCases + score.execution.missingCases} failed or missing case results. Conservative metrics count every expected finding in those cases as missed.`,
    '',
    '## Operational and trust metrics',
    '',
    `- Execution: ${score.execution.successfulCases}/${score.execution.totalCases} successful, ${score.execution.failedCases} failed, ${score.execution.missingCases} missing.`,
    `- Clean-case false-positive rate: ${percent(score.cleanCases.cleanCaseFalsePositiveRate)} (${score.cleanCases.cleanCasesWithAnyPrediction}/${score.cleanCases.successfulCleanCases}); ${score.cleanCases.totalFindingsOnCleanCases} total findings on clean cases.`,
    `- Mutation detection rate (successful cases): ${percent(score.mutationDetection.successful.mutationDetectionRate)} (${score.mutationDetection.successful.mutatedCasesDetected}/${score.mutationDetection.successful.mutatedCases}).`,
    `- Mutation detection rate (conservative): ${percent(score.mutationDetection.conservative.mutationDetectionRate)} (${score.mutationDetection.conservative.mutatedCasesDetected}/${score.mutationDetection.conservative.mutatedCases}).`,
    `- Per-mutation detection: ${percent(score.mutationDetection.mutations.detectionRate)} (${score.mutationDetection.mutations.detected}/${score.mutationDetection.mutations.total}).`,
    `- Severity agreement: ${percent(score.severityAgreement.severityAgreementRate)} (${score.severityAgreement.exactMatches}/${score.severityAgreement.totalMatchedFindings} matched findings).`,
    `- Primary-category exact agreement: ${percent(score.categoryAgreement.primaryCategoryExactRate)} (${score.categoryAgreement.primaryCategoryExactMatches}/${score.categoryAgreement.totalMatchedFindings}); ${score.categoryAgreement.acceptedCategoryMatches} alias matches.`,
    `- Exact/tolerant source location agreement: ${percent(score.locationAgreement.source.exactRate)} / ${percent(score.locationAgreement.source.tolerantRate)} over ${score.locationAgreement.source.comparable} comparable matches.`,
    `- Exact/tolerant target location agreement: ${percent(score.locationAgreement.target.exactRate)} / ${percent(score.locationAgreement.target.tolerantRate)} over ${score.locationAgreement.target.comparable} comparable matches.`,
    '',
    '## Per-category successful-case metrics',
    '',
    '| Category | Expected | Predicted | TP | FP | FN | Precision | Recall | F1 |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...score.successfulCases.categories.map(
      (metric) =>
        `| ${metric.category} | ${metric.expectedCount} | ${metric.predictedCount} | ${metric.truePositives} | ${metric.falsePositives} | ${metric.falseNegatives} | ${percent(metric.precision)} | ${percent(metric.recall)} | ${percent(metric.f1)} |`,
    ),
    '',
    `Macro averages include categories with expected support: ${score.successfulCases.macro.includedCategories.join(', ') || 'none'}. Precision ${percent(score.successfulCases.macro.precision)}, recall ${percent(score.successfulCases.macro.recall)}, F1 ${percent(score.successfulCases.macro.f1)}.`,
    '',
    '## Case results',
    '',
    '| Case | Kind | Status | Expected | Predicted | TP | FP | FN |',
    '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |',
    ...score.cases.map(
      (benchmarkCase) =>
        `| ${benchmarkCase.caseId} | ${benchmarkCase.kind} | ${benchmarkCase.status} | ${benchmarkCase.expectedCount} | ${benchmarkCase.predictedCount} | ${benchmarkCase.truePositives} | ${benchmarkCase.falsePositives} | ${benchmarkCase.falseNegatives} |`,
    ),
    '',
    '## Interpretation limits',
    '',
    'High precision means fewer false positives reach reviewers; high recall means fewer known synthetic defects are missed. F1 balances the two. Severity agreement measures classification consistency, not detection quality. Clean-case false-positive rate measures how often equivalent fixtures receive any finding. Mutation detection rate measures whether intentionally injected mutations receive at least one valid match.',
    '',
    'No metric here proves total semantic equivalence. This synthetic curated set is small, labels can be subjective, models may be nondeterministic, and no claim is made that a foundation model has never seen similar patterns.',
    '',
  ];
  return lines.join('\n');
}

function metricRow(
  label: string,
  metric: { truePositives: number; falsePositives: number; falseNegatives: number; precision: number; recall: number; f1: number },
): string {
  return `| ${label} | ${metric.truePositives} | ${metric.falsePositives} | ${metric.falseNegatives} | ${percent(metric.precision)} | ${percent(metric.recall)} | ${percent(metric.f1)} |`;
}

function percent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}
