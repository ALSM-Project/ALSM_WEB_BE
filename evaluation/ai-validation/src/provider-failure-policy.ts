import * as Joi from 'joi';
import { sanitizeProviderDiagnostics } from '../../../src/modules/validation/domain/ai-provider-diagnostics';
import type { EvaluationPredictionCase } from './evaluation.types';
import type { RunIdentity } from './multiday-checkpoint';

export const PHASE6_3F_RUN_ID = 'phase6-3f-gemini36-reliability-v1';
export const PROVIDER_FAILURE_POLICY = Object.freeze({
  version: 1 as const,
  mode: 'CONTINUE_ON_TRANSIENT_PROVIDER_FAILURE' as const,
  runId: PHASE6_3F_RUN_ID,
});
export type ProviderFailurePolicy = typeof PROVIDER_FAILURE_POLICY;
export const providerFailurePolicySchema = Joi.object({
  version: Joi.valid(1).required(),
  mode: Joi.valid(PROVIDER_FAILURE_POLICY.mode).required(),
  runId: Joi.valid(PHASE6_3F_RUN_ID).required(),
}).unknown(false);

/** Only exhausted infrastructure errors without a model observation are eligible.
 * Short-window/unknown 429 are deliberately excluded in policy v1.
 */
export function isContinuableProviderFailure(
  identity: RunIdentity,
  result: EvaluationPredictionCase,
): boolean {
  const p = result.modelProvenance;
  const d = result.failure?.diagnostics;
  if (
    !identity.providerFailurePolicy ||
    providerFailurePolicySchema.validate(identity.providerFailurePolicy, { convert: false })
      .error ||
    result.status !== 'PROVIDER_FAILED' ||
    p?.status !== 'UNKNOWN' ||
    p.observedModelVersion !== undefined ||
    p.requestedModel !== identity.model ||
    !d ||
    !sanitizeProviderDiagnostics(d) ||
    !d.retriesExhausted ||
    d.attempts !== identity.settings.AI_MAX_RETRIES + 1 ||
    d.rateLimitScope !== undefined
  )
    return false;
  if (d.finalFailureClass === 'SERVER_ERROR')
    return (
      result.failure?.code === 'AI_PROVIDER_UNAVAILABLE' &&
      d.httpStatus !== undefined &&
      d.httpStatus >= 500 &&
      d.httpStatus <= 599
    );
  if (d.finalFailureClass === 'NETWORK_ERROR')
    return result.failure?.code === 'AI_PROVIDER_UNAVAILABLE' && d.httpStatus === undefined;
  if (d.finalFailureClass === 'TIMEOUT')
    return result.failure?.code === 'AI_PROVIDER_TIMEOUT' && d.httpStatus === undefined;
  return false;
}

/** Shared by append, resume, CLI and final materialization. Legacy rules stay strict. */
export function requiresProvenanceReview(
  identity: RunIdentity,
  result: EvaluationPredictionCase,
): boolean {
  return (
    !!identity.provenancePolicy &&
    (result.modelProvenance?.status !== 'CONFIRMED' ||
      (!!identity.providerFailurePolicy && result.status !== 'SUCCESS')) &&
    !isContinuableProviderFailure(identity, result)
  );
}
