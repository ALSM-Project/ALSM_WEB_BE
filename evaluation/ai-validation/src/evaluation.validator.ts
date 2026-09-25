import * as Joi from 'joi';
import { ValidationFindingSeverity } from '../../../src/modules/validation/domain/validation-finding.types';
import {
  AiEvaluationDataset,
  AiEvaluationPredictions,
  EVALUATION_CATEGORIES,
  EvaluationCodeFile,
  EvaluationLocation,
} from './evaluation.types';

const categories = [...EVALUATION_CATEGORIES];
const severities = Object.values(ValidationFindingSeverity);
const locationSchema = Joi.object({
  file: Joi.string().trim().min(1).required(),
  startLine: Joi.number().integer().min(1).required(),
  endLine: Joi.number().integer().min(Joi.ref('startLine')).required(),
}).unknown(false);
const codeFileSchema = Joi.object({
  path: Joi.string().trim().min(1).required(),
  content: Joi.string().min(1).required(),
}).unknown(false);
const expectedFindingSchema = Joi.object({
  findingId: Joi.string().trim().min(1).required(),
  category: Joi.string()
    .valid(...categories)
    .required(),
  acceptedCategories: Joi.array()
    .items(Joi.string().valid(...categories))
    .unique()
    .min(1),
  acceptedCategoryJustification: Joi.when('acceptedCategories', {
    is: Joi.exist(),
    then: Joi.string().trim().min(1).required(),
    otherwise: Joi.forbidden(),
  }),
  severity: Joi.string()
    .valid(...severities)
    .required(),
  sourceLocation: locationSchema,
  targetLocation: locationSchema,
  allowCategoryOnly: Joi.boolean(),
  description: Joi.string().trim().min(1).required(),
  mutationId: Joi.string().trim().min(1),
})
  .or('sourceLocation', 'targetLocation', 'allowCategoryOnly')
  .unknown(false);
const mutationSchema = Joi.object({
  mutationId: Joi.string().trim().min(1).required(),
  operator: Joi.string().trim().min(1).required(),
  description: Joi.string().trim().min(1).required(),
  observableImpact: Joi.string().trim().min(1).required(),
}).unknown(false);
const caseSchema = Joi.object({
  caseId: Joi.string().trim().min(1).required(),
  title: Joi.string().trim().min(1).required(),
  description: Joi.string().trim().min(1).required(),
  sourceFiles: Joi.array().items(codeFileSchema).min(1).required(),
  targetFiles: Joi.array().items(codeFileSchema).min(1).required(),
  expectedFindings: Joi.array().items(expectedFindingSchema).required(),
  isClean: Joi.boolean().required(),
  difficulty: Joi.string().valid('EASY', 'MEDIUM', 'HARD').required(),
  mutations: Joi.array().items(mutationSchema).min(1),
  tags: Joi.array().items(Joi.string().trim().min(1)).unique().required(),
}).unknown(false);
const datasetSchema = Joi.object({
  datasetId: Joi.string().trim().min(1).required(),
  version: Joi.string()
    .pattern(/^\d+\.\d+\.\d+$/)
    .required(),
  type: Joi.string().valid('synthetic-curated').required(),
  description: Joi.string().trim().min(1).required(),
  caseCount: Joi.number().integer().min(1).required(),
  creationMethodology: Joi.string().trim().min(1).required(),
  limitations: Joi.array().items(Joi.string().trim().min(1)).min(1).required(),
  cases: Joi.array().items(caseSchema).min(1).required(),
}).unknown(false);

const predictedFindingSchema = Joi.object({
  category: Joi.string()
    .valid(...categories)
    .required(),
  severity: Joi.string()
    .valid(...severities)
    .required(),
  title: Joi.string().trim().min(1).required(),
  explanation: Joi.string().trim().min(1).required(),
  sourceLocation: locationSchema,
  targetLocation: locationSchema,
  confidence: Joi.number().min(0).max(1),
}).unknown(false);
const predictionCaseSchema = Joi.object({
  caseId: Joi.string().trim().min(1).required(),
  status: Joi.string()
    .valid('SUCCESS', 'VALIDATION_FAILED', 'PROVIDER_FAILED', 'INVALID_OUTPUT')
    .required(),
  latencyMs: Joi.number().integer().min(0),
  findings: Joi.when('status', {
    is: 'SUCCESS',
    then: Joi.array().items(predictedFindingSchema).required(),
    otherwise: Joi.forbidden(),
  }),
  failure: Joi.when('status', {
    is: 'SUCCESS',
    then: Joi.forbidden(),
    otherwise: Joi.object({
      code: Joi.string().trim().min(1).required(),
      message: Joi.string().trim().min(1).required(),
    })
      .unknown(false)
      .required(),
  }),
}).unknown(false);
const predictionsSchema = Joi.object({
  datasetId: Joi.string().trim().min(1).required(),
  datasetVersion: Joi.string().trim().min(1).required(),
  evaluatorVersion: Joi.string().trim().min(1).required(),
  generatedAt: Joi.string().isoDate().required(),
  provider: Joi.string().trim().min(1).required(),
  model: Joi.string().trim().min(1).required(),
  promptVersion: Joi.string().trim().min(1).required(),
  locationToleranceLines: Joi.number().integer().min(0).max(10).required(),
  matchingPolicyVersion: Joi.string().trim().min(1).required(),
  cases: Joi.array().items(predictionCaseSchema).min(1).required(),
}).unknown(false);

