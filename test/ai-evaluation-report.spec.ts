import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  loadAndScore,
  parseNamedArguments,
  writeEvaluationResults,
} from '../evaluation/ai-validation/src/evaluation.io';
import { renderEvaluationReport } from '../evaluation/ai-validation/src/evaluation.report';

describe('AI evaluation offline reporting', () => {
  const root = join(process.cwd(), 'evaluation', 'ai-validation');
  const datasetPath = join(root, 'datasets', 'cobol-java-semantic-v1', 'manifest.json');
  const predictionsPath = join(root, 'samples', 'sample-predictions.json');

  it('scores the deterministic sample with known TP, FP, FN, and failure counts', () => {
    const score = loadAndScore(datasetPath, predictionsPath);
    expect(score.successfulCases.micro).toEqual(
      expect.objectContaining({ truePositives: 2, falsePositives: 1, falseNegatives: 27 }),
    );
    expect(score.conservative.micro).toEqual(
      expect.objectContaining({ truePositives: 2, falsePositives: 1, falseNegatives: 28 }),
    );
    expect(score.execution).toEqual(
      expect.objectContaining({ totalCases: 40, successfulCases: 39, failedCases: 1 }),
    );
    expect(score.cleanCases.cleanCaseFalsePositiveRate).toBe(0.1);
    expect(score.mutationDetection.conservative).toEqual({
      mutatedCases: 30,
      mutatedCasesDetected: 2,
      mutationDetectionRate: 2 / 30,
    });
  });

  it('renders a source-free report that labels sample predictions', () => {
    const report = renderEvaluationReport(loadAndScore(datasetPath, predictionsPath));
    expect(report).toContain('SAMPLE / TEST PREDICTIONS ONLY');
    expect(report).toContain('| Successful cases | 2 | 1 | 27 |');
    expect(report).not.toContain('01 AMOUNT PIC');
  });

  it('writes only metrics.json and report.md to a requested output directory', () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), 'alsm-ai-eval-'));
    try {
      writeEvaluationResults(temporaryDirectory, loadAndScore(datasetPath, predictionsPath));
      expect(existsSync(join(temporaryDirectory, 'metrics.json'))).toBe(true);
      expect(existsSync(join(temporaryDirectory, 'report.md'))).toBe(true);
      expect(readFileSync(join(temporaryDirectory, 'metrics.json'), 'utf8')).not.toContain(
        '01 AMOUNT PIC',
      );
    } finally {
      if (temporaryDirectory.startsWith(tmpdir())) {
        rmSync(temporaryDirectory, { recursive: true, force: true });
      }
    }
  });

  it('parses named arguments without accepting unknown, duplicate, or missing values', () => {
    expect(parseNamedArguments(['--dataset', 'data.json'], new Set(['dataset']))).toEqual(
      new Map([['dataset', 'data.json']]),
    );
    expect(() => parseNamedArguments(['--unknown', 'x'], new Set(['dataset']))).toThrow(
      'Unknown CLI argument',
    );
    expect(() =>
      parseNamedArguments(['--dataset', 'a', '--dataset', 'b'], new Set(['dataset'])),
    ).toThrow('Duplicate CLI argument');
    expect(() => parseNamedArguments(['--dataset'], new Set(['dataset']))).toThrow(
      'Invalid CLI argument',
    );
  });
});
