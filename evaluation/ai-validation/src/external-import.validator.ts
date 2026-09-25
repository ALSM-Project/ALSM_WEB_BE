import * as Joi from 'joi';
import {
  EXTERNAL_IMPORT_SCHEMA_VERSION,
  ImportedCandidateManifest,
  ImportedReviewManifest,
  PHASE_3_CONTEXT_LIMITS,
} from './external-import.types';
import {
  calculateContextCompatibility,
  normalizeImportedPath,
  sha256,
} from './external-import.utils';
import { EVALUATION_CATEGORIES } from './evaluation.types';
import { ValidationFindingSeverity } from '../../../src/modules/validation/domain/validation-finding.types';

const sourceDatasets = ['COBOL_JAVATRANS', 'AWS_CARDDEMO'];
const sha256Pattern = /^[a-f0-9]{64}$/;
const gitShaPattern = /^[a-f0-9]{40}$/;
const codeFileSchema = Joi.object({
  path: Joi.string().min(1).required(),
  content: Joi.string().min(1).required(),
}).unknown(false);
const integritySchema = Joi.object({
  candidatePath: Joi.string().min(1).required(),
  upstreamPath: Joi.string().min(1).required(),
  upstreamBlobSha: Joi.string().pattern(gitShaPattern).required(),
  contentSha256: Joi.string().pattern(sha256Pattern).required(),
}).unknown(false);
const contextSchema = Joi.object({
  status: Joi.string()
    .valid(
      'COMPATIBLE',
      'TOO_MANY_FILES',
      'FILE_TOO_LARGE',
      'TOTAL_TOO_LARGE',
      'UNSUPPORTED_EXTENSION',
    )
    .required(),
  sourceFileCount: Joi.number().integer().min(1).required(),
  targetFileCount: Joi.number().integer().min(0).required(),
  totalFileCount: Joi.number().integer().min(1).required(),
  charactersPerFile: Joi.array()
    .items(
      Joi.object({
        path: Joi.string().min(1).required(),
        characters: Joi.number().integer().min(1).required(),
      }).unknown(false),
    )
    .min(1)
    .required(),
  totalCharacters: Joi.number().integer().min(1).required(),
  totalPreparedCharacters: Joi.number().integer().min(1).required(),
  limits: Joi.object({
    maxFiles: Joi.number().valid(PHASE_3_CONTEXT_LIMITS.maxFiles).required(),
    maxFileCharacters: Joi.number().valid(PHASE_3_CONTEXT_LIMITS.maxFileCharacters).required(),
    maxTotalCharacters: Joi.number().valid(PHASE_3_CONTEXT_LIMITS.maxTotalCharacters).required(),
  })
    .unknown(false)
    .required(),
}).unknown(false);
const targetJavaProvenanceSchema = Joi.object({
  generationSource: Joi.string()
    .valid('ALSM_CONVERTER', 'HUMAN_IMPLEMENTATION', 'OTHER_VERIFIED_SOURCE')
    .required(),
  toolVersion: Joi.string().trim().min(1).required(),
  sourceCommit: Joi.string().trim().min(1).required(),
  verificationStatus: Joi.string().valid('VERIFIED').required(),
  verificationEvidence: Joi.array().items(Joi.string().trim().min(1)).min(1).required(),
  humanReviewers: Joi.array().items(Joi.string().trim().min(1)).min(2).unique().required(),
}).unknown(false);
const provenanceSchema = Joi.object({
  upstreamRepository: Joi.string()
    .pattern(/^[^/\s]+\/[^/\s]+$/)
    .required(),
  upstreamRepositoryUrl: Joi.string()
    .uri({ scheme: ['https'] })
    .required(),
  upstreamCommit: Joi.string().pattern(gitShaPattern).required(),
  upstreamPath: Joi.string().min(1).required(),
  upstreamCaseId: Joi.string().min(1),
  upstreamBlobSha: Joi.string().pattern(gitShaPattern),
  fileIntegrity: Joi.array().items(integritySchema).min(1).required(),
  licenseSpdx: Joi.string().valid('Apache-2.0').required(),
  licensePath: Joi.string().min(1).required(),
  noticePath: Joi.string().min(1),
  retrievedAt: Joi.string().isoDate().required(),
}).unknown(false);
const upstreamEvidenceSchema = Joi.object({
  testDataPresent: Joi.boolean(),
  upstreamValidationClaim: Joi.string().min(1),
  problemDescriptions: Joi.object({
    cobol: Joi.string().allow(''),
    java: Joi.string().allow(''),
  }).unknown(false),
  structuredTests: Joi.array().items(
    Joi.object({ test: Joi.any().required(), result: Joi.any().required() }).unknown(false),
  ),
  javaTestSource: Joi.string().allow(''),
}).unknown(false);
const candidateSchema = Joi.object({
  candidateId: Joi.string()
    .pattern(/^[a-z0-9][a-z0-9-]*$/)
    .required(),
  sourceDataset: Joi.string()
    .valid(...sourceDatasets)
    .required(),
  sourceFiles: Joi.array().items(codeFileSchema).min(1).required(),
  targetFiles: Joi.array().items(codeFileSchema).min(1),
  provenance: provenanceSchema.required(),
  upstreamEvidence: upstreamEvidenceSchema,
  featureTags: Joi.array()
    .items(Joi.string().pattern(/^[A-Z0-9_]+$/))
    .unique(),
  dependencyStatus: Joi.string().valid('RESOLVED', 'UNRESOLVED'),
  copybookDependencies: Joi.array().items(Joi.string().min(1)).unique(),
  unresolvedDependencies: Joi.array().items(Joi.string().min(1)).unique(),
  selectionReason: Joi.string().min(1),
  contextCompatibility: contextSchema.required(),
  groundTruthStatus: Joi.string()
    .valid('PENDING_ALSM_REVIEW', 'SOURCE_ONLY_PENDING_CONVERSION')
    .required(),
  scorable: Joi.boolean().valid(false).required(),
  humanReviewRequired: Joi.boolean().valid(true).required(),
  targetJavaProvenance: targetJavaProvenanceSchema,
}).unknown(false);
const manifestSchema = Joi.object({
  schemaVersion: Joi.string().valid(EXTERNAL_IMPORT_SCHEMA_VERSION).required(),
  sourceDataset: Joi.string()
    .valid(...sourceDatasets)
    .required(),
  licenseStatus: Joi.string().valid('RECORDED', 'REVIEW_REQUIRED').required(),
  candidateCount: Joi.number().integer().min(1).required(),
  candidates: Joi.array().items(candidateSchema).min(1).required(),
}).unknown(false);

