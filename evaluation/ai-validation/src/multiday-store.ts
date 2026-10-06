import * as fs from 'fs';
import { dirname, join, relative, resolve, sep } from 'path';
import { randomUUID } from 'crypto';
import { AiEvaluationDataset } from './evaluation.types';
import {
  sameJson,
  assertTransition,
  Checkpoint,
  RunIdentity,
  sha256,
  validateCheckpoint,
  materializePredictions,
} from './multiday-checkpoint';

export function checkpointLocation(
  checkpoint: string,
  output: string,
  projectRoot = process.cwd(),
) {
  const root = resolve(projectRoot, 'evaluation/ai-validation/results/multiday');
  const path = resolve(checkpoint);
  const suffix = relative(root, path).split(sep);
  if (
    suffix.length !== 2 ||
    !/^[a-z0-9][a-z0-9-]{0,63}$/.test(suffix[0]) ||
    suffix[1] !== 'checkpoint.json' ||
    resolve(output) !== dirname(path)
  )
    throw new Error(
      'Checkpoint must be results/multiday/<run-id>/checkpoint.json; output must be its directory',
    );
  // Reject symlink/reparse aliases into tracked evidence or a second lock namespace.
  let cursor = resolve(projectRoot);
  for (const part of relative(cursor, dirname(path)).split(sep)) {
    cursor = join(cursor, part);
    if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink())
      throw new Error('Symlink checkpoint directories are forbidden');
  }
  const normalized = process.platform === 'win32' ? path.toLowerCase() : path;
  return { path, directory: dirname(path), storageFingerprint: sha256(normalized) };
}

// Validate before touching disk; temp and destination share a filesystem/directory.
export function atomicJson(path: string, value: unknown, validate: () => void): void {
  validate();
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  const temp = `${path}.${randomUUID()}.tmp`;
  let fd: number | undefined;
  let created = false;
  try {
    fd = fs.openSync(temp, 'wx', 0o600);
    created = true;
    fs.writeFileSync(fd, serialized, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(temp, path);
    // Windows does not expose portable directory fsync through Node. File contents
    // are flushed before replacement; POSIX also flushes the directory entry.
    if (process.platform !== 'win32') {
      const directory = fs.openSync(dirname(path), 'r');
      try {
        fs.fsyncSync(directory);
      } finally {
        fs.closeSync(directory);
      }
    }
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    if (created && fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}

export function assertLegacyOutputOutsideMultiday(
  output: string,
  projectRoot = process.cwd(),
): void {
  const root = resolve(projectRoot, 'evaluation/ai-validation/results/multiday');
  const canonical = (path: string) => (process.platform === 'win32' ? path.toLowerCase() : path);
  const candidate = canonical(resolve(output));
  if (candidate === canonical(root) || candidate.startsWith(canonical(root) + sep))
    throw new Error(
      'Multiday output directories require --checkpoint; legacy runs cannot overwrite them',
    );
}

export class CheckpointStore {
  private current?: Checkpoint;
  private constructor(
    readonly path: string,
    private readonly lockPath: string,
    private readonly dataset: AiEvaluationDataset,
    private readonly identity: RunIdentity,
  ) {}
  static acquire(
    path: string,
    output: string,
    dataset: AiEvaluationDataset,
    identity: RunIdentity,
    projectRoot = process.cwd(),
  ): CheckpointStore {
    const location = checkpointLocation(path, output, projectRoot);
    if (location.storageFingerprint !== identity.storageFingerprint)
      throw new Error('Resume mismatch: storageFingerprint');
    fs.mkdirSync(location.directory, { recursive: true });
    const lock = join(location.directory, '.session.lock');
    let fd: number;
    try {
      fd = fs.openSync(lock, 'wx', 0o600);
    } catch {
      throw new Error(
        'AMBIGUOUS_INTERRUPTION: active or stale session lock; no automatic takeover or rerun',
      );
    }
    fs.closeSync(fd);
    return new CheckpointStore(location.path, lock, dataset, identity);
  }
  close(): void {
    fs.unlinkSync(this.lockPath);
  }
  load(resume: boolean): Checkpoint | undefined {
    if (!fs.existsSync(this.path)) {
      if (resume) throw new Error('Resume requires an existing checkpoint');
      if (fs.readdirSync(dirname(this.path)).some((name) => name !== '.session.lock'))
        throw new Error('New run requires an empty output directory');
      return undefined;
    }
    if (!resume) throw new Error('Checkpoint already exists; explicit --resume required');
    if (fs.lstatSync(this.path).isSymbolicLink())
      throw new Error('Symlink checkpoint is forbidden');
    let raw: unknown;
    try {
      raw = JSON.parse(fs.readFileSync(this.path, 'utf8'));
    } catch {
      throw new Error('Unreadable checkpoint; no automatic repair');
    }
    this.current = validateCheckpoint(raw, this.dataset, this.identity);
    if (this.current.state === 'IN_PROGRESS')
      throw new Error(
        'AMBIGUOUS_INTERRUPTION: persisted IN_PROGRESS; automatic rerun risks duplicate execution and benchmark bias',
      );
    return structuredClone(this.current);
  }
  save(next: Checkpoint): void {
    const validated = validateCheckpoint(next, this.dataset, this.identity);
    if (this.current) {
      assertTransition(this.current, validated);
      let disk: unknown;
      try {
        disk = JSON.parse(fs.readFileSync(this.path, 'utf8'));
      } catch {
        throw new Error('Checkpoint changed externally');
      }
      if (!sameJson(disk, this.current)) throw new Error('Checkpoint changed externally');
    } else if (
      validated.state !== 'READY' ||
      validated.nextIndex !== 0 ||
      validated.sessions.length ||
      validated.quotaEvents.length ||
      fs.existsSync(this.path)
    ) {
      throw new Error('Invalid initial checkpoint');
    }
    atomicJson(this.path, validated, () =>
      validateCheckpoint(validated, this.dataset, this.identity),
    );
    this.current = structuredClone(validated);
  }
  materialize(cp: Checkpoint): void {
    const predictions = materializePredictions(cp, this.dataset, this.identity);
    const path = join(dirname(this.path), 'predictions.json');
    if (fs.existsSync(path)) {
      if (fs.lstatSync(path).isSymbolicLink()) throw new Error('Symlink predictions are forbidden');
      let existing: unknown;
      try {
        existing = JSON.parse(fs.readFileSync(path, 'utf8'));
      } catch {
        throw new Error('Existing predictions cannot be replaced');
      }
      if (!sameJson(existing, predictions))
        throw new Error('Existing predictions cannot be replaced');
      return;
    }
    atomicJson(path, predictions, () => materializePredictions(cp, this.dataset, this.identity));
  }
}
