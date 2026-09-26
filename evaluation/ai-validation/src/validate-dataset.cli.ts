import { EVALUATION_CATEGORIES } from './evaluation.types';
import { parseNamedArguments, readJson } from './evaluation.io';
import { validateDataset } from './evaluation.validator';

function main(): void {
  const args = parseNamedArguments(process.argv.slice(2), new Set(['dataset']));
  const datasetPath = args.get('dataset');
  if (!datasetPath) throw new Error('Missing required argument --dataset');
  const dataset = validateDataset(readJson(datasetPath));
  const categoryDistribution = Object.fromEntries(
    EVALUATION_CATEGORIES.map((category) => [
      category,
      dataset.cases.flatMap((benchmarkCase) => benchmarkCase.expectedFindings).filter(
        (finding) => finding.category === category,
      ).length,
    ]),
  );
  const difficultyDistribution = Object.fromEntries(
    ['EASY', 'MEDIUM', 'HARD'].map((difficulty) => [
      difficulty,
      dataset.cases.filter((benchmarkCase) => benchmarkCase.difficulty === difficulty).length,
    ]),
  );
  process.stdout.write(
    `${JSON.stringify(
      {
        valid: true,
        datasetId: dataset.datasetId,
        version: dataset.version,
        type: dataset.type,
        totalCases: dataset.cases.length,
        cleanCases: dataset.cases.filter((benchmarkCase) => benchmarkCase.isClean).length,
        mutatedCases: dataset.cases.filter((benchmarkCase) => !benchmarkCase.isClean).length,
        categoryDistribution,
        difficultyDistribution,
      },
      null,
      2,
    )}\n`,
  );
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : 'Dataset validation failed'}\n`);
  process.exitCode = 1;
}
