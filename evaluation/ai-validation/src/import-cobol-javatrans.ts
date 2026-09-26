import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  EXTERNAL_IMPORT_SCHEMA_VERSION,
  ImportedCandidateManifest,
  ImportedEvaluationCandidate,
  ImportedReviewManifest,
  UpstreamMetadata,
} from './external-import.types';
import { calculateContextCompatibility, sha256 } from './external-import.utils';
import {
  validateImportedCandidateManifest,
  validateImportedReviewManifest,
} from './external-import.validator';
import { checkoutPinnedCommit, readUpstreamFile, upstreamBlobSha } from './external-import.git';
import { ensureImportDirectory, writeImportJson } from './external-import.io';
import { ImportSecurityFlag, scanImportedText } from './external-import.security';
import { parseNamedArguments } from './evaluation.io';

const REPOSITORY = 'COBOL-Coder/COBOL-Coder';
const REPOSITORY_URL = 'https://github.com/COBOL-Coder/COBOL-Coder.git';
const DATASET_PATH = 'evaluation/data/COBOL-JavaTrans.jsonl';
const LICENSE_PATH = 'LICENSE';
const AUDITED_COMMIT = '2b14b7bf7e55556205654c6f7657fa60e36251fa';
const AUDITED_DATASET_BLOB_SHA = 'b29ce552a209e6a12cb5b31e130188404ccf8958';
const UPSTREAM_VALIDATION_CLAIM =
  'The upstream README states that the programs were manually reviewed and validated for compilability and functional correctness.';

interface CobolJavaTransRecord {
  task_id?: unknown;
  COBOL_canonical_solution?: unknown;
  COBOL_prompt?: unknown;
  Java_prompt?: unknown;
  Java_canonical_solution?: unknown;
  Java_tests?: unknown;
  tests?: unknown;
}

export interface CobolJavaTransImportResult {
  manifest: ImportedCandidateManifest;
  reviews: ImportedReviewManifest;
  statistics: {
    actualRecordCount: number;
    importedCandidateCount: number;
    rejectedCount: number;
    testEvidenceCount: number;
    securityFlagCount: number;
  };
  securityFlags: ImportSecurityFlag[];
}

export interface CobolJavaTransImportInput {
  jsonl: string;
  commit: string;
  datasetBlobSha: string;
  retrievedAt: string;
}

