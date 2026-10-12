import * as Joi from 'joi';
import {
  AI_RESPONSE_METADATA,
  safeGeminiModelVersion,
  WithAiResponseMetadata,
} from '../../../src/modules/validation/domain/ai-response-metadata';
import type { AiEvaluationDataset, AiEvaluationPredictions } from './evaluation.types';
import { providerFailurePolicySchema, requiresProvenanceReview } from './provider-failure-policy';
import { PHASE6_3F } from './phase6-3f-campaign';

export interface ProvenancePolicy {
  version: 1;
  expectedModelVersion: string;
}
export interface ModelProvenance {
  version: 1;
  requestedModel: string;
  observedModelVersion?: string;
  status: 'UNKNOWN' | 'CONFIRMED' | 'MISMATCH';
}
const model = () =>
  Joi.string()
    .max(128)
    .pattern(/^gemini-[a-z0-9]+(?:[.-][a-z0-9]+)*$/);
export const provenancePolicySchema = Joi.object({
  version: Joi.valid(1).required(),
  expectedModelVersion: model().required(),
}).unknown(false);
export const modelProvenanceSchema = Joi.object({
  version: Joi.valid(1).required(),
  requestedModel: model().required(),
  observedModelVersion: model(),
  status: Joi.valid('UNKNOWN', 'CONFIRMED', 'MISMATCH').required(),
}).unknown(false);

export function captureProvenance(
  requestedModel: string,
  policy: ProvenancePolicy,
  response?: WithAiResponseMetadata,
): ModelProvenance {
  const metadata = response?.[AI_RESPONSE_METADATA];
  const observedModelVersion = safeGeminiModelVersion(metadata?.modelVersion);
  const actualRequestedModel = safeGeminiModelVersion(metadata?.requestedModel) ?? requestedModel;
  return {
    version: 1,
    requestedModel: actualRequestedModel,
    ...(observedModelVersion ? { observedModelVersion } : {}),
    status: !observedModelVersion
      ? 'UNKNOWN'
      : actualRequestedModel === requestedModel &&
          observedModelVersion === policy.expectedModelVersion
        ? 'CONFIRMED'
        : 'MISMATCH',
  };
}

/** Recompute claims rather than trusting stored status flags. No historic backfill. */
export function validateProvenance(predictions: AiEvaluationPredictions): void {
  const policy = predictions.provenancePolicy;
  if (
    predictions.providerFailurePolicy &&
    (providerFailurePolicySchema.validate(predictions.providerFailurePolicy, { convert: false })
      .error ||
      !policy ||
      predictions.provider !== 'gemini' ||
      predictions.model !== PHASE6_3F.model ||
      policy.expectedModelVersion !== PHASE6_3F.expectedModelVersion ||
      predictions.promptVersion !== PHASE6_3F.promptVersion)
  )
    throw new Error('Invalid provider failure policy provenance');
  if (!policy) {
    if (predictions.cases.some((c) => c.modelProvenance))
      throw new Error('Model provenance requires a versioned policy');
    return;
  }
  if (
    predictions.provider !== 'gemini' ||
    provenancePolicySchema.validate(policy, { convert: false }).error
  )
    throw new Error('Invalid provenance policy');
  for (const result of predictions.cases) {
    const p = result.modelProvenance;
    if (!p || modelProvenanceSchema.validate(p, { convert: false }).error)
      throw new Error('Invalid per-case model provenance');
    const expected = !p.observedModelVersion
      ? 'UNKNOWN'
      : p.requestedModel === predictions.model &&
          p.observedModelVersion === policy.expectedModelVersion
        ? 'CONFIRMED'
        : 'MISMATCH';
    if (p.status !== expected) throw new Error('Inconsistent model provenance status');
  }
}

/** Final reports must enforce the same policy as checkpoint materialization.
 * Stored review evidence uses validateProvenance without this final-output gate.
 */
export function validateFinalProvenance(predictions: AiEvaluationPredictions): void {
  validateProvenance(predictions);
  if (!predictions.providerFailurePolicy) return;
  const identity = {
    model: predictions.model,
    provenancePolicy: predictions.provenancePolicy,
    providerFailurePolicy: predictions.providerFailurePolicy,
    settings: PHASE6_3F.settings,
  };
  if (predictions.cases.some((result) => requiresProvenanceReview(identity, result)))
    throw new Error('PROVENANCE_REVIEW: provider failure policy forbids final predictions');
}

export function summarizeProvenance(
  dataset: AiEvaluationDataset,
  predictions: AiEvaluationPredictions,
) {
  validateFinalProvenance(predictions);
  const cases = dataset.cases.map(({ caseId }) => {
    const result = predictions.cases.find((c) => c.caseId === caseId);
    return {
      caseId,
      requestedModel: result?.modelProvenance?.requestedModel ?? predictions.model,
      observedModelVersion: result?.modelProvenance?.observedModelVersion,
      status: result?.modelProvenance?.status ?? ('UNKNOWN' as const),
    };
  });
  const confirmed = cases.filter((c) => c.status === 'CONFIRMED').length;
  const mismatch = cases.filter((c) => c.status === 'MISMATCH').length;
  return {
    version: 1 as const,
    verifiedSingleModelCohort:
      confirmed === dataset.caseCount && predictions.cases.length === dataset.caseCount,
    confirmed,
    mismatch,
    unknown: cases.length - confirmed - mismatch,
    expectedModelVersion: predictions.provenancePolicy?.expectedModelVersion,
    cases,
  };
}
