import { mkdirSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { PrepareAiValidationContextService } from '../../../src/modules/validation/application/prepare-ai-validation-context.service';
import { ValidationSecretRedactorService } from '../../../src/modules/validation/application/validation-secret-redactor.service';
import { readJson } from './evaluation.io';
import { assertLiveProviderOptIn, runLiveBenchmark, selectLiveCases } from './live-runner';
import { createLiveValidator } from './live-validator.factory';
import { validateDataset } from './evaluation.validator';

interface LiveCliArguments {
  dataset?: string;
  output?: string;
  caseId?: string;
  limit?: number;
  all: boolean;
  allowLiveProvider: boolean;
  failFast: boolean;
}

async function main(): Promise<void> {
  const args = parseLiveArguments(process.argv.slice(2));
  assertLiveProviderOptIn(process.env, args.allowLiveProvider);
  if (!args.dataset || !args.output) throw new Error('Live run requires --dataset and --output');
  const dataset = validateDataset(readJson(args.dataset));
  const selectedCases = selectLiveCases(dataset, {
    caseId: args.caseId,
    limit: args.limit,
    all: args.all,
  });
  const { config, validator } = createLiveValidator(process.env);
  const prepareContext = new PrepareAiValidationContextService(
    new ValidationSecretRedactorService(),
    config,
  );
  const predictions = await runLiveBenchmark({
    dataset,
    selectedCases,
    validator,
    prepareContext,
    failFast: args.failFast,
  });
  const output = resolve(args.output);
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

function parseLiveArguments(values: string[]): LiveCliArguments {
  const result: LiveCliArguments = {
    all: false,
    allowLiveProvider: false,
    failFast: false,
  };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === '--all') result.all = true;
    else if (value === '--allow-live-provider') result.allowLiveProvider = true;
    else if (value === '--fail-fast') result.failFast = true;
    else if (value === '--dataset') result.dataset = nextValue(values, ++index, value);
    else if (value === '--output') result.output = nextValue(values, ++index, value);
    else if (value === '--case') result.caseId = nextValue(values, ++index, value);
    else if (value === '--limit') result.limit = Number(nextValue(values, ++index, value));
    else throw new Error(`Unknown live-run argument ${value}`);
  }
  return result;
}

function nextValue(values: string[], index: number, flag: string): string {
  const value = values[index];
  if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
  return value;
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Live evaluation failed'}\n`);
  process.exitCode = 1;
});
