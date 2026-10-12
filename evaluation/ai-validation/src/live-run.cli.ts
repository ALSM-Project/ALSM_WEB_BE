import { mkdirSync, writeFileSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { PrepareAiValidationContextService } from '../../../src/modules/validation/application/prepare-ai-validation-context.service';
import { ValidationSecretRedactorService } from '../../../src/modules/validation/application/validation-secret-redactor.service';
import { readJson } from './evaluation.io';
import { assertLiveProviderOptIn, runLiveBenchmark, selectLiveCases } from './live-runner';
import { createLiveValidator } from './live-validator.factory';
import { validateDataset } from './evaluation.validator';
import { runMultidayBenchmark } from './multiday-runner';
import { assertLegacyOutputOutsideMultiday, checkpointLocation } from './multiday-store';
import { provenancePolicySchema } from './model-provenance';
import {
  PROVIDER_FAILURE_POLICY,
  requiresProvenanceReview,
  isContinuableProviderFailure,
} from './provider-failure-policy';
import { Checkpoint } from './multiday-checkpoint';

interface LiveCliArguments {
  continueOnTransientProviderFailure?: boolean;
  expectedModelVersion?: string;
  dataset?: string;
  output?: string;
  caseId?: string;
  limit?: number;
  all: boolean;
  allowLiveProvider: boolean;
  failFast: boolean;
  checkpoint?: string;
  resume: boolean;
  confirmNewQuotaWindow: boolean;
  maxNewCases?: number;
}

export async function main(
  values = process.argv.slice(2),
  environment: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const args = parseLiveArguments(values);
  assertLiveProviderOptIn(environment, args.allowLiveProvider);
  if (!args.dataset || !args.output) throw new Error('Live run requires --dataset and --output');
  if (!args.checkpoint) assertLegacyOutputOutsideMultiday(args.output);
  else checkpointLocation(args.checkpoint, args.output);
  const dataset = validateDataset(readJson(args.dataset));
  const selectedCases = selectLiveCases(dataset, {
    caseId: args.caseId,
    limit: args.limit,
    all: args.all,
  });
  const { config, validator } = createLiveValidator(environment);
  const prepareContext = new PrepareAiValidationContextService(
    new ValidationSecretRedactorService(),
    config,
  );
  if (args.checkpoint) {
    const checkpoint = await runMultidayBenchmark({
      dataset,
      datasetBytes: readFileSync(args.dataset),
      validator,
      config,
      prepareContext,
      failFast: args.failFast,
      checkpoint: args.checkpoint,
      output: args.output,
      resume: args.resume,
      confirmNewQuotaWindow: args.confirmNewQuotaWindow,
      maxNewCases: args.maxNewCases,
      ...(args.continueOnTransientProviderFailure
        ? { providerFailurePolicy: PROVIDER_FAILURE_POLICY }
        : {}),
      ...(args.expectedModelVersion
        ? {
            provenancePolicy: {
              version: 1,
              expectedModelVersion: args.expectedModelVersion,
            } as const,
          }
        : {}),
    });
    process.stdout.write(formatCheckpointSummary(checkpoint));
    if (checkpoint.identity.provenancePolicy) {
      if (checkpoint.results.some((r) => requiresProvenanceReview(checkpoint.identity, r)))
        throw new Error(
          'PROVENANCE_REVIEW: evidence saved; unverified model identity blocks continuation and final output',
        );
    }
    return;
  }
  const predictions = await runLiveBenchmark({
    dataset,
    selectedCases,
    validator,
    prepareContext,
    failFast: args.failFast,
  });
  const output = resolve(args.output);
  assertLegacyOutputOutsideMultiday(output);
  mkdirSync(output, { recursive: true });
  writeFileSync(
    resolve(output, 'predictions.json'),
    `${JSON.stringify(predictions, null, 2)}\n`,
    'utf8',
  );
  process.stdout.write(
    `Recorded ${predictions.cases.length} synthetic case results in ${resolve(output, 'predictions.json')}\n`,
  );
}

export function parseLiveArguments(values: string[]): LiveCliArguments {
  const result: LiveCliArguments = {
    all: false,
    allowLiveProvider: false,
    failFast: false,
    resume: false,
    confirmNewQuotaWindow: false,
  };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === '--all') result.all = true;
    else if (value === '--allow-live-provider') result.allowLiveProvider = true;
    else if (value === '--fail-fast') result.failFast = true;
    else if (value === '--resume') result.resume = true;
    else if (value === '--continue-on-transient-provider-failure')
      result.continueOnTransientProviderFailure = true;
    else if (value === '--confirm-new-quota-window') result.confirmNewQuotaWindow = true;
    else if (value === '--checkpoint') result.checkpoint = nextValue(values, ++index, value);
    else if (value === '--expected-model-version')
      result.expectedModelVersion = nextValue(values, ++index, value);
    else if (value === '--max-new-cases')
      result.maxNewCases = Number(nextValue(values, ++index, value));
    else if (value === '--dataset') result.dataset = nextValue(values, ++index, value);
    else if (value === '--output') result.output = nextValue(values, ++index, value);
    else if (value === '--case') result.caseId = nextValue(values, ++index, value);
    else if (value === '--limit') result.limit = Number(nextValue(values, ++index, value));
    else throw new Error(`Unknown live-run argument ${value}`);
  }
  if (result.checkpoint) {
    if (result.continueOnTransientProviderFailure && !result.expectedModelVersion)
      throw new Error('Provider failure policy requires --expected-model-version');
    if (
      result.expectedModelVersion &&
      provenancePolicySchema.validate(
        { version: 1, expectedModelVersion: result.expectedModelVersion },
        { convert: false },
      ).error
    )
      throw new Error('Invalid expected model version');
    if (!result.all || result.caseId !== undefined || result.limit !== undefined)
      throw new Error('Resumable mode requires --all and forbids --case/--limit');
    if (result.confirmNewQuotaWindow && !result.resume)
      throw new Error('Quota confirmation requires --resume');
    if (
      result.maxNewCases !== undefined &&
      (!Number.isInteger(result.maxNewCases) || result.maxNewCases < 1 || result.maxNewCases > 40)
    )
      throw new Error('--max-new-cases must be an integer from 1 to 40');
  } else if (
    result.resume ||
    result.confirmNewQuotaWindow ||
    result.maxNewCases !== undefined ||
    result.expectedModelVersion !== undefined ||
    result.continueOnTransientProviderFailure
  )
    throw new Error('Resume/session options require --checkpoint');
  return result;
}

