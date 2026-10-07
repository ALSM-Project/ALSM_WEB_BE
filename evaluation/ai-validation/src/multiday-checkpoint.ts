import { createHash } from 'crypto';
import { ConfigService } from '@nestjs/config';
import * as Joi from 'joi';
import { AiValidatorMetadata } from '../../../src/modules/validation/domain/ai-validator.port';
import {
  AiProviderDiagnostics,
  PROVIDER_FAILURE_CLASSES,
  RATE_LIMIT_SCOPES,
} from '../../../src/modules/validation/domain/ai-provider-diagnostics';
import {
  AiEvaluationDataset,
  AiEvaluationPredictions,
  EvaluationPredictionCase,
  EVALUATOR_VERSION,
  MATCHING_POLICY_VERSION,
  DEFAULT_LOCATION_TOLERANCE_LINES,
} from './evaluation.types';
import { validateDataset, validatePredictions } from './evaluation.validator';

export function sameJson(a: unknown, b: unknown): boolean {
  const canonical = (value: unknown) =>
    JSON.stringify(value, (_key, item: unknown) => {
      if (item === null || typeof item !== 'object' || Array.isArray(item)) return item;
      return Object.fromEntries(
        Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
      );
    });
  return canonical(a) === canonical(b);
}

export const CHECKPOINT_VERSION = 1;
export const EXECUTION_POLICY_VERSION = 'gemini-multiday-v1';
export const SETTING_BOUNDS = {
  AI_MAX_RETRIES: [0, 5],
  AI_TIMEOUT_MS: [1000, 300000],
  AI_MAX_FINDINGS: [1, 200],
  GEMINI_MIN_REQUEST_INTERVAL_MS: [0, 60000],
  AI_MAX_FILES: [2, 500],
  AI_MAX_FILE_CHARS: [1, 2000000],
  AI_MAX_TOTAL_CHARS: [1, 5000000],
} as const;
export type Settings = Record<keyof typeof SETTING_BOUNDS, number>;
export interface RunIdentity {
  datasetId: string;
  datasetVersion: string;
  datasetSha256: string;
  datasetContentSha256: string;
  caseIds: string[];
  provider: 'gemini';
  model: string;
  promptVersion: string;
  evaluatorVersion: string;
  matchingPolicyVersion: string;
  locationToleranceLines: number;
  executionPolicyVersion: string;
  settings: Settings;
  failFast: boolean;
  storageFingerprint: string;
}
export type CheckpointState = 'READY' | 'IN_PROGRESS' | 'PAUSED_DAILY_QUOTA' | 'COMPLETE';
export type StopReason =
  'MAX_NEW_CASES' | 'FAIL_FAST' | 'DAILY_QUOTA' | 'COMPLETE' | 'INTERRUPTED_BETWEEN_CASES';
export interface Session {
  sequence: number;
  startedAt: string;
  startIndex: number;
  confirmedNewQuotaWindow: boolean;
  endedAt?: string;
  endIndex?: number;
  stopReason?: StopReason;
}
export interface QuotaEvent {
  session: number;
  caseId: string;
  caseIndex: number;
  timestamp: string;
  diagnostics: AiProviderDiagnostics;
}
export interface Checkpoint {
  checkpointSchemaVersion: 1;
  identity: RunIdentity;
  state: CheckpointState;
  nextIndex: number;
  results: EvaluationPredictionCase[];
  quotaEvents: QuotaEvent[];
  sessions: Session[];
  createdAt: string;
  updatedAt: string;
}
export function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

export function createRunIdentity(
  dataset: AiEvaluationDataset,
  datasetBytes: Buffer,
  metadata: AiValidatorMetadata,
  config: ConfigService,
  storageFingerprint: string,
  failFast: boolean,
): RunIdentity {
  validateDataset(dataset);
  if (dataset.caseCount !== 40 || metadata.provider !== 'gemini')
    throw new Error('Resumable mode requires a full 40-case Gemini benchmark');
  // Bind the parsed dataset to exactly the bytes fingerprinted; no external file references.
  let parsed: unknown;
  try {
    parsed = JSON.parse(datasetBytes.toString('utf8'));
  } catch {
    throw new Error('Invalid dataset bytes');
  }
  if (!sameJson(parsed, dataset)) throw new Error('Dataset bytes/content mismatch');
  const settings = Object.fromEntries(
    Object.keys(SETTING_BOUNDS).map((key) => [key, config.getOrThrow<number>(key)]),
  ) as Settings;
  const identity: RunIdentity = {
    datasetId: dataset.datasetId,
    datasetVersion: dataset.version,
    datasetSha256: sha256(datasetBytes),
    datasetContentSha256: sha256(JSON.stringify(dataset)),
    caseIds: dataset.cases.map((c) => c.caseId),
    provider: 'gemini',
    model: metadata.model,
    promptVersion: metadata.promptVersion,
    evaluatorVersion: EVALUATOR_VERSION,
    matchingPolicyVersion: MATCHING_POLICY_VERSION,
    locationToleranceLines: DEFAULT_LOCATION_TOLERANCE_LINES,
    executionPolicyVersion: EXECUTION_POLICY_VERSION,
    settings,
    failFast,
    storageFingerprint,
  };
  if (identitySchema.validate(identity, { convert: false }).error)
    throw new Error('Invalid safe run identity/settings');
  return identity;
}

