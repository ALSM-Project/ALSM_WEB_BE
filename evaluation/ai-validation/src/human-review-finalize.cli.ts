import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { parseNamedArguments, readJson } from './evaluation.io';
import { sha256 } from './external-import.utils';
import { finalizeCleanReviewManifest } from './human-review-reconciliation';

const root = resolve(__dirname, '..', '..', '..');
const pilot = resolve(root, 'evaluation/ai-validation/reviews/cobol-javatrans-pilot-v1');

function main(): void {
  const args = parseNamedArguments(
    process.argv.slice(2),
    new Set(['candidates', 'selection', 'review-a', 'review-b', 'finalization', 'output']),
  );
  const candidatesPath = resolve(
    args.get('candidates') ??
      resolve(root, 'evaluation/ai-validation/imports/cobol-javatrans/candidates.json'),
  );
  const rawCandidates = readFileSync(candidatesPath, 'utf8');
  const manifest = finalizeCleanReviewManifest(
    JSON.parse(rawCandidates) as unknown,
    sha256(rawCandidates),
    readJson(args.get('selection') ?? resolve(pilot, 'selection.json')),
    readJson(args.get('review-a') ?? resolve(pilot, 'reviewer-a.template.json')),
    readJson(args.get('review-b') ?? resolve(pilot, 'reviewer-b.template.json')),
    readJson(args.get('finalization') ?? resolve(pilot, 'finalization.template.json')),
  );
  if (!manifest) {
    process.stdout.write('Finalized 0 READY_CLEAN cases; no review manifest was written.\n');
    return;
  }
  const output = resolve(
    args.get('output') ??
      resolve(root, 'evaluation/ai-validation/reviews/work/finalized-review-manifest.json'),
  );
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  process.stdout.write(`Finalized ${manifest.reviews.length} READY_CLEAN cases to ${output}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : 'Pilot finalization failed'}\n`);
  process.exitCode = 1;
}
