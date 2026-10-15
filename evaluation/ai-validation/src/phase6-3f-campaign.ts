import { basename } from 'path';
import type { RunIdentity } from './multiday-checkpoint';
import { PHASE6_3E } from './phase6-3e-campaign';
import { PHASE6_3F_RUN_ID, providerFailurePolicySchema } from './provider-failure-policy';

export const PHASE6_3F = Object.freeze({ ...PHASE6_3E, runId: PHASE6_3F_RUN_ID });

export function assertPhase63fIdentity(directory: string, identity: RunIdentity): void {
  const isCampaign = basename(directory) === PHASE6_3F.runId;
  if (!isCampaign && !identity.providerFailurePolicy) return;
  if (
    !isCampaign ||
    !identity.providerFailurePolicy ||
    providerFailurePolicySchema.validate(identity.providerFailurePolicy, { convert: false })
      .error ||
    identity.provider !== 'gemini' ||
    identity.model !== PHASE6_3F.model ||
    identity.provenancePolicy?.version !== 1 ||
    identity.provenancePolicy.expectedModelVersion !== PHASE6_3F.expectedModelVersion ||
    !PHASE6_3F.datasetSha256.includes(identity.datasetSha256) ||
    identity.promptVersion !== PHASE6_3F.promptVersion ||
    identity.failFast ||
    Object.entries(PHASE6_3F.settings).some(
      ([key, value]) => identity.settings[key as keyof typeof PHASE6_3F.settings] !== value,
    )
  )
    throw new Error(
      'Phase 6.3F requires its separate run ID, immutable provider failure policy, frozen model, provenance, dataset, prompt and settings',
    );
}
