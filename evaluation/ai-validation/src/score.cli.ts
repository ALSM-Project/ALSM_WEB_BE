import { loadAndScore, parseNamedArguments, writeEvaluationResults } from './evaluation.io';

function main(): void {
  const args = parseNamedArguments(process.argv.slice(2), new Set(['dataset', 'predictions', 'output']));
  const dataset = required(args, 'dataset');
  const predictions = required(args, 'predictions');
  const output = required(args, 'output');
  const score = loadAndScore(dataset, predictions);
  writeEvaluationResults(output, score);
  process.stdout.write(
    `Scored ${score.execution.totalCases} cases; wrote metrics.json and report.md to ${output}\n`,
  );
}

function required(args: Map<string, string>, name: string): string {
  const value = args.get(name);
  if (!value) throw new Error(`Missing required argument --${name}`);
  return value;
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : 'Evaluation scoring failed'}\n`);
  process.exitCode = 1;
}
