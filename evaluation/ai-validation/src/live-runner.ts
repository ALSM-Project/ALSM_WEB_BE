import { BadRequestException } from '@nestjs/common';
import { AiValidatorError } from '../../../src/modules/validation/domain/ai-validator.error';
import {
  AiValidatorPort,
  AiValidationFindingDraft,
} from '../../../src/modules/validation/domain/ai-validator.port';
import { ConversionType } from '../../../src/modules/projects/domain/project.types';
import { PrepareAiValidationContextService } from '../../../src/modules/validation/application/prepare-ai-validation-context.service';
import {
  AiEvaluationCase,
  AiEvaluationDataset,
  AiEvaluationPredictions,
  DEFAULT_LOCATION_TOLERANCE_LINES,
  EVALUATION_CATEGORIES,
  EVALUATOR_VERSION,
  EvaluationPredictionCase,
  MATCHING_POLICY_VERSION,
  PredictedEvaluationFinding,
} from './evaluation.types';

export interface LiveRunSelection {
  caseId?: string;
  limit?: number;
  all?: boolean;
}

export interface LiveRunOptions {
  dataset: AiEvaluationDataset;
  selectedCases: AiEvaluationCase[];
  validator: AiValidatorPort;
  prepareContext: PrepareAiValidationContextService;
  failFast: boolean;
  now?: () => Date;
}

export function assertLiveProviderOptIn(
  environment: NodeJS.ProcessEnv,
  allowLiveProviderFlag: boolean,
): void {
  if (environment.AI_EVAL_ALLOW_LIVE_PROVIDER !== 'true' || !allowLiveProviderFlag) {
    throw new Error(
      'Live evaluation refused: require AI_EVAL_ALLOW_LIVE_PROVIDER=true and --allow-live-provider',
    );
  }
}

export function selectLiveCases(
  dataset: AiEvaluationDataset,
  selection: LiveRunSelection,
): AiEvaluationCase[] {
  const modes = [
    selection.caseId !== undefined,
    selection.limit !== undefined,
    selection.all === true,
  ];
  if (modes.filter(Boolean).length !== 1) {
    throw new Error('Choose exactly one live-run scope: --case, --limit, or --all');
  }
  if (selection.caseId) {
    const benchmarkCase = dataset.cases.find((candidate) => candidate.caseId === selection.caseId);
    if (!benchmarkCase) throw new Error(`Unknown benchmark case ${selection.caseId}`);
    return [benchmarkCase];
  }
  if (selection.limit !== undefined) {
    if (
      !Number.isInteger(selection.limit) ||
      selection.limit < 1 ||
      selection.limit > dataset.cases.length
    ) {
      throw new Error(`--limit must be an integer from 1 to ${dataset.cases.length}`);
    }
    return dataset.cases.slice(0, selection.limit);
  }
  return dataset.cases;
}

export async function runLiveBenchmark(options: LiveRunOptions): Promise<AiEvaluationPredictions> {
  const metadata = options.validator.getMetadata();
  const results: EvaluationPredictionCase[] = [];

  for (const benchmarkCase of options.selectedCases) {
    const startedAt = Date.now();
    try {
      const prepared = options.prepareContext.execute({
        conversionJobId: `ai-evaluation:${benchmarkCase.caseId}`,
        organizationId: 'synthetic-evaluation',
        projectId: 'synthetic-evaluation',
        conversionType: ConversionType.COBOL_TO_JAVA,
        sourceFiles: benchmarkCase.sourceFiles,
        targetFiles: benchmarkCase.targetFiles,
      });
      const result = await options.validator.validate(prepared.input);
      results.push({
        caseId: benchmarkCase.caseId,
        status: 'SUCCESS',
        latencyMs: Date.now() - startedAt,
        findings: result.findings.map(toPredictionFinding),
      });
    } catch (error) {
      results.push({
        caseId: benchmarkCase.caseId,
        status: classifyFailure(error),
        latencyMs: Date.now() - startedAt,
        failure: sanitizeFailure(error),
      });
      if (options.failFast) break;
    }
  }

  return {
    datasetId: options.dataset.datasetId,
    datasetVersion: options.dataset.version,
    evaluatorVersion: EVALUATOR_VERSION,
    generatedAt: (options.now ?? (() => new Date()))().toISOString(),
    provider: metadata.provider,
    model: metadata.model,
    promptVersion: metadata.promptVersion,
    locationToleranceLines: DEFAULT_LOCATION_TOLERANCE_LINES,
    matchingPolicyVersion: MATCHING_POLICY_VERSION,
    cases: results,
  };
}

function toPredictionFinding(finding: AiValidationFindingDraft): PredictedEvaluationFinding {
  if (!EVALUATION_CATEGORIES.some((category) => category === finding.category)) {
    throw new AiValidatorError(
      'AI_PROVIDER_RESPONSE_INVALID',
      'AI provider returned a category outside the evaluation contract',
    );
  }
  return {
    category: finding.category as PredictedEvaluationFinding['category'],
    severity: finding.severity,
    title: finding.title,
    explanation: finding.explanation,
    ...(finding.sourceLocation?.file &&
    finding.sourceLocation.startLine !== undefined &&
    finding.sourceLocation.endLine !== undefined
      ? {
          sourceLocation: {
            file: finding.sourceLocation.file,
            startLine: finding.sourceLocation.startLine,
            endLine: finding.sourceLocation.endLine,
          },
        }
      : {}),
    ...(finding.targetLocation?.file &&
    finding.targetLocation.startLine !== undefined &&
    finding.targetLocation.endLine !== undefined
      ? {
          targetLocation: {
            file: finding.targetLocation.file,
            startLine: finding.targetLocation.startLine,
            endLine: finding.targetLocation.endLine,
          },
        }
      : {}),
    ...(finding.confidence === undefined ? {} : { confidence: finding.confidence }),
  };
}

function classifyFailure(error: unknown): EvaluationPredictionCase['status'] {
  if (error instanceof AiValidatorError) {
    return error.code === 'AI_PROVIDER_RESPONSE_INVALID' ? 'INVALID_OUTPUT' : 'PROVIDER_FAILED';
  }
  if (error instanceof BadRequestException) return 'VALIDATION_FAILED';
  return 'PROVIDER_FAILED';
}

function sanitizeFailure(error: unknown): { code: string; message: string } {
  if (error instanceof AiValidatorError) return { code: error.code, message: error.message };
  if (error instanceof BadRequestException) {
    const response = error.getResponse();
    if (typeof response === 'object' && response !== null) {
      const code = 'code' in response ? String(response.code) : 'VALIDATION_FAILED';
      const message =
        'message' in response ? String(response.message) : 'Context preparation failed';
      return { code, message };
    }
    return { code: 'VALIDATION_FAILED', message: 'Context preparation failed' };
  }
  return { code: 'AI_PROVIDER_UNAVAILABLE', message: 'AI provider evaluation failed' };
}
