import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { sha256 } from './external-import.utils';
import { validateImportedCandidateManifest } from './external-import.validator';
import {
  createFinalizationTemplate,
  createReviewTemplate,
  preparePilotSelection,
  renderPilotSummary,
} from './human-review-selection';
import { PilotSelectionManifest } from './human-review.types';

const root = resolve(__dirname, '..', '..', '..');
const candidatesPath = resolve(
  root,
  'evaluation/ai-validation/imports/cobol-javatrans/candidates.json',
);
const pilotDirectory = resolve(
  root,
  'evaluation/ai-validation/reviews/cobol-javatrans-pilot-v1',
);
const selectionPath = resolve(pilotDirectory, 'selection.json');

function main(): void {
  const raw = readFileSync(candidatesPath, 'utf8');
  const candidates = validateImportedCandidateManifest(JSON.parse(raw) as unknown);
  const existing = readExistingSelectionTime();
  const selection = preparePilotSelection(
    candidates,
    'evaluation/ai-validation/imports/cobol-javatrans/candidates.json',
    sha256(raw),
    existing ?? new Date().toISOString(),
  );
  mkdirSync(pilotDirectory, { recursive: true });
  writeJson(selectionPath, selection);
  writeJson(resolve(pilotDirectory, 'reviewer-a.template.json'), createReviewTemplate(selection, 'A'));
  writeJson(resolve(pilotDirectory, 'reviewer-b.template.json'), createReviewTemplate(selection, 'B'));
  writeJson(resolve(pilotDirectory, 'finalization.template.json'), createFinalizationTemplate(selection));
  writeFileSync(resolve(pilotDirectory, 'pilot-summary.md'), renderPilotSummary(selection, candidates));
  process.stdout.write(
    `Prepared ${selection.selectedCandidates.length} pilot cases from ${selection.eligibleCandidateCount} eligible candidates (SMALL=5, MEDIUM=5, LARGE=5).\n`,
  );
}

function readExistingSelectionTime(): string | undefined {
  if (!existsSync(selectionPath)) return undefined;
  try {
    const existing = JSON.parse(readFileSync(selectionPath, 'utf8')) as Partial<PilotSelectionManifest>;
    return typeof existing.selectedAt === 'string' ? existing.selectedAt : undefined;
  } catch {
    return undefined;
  }
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : 'Pilot preparation failed'}\n`);
  process.exitCode = 1;
}