export function buildCobolJavaTransImport(
  input: CobolJavaTransImportInput,
): CobolJavaTransImportResult {
  const records = parseJsonl(input.jsonl);
  const candidates: ImportedEvaluationCandidate[] = [];
  const candidateIds = new Set<string>();
  const securityFlags: ImportSecurityFlag[] = [];
  let rejectedCount = 0;

  records.forEach((record, index) => {
    const cobol = nonEmptyString(record.COBOL_canonical_solution);
    const java = nonEmptyString(record.Java_canonical_solution);
    if (!cobol || !java) {
      rejectedCount += 1;
      return;
    }
    const upstreamCaseId = nonEmptyString(record.task_id);
    const candidateId = candidateIdentifier(upstreamCaseId, index, cobol, java);
    if (candidateIds.has(candidateId)) {
      throw new Error(`Duplicate COBOL-JavaTrans candidate ID: ${candidateId}`);
    }
    candidateIds.add(candidateId);
    const fileStem = candidateId.replace(/^external-cjt-/, '');
    const sourceFiles = [{ path: `source/${fileStem}.cbl`, content: cobol }];
    const targetFiles = [{ path: `target/${fileStem}.java`, content: java }];
    const flags = [...sourceFiles, ...targetFiles].flatMap((file) =>
      scanImportedText(file.path, file.content),
    );
    if (flags.length > 0) {
      securityFlags.push(...flags);
      rejectedCount += 1;
      return;
    }
    const structuredTests = parseStructuredTests(record.tests);
    const javaTestSource = stringValue(record.Java_tests);
    const evidencePresent = structuredTests.length > 0 || javaTestSource.length > 0;
    const fileIntegrity = [...sourceFiles, ...targetFiles].map((file) => ({
      candidatePath: file.path,
      upstreamPath: DATASET_PATH,
      upstreamBlobSha: input.datasetBlobSha,
      contentSha256: sha256(file.content),
    }));
    candidates.push({
      candidateId,
      sourceDataset: 'COBOL_JAVATRANS',
      sourceFiles,
      targetFiles,
      provenance: {
        upstreamRepository: REPOSITORY,
        upstreamRepositoryUrl: REPOSITORY_URL.replace(/\.git$/, ''),
        upstreamCommit: input.commit,
        upstreamPath: DATASET_PATH,
        ...(upstreamCaseId ? { upstreamCaseId } : {}),
        upstreamBlobSha: input.datasetBlobSha,
        fileIntegrity,
        licenseSpdx: 'Apache-2.0',
        licensePath: 'LICENSE.upstream.txt',
        retrievedAt: input.retrievedAt,
      },
      upstreamEvidence: {
        testDataPresent: evidencePresent,
        upstreamValidationClaim: UPSTREAM_VALIDATION_CLAIM,
        problemDescriptions: {
          cobol: stringValue(record.COBOL_prompt),
          java: stringValue(record.Java_prompt),
        },
        structuredTests,
        javaTestSource,
      },
      contextCompatibility: calculateContextCompatibility(sourceFiles, targetFiles),
      groundTruthStatus: 'PENDING_ALSM_REVIEW',
      scorable: false,
      humanReviewRequired: true,
    });
  });

  const manifest = validateImportedCandidateManifest({
    schemaVersion: EXTERNAL_IMPORT_SCHEMA_VERSION,
    sourceDataset: 'COBOL_JAVATRANS',
    licenseStatus:
      input.commit === AUDITED_COMMIT && input.datasetBlobSha === AUDITED_DATASET_BLOB_SHA
        ? 'RECORDED'
        : 'REVIEW_REQUIRED',
    candidateCount: candidates.length,
    candidates,
  });
  const reviews = validateImportedReviewManifest(
    {
      schemaVersion: EXTERNAL_IMPORT_SCHEMA_VERSION,
      sourceDataset: 'COBOL_JAVATRANS',
      reviews: candidates.map((candidate) => ({
        candidateId: candidate.candidateId,
        reviewStatus: 'PENDING',
        reviewers: [],
        title: null,
        description: null,
        difficulty: null,
        isClean: null,
        expectedFindings: null,
        mutations: null,
        notes: null,
        targetJavaStatus: 'UPSTREAM_PRESENT',
      })),
    },
    manifest,
  );
  return {
    manifest,
    reviews,
    statistics: {
      actualRecordCount: records.length,
      importedCandidateCount: candidates.length,
      rejectedCount,
      testEvidenceCount: candidates.filter(
        (candidate) => candidate.upstreamEvidence?.testDataPresent,
      ).length,
      securityFlagCount: securityFlags.length,
    },
    securityFlags,
  };
}

export function parseJsonl(jsonl: string): CobolJavaTransRecord[] {
  return jsonl
    .split(/\r\n|\n|\r/)
    .filter((line) => line.trim().length > 0)
    .map((line, index) => {
      try {
        const value = JSON.parse(line) as unknown;
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          throw new Error('record is not an object');
        }
        return value as CobolJavaTransRecord;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown JSON error';
        throw new Error(`Malformed COBOL-JavaTrans JSONL at line ${index + 1}: ${message}`);
      }
    });
}

