import { AiValidatorError } from '../src/modules/validation/domain/ai-validator.error';
import {
  AiValidationInput,
  AiValidatorPort,
} from '../src/modules/validation/domain/ai-validator.port';
import {
  ValidationFindingCategory,
  ValidationFindingSeverity,
} from '../src/modules/validation/domain/validation-finding.types';
import { PrepareAiValidationContextService } from '../src/modules/validation/application/prepare-ai-validation-context.service';
import {
  assertLiveProviderOptIn,
  runLiveBenchmark,
  selectLiveCases,
} from '../evaluation/ai-validation/src/live-runner';
import { AiEvaluationDataset } from '../evaluation/ai-validation/src/evaluation.types';

describe('AI evaluation live runner safeguards', () => {
  const dataset: AiEvaluationDataset = {
    datasetId: 'live-test',
    version: '1.0.0',
    type: 'synthetic-curated',
    description: 'Synthetic live-run test.',
    caseCount: 2,
    creationMethodology: 'Test fixture.',
    limitations: ['Test only.'],
    cases: [
      {
        caseId: 'case-1',
        title: 'First',
        description: 'First synthetic case.',
        sourceFiles: [{ path: 'FIRST.cbl', content: 'DISPLAY TOTAL' }],
        targetFiles: [{ path: 'First.java', content: 'show(total);' }],
        expectedFindings: [],
        isClean: true,
        difficulty: 'EASY',
        tags: [],
      },
      {
        caseId: 'case-2',
        title: 'Second',
        description: 'Second synthetic case.',
        sourceFiles: [{ path: 'SECOND.cbl', content: 'DISPLAY TOTAL' }],
        targetFiles: [{ path: 'Second.java', content: 'show(total);' }],
        expectedFindings: [],
        isClean: true,
        difficulty: 'EASY',
        tags: [],
      },
    ],
  };
  const prepareContext = {
    execute: jest.fn(
      (context: {
        conversionJobId: string;
        sourceFiles: Array<{ path: string; content: string }>;
        targetFiles: Array<{ path: string; content: string }>;
      }) => ({
        input: {
          conversionJobId: context.conversionJobId,
          sourceFiles: context.sourceFiles.map((file) => ({ ...file, lineCount: 1 })),
          targetFiles: context.targetFiles.map((file) => ({ ...file, lineCount: 1 })),
        } satisfies AiValidationInput,
        redactionCount: 0,
        selectedFileCount: 2,
        inputCharacterCount: 10,
      }),
    ),
  } as unknown as PrepareAiValidationContextService;

  it('requires both environment and CLI opt-in before a live call can be considered', () => {
    expect(() => assertLiveProviderOptIn({}, true)).toThrow('Live evaluation refused');
    expect(() => assertLiveProviderOptIn({ AI_EVAL_ALLOW_LIVE_PROVIDER: 'true' }, false)).toThrow(
      'Live evaluation refused',
    );
    expect(() =>
      assertLiveProviderOptIn({ AI_EVAL_ALLOW_LIVE_PROVIDER: 'true' }, true),
    ).not.toThrow();
  });

  it('requires an explicit bounded selection or --all', () => {
    expect(() => selectLiveCases(dataset, {})).toThrow('Choose exactly one');
    expect(selectLiveCases(dataset, { caseId: 'case-2' }).map((value) => value.caseId)).toEqual([
      'case-2',
    ]);
    expect(selectLiveCases(dataset, { limit: 1 }).map((value) => value.caseId)).toEqual(['case-1']);
    expect(selectLiveCases(dataset, { all: true })).toHaveLength(2);
    expect(() => selectLiveCases(dataset, { limit: 1, all: true })).toThrow('Choose exactly one');
  });

  it('records provider failures separately and continues by default', async () => {
    const validator: AiValidatorPort = {
      getMetadata: () => ({
        provider: 'mock-provider',
        model: 'mock-model',
        promptVersion: 'semantic-cobol-java-v1',
      }),
      validate: jest
        .fn()
        .mockRejectedValueOnce(new AiValidatorError('AI_PROVIDER_TIMEOUT', 'AI provider timed out'))
        .mockResolvedValueOnce({
          findings: [
            {
              category: ValidationFindingCategory.LOGIC_MISMATCH,
              severity: ValidationFindingSeverity.HIGH,
              title: 'Synthetic finding',
              explanation: 'Synthetic explanation.',
            },
          ],
        }),
    };
    const predictions = await runLiveBenchmark({
      dataset,
      selectedCases: dataset.cases,
      validator,
      prepareContext,
      failFast: false,
      now: () => new Date('2026-09-25T00:00:00.000Z'),
    });
    expect(predictions.cases.map((result) => result.status)).toEqual([
      'PROVIDER_FAILED',
      'SUCCESS',
    ]);
    expect(predictions.cases[0].failure).toEqual({
      code: 'AI_PROVIDER_TIMEOUT',
      message: 'AI provider timed out',
    });
    expect(JSON.stringify(predictions)).not.toContain('DISPLAY TOTAL');
  });

  it('stops after the first failure when fail-fast is requested', async () => {
    const validator: AiValidatorPort = {
      getMetadata: () => ({ provider: 'mock', model: 'mock', promptVersion: 'mock' }),
      validate: jest.fn().mockRejectedValue(new Error('sensitive raw failure')),
    };
    const predictions = await runLiveBenchmark({
      dataset,
      selectedCases: dataset.cases,
      validator,
      prepareContext,
      failFast: true,
    });
    expect(predictions.cases).toHaveLength(1);
    expect(predictions.cases[0]).toEqual(
      expect.objectContaining({
        status: 'PROVIDER_FAILED',
        failure: {
          code: 'AI_PROVIDER_UNAVAILABLE',
          message: 'AI provider evaluation failed',
        },
      }),
    );
  });
});