const text = () => Joi.string().trim().min(1).max(200).required();
const hash = () =>
  Joi.string()
    .pattern(/^[a-f0-9]{64}$/)
    .required();
const date = () => Joi.string().isoDate().required();
const index = () => Joi.number().integer().min(0).max(40).required();
const identitySchema = Joi.object({
  datasetId: text(),
  datasetVersion: text(),
  datasetSha256: hash(),
  datasetContentSha256: hash(),
  caseIds: Joi.array().items(text()).length(40).unique().required(),
  provider: Joi.valid('gemini').required(),
  model: text(),
  promptVersion: text(),
  evaluatorVersion: text(),
  matchingPolicyVersion: text(),
  locationToleranceLines: Joi.number().integer().min(0).max(10).required(),
  executionPolicyVersion: text(),
  settings: Joi.object(
    Object.fromEntries(
      Object.entries(SETTING_BOUNDS).map(([key, [min, max]]) => [
        key,
        Joi.number().integer().min(min).max(max).required(),
      ]),
    ),
  )
    .unknown(false)
    .required(),
  failFast: Joi.boolean().required(),
  storageFingerprint: hash(),
})
  .unknown(false)
  .required();
const diagnosticsSchema = Joi.object({
  finalFailureClass: Joi.string()
    .valid(...PROVIDER_FAILURE_CLASSES)
    .required(),
  rateLimitScope: Joi.string().valid(...RATE_LIMIT_SCOPES),
  httpStatus: Joi.number().integer().min(100).max(599),
  attempts: Joi.number().integer().min(1).max(6).required(),
  retriesExhausted: Joi.boolean().required(),
  totalLatencyMs: Joi.number().integer().min(0).required(),
})
  .unknown(false)
  .required();
const schema = Joi.object({
  checkpointSchemaVersion: Joi.valid(CHECKPOINT_VERSION).required(),
  identity: identitySchema,
  state: Joi.valid('READY', 'IN_PROGRESS', 'PAUSED_DAILY_QUOTA', 'COMPLETE').required(),
  nextIndex: index(),
  results: Joi.array().items(Joi.object()).max(40).required(),
  quotaEvents: Joi.array()
    .items(
      Joi.object({
        session: Joi.number().integer().min(1).required(),
        caseId: text(),
        caseIndex: index(),
        timestamp: date(),
        diagnostics: diagnosticsSchema,
      }).unknown(false),
    )
    .required(),
  sessions: Joi.array()
    .items(
      Joi.object({
        sequence: Joi.number().integer().min(1).required(),
        startedAt: date(),
        startIndex: index(),
        confirmedNewQuotaWindow: Joi.boolean().required(),
        endedAt: Joi.string().isoDate(),
        endIndex: Joi.number().integer().min(0).max(40),
        stopReason: Joi.valid(
          'MAX_NEW_CASES',
          'FAIL_FAST',
          'DAILY_QUOTA',
          'COMPLETE',
          'INTERRUPTED_BETWEEN_CASES',
        ),
      })
        .and('endedAt', 'endIndex', 'stopReason')
        .unknown(false),
    )
    .required(),
  createdAt: date(),
  updatedAt: date(),
}).unknown(false);

