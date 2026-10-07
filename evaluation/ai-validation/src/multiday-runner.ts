import { ConfigService } from '@nestjs/config';
import { LiveRunOptions, runLiveBenchmark } from './live-runner';
import { CheckpointStore, checkpointLocation } from './multiday-store';
import {
  Checkpoint,
  createRunIdentity,
  initialCheckpoint,
  isDailyQuota,
  safeTerminal,
  StopReason,
} from './multiday-checkpoint';

export interface MultidayOptions extends Omit<LiveRunOptions, 'selectedCases'> {
  config: ConfigService;
  datasetBytes: Buffer;
  checkpoint: string;
  output: string;
  resume: boolean;
  confirmNewQuotaWindow: boolean;
  maxNewCases?: number;
  projectRoot?: string;
}

export async function runMultidayBenchmark(options: MultidayOptions): Promise<Checkpoint> {
  const limit = options.maxNewCases ?? 40;
  if (!Number.isInteger(limit) || limit < 1 || limit > 40)
    throw new Error('--max-new-cases must be an integer from 1 to 40');
  const location = checkpointLocation(options.checkpoint, options.output, options.projectRoot);
  const identity = createRunIdentity(
    options.dataset,
    options.datasetBytes,
    options.validator.getMetadata(),
    options.config,
    location.storageFingerprint,
    options.failFast,
  );
  const store = CheckpointStore.acquire(
    options.checkpoint,
    options.output,
    options.dataset,
    identity,
    options.projectRoot,
  );
  const now = () => (options.now ?? (() => new Date()))().toISOString();
  try {
    let cp = store.load(options.resume);
    if (options.confirmNewQuotaWindow && cp?.state !== 'PAUSED_DAILY_QUOTA')
      throw new Error('Quota-window confirmation is only valid for PAUSED_DAILY_QUOTA');
    if (!cp) {
      cp = initialCheckpoint(identity, now());
      store.save(cp);
    }
    if (cp.state === 'COMPLETE') {
      store.materialize(cp);
      return cp;
    }
    if (cp.state === 'PAUSED_DAILY_QUOTA' && !options.confirmNewQuotaWindow)
      throw new Error('Resume requires --confirm-new-quota-window; no automatic reset assumption');
    const stamp = now();
    const previous = cp.sessions.at(-1);
    if (previous && !previous.endedAt)
      Object.assign(previous, {
        endedAt: stamp,
        endIndex: cp.nextIndex,
        stopReason: 'INTERRUPTED_BETWEEN_CASES',
      });
    cp.sessions.push({
      sequence: cp.sessions.length + 1,
      startedAt: stamp,
      startIndex: cp.nextIndex,
      confirmedNewQuotaWindow: cp.state === 'PAUSED_DAILY_QUOTA',
    });
    const finish = (reason: StopReason) =>
      Object.assign(cp!.sessions.at(-1)!, {
        endedAt: cp!.updatedAt,
        endIndex: cp!.nextIndex,
        stopReason: reason,
      });
    for (let count = 0; count < limit; count++) {
      cp.state = 'IN_PROGRESS';
      cp.updatedAt = now();
      store.save(cp); // Must be durable before context preparation or provider execution.
      const caseResult = await runLiveBenchmark({
        ...options,
        selectedCases: [options.dataset.cases[cp.nextIndex]],
        failFast: false,
      });
      const result = caseResult.cases[0];
      cp.updatedAt = now();
      if (isDailyQuota(result)) {
        cp.quotaEvents.push({
          session: cp.sessions.length,
          caseId: result.caseId,
          caseIndex: cp.nextIndex,
          timestamp: cp.updatedAt,
          diagnostics: structuredClone(result.failure!.diagnostics!),
        });
        cp.state = 'PAUSED_DAILY_QUOTA';
        finish('DAILY_QUOTA');
        store.save(cp);
        return cp;
      }
      cp.results.push(safeTerminal(result));
      cp.nextIndex++;
      cp.state = cp.nextIndex === 40 ? 'COMPLETE' : 'READY';
      if (cp.state === 'COMPLETE') finish('COMPLETE');
      else if (options.failFast && result.status !== 'SUCCESS') finish('FAIL_FAST');
      else if (count + 1 === limit) finish('MAX_NEW_CASES');
      store.save(cp);
      if (cp.state === 'COMPLETE') {
        store.materialize(cp);
        return cp;
      }
      if (cp.sessions.at(-1)!.endedAt) return cp;
    }
    return cp;
  } finally {
    store.close();
  }
}