const locationSchema = Joi.object({
  file: Joi.string().min(1).required(),
  startLine: Joi.number().integer().min(1).required(),
  endLine: Joi.number().integer().min(Joi.ref('startLine')).required(),
}).unknown(false);
const findingSchema = Joi.object({
  findingId: Joi.string().trim().min(1).required(),
  category: Joi.string()
    .valid(...EVALUATION_CATEGORIES)
    .required(),
  acceptedCategories: Joi.array()
    .items(Joi.string().valid(...EVALUATION_CATEGORIES))
    .unique()
    .min(1),
  acceptedCategoryJustification: Joi.string().trim().min(1),
  severity: Joi.string()
    .valid(...Object.values(ValidationFindingSeverity))
    .required(),
  sourceLocation: locationSchema,
  targetLocation: locationSchema,
  allowCategoryOnly: Joi.boolean(),
  description: Joi.string().trim().min(1).required(),
  mutationId: Joi.string().trim().min(1),
}).unknown(false);
const mutationSchema = Joi.object({
  mutationId: Joi.string().trim().min(1).required(),
  operator: Joi.string().trim().min(1).required(),
  description: Joi.string().trim().min(1).required(),
  observableImpact: Joi.string().trim().min(1).required(),
}).unknown(false);
const reviewSchema = Joi.object({
  candidateId: Joi.string().min(1).required(),
  reviewStatus: Joi.string().valid('PENDING', 'APPROVED', 'REJECTED').required(),
  reviewers: Joi.array().items(Joi.string().trim().min(1)).unique().required(),
  title: Joi.string().trim().min(1).allow(null).required(),
  description: Joi.string().trim().min(1).allow(null).required(),
  difficulty: Joi.string().valid('EASY', 'MEDIUM', 'HARD').allow(null).required(),
  isClean: Joi.boolean().allow(null).required(),
  expectedFindings: Joi.array().items(findingSchema).allow(null).required(),
  mutations: Joi.array().items(mutationSchema).allow(null).required(),
  notes: Joi.string().allow(null).required(),
  targetJavaStatus: Joi.string().valid('UPSTREAM_PRESENT', 'MISSING', 'VERIFIED').required(),
  targetFiles: Joi.array().items(codeFileSchema).min(1).allow(null),
  targetJavaProvenance: targetJavaProvenanceSchema.allow(null),
}).unknown(false);
const reviewManifestSchema = Joi.object({
  schemaVersion: Joi.string().valid(EXTERNAL_IMPORT_SCHEMA_VERSION).required(),
  sourceDataset: Joi.string()
    .valid(...sourceDatasets)
    .required(),
  reviews: Joi.array().items(reviewSchema).min(1).required(),
}).unknown(false);

