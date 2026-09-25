import { writeFileSync } from 'fs';
import { resolve } from 'path';
import {
  ImportedCandidateManifest,
  ImportedCaseReview,
  PromotionDatasetMetadata,
  TargetJavaProvenance,
} from './external-import.types';
import {
  validateImportedCandidateManifest,
  validateImportedReviewManifest,
} from './external-import.validator';
import { normalizeImportedPath, sha256 } from './external-import.utils';
import { AiEvaluationCase, AiEvaluationDataset, EvaluationCodeFile } from './evaluation.types';
import { validateDataset } from './evaluation.validator';
import { parseNamedArguments, readJson } from './evaluation.io';

const NON_HUMAN_REVIEWER =
  /\b(?:openai|chatgpt|codex|llm|language model|anthropic|gemini|bedrock|static analyzer|automated)\b/i;

export function promoteImportedCases(
  candidateValue: unknown,
  reviewValue: unknown,
  metadataValue: unknown,
): AiEvaluationDataset {
  const candidates = validateImportedCandidateManifest(candidateValue);
  const reviews = validateImportedReviewManifest(reviewValue, candidates);
  const metadata = validateMetadata(metadataValue);
  if (candidates.licenseStatus !== 'RECORDED') {
    throw new Error('Promotion blocked: source license status must be RECORDED');
  }
  const candidateById = new Map(
    candidates.candidates.map((candidate) => [candidate.candidateId, candidate]),
  );
  const cases = reviews.reviews.map((review) => {
    const candidate = candidateById.get(review.candidateId);
    if (!candidate) throw new Error(`Promotion blocked: unknown candidate ${review.candidateId}`);
    assertHumanDecision(review);
    const targetFiles = promotionTargetFiles(candidates, review, candidate.targetFiles);
    const benchmarkCase: AiEvaluationCase = {
      caseId: candidate.candidateId,
      title: review.title!,
      description: review.description!,
      sourceFiles: candidate.sourceFiles,
      targetFiles,
      expectedFindings: review.expectedFindings!,
      isClean: review.isClean!,
      difficulty: review.difficulty!,
      ...(review.isClean ? {} : { mutations: review.mutations! }),
      tags: [
        ...new Set([
          'EXTERNAL_HUMAN_REVIEWED',
          candidate.sourceDataset,
          ...(candidate.featureTags ?? []),
        ]),
      ],
    };
    return benchmarkCase;
  });
  return validateDataset({
    datasetId: metadata.datasetId,
    version: metadata.version,
    type: 'human-reviewed-external',
    description: metadata.description,
    caseCount: cases.length,
    creationMethodology: metadata.creationMethodology,
    limitations: metadata.limitations,
    cases,
  });
}

function assertHumanDecision(review: ImportedCaseReview): void {
  if (review.reviewStatus !== 'APPROVED') {
    throw new Error(`Promotion blocked: ${review.candidateId} is not explicitly APPROVED`);
  }
  const reviewers = [...new Set(review.reviewers.map((reviewer) => reviewer.toLowerCase()))];
  if (reviewers.length < 2) {
    throw new Error(`Promotion blocked: ${review.candidateId} requires two distinct reviewers`);
  }
  if (review.reviewers.some((reviewer) => NON_HUMAN_REVIEWER.test(reviewer))) {
    throw new Error(`Promotion blocked: ${review.candidateId} contains a non-human reviewer ID`);
  }
  if (!review.title || !review.description || !review.difficulty) {
    throw new Error(`Promotion blocked: ${review.candidateId} requires reviewed case metadata`);
  }
  if (typeof review.isClean !== 'boolean') {
    throw new Error(
      `Promotion blocked: ${review.candidateId} requires an explicit isClean decision`,
    );
  }
  if (!Array.isArray(review.expectedFindings)) {
    throw new Error(`Promotion blocked: ${review.candidateId} requires explicit expectedFindings`);
  }
  if (review.isClean && review.expectedFindings.length !== 0) {
    throw new Error(
      `Promotion blocked: clean case ${review.candidateId} requires explicit [] findings`,
    );
  }
  if (!review.isClean && (review.expectedFindings.length === 0 || !review.mutations?.length)) {
    throw new Error(
      `Promotion blocked: defective case ${review.candidateId} requires findings and mutations`,
    );
  }
  if (review.isClean && review.mutations !== null) {
    throw new Error(`Promotion blocked: clean case ${review.candidateId} cannot define mutations`);
  }
}

