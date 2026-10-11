import { basename } from 'path';
import type { RunIdentity } from './multiday-checkpoint';

/** Configuration for a future approved run, not permission to execute it. */
export const PHASE6_3E = Object.freeze({
  runId: 'phase6-3e-gemini36-v1',
  model: 'gemini-3.6-flash',
  expectedModelVersion: 'gemini-3.6-flash',
  datasetSha256: 'bf51ea1f968a877c2b6393103c2a558d704d6e998f73d23de5086eab703c513e',
  promptVersion: 'semantic-cobol-java-v1',
  settings: Object.freeze({
    AI_MAX_RETRIES: 2,
    AI_TIMEOUT_MS: 60000,
    AI_MAX_FINDINGS: 50,
    GEMINI_MIN_REQUEST_INTERVAL_MS: 13000,
    AI_MAX_FILES: 50,
    AI_MAX_FILE_CHARS: 200000,
    AI_MAX_TOTAL_CHARS: 500000,
  }),
});

export function assertPhase63eIdentity(directory: string, identity: RunIdentity): void {
  if (basename(directory) !== PHASE6_3E.runId) return;
  if (
    identity.model !== PHASE6_3E.model ||
    identity.provenancePolicy?.expectedModelVersion !== PHASE6_3E.expectedModelVersion ||
    identity.datasetSha256 !== PHASE6_3E.datasetSha256 ||
    identity.promptVersion !== PHASE6_3E.promptVersion ||
    identity.failFast ||
    Object.entries(PHASE6_3E.settings).some(
      ([key, value]) => identity.settings[key as keyof typeof PHASE6_3E.settings] !== value,
    )
  )
    throw new Error(
      'Phase 6.3E requires its frozen explicit model, provenance policy, dataset, prompt and execution settings',
    );
}