export function validateImportedCandidateManifest(value: unknown): ImportedCandidateManifest {
  const manifest = validate<ImportedCandidateManifest>(manifestSchema, value, 'candidate manifest');
  if (manifest.candidateCount !== manifest.candidates.length) {
    throw new Error('Invalid candidate manifest: candidateCount must equal candidates.length');
  }
  const candidateIds = new Set<string>();
  for (const candidate of manifest.candidates) {
    if (candidateIds.has(candidate.candidateId)) {
      throw new Error(`Invalid candidate manifest: duplicate candidateId ${candidate.candidateId}`);
    }
    candidateIds.add(candidate.candidateId);
    if (candidate.sourceDataset !== manifest.sourceDataset) {
      throw new Error(
        `Invalid candidate manifest: sourceDataset mismatch in ${candidate.candidateId}`,
      );
    }
    assertDatasetRules(candidate);
    assertFilesAndHashes(candidate);
    const calculated = calculateContextCompatibility(candidate.sourceFiles, candidate.targetFiles);
    if (JSON.stringify(calculated) !== JSON.stringify(candidate.contextCompatibility)) {
      throw new Error(
        `Invalid candidate manifest: context compatibility mismatch in ${candidate.candidateId}`,
      );
    }
  }
  return manifest;
}

export function validateImportedReviewManifest(
  value: unknown,
  candidates?: ImportedCandidateManifest,
): ImportedReviewManifest {
  const reviews = validate<ImportedReviewManifest>(reviewManifestSchema, value, 'review manifest');
  const seen = new Set<string>();
  const candidateIds = new Set(candidates?.candidates.map((candidate) => candidate.candidateId));
  for (const review of reviews.reviews) {
    if (seen.has(review.candidateId)) {
      throw new Error(`Invalid review manifest: duplicate candidateId ${review.candidateId}`);
    }
    seen.add(review.candidateId);
    if (candidates && !candidateIds.has(review.candidateId)) {
      throw new Error(`Invalid review manifest: unknown candidateId ${review.candidateId}`);
    }
  }
  if (candidates && reviews.sourceDataset !== candidates.sourceDataset) {
    throw new Error('Invalid review manifest: sourceDataset does not match candidates');
  }
  return reviews;
}

function assertDatasetRules(candidate: ImportedCandidateManifest['candidates'][number]): void {
  if (candidate.sourceDataset === 'COBOL_JAVATRANS') {
    if (candidate.groundTruthStatus !== 'PENDING_ALSM_REVIEW' || !candidate.targetFiles?.length) {
      throw new Error(
        `Invalid candidate manifest: invalid COBOL-JavaTrans candidate ${candidate.candidateId}`,
      );
    }
  } else if (
    candidate.groundTruthStatus !== 'SOURCE_ONLY_PENDING_CONVERSION' ||
    candidate.targetFiles !== undefined ||
    candidate.targetJavaProvenance !== undefined ||
    !candidate.dependencyStatus ||
    !candidate.selectionReason
  ) {
    throw new Error(
      `Invalid candidate manifest: invalid AWS source-only candidate ${candidate.candidateId}`,
    );
  }
}

function assertFilesAndHashes(candidate: ImportedCandidateManifest['candidates'][number]): void {
  const files = [...candidate.sourceFiles, ...(candidate.targetFiles ?? [])];
  const paths = new Set<string>();
  for (const file of files) {
    const normalized = normalizeImportedPath(file.path).toLowerCase();
    if (paths.has(normalized)) {
      throw new Error(
        `Invalid candidate manifest: duplicate normalized path in ${candidate.candidateId}`,
      );
    }
    paths.add(normalized);
  }
  if (candidate.provenance.fileIntegrity.length !== files.length) {
    throw new Error(
      `Invalid candidate manifest: file integrity count mismatch in ${candidate.candidateId}`,
    );
  }
  const integrityByPath = new Map(
    candidate.provenance.fileIntegrity.map((entry) => [
      normalizeImportedPath(entry.candidatePath).toLowerCase(),
      entry,
    ]),
  );
  for (const file of files) {
    const integrity = integrityByPath.get(normalizeImportedPath(file.path).toLowerCase());
    if (!integrity || integrity.contentSha256 !== sha256(file.content)) {
      throw new Error(`Invalid candidate manifest: content hash mismatch for ${file.path}`);
    }
    normalizeImportedPath(integrity.upstreamPath);
  }
}

function validate<T>(schema: Joi.Schema, value: unknown, label: string): T {
  const result = schema.validate(value, { abortEarly: false, convert: false });
  if (result.error) {
    throw new Error(
      `Invalid ${label}: ${result.error.details.map((detail) => detail.message).join('; ')}`,
    );
  }
  return result.value as T;
}
