import { readFileSync } from 'fs';
import { resolve } from 'path';
import { parseNamedArguments, readJson } from './evaluation.io';
import { sha256 } from './external-import.utils';
import { validateImportedCandidateManifest } from './external-import.validator';
import { validatePilotReview } from './human-review-reconciliation';
import { validatePilotSelection } from './human-review-selection';

const root = resolve(__dirname, '..', '..', '..');
const pilot = resolve(root, 'evaluation/ai-validation/reviews/cobol-javatrans-pilot-v1');

function main(): void {
  const args = parseNamedArguments(
    process.argv.slice(2),
    new Set(['candidates', 'selection', 'review-a', 'review-b', 'mode']),
  );
  const candidatesPath = args.get('candidates') ??
    resolve(root, 'evaluation/ai-validation/imports/cobol-javatrans/candidates.json');
  const rawCandidates = readFileSync(resolve(candidatesPath), 'utf8');
  const candidates = validateImportedCandidateManifest(JSON.parse(rawCandidates) as unknown);
  const selection = validatePilotSelection(
    readJson(args.get('selection') ?? resolve(pilot, 'selection.json')),
    candidates,
    sha256(rawCandidates),
  );
  const mode = args.get('mode') ?? 'incomplete';
  if (!['incomplete', 'complete'].includes(mode)) {
    throw new Error('Invalid --mode: use incomplete or complete');
  }
  const requireComplete = mode === 'complete';
  const reviewA = validatePilotReview(
    readJson(args.get('review-a') ?? resolve(pilot, 'reviewer-a.template.json')),
    selection,
    'A',
    requireComplete,
  );
  const reviewB = validatePilotReview(
    readJson(args.get('review-b') ?? resolve(pilot, 'reviewer-b.template.json')),
    selection,
    'B',
    requireComplete,
  );
  process.stdout.write(
    `${JSON.stringify(
      {
        valid: true,
        mode,
        selectedPilotCases: selection.selectedCandidates.length,
        reviewerA: reviewA.summary,
        reviewerB: reviewB.summary,
      },
      null,
      2,
    )}\n`,
  );
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : 'Pilot review validation failed'}\n`);
  process.exitCode = 1;
}
