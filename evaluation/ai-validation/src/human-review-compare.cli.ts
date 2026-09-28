import { mkdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { parseNamedArguments, readJson } from './evaluation.io';
import { comparePilotReviews } from './human-review-reconciliation';

const root = resolve(__dirname, '..', '..', '..');
const pilot = resolve(root, 'evaluation/ai-validation/reviews/cobol-javatrans-pilot-v1');

function main(): void {
  const args = parseNamedArguments(
    process.argv.slice(2),
    new Set(['selection', 'review-a', 'review-b', 'output']),
  );
  const output = resolve(
    args.get('output') ??
      resolve(root, 'evaluation/ai-validation/reviews/work/pilot-comparison.json'),
  );
  const comparison = comparePilotReviews(
    readJson(args.get('selection') ?? resolve(pilot, 'selection.json')),
    readJson(args.get('review-a') ?? resolve(pilot, 'reviewer-a.template.json')),
    readJson(args.get('review-b') ?? resolve(pilot, 'reviewer-b.template.json')),
  );
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(comparison, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(comparison.counts)}\nWrote comparison to ${output}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : 'Pilot comparison failed'}\n`);
  process.exitCode = 1;
}
