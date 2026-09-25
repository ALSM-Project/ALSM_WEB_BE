import {
  EvaluationCodeFile,
  EvaluationDifficulty,
  EvaluationMutation,
  ExpectedEvaluationFinding,
} from './evaluation.types';

export const EXTERNAL_IMPORT_SCHEMA_VERSION = '1.0.0';
export const PHASE_3_CONTEXT_LIMITS = {
  maxFiles: 50,
  maxFileCharacters: 200_000,
  maxTotalCharacters: 500_000,
} as const;

export type ExternalSourceDataset = 'COBOL_JAVATRANS' | 'AWS_CARDDEMO';
export type ExternalLicenseStatus = 'RECORDED' | 'REVIEW_REQUIRED';
export type ExternalGroundTruthStatus = 'PENDING_ALSM_REVIEW' | 'SOURCE_ONLY_PENDING_CONVERSION';
export type ContextCompatibilityStatus =
  'COMPATIBLE' | 'TOO_MANY_FILES' | 'FILE_TOO_LARGE' | 'TOTAL_TOO_LARGE' | 'UNSUPPORTED_EXTENSION';
export type DependencyStatus = 'RESOLVED' | 'UNRESOLVED';
export type ReviewStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
export type TargetJavaStatus = 'UPSTREAM_PRESENT' | 'MISSING' | 'VERIFIED';
export type TargetJavaGenerationSource =
  'ALSM_CONVERTER' | 'HUMAN_IMPLEMENTATION' | 'OTHER_VERIFIED_SOURCE';

export interface ImportedFileIntegrity {
  candidatePath: string;
  upstreamPath: string;
  upstreamBlobSha: string;
  contentSha256: string;
}

export interface ImportedCandidateProvenance {
  upstreamRepository: string;
  upstreamRepositoryUrl: string;
  upstreamCommit: string;
  upstreamPath: string;
  upstreamCaseId?: string;
  upstreamBlobSha?: string;
  fileIntegrity: ImportedFileIntegrity[];
  licenseSpdx: string;
  licensePath: string;
  noticePath?: string;
  retrievedAt: string;
}

export interface ImportedUpstreamEvidence {
  testDataPresent?: boolean;
  upstreamValidationClaim?: string;
  problemDescriptions?: {
    cobol?: string;
    java?: string;
  };
  structuredTests?: Array<{
    test: unknown;
    result: unknown;
  }>;
  javaTestSource?: string;
}

export interface ContextCompatibility {
  status: ContextCompatibilityStatus;
  sourceFileCount: number;
  targetFileCount: number;
  totalFileCount: number;
  charactersPerFile: Array<{
    path: string;
    characters: number;
  }>;
  totalCharacters: number;
  totalPreparedCharacters: number;
  limits: {
    maxFiles: number;
    maxFileCharacters: number;
    maxTotalCharacters: number;
  };
}

export interface TargetJavaProvenance {
  generationSource: TargetJavaGenerationSource;
  toolVersion: string;
  sourceCommit: string;
  verificationStatus: 'VERIFIED';
  verificationEvidence: string[];
  humanReviewers: string[];
}

export interface ImportedEvaluationCandidate {
  candidateId: string;
  sourceDataset: ExternalSourceDataset;
  sourceFiles: EvaluationCodeFile[];
  targetFiles?: EvaluationCodeFile[];
  provenance: ImportedCandidateProvenance;
  upstreamEvidence?: ImportedUpstreamEvidence;
  featureTags?: string[];
  dependencyStatus?: DependencyStatus;
  copybookDependencies?: string[];
  unresolvedDependencies?: string[];
  selectionReason?: string;
  contextCompatibility: ContextCompatibility;
  groundTruthStatus: ExternalGroundTruthStatus;
  scorable: false;
  humanReviewRequired: true;
  targetJavaProvenance?: TargetJavaProvenance;
}

export interface ImportedCandidateManifest {
  schemaVersion: typeof EXTERNAL_IMPORT_SCHEMA_VERSION;
  sourceDataset: ExternalSourceDataset;
  licenseStatus: ExternalLicenseStatus;
  candidateCount: number;
  candidates: ImportedEvaluationCandidate[];
}

export interface ImportedCaseReview {
  candidateId: string;
  reviewStatus: ReviewStatus;
  reviewers: string[];
  title: string | null;
  description: string | null;
  difficulty: EvaluationDifficulty | null;
  isClean: boolean | null;
  expectedFindings: ExpectedEvaluationFinding[] | null;
  mutations: EvaluationMutation[] | null;
  notes: string | null;
  targetJavaStatus: TargetJavaStatus;
  targetFiles?: EvaluationCodeFile[] | null;
  targetJavaProvenance?: TargetJavaProvenance | null;
}

export interface ImportedReviewManifest {
  schemaVersion: typeof EXTERNAL_IMPORT_SCHEMA_VERSION;
  sourceDataset: ExternalSourceDataset;
  reviews: ImportedCaseReview[];
}

export interface PromotionDatasetMetadata {
  datasetId: string;
  version: string;
  description: string;
  creationMethodology: string;
  limitations: string[];
}

export interface UpstreamMetadata {
  repository: string;
  repositoryUrl: string;
  commit: string;
  retrievedAt: string;
  license: {
    spdx: string;
    sourcePath: string;
    sha256: string;
  };
  notice?: {
    sourcePath: string;
    sha256: string;
  };
  licenseStatus: ExternalLicenseStatus;
  datasetDerivation?: string;
  importStatistics: Record<string, number>;
}