export function validateDataset(value: unknown): AiEvaluationDataset {
  const dataset = validate<AiEvaluationDataset>(datasetSchema, value, 'dataset');
  const caseIds = new Set<string>();
  const mutationIds = new Set<string>();

  if (dataset.caseCount !== dataset.cases.length) {
    throw new Error('Invalid dataset: caseCount must equal cases.length');
  }

  for (const benchmarkCase of dataset.cases) {
    assertUnique(caseIds, benchmarkCase.caseId, `duplicate caseId ${benchmarkCase.caseId}`);
    const caseFilePaths = new Set<string>();
    assertFileSet(benchmarkCase.caseId, benchmarkCase.sourceFiles, 'source', caseFilePaths);
    assertFileSet(benchmarkCase.caseId, benchmarkCase.targetFiles, 'target', caseFilePaths);

    if (benchmarkCase.isClean) {
      if (benchmarkCase.expectedFindings.length > 0 || benchmarkCase.mutations) {
        throw new Error(
          `Invalid dataset: clean case ${benchmarkCase.caseId} cannot define findings or mutations`,
        );
      }
      continue;
    }
    if (!benchmarkCase.mutations?.length || !benchmarkCase.expectedFindings.length) {
      throw new Error(
        `Invalid dataset: mutated case ${benchmarkCase.caseId} requires mutations and findings`,
      );
    }

    const caseMutationIds = new Set<string>();
    for (const mutation of benchmarkCase.mutations) {
      assertUnique(mutationIds, mutation.mutationId, `duplicate mutationId ${mutation.mutationId}`);
      caseMutationIds.add(mutation.mutationId);
    }
    const findingIds = new Set<string>();
    for (const finding of benchmarkCase.expectedFindings) {
      assertUnique(findingIds, finding.findingId, `duplicate findingId ${finding.findingId}`);
      if (!finding.mutationId || !caseMutationIds.has(finding.mutationId)) {
        throw new Error(
          `Invalid dataset: finding ${finding.findingId} must reference a mutation in ${benchmarkCase.caseId}`,
        );
      }
      assertLocationFile(benchmarkCase.caseId, finding.sourceLocation, benchmarkCase.sourceFiles);
      assertLocationFile(benchmarkCase.caseId, finding.targetLocation, benchmarkCase.targetFiles);
      if (finding.allowCategoryOnly && (finding.sourceLocation || finding.targetLocation)) {
        throw new Error(
          `Invalid dataset: category-only finding ${finding.findingId} cannot define a location`,
        );
      }
    }
  }
  return dataset;
}

export function validatePredictions(
  value: unknown,
  dataset: AiEvaluationDataset,
): AiEvaluationPredictions {
  const predictions = validate<AiEvaluationPredictions>(predictionsSchema, value, 'predictions');
  if (predictions.datasetId !== dataset.datasetId) {
    throw new Error('Invalid predictions: datasetId does not match the dataset');
  }
  if (predictions.datasetVersion !== dataset.version) {
    throw new Error('Invalid predictions: datasetVersion does not match the dataset');
  }
  const validCaseIds = new Set(dataset.cases.map((benchmarkCase) => benchmarkCase.caseId));
  const seen = new Set<string>();
  for (const result of predictions.cases) {
    if (!validCaseIds.has(result.caseId)) {
      throw new Error(`Invalid predictions: unknown caseId ${result.caseId}`);
    }
    if (seen.has(result.caseId)) {
      throw new Error(`Invalid predictions: duplicate prediction caseId ${result.caseId}`);
    }
    seen.add(result.caseId);
    if (result.status === 'SUCCESS') {
      const benchmarkCase = dataset.cases.find((candidate) => candidate.caseId === result.caseId);
      if (!benchmarkCase) throw new Error(`Invalid predictions: unknown caseId ${result.caseId}`);
      for (const finding of result.findings ?? []) {
        assertLocationFile(result.caseId, finding.sourceLocation, benchmarkCase.sourceFiles);
        assertLocationFile(result.caseId, finding.targetLocation, benchmarkCase.targetFiles);
      }
    }
  }
  return predictions;
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

function assertUnique(values: Set<string>, value: string, message: string): void {
  if (values.has(value)) throw new Error(`Invalid dataset: ${message}`);
  values.add(value);
}

function assertFileSet(
  caseId: string,
  files: EvaluationCodeFile[],
  kind: string,
  paths: Set<string>,
): void {
  for (const file of files) {
    const normalized = normalizePath(file.path);
    if (
      normalized.startsWith('/') ||
      /^[a-z]:\//.test(normalized) ||
      normalized.split('/').includes('..')
    ) {
      throw new Error(`Invalid dataset: unsafe ${kind} path in ${caseId}`);
    }
    if (paths.has(normalized)) {
      throw new Error(`Invalid dataset: duplicate file path in ${caseId}`);
    }
    paths.add(normalized);
  }
}

function assertLocationFile(
  caseId: string,
  location: EvaluationLocation | undefined,
  files: EvaluationCodeFile[],
): void {
  if (!location) return;
  const file = files.find(
    (candidate) => normalizePath(candidate.path) === normalizePath(location.file),
  );
  if (!file) {
    throw new Error(
      `Invalid dataset: location in ${caseId} references nonexistent file ${location.file}`,
    );
  }
  const lineCount = file.content.split(/\r\n|\n|\r/).length;
  if (location.endLine > lineCount) {
    throw new Error(`Invalid dataset: location in ${caseId} exceeds file line count`);
  }
}

export function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
}
