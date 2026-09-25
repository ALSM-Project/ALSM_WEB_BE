import { readFileSync } from 'fs';
import { join } from 'path';
import { ValidationFindingCategory } from '../src/modules/validation/domain/validation-finding.types';
import { EVALUATION_CATEGORIES } from '../evaluation/ai-validation/src/evaluation.types';
import { validateDataset } from '../evaluation/ai-validation/src/evaluation.validator';

describe('cobol-java-semantic-v1 dataset', () => {
  const manifestPath = join(
    process.cwd(),
    'evaluation',
    'ai-validation',
    'datasets',
    'cobol-java-semantic-v1',
    'manifest.json',
  );
  const dataset = validateDataset(JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown);

  it('contains the intended 10 clean and 30 mutated synthetic cases', () => {
    expect(dataset.datasetId).toBe('cobol-java-semantic-v1');
    expect(dataset.version).toBe('1.0.0');
    expect(dataset.type).toBe('synthetic-curated');
    expect(dataset.cases).toHaveLength(40);
    expect(dataset.cases.filter((benchmarkCase) => benchmarkCase.isClean)).toHaveLength(10);
    expect(dataset.cases.filter((benchmarkCase) => !benchmarkCase.isClean)).toHaveLength(30);
  });

  it('has exactly three mutations for every supported evaluation category', () => {
    const distribution = Object.fromEntries(
      EVALUATION_CATEGORIES.map((category) => [category, 0]),
    ) as Record<ValidationFindingCategory, number>;
    for (const benchmarkCase of dataset.cases) {
      for (const finding of benchmarkCase.expectedFindings) distribution[finding.category] += 1;
    }
    expect(
      Object.fromEntries(EVALUATION_CATEGORIES.map((category) => [category, distribution[category]])),
    ).toEqual(Object.fromEntries(EVALUATION_CATEGORIES.map((category) => [category, 3])));
  });

  it('includes easy, medium, and hard cases without duplicate fixture pairs or mutation operators', () => {
    const difficulties = new Set(dataset.cases.map((benchmarkCase) => benchmarkCase.difficulty));
    expect(difficulties).toEqual(new Set(['EASY', 'MEDIUM', 'HARD']));

    const fixturePairs = dataset.cases.map((benchmarkCase) =>
      JSON.stringify({ source: benchmarkCase.sourceFiles, target: benchmarkCase.targetFiles }),
    );
    expect(new Set(fixturePairs).size).toBe(fixturePairs.length);

    const operators = dataset.cases.flatMap((benchmarkCase) =>
      (benchmarkCase.mutations ?? []).map((mutation) => mutation.operator),
    );
    expect(new Set(operators).size).toBe(operators.length);
  });

  it('uses only explicitly synthetic identifiers and contains no credential-like material', () => {
    const serialized = JSON.stringify(dataset).toLowerCase();
    expect(serialized).toContain('synthetic');
    expect(serialized).not.toMatch(/api[_-]?key|password\s*=|bearer\s+[a-z0-9]/);
  });
});
