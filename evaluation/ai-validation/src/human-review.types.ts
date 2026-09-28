import { EvaluationDifficulty } from './evaluation.types';

export const HUMAN_REVIEW_PILOT_SCHEMA_VERSION = '1.0.0' as const;
export const COBOL_JAVATRANS_PILOT_ID = 'cobol-javatrans-pilot-v1' as const;

export type PilotSizeStratum = 'SMALL' | 'MEDIUM' | 'LARGE';
export type EquivalenceDecision = 'CLEAN' | 'NOT_CLEAN_OR_UNCERTAIN';
export type ReviewComparisonState =
  | 'READY_CLEAN'
  | 'DISAGREEMENT'
  | 'NEEDS_REVIEW'
  | 'NOT_CLEAN_OR_UNCERTAIN';

export interface PilotCandidateProvenance {
  upstreamRepository: string;
  upstreamRepositoryUrl: string;
  upstreamCommit: string;
  upstreamPath: string;
  upstreamCaseId?: string;
  upstreamBlobSha?: string;
  licenseSpdx: string;
  licensePath: string;
}

export interface PilotSelectedCandidate {
  candidateId: string;
  sourcePath: string;
  targetPath: string;
  totalCharacters: number;
  sizeStratum: PilotSizeStratum;
  testEvidencePresent: boolean;
  contextCompatibility: 'COMPATIBLE';
  sourceSha256: string;
  targetSha256: string;
  provenance: PilotCandidateProvenance;
}

export interface PilotSelectionManifest {
  schemaVersion: typeof HUMAN_REVIEW_PILOT_SCHEMA_VERSION;
  pilotId: typeof COBOL_JAVATRANS_PILOT_ID;
  version: '1.0.0';
  sourceDataset: 'COBOL_JAVATRANS';
  sourceCandidateManifest: string;
  sourceCandidateManifestHash: string;
  selectionAlgorithm: string;
  selectedAt: string;
  selectionHash: string;
  eligibleCandidateCount: number;
  selectedCandidates: PilotSelectedCandidate[];
}

export interface PilotReviewDecision {
  candidateId: string;
  reviewerId: string | null;
  reviewedAt: string | null;
  equivalenceDecision: EquivalenceDecision | null;
  notes: string | null;
  sourceSha256: string;
  targetSha256: string;
}

export interface PilotReviewFile {
  schemaVersion: typeof HUMAN_REVIEW_PILOT_SCHEMA_VERSION;
  pilotId: typeof COBOL_JAVATRANS_PILOT_ID;
  selectionHash: string;
  reviewerRole: 'A' | 'B';
  decisions: PilotReviewDecision[];
}

export interface PilotComparisonCase {
  candidateId: string;
  state: ReviewComparisonState;
  reviewerA: PilotReviewDecision | null;
  reviewerB: PilotReviewDecision | null;
}

export interface PilotComparison {
  schemaVersion: typeof HUMAN_REVIEW_PILOT_SCHEMA_VERSION;
  pilotId: typeof COBOL_JAVATRANS_PILOT_ID;
  selectionHash: string;
  cases: PilotComparisonCase[];
  counts: Record<ReviewComparisonState, number>;
}

export interface PilotFinalizationCase {
  candidateId: string;
  sourceSha256: string;
  targetSha256: string;
  title: string | null;
  description: string | null;
  difficulty: EvaluationDifficulty | null;
}

export interface PilotFinalizationFile {
  schemaVersion: typeof HUMAN_REVIEW_PILOT_SCHEMA_VERSION;
  pilotId: typeof COBOL_JAVATRANS_PILOT_ID;
  selectionHash: string;
  cases: PilotFinalizationCase[];
}