function main(): void {
  const args = parseNamedArguments(process.argv.slice(2), new Set(['output']));
  const outputDirectory = ensureImportDirectory(
    args.get('output') ?? 'evaluation/ai-validation/imports/cobol-javatrans',
  );
  const checkout = checkoutPinnedCommit(REPOSITORY_URL, AUDITED_COMMIT);
  try {
    const license = readUpstreamFile(checkout.path, checkout.commit, LICENSE_PATH);
    if (!license.toString('utf8').includes('Apache License')) {
      throw new Error('Expected Apache-2.0 license text was not found at the pinned commit');
    }
    const retrievedAt = new Date().toISOString();
    const datasetBlobSha = upstreamBlobSha(checkout.path, checkout.commit, DATASET_PATH);
    const result = buildCobolJavaTransImport({
      jsonl: readFileSync(join(checkout.path, DATASET_PATH), 'utf8'),
      commit: checkout.commit,
      datasetBlobSha,
      retrievedAt,
    });
    const upstream: UpstreamMetadata = {
      repository: REPOSITORY,
      repositoryUrl: REPOSITORY_URL.replace(/\.git$/, ''),
      commit: checkout.commit,
      retrievedAt,
      license: {
        spdx: 'Apache-2.0',
        sourcePath: LICENSE_PATH,
        sha256: sha256(license),
      },
      licenseStatus: result.manifest.licenseStatus,
      datasetDerivation:
        'The pinned README and paper state that COBOL-JavaTrans is derived from HumanEval; the paper identifies HumanEval-X as the source of Java solutions. The Phase 6.1A audit records exact upstream licenses, revisions, attribution, and byte-for-byte Java provenance for this audited dataset blob.',
      importStatistics: result.statistics,
    };
    writeFileSync(join(outputDirectory, 'LICENSE.upstream.txt'), license);
    writeImportJson(join(outputDirectory, 'upstream.json'), upstream);
    writeImportJson(join(outputDirectory, 'candidates.json'), result.manifest);
    writeImportJson(join(outputDirectory, 'review-template.json'), result.reviews);
    writeFileSync(
      join(outputDirectory, 'IMPORT_SUMMARY.md'),
      renderSummary(checkout.commit, result),
      'utf8',
    );
    process.stdout.write(
      `${JSON.stringify({ commit: checkout.commit, ...result.statistics }, null, 2)}\n`,
    );
  } finally {
    checkout.cleanup();
  }
}

function renderSummary(commit: string, result: CobolJavaTransImportResult): string {
  const compatibility = distribution(
    result.manifest.candidates.map((candidate) => candidate.contextCompatibility.status),
  );
  return `# COBOL-JavaTrans Import Summary

- Pinned upstream commit: \`${commit}\`
- Repository license: Apache-2.0
- License status: ${result.manifest.licenseStatus} (evidence is recorded only for the audited commit and dataset blob)
- HumanEval source: \`openai/human-eval@6d43fb980f9fee3c892a914eda09951f772ad10d\` (MIT)
- HumanEval-X Java source: \`zai-org/CodeGeeX@2838420b7b4492cf3d16bce5320e26e65960c9e2\` (Apache-2.0)
- Documented pair count: 143
- Actual JSONL record count: ${result.statistics.actualRecordCount}
- Imported candidate count: ${result.statistics.importedCandidateCount}
- Rejected count: ${result.statistics.rejectedCount}
- Candidates with upstream test evidence: ${result.statistics.testEvidenceCount}
- Security flags: ${result.statistics.securityFlagCount}
- Phase 3 compatibility: ${JSON.stringify(compatibility)}

RECORDED means license/provenance evidence is recorded for engineering use. It is not legal approval.
These candidates remain unscorable and are not ALSM ground truth until human review and promotion.
`;
}

function candidateIdentifier(
  upstreamCaseId: string | undefined,
  index: number,
  cobol: string,
  java: string,
): string {
  if (upstreamCaseId) {
    const normalized = upstreamCaseId
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    if (normalized) return `external-cjt-${normalized}`;
  }
  return `external-cjt-record-${String(index + 1).padStart(4, '0')}-${sha256(`${cobol}\0${java}`).slice(0, 12)}`;
}

function parseStructuredTests(value: unknown): Array<{ test: unknown; result: unknown }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    if (
      !Object.prototype.hasOwnProperty.call(record, 'test') ||
      !Object.prototype.hasOwnProperty.call(record, 'result')
    ) {
      return [];
    }
    return [{ test: record.test, result: record.result }];
  });
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function distribution(values: string[]): Record<string, number> {
  return values.reduce<Record<string, number>>((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'COBOL-JavaTrans import failed'}\n`,
    );
    process.exitCode = 1;
  }
}