function promotionTargetFiles(
  candidates: ImportedCandidateManifest,
  review: ImportedCaseReview,
  upstreamTargets: EvaluationCodeFile[] | undefined,
): EvaluationCodeFile[] {
  if (candidates.sourceDataset === 'COBOL_JAVATRANS') {
    if (review.targetJavaStatus !== 'UPSTREAM_PRESENT' || !upstreamTargets?.length) {
      throw new Error(`Promotion blocked: ${review.candidateId} lacks its upstream Java target`);
    }
    return upstreamTargets;
  }
  if (
    review.targetJavaStatus !== 'VERIFIED' ||
    !review.targetFiles?.length ||
    !review.targetJavaProvenance
  ) {
    throw new Error(
      `Promotion blocked: AWS candidate ${review.candidateId} requires verified target Java`,
    );
  }
  assertTargetJavaProvenance(review.targetFiles, review.targetJavaProvenance, review.candidateId);
  return review.targetFiles;
}

function assertTargetJavaProvenance(
  targetFiles: EvaluationCodeFile[],
  provenance: TargetJavaProvenance,
  candidateId: string,
): void {
  const humanReviewers = [
    ...new Set(provenance.humanReviewers.map((reviewer) => reviewer.toLowerCase())),
  ];
  if (
    provenance.verificationStatus !== 'VERIFIED' ||
    humanReviewers.length < 2 ||
    provenance.humanReviewers.some((reviewer) => NON_HUMAN_REVIEWER.test(reviewer))
  ) {
    throw new Error(`Promotion blocked: AWS target verification is incomplete for ${candidateId}`);
  }
  const integrity = new Map(
    provenance.fileIntegrity.map((entry) => [
      normalizeImportedPath(entry.path).toLowerCase(),
      entry,
    ]),
  );
  for (const file of targetFiles) {
    const entry = integrity.get(normalizeImportedPath(file.path).toLowerCase());
    if (!entry || entry.contentSha256 !== sha256(file.content)) {
      throw new Error(`Promotion blocked: AWS target Java hash mismatch for ${candidateId}`);
    }
  }
  if (integrity.size !== targetFiles.length) {
    throw new Error(
      `Promotion blocked: AWS target Java integrity count mismatch for ${candidateId}`,
    );
  }
}

function validateMetadata(value: unknown): PromotionDatasetMetadata {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Promotion metadata must be an object');
  }
  const metadata = value as Partial<PromotionDatasetMetadata>;
  if (
    !metadata.datasetId?.trim() ||
    !metadata.version?.match(/^\d+\.\d+\.\d+$/) ||
    !metadata.description?.trim() ||
    !metadata.creationMethodology?.trim() ||
    !Array.isArray(metadata.limitations) ||
    metadata.limitations.length === 0 ||
    metadata.limitations.some((limitation) => !limitation.trim())
  ) {
    throw new Error('Promotion metadata is incomplete');
  }
  return metadata as PromotionDatasetMetadata;
}

function main(): void {
  const args = parseNamedArguments(
    process.argv.slice(2),
    new Set(['candidates', 'reviews', 'metadata', 'output']),
  );
  const candidatePath = required(args, 'candidates');
  const reviewPath = required(args, 'reviews');
  const metadataPath = required(args, 'metadata');
  const outputPath = required(args, 'output');
  const dataset = promoteImportedCases(
    readJson(candidatePath),
    readJson(reviewPath),
    readJson(metadataPath),
  );
  writeFileSync(resolve(outputPath), `${JSON.stringify(dataset, null, 2)}\n`, 'utf8');
  process.stdout.write(`Promoted ${dataset.caseCount} human-reviewed case(s) to ${outputPath}\n`);
}

function required(args: Map<string, string>, name: string): string {
  const value = args.get(name);
  if (!value) throw new Error(`Missing required argument --${name}`);
  return value;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'Candidate promotion failed'}\n`,
    );
    process.exitCode = 1;
  }
}