export function isDailyQuota(result: EvaluationPredictionCase): boolean {
  return (
    result.status === 'PROVIDER_FAILED' &&
    result.failure?.diagnostics?.finalFailureClass === 'RATE_LIMITED' &&
    result.failure.diagnostics.rateLimitScope === 'DAILY_QUOTA'
  );
}
export function predictionEnvelope(cp: Checkpoint): AiEvaluationPredictions {
  const i = cp.identity;
  return {
    datasetId: i.datasetId,
    datasetVersion: i.datasetVersion,
    evaluatorVersion: i.evaluatorVersion,
    matchingPolicyVersion: i.matchingPolicyVersion,
    locationToleranceLines: i.locationToleranceLines,
    generatedAt: cp.updatedAt,
    provider: i.provider,
    model: i.model,
    promptVersion: i.promptVersion,
    cases: structuredClone(cp.results),
  };
}
function requireValid(condition: boolean, field: string): asserts condition {
  if (!condition) throw new Error(`Invalid checkpoint: ${field}`);
}
export function validateCheckpoint(
  value: unknown,
  dataset: AiEvaluationDataset,
  expected: RunIdentity,
): Checkpoint {
  const checked = schema.validate(value, { convert: false, abortEarly: true });
  // Never echo untrusted values or Joi messages (which can include raw input).
  if (checked.error) throw new Error('Invalid checkpoint schema');
  const cp = checked.value as Checkpoint;
  for (const key of Object.keys(expected) as (keyof RunIdentity)[]) {
    if (key === 'settings') {
      for (const setting of Object.keys(SETTING_BOUNDS) as (keyof Settings)[]) {
        if (cp.identity.settings[setting] !== expected.settings[setting])
          throw new Error(`Resume mismatch: settings.${setting}`);
      }
      continue;
    }
    if (!sameJson(cp.identity[key], expected[key])) throw new Error(`Resume mismatch: ${key}`);
  }
  requireValid(
    cp.identity.datasetContentSha256 === sha256(JSON.stringify(dataset)),
    'dataset fingerprint',
  );
  requireValid(
    sameJson(
      cp.identity.caseIds,
      dataset.cases.map((c) => c.caseId),
    ),
    'case order',
  );
  requireValid(cp.nextIndex === cp.results.length, 'nextIndex');
  requireValid((cp.state === 'COMPLETE') === (cp.nextIndex === 40), 'completion');
  requireValid(
    cp.results.every((r, n) => r.caseId === cp.identity.caseIds[n] && !isDailyQuota(r)),
    'terminal order/quota',
  );
  if (cp.results.length) {
    try {
      validatePredictions(predictionEnvelope(cp), dataset);
    } catch {
      throw new Error('Invalid checkpoint terminal predictions');
    }
    for (const r of cp.results)
      if (r.failure)
        requireValid(
          r.failure.message === 'Benchmark validation failed' &&
            SAFE_FAILURE_CODES.has(r.failure.code),
          'safe failure',
        );
  }
  requireValid(Date.parse(cp.updatedAt) >= Date.parse(cp.createdAt), 'timestamps');
  let previousEnd = 0;
  cp.sessions.forEach((s, n) => {
    requireValid(s.sequence === n + 1 && s.startIndex === previousEnd, 'session sequence/order');
    requireValid(
      n === cp.sessions.length - 1 || s.endedAt !== undefined,
      'unfinished prior session',
    );
    requireValid(Date.parse(s.startedAt) >= Date.parse(cp.createdAt), 'session timestamp');
    if (s.endedAt)
      requireValid(
        Date.parse(s.endedAt) >= Date.parse(s.startedAt) &&
          s.endIndex! >= s.startIndex &&
          s.endIndex! <= cp.nextIndex,
        'session end',
      );
    const prior = cp.sessions[n - 1];
    requireValid(
      !prior?.endedAt || Date.parse(s.startedAt) >= Date.parse(prior.endedAt),
      'session chronology',
    );
    requireValid(Date.parse(cp.updatedAt) >= Date.parse(s.endedAt ?? s.startedAt), 'updatedAt');
    if (s.stopReason === 'COMPLETE')
      requireValid(s.endIndex === 40 && n === cp.sessions.length - 1, 'complete position');
    if (s.stopReason === 'MAX_NEW_CASES')
      requireValid(s.endIndex! > s.startIndex, 'voluntary stop');
    if (s.stopReason === 'FAIL_FAST')
      requireValid(
        s.endIndex! > s.startIndex && cp.results[s.endIndex! - 1]?.status !== 'SUCCESS',
        'fail-fast result',
      );
    requireValid(
      s.confirmedNewQuotaWindow === (prior?.stopReason === 'DAILY_QUOTA'),
      'quota confirmation',
    );
    previousEnd = s.endIndex ?? cp.nextIndex;
  });
  const last = cp.sessions.at(-1);
  requireValid(previousEnd === cp.nextIndex, 'session position');
  requireValid(cp.results.length === 0 || !!last, 'missing sessions');
  requireValid(cp.state !== 'IN_PROGRESS' || (!!last && !last.endedAt), 'in-progress session');
  requireValid(cp.state !== 'COMPLETE' || last?.stopReason === 'COMPLETE', 'complete session');
  requireValid(last?.stopReason !== 'COMPLETE' || cp.state === 'COMPLETE', 'complete state');
  cp.quotaEvents.forEach((event, n) => {
    const s = cp.sessions[event.session - 1];
    requireValid(
      !!s &&
        s.stopReason === 'DAILY_QUOTA' &&
        s.endIndex === event.caseIndex &&
        s.endedAt === event.timestamp &&
        event.caseId === cp.identity.caseIds[event.caseIndex],
      'quota event session',
    );
    requireValid(
      event.diagnostics.finalFailureClass === 'RATE_LIMITED' &&
        event.diagnostics.rateLimitScope === 'DAILY_QUOTA',
      'quota evidence',
    );
    requireValid(n === 0 || cp.quotaEvents[n - 1].session < event.session, 'quota event order');
  });
  requireValid(
    cp.sessions.filter((s) => s.stopReason === 'DAILY_QUOTA').length === cp.quotaEvents.length,
    'quota event count',
  );
  requireValid(
    (cp.state === 'PAUSED_DAILY_QUOTA') === (last?.stopReason === 'DAILY_QUOTA'),
    'paused quota event',
  );
  return structuredClone(cp);
}

