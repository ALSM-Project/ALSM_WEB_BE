import {
  ValidationFindingCategory,
  ValidationFindingSeverity,
} from '../src/modules/validation/domain/validation-finding.types';
import { AiEvaluationDataset } from '../evaluation/ai-validation/src/evaluation.types';
import {
  validateDataset,
  validatePredictions,
} from '../evaluation/ai-validation/src/evaluation.validator';

describe('AI evaluation validators', () => {
  const dataset = (): AiEvaluationDataset => ({
    datasetId: 'synthetic-test',
    version: '1.0.0',
    type: 'synthetic-curated',
    description: 'Synthetic validator fixture.',
    caseCount: 1,
    creationMethodology: 'Created for deterministic tests.',
    limitations: ['Not a production corpus.'],
    cases: [
      {
        caseId: 'case-1',
        title: 'Reversed condition',
        description: 'A synthetic condition mutation.',
        sourceFiles: [{ path: 'PROGRAM.cbl', content: 'IF TOTAL > 0\n  DISPLAY TOTAL' }],
        targetFiles: [{ path: 'Program.java', content: 'if (total <= 0) {\n  show(total);\n}' }],
        expectedFindings: [
          {
            findingId: 'finding-1',
            category: ValidationFindingCategory.LOGIC_MISMATCH,
            severity: ValidationFindingSeverity.HIGH,
            sourceLocation: { file: 'PROGRAM.cbl', startLine: 1, endLine: 1 },
            targetLocation: { file: 'Program.java', startLine: 1, endLine: 1 },
            description: 'The Java condition is reversed.',
            mutationId: 'mutation-1',
          },
        ],
        isClean: false,
        difficulty: 'MEDIUM',
        mutations: [
          {
            mutationId: 'mutation-1',
            operator: 'REVERSE_CONDITION',
            description: 'Changed greater-than to less-than-or-equal.',
            observableImpact: 'The opposite branch executes.',
          },
        ],
        tags: ['condition'],
      },
    ],
  });

  it('accepts a valid synthetic dataset and matching prediction metadata', () => {
    const validDataset = validateDataset(dataset());
    expect(
      validatePredictions(
        {
          datasetId: 'synthetic-test',
          datasetVersion: '1.0.0',
          evaluatorVersion: '1.0.0',
          generatedAt: '2026-09-25T00:00:00.000Z',
          provider: 'sample',
          model: 'sample',
          promptVersion: 'sample',
          locationToleranceLines: 2,
          matchingPolicyVersion: '1.0.0',
          cases: [{ caseId: 'case-1', status: 'SUCCESS', findings: [] }],
        },
        validDataset,
      ),
    ).toBeDefined();
  });

  it.each([
    [
      'duplicate case IDs',
      (value: AiEvaluationDataset) => value.cases.push(structuredClone(value.cases[0])),
    ],
    ['wrong case count', (value: AiEvaluationDataset) => (value.caseCount = 2)],
    [
      'duplicate file paths',
      (value: AiEvaluationDataset) =>
        value.cases[0].sourceFiles.push({ path: './PROGRAM.cbl', content: 'x' }),
    ],
    [
      'duplicate paths across source and target files',
      (value: AiEvaluationDataset) =>
        value.cases[0].targetFiles.push({ path: 'program.cbl', content: 'x' }),
    ],
    [
      'absolute Windows paths',
      (value: AiEvaluationDataset) => (value.cases[0].sourceFiles[0].path = 'C:\\PROGRAM.cbl'),
    ],
    [
      'expected finding on a clean case',
      (value: AiEvaluationDataset) => (value.cases[0].isClean = true),
    ],
    ['missing mutation metadata', (value: AiEvaluationDataset) => delete value.cases[0].mutations],
    [
      'unknown mutation reference',
      (value: AiEvaluationDataset) => (value.cases[0].expectedFindings[0].mutationId = 'missing'),
    ],
    [
      'nonexistent location file',
      (value: AiEvaluationDataset) =>
        (value.cases[0].expectedFindings[0].sourceLocation!.file = 'MISSING.cbl'),
    ],
    [
      'invalid line range',
      (value: AiEvaluationDataset) =>
        (value.cases[0].expectedFindings[0].sourceLocation!.endLine = 99),
    ],
  ])('rejects %s', (_name, mutate) => {
    const value = dataset();
    mutate(value);
    expect(() => validateDataset(value)).toThrow('Invalid dataset');
  });

  it('rejects category-only matching unless it is explicitly enabled', () => {
    const value = dataset();
    delete value.cases[0].expectedFindings[0].sourceLocation;
    delete value.cases[0].expectedFindings[0].targetLocation;
    expect(() => validateDataset(value)).toThrow('Invalid dataset');

    value.cases[0].expectedFindings[0].allowCategoryOnly = true;
    expect(validateDataset(value)).toBeDefined();
  });

  it.each([
    ['wrong dataset ID', { datasetId: 'wrong' }],
    ['wrong dataset version', { datasetVersion: '2.0.0' }],
    [
      'duplicate results',
      {
        cases: [
          { caseId: 'case-1', status: 'SUCCESS', findings: [] },
          { caseId: 'case-1', status: 'SUCCESS', findings: [] },
        ],
      },
    ],
    ['unknown case', { cases: [{ caseId: 'missing', status: 'SUCCESS', findings: [] }] }],
    [
      'failure represented as empty success',
      { cases: [{ caseId: 'case-1', status: 'PROVIDER_FAILED', findings: [] }] },
    ],
  ])('rejects predictions with %s', (_name, override) => {
    const value = {
      datasetId: 'synthetic-test',
      datasetVersion: '1.0.0',
      evaluatorVersion: '1.0.0',
      generatedAt: '2026-09-25T00:00:00.000Z',
      provider: 'sample',
      model: 'sample',
      promptVersion: 'sample',
      locationToleranceLines: 2,
      matchingPolicyVersion: '1.0.0',
      cases: [{ caseId: 'case-1', status: 'SUCCESS', findings: [] }],
      ...override,
    };
    expect(() => validatePredictions(value, validateDataset(dataset()))).toThrow(
      'Invalid predictions',
    );
  });
});
