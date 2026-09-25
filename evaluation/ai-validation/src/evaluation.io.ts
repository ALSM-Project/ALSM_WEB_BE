import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { EvaluationScore, scoreEvaluation } from './evaluation.scorer';
import { renderEvaluationReport } from './evaluation.report';
import { validateDataset, validatePredictions } from './evaluation.validator';

export function loadAndScore(datasetPath: string, predictionsPath: string): EvaluationScore {
  const dataset = validateDataset(readJson(datasetPath));
  const predictions = validatePredictions(readJson(predictionsPath), dataset);
  return scoreEvaluation(dataset, predictions);
}

export function writeEvaluationResults(outputDirectory: string, score: EvaluationScore): void {
  const absoluteOutput = resolve(outputDirectory);
  mkdirSync(absoluteOutput, { recursive: true });
  writeFileSync(resolve(absoluteOutput, 'metrics.json'), `${JSON.stringify(score, null, 2)}\n`, 'utf8');
  writeFileSync(resolve(absoluteOutput, 'report.md'), renderEvaluationReport(score), 'utf8');
}

export function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(resolve(path), 'utf8')) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown read error';
    throw new Error(`Unable to read JSON file ${path}: ${message}`);
  }
}

export function parseNamedArguments(
  args: string[],
  allowed: ReadonlySet<string>,
): Map<string, string> {
  const parsed = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!name?.startsWith('--') || !value || value.startsWith('--')) {
      throw new Error(`Invalid CLI argument near ${name ?? '<end>'}`);
    }
    const key = name.slice(2);
    if (!allowed.has(key)) throw new Error(`Unknown CLI argument --${key}`);
    if (parsed.has(key)) throw new Error(`Duplicate CLI argument --${key}`);
    parsed.set(key, value);
  }
  return parsed;
}