export const SAFE_FAILURE_CODES = new Set([
  'AI_PROVIDER_UNAVAILABLE',
  'AI_PROVIDER_TIMEOUT',
  'AI_PROVIDER_AUTHENTICATION_FAILED',
  'AI_PROVIDER_REQUEST_REJECTED',
  'AI_PROVIDER_REFUSED',
  'AI_PROVIDER_RESPONSE_INVALID',
  'VALIDATION_FAILED',
]);
export function safeTerminal(result: EvaluationPredictionCase): EvaluationPredictionCase {
  if (!result.failure) return structuredClone(result);
  const diagnostics = result.failure.diagnostics;
  return {
    caseId: result.caseId,
    status: result.status,
    latencyMs: result.latencyMs,
    failure: {
      code: SAFE_FAILURE_CODES.has(result.failure.code) ? result.failure.code : 'VALIDATION_FAILED',
      message: 'Benchmark validation failed',
      ...(diagnostics ? { diagnostics: structuredClone(diagnostics) } : {}),
    },
  };
}
export function initialCheckpoint(identity: RunIdentity, timestamp: string): Checkpoint {
  return {
    checkpointSchemaVersion: 1,
    identity: structuredClone(identity),
    state: 'READY',
    nextIndex: 0,
    results: [],
    quotaEvents: [],
    sessions: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
export function assertTransition(old: Checkpoint, next: Checkpoint): void {
  requireValid(
    sameJson(old.identity, next.identity) && old.createdAt === next.createdAt,
    'immutable identity',
  );
  requireValid(Date.parse(next.updatedAt) >= Date.parse(old.updatedAt), 'backwards time');
  requireValid(
    sameJson(old.results, next.results.slice(0, old.results.length)),
    'immutable terminal results',
  );
  requireValid(
    sameJson(old.quotaEvents, next.quotaEvents.slice(0, old.quotaEvents.length)),
    'immutable quota events',
  );
  const delta = next.nextIndex - old.nextIndex;
  const sessionsAdded = next.sessions.length - old.sessions.length;
  requireValid(sessionsAdded === 0 || sessionsAdded === 1, 'session append');
  old.sessions.forEach((s, n) => {
    if (s.endedAt) requireValid(sameJson(s, next.sessions[n]), 'immutable closed session');
    else {
      const candidate = next.sessions[n];
      requireValid(
        !!candidate &&
          s.sequence === candidate.sequence &&
          s.startedAt === candidate.startedAt &&
          s.startIndex === candidate.startIndex &&
          s.confirmedNewQuotaWindow === candidate.confirmedNewQuotaWindow,
        'immutable session identity',
      );
    }
  });
  const eventsAdded = next.quotaEvents.length - old.quotaEvents.length;
  if (old.state === 'IN_PROGRESS') {
    requireValid(
      sessionsAdded === 0 &&
        ((delta === 1 && eventsAdded === 0 && ['READY', 'COMPLETE'].includes(next.state)) ||
          (delta === 0 && eventsAdded === 1 && next.state === 'PAUSED_DAILY_QUOTA')),
      'case completion transition',
    );
  } else if (old.state === 'READY' || old.state === 'PAUSED_DAILY_QUOTA') {
    requireValid(
      delta === 0 &&
        eventsAdded === 0 &&
        (next.state === 'IN_PROGRESS' ||
          (old.state === 'READY' && next.state === 'READY' && sessionsAdded === 0)),
      'start/stop transition',
    );
    if (old.state === 'PAUSED_DAILY_QUOTA')
      requireValid(
        sessionsAdded === 1 && next.sessions.at(-1)!.confirmedNewQuotaWindow,
        'confirmed quota resume',
      );
  } else throw new Error('COMPLETE checkpoint is immutable');
}
export function materializePredictions(
  cp: Checkpoint,
  dataset: AiEvaluationDataset,
  expected: RunIdentity,
): AiEvaluationPredictions {
  const valid = validateCheckpoint(cp, dataset, expected);
  if (valid.state !== 'COMPLETE')
    throw new Error('Partial checkpoint cannot be materialized or scored as final predictions');
  return validatePredictions(predictionEnvelope(valid), dataset);
}