function nextValue(values: string[], index: number, flag: string): string {
  const value = values[index];
  if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
  return value;
}

export function formatCheckpointSummary(cp: Checkpoint): string {
  const confirmed = cp.results.filter((r) => r.modelProvenance?.status === 'CONFIRMED').length;
  const mismatch = cp.results.filter((r) => r.modelProvenance?.status === 'MISMATCH').length;
  const unknown = cp.results.length - confirmed - mismatch;
  const success = cp.results.filter((r) => r.status === 'SUCCESS').length;
  const continuable = cp.results.filter((r) => isContinuableProviderFailure(cp.identity, r)).length;
  const blocked = cp.results.some((r) => requiresProvenanceReview(cp.identity, r));
  const verified =
    confirmed === 40 &&
    (!cp.identity.providerFailurePolicy ||
      (cp.state === 'COMPLETE' && cp.sessions.at(-1)?.stopReason === 'COMPLETE' && !blocked));
  return (
    `Resumable benchmark: ${cp.state}; ${cp.nextIndex}/40 terminal cases; ${cp.quotaEvents.length} quota pauses\n` +
    `Execution: ${success} SUCCESS; ${cp.results.filter((r) => r.status === 'PROVIDER_FAILED').length} PROVIDER_FAILED\n` +
    `Model provenance: ${confirmed}/${cp.nextIndex} confirmed; ${confirmed} CONFIRMED; ${unknown} UNKNOWN; ${mismatch} MISMATCH; completion is not model verification\n` +
    `Verified single-model cohort: ${verified ? 'YES' : 'NO — UNVERIFIED'}\n` +
    (continuable
      ? `${continuable} PROVIDER_FAILED UNKNOWN: continuable under immutable Phase 6.3F policy; failures remain failures\n`
      : '') +
    (blocked ? 'PROVENANCE_REVIEW: unapproved evidence blocks continuation and final output\n' : '')
  );
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Live evaluation failed'}\n`);
    process.exitCode = 1;
  });
}
