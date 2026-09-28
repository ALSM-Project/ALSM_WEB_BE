import { ImportedCandidateManifest, ImportedEvaluationCandidate } from './external-import.types';
import { sha256 } from './external-import.utils';
import { validateImportedCandidateManifest } from './external-import.validator';
import {
  COBOL_JAVATRANS_PILOT_ID,
  HUMAN_REVIEW_PILOT_SCHEMA_VERSION,
  PilotFinalizationFile,
  PilotReviewFile,
  PilotSelectedCandidate,
  PilotSelectionManifest,
  PilotSizeStratum,
} from './human-review.types';

export const PILOT_SELECTION_ALGORITHM =
  'Validate the pinned COBOL_JAVATRANS manifest; retain pending, unscorable, human-review-required, context-compatible candidates with non-empty COBOL and upstream Java files, complete provenance, and matching SHA-256 integrity. Sort eligible candidates by total COBOL+Java characters ascending then candidateId ascending. Split that ordered list at ceil(n/3) and ceil(2n/3) into SMALL, MEDIUM, and LARGE. Within each stratum rank candidates with upstream test evidence first, then SHA-256(pilotId + ":" + stratum + ":" + candidateId) ascending, then candidateId ascending; select the first five.';

const sha256Pattern = /^[a-f0-9]{64}$/;

export function isEligiblePilotCandidate(candidate: ImportedEvaluationCandidate): boolean {
  const sourceFiles = candidate.sourceFiles.filter((file) => /\.(?:cbl|cob|cobol)$/i.test(file.path));
  const targetFiles = (candidate.targetFiles ?? []).filter((file) => /\.java$/i.test(file.path));
  const allFiles = [...candidate.sourceFiles, ...(candidate.targetFiles ?? [])];
  const integrity = new Map(
    candidate.provenance.fileIntegrity.map((entry) => [entry.candidatePath.toLowerCase(), entry]),
  );
  const hashesMatch = allFiles.every((file) => {
    const entry = integrity.get(file.path.toLowerCase());
    return Boolean(entry && entry.contentSha256 === sha256(file.content));
  });
  const provenanceComplete = Boolean(
    candidate.provenance.upstreamRepository &&
      candidate.provenance.upstreamRepositoryUrl &&
      candidate.provenance.upstreamCommit &&
      candidate.provenance.upstreamPath &&
      candidate.provenance.licenseSpdx &&
      candidate.provenance.licensePath &&
      candidate.provenance.fileIntegrity.length === allFiles.length,
  );
  return (
    candidate.sourceDataset === 'COBOL_JAVATRANS' &&
    candidate.groundTruthStatus === 'PENDING_ALSM_REVIEW' &&
    candidate.scorable === false &&
    candidate.humanReviewRequired === true &&
    candidate.contextCompatibility.status === 'COMPATIBLE' &&
    sourceFiles.length > 0 &&
    sourceFiles.every((file) => file.content.length > 0) &&
    targetFiles.length > 0 &&
    targetFiles.every((file) => file.content.length > 0) &&
    provenanceComplete &&
    hashesMatch
  );
}

export function preparePilotSelection(
  candidateValue: unknown,
  sourceCandidateManifest: string,
  sourceCandidateManifestHash: string,
  selectedAt: string,
): PilotSelectionManifest {
  const manifest = validateImportedCandidateManifest(candidateValue);
  if (manifest.sourceDataset !== 'COBOL_JAVATRANS') {
    throw new Error('Pilot selection requires sourceDataset COBOL_JAVATRANS');
  }
  if (manifest.licenseStatus !== 'RECORDED') {
    throw new Error('Pilot selection requires licenseStatus RECORDED');
  }
  if (!sha256Pattern.test(sourceCandidateManifestHash)) {
    throw new Error('Pilot selection requires a SHA-256 source manifest hash');
  }
  if (!isIsoDate(selectedAt)) throw new Error('Pilot selection requires an ISO selectedAt value');

  const eligible = manifest.candidates
    .filter(isEligiblePilotCandidate)
    .map((candidate) => ({ candidate, totalCharacters: totalCharacters(candidate) }))
    .sort(
      (left, right) =>
        left.totalCharacters - right.totalCharacters ||
        left.candidate.candidateId.localeCompare(right.candidate.candidateId),
    );
  if (eligible.length < 15) throw new Error('Pilot selection requires at least 15 eligible cases');

  const firstCut = Math.ceil(eligible.length / 3);
  const secondCut = Math.ceil((2 * eligible.length) / 3);
  const strata: Array<{
    name: PilotSizeStratum;
    values: typeof eligible;
  }> = [
    { name: 'SMALL', values: eligible.slice(0, firstCut) },
    { name: 'MEDIUM', values: eligible.slice(firstCut, secondCut) },
    { name: 'LARGE', values: eligible.slice(secondCut) },
  ];

  const selectedCandidates = strata.flatMap(({ name, values }) =>
    values
      .map((entry) => ({ ...entry, testEvidencePresent: hasTestEvidence(entry.candidate) }))
      .sort(
        (left, right) =>
          Number(right.testEvidencePresent) - Number(left.testEvidencePresent) ||
          selectionRank(name, left.candidate.candidateId).localeCompare(
            selectionRank(name, right.candidate.candidateId),
          ) ||
          left.candidate.candidateId.localeCompare(right.candidate.candidateId),
      )
      .slice(0, 5)
      .map(({ candidate, totalCharacters: characters }) =>
        toSelectedCandidate(candidate, characters, name),
      ),
  );

  const binding = {
    pilotId: COBOL_JAVATRANS_PILOT_ID,
    version: '1.0.0' as const,
    sourceDataset: 'COBOL_JAVATRANS' as const,
    sourceCandidateManifest,
    sourceCandidateManifestHash,
    selectionAlgorithm: PILOT_SELECTION_ALGORITHM,
    eligibleCandidateCount: eligible.length,
    selectedCandidates,
  };
  return {
    schemaVersion: HUMAN_REVIEW_PILOT_SCHEMA_VERSION,
    ...binding,
    selectedAt,
    selectionHash: sha256(stableStringify(binding)),
  };
}

export function validatePilotSelection(
  value: unknown,
  candidates?: ImportedCandidateManifest,
  sourceCandidateManifestHash?: string,
): PilotSelectionManifest {
  if (!isRecord(value)) throw new Error('Invalid pilot selection: expected an object');
  const selection = value as unknown as PilotSelectionManifest;
  if (
    selection.schemaVersion !== HUMAN_REVIEW_PILOT_SCHEMA_VERSION ||
    selection.pilotId !== COBOL_JAVATRANS_PILOT_ID ||
    selection.version !== '1.0.0' ||
    selection.sourceDataset !== 'COBOL_JAVATRANS' ||
    !selection.sourceCandidateManifest ||
    !sha256Pattern.test(selection.sourceCandidateManifestHash ?? '') ||
    selection.selectionAlgorithm !== PILOT_SELECTION_ALGORITHM ||
    !isIsoDate(selection.selectedAt) ||
    !sha256Pattern.test(selection.selectionHash ?? '') ||
    !Number.isInteger(selection.eligibleCandidateCount) ||
    selection.eligibleCandidateCount < 15 ||
    !Array.isArray(selection.selectedCandidates) ||
    selection.selectedCandidates.length !== 15
  ) {
    throw new Error('Invalid pilot selection: required fields are missing or invalid');
  }
  const counts = { SMALL: 0, MEDIUM: 0, LARGE: 0 };
  const ids = new Set<string>();
  for (const selected of selection.selectedCandidates) {
    if (
      !selected.candidateId ||
      ids.has(selected.candidateId) ||
      !selected.sourcePath ||
      !selected.targetPath ||
      !Number.isInteger(selected.totalCharacters) ||
      selected.totalCharacters < 1 ||
      !['SMALL', 'MEDIUM', 'LARGE'].includes(selected.sizeStratum) ||
      typeof selected.testEvidencePresent !== 'boolean' ||
      selected.contextCompatibility !== 'COMPATIBLE' ||
      !sha256Pattern.test(selected.sourceSha256) ||
      !sha256Pattern.test(selected.targetSha256) ||
      !selected.provenance
    ) {
      throw new Error(`Invalid pilot selection: malformed candidate ${selected.candidateId ?? ''}`);
    }
    ids.add(selected.candidateId);
    counts[selected.sizeStratum] += 1;
  }
  if (counts.SMALL !== 5 || counts.MEDIUM !== 5 || counts.LARGE !== 5) {
    throw new Error('Invalid pilot selection: expected five candidates in each size stratum');
  }
  const binding = {
    pilotId: selection.pilotId,
    version: selection.version,
    sourceDataset: selection.sourceDataset,
    sourceCandidateManifest: selection.sourceCandidateManifest,
    sourceCandidateManifestHash: selection.sourceCandidateManifestHash,
    selectionAlgorithm: selection.selectionAlgorithm,
    eligibleCandidateCount: selection.eligibleCandidateCount,
    selectedCandidates: selection.selectedCandidates,
  };
  if (selection.selectionHash !== sha256(stableStringify(binding))) {
    throw new Error('Invalid pilot selection: selection hash mismatch');
  }
  if (
    sourceCandidateManifestHash &&
    selection.sourceCandidateManifestHash !== sourceCandidateManifestHash
  ) {
    throw new Error('Invalid pilot selection: source candidate manifest hash mismatch');
  }
  if (candidates) assertSelectionMatchesCandidates(selection, candidates);
  return selection;
}

export function createReviewTemplate(
  selection: PilotSelectionManifest,
  reviewerRole: 'A' | 'B',
): PilotReviewFile {
  return {
    schemaVersion: HUMAN_REVIEW_PILOT_SCHEMA_VERSION,
    pilotId: selection.pilotId,
    selectionHash: selection.selectionHash,
    reviewerRole,
    decisions: selection.selectedCandidates.map((candidate) => ({
      candidateId: candidate.candidateId,
      reviewerId: null,
      reviewedAt: null,
      equivalenceDecision: null,
      notes: null,
      sourceSha256: candidate.sourceSha256,
      targetSha256: candidate.targetSha256,
    })),
  };
}

export function createFinalizationTemplate(
  selection: PilotSelectionManifest,
): PilotFinalizationFile {
  return {
    schemaVersion: HUMAN_REVIEW_PILOT_SCHEMA_VERSION,
    pilotId: selection.pilotId,
    selectionHash: selection.selectionHash,
    cases: selection.selectedCandidates.map((candidate) => ({
      candidateId: candidate.candidateId,
      sourceSha256: candidate.sourceSha256,
      targetSha256: candidate.targetSha256,
      title: null,
      description: null,
      difficulty: null,
    })),
  };
}

export function renderPilotSummary(
  selection: PilotSelectionManifest,
  candidates: ImportedCandidateManifest,
): string {
  const byId = new Map(candidates.candidates.map((candidate) => [candidate.candidateId, candidate]));
  const lines = [
    '# COBOL-JavaTrans Human Review Pilot v1',
    '',
    `- Pilot: \`${selection.pilotId}\``,
    `- Source dataset: \`${selection.sourceDataset}\``,
    `- Eligible candidates: ${selection.eligibleCandidateCount}`,
    `- Selected candidates: ${selection.selectedCandidates.length}`,
    '- Size strata: 5 SMALL, 5 MEDIUM, 5 LARGE',
    `- Selection hash: \`${selection.selectionHash}\``,
    '',
    'Size strata describe source-plus-target character count only. They do not express semantic difficulty.',
    'Upstream tests are evidence only and never establish ALSM human approval.',
    '',
  ];
  for (const selected of selection.selectedCandidates) {
    const candidate = byId.get(selected.candidateId)!;
    const structuredTests = candidate.upstreamEvidence?.structuredTests?.length ?? 0;
    lines.push(
      `## ${selected.candidateId}`,
      '',
      `- Size stratum: ${selected.sizeStratum} (${selected.totalCharacters} characters)`,
      `- COBOL source: \`${selected.sourcePath}\` in \`${selection.sourceCandidateManifest}\``,
      `- Java target: \`${selected.targetPath}\` in \`${selection.sourceCandidateManifest}\``,
      `- Context compatibility: ${selected.contextCompatibility}`,
      `- Upstream test evidence: ${selected.testEvidencePresent ? 'present' : 'not present'} (${structuredTests} structured COBOL test(s); Java test source ${candidate.upstreamEvidence?.javaTestSource ? 'present' : 'absent'})`,
      `- COBOL SHA-256: \`${selected.sourceSha256}\``,
      `- Java SHA-256: \`${selected.targetSha256}\``,
      `- Provenance: \`${selected.provenance.upstreamRepository}@${selected.provenance.upstreamCommit}\`, \`${selected.provenance.upstreamPath}\`, case \`${selected.provenance.upstreamCaseId ?? 'not recorded'}\``,
      `- License evidence: \`${selected.provenance.licenseSpdx}\` at \`${selected.provenance.licensePath}\``,
      `- Task/problem description: ${extractTaskDescription(candidate)}`,
      '',
    );
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

function assertSelectionMatchesCandidates(
  selection: PilotSelectionManifest,
  candidates: ImportedCandidateManifest,
): void {
  if (candidates.sourceDataset !== 'COBOL_JAVATRANS' || candidates.licenseStatus !== 'RECORDED') {
    throw new Error('Invalid pilot selection: source manifest is not recorded COBOL_JAVATRANS');
  }
  const byId = new Map(candidates.candidates.map((candidate) => [candidate.candidateId, candidate]));
  for (const selected of selection.selectedCandidates) {
    const candidate = byId.get(selected.candidateId);
    if (!candidate || !isEligiblePilotCandidate(candidate)) {
      throw new Error(`Invalid pilot selection: ineligible or unknown candidate ${selected.candidateId}`);
    }
    const current = toSelectedCandidate(candidate, totalCharacters(candidate), selected.sizeStratum);
    if (
      current.sourcePath !== selected.sourcePath ||
      current.targetPath !== selected.targetPath ||
      current.totalCharacters !== selected.totalCharacters ||
      current.sourceSha256 !== selected.sourceSha256 ||
      current.targetSha256 !== selected.targetSha256 ||
      stableStringify(current.provenance) !== stableStringify(selected.provenance)
    ) {
      throw new Error(`Invalid pilot selection: candidate binding mismatch for ${selected.candidateId}`);
    }
  }
}

function toSelectedCandidate(
  candidate: ImportedEvaluationCandidate,
  characters: number,
  sizeStratum: PilotSizeStratum,
): PilotSelectedCandidate {
  const source = candidate.sourceFiles.find((file) => /\.(?:cbl|cob|cobol)$/i.test(file.path))!;
  const target = candidate.targetFiles!.find((file) => /\.java$/i.test(file.path))!;
  return {
    candidateId: candidate.candidateId,
    sourcePath: source.path,
    targetPath: target.path,
    totalCharacters: characters,
    sizeStratum,
    testEvidencePresent: hasTestEvidence(candidate),
    contextCompatibility: 'COMPATIBLE',
    sourceSha256: sha256(source.content),
    targetSha256: sha256(target.content),
    provenance: {
      upstreamRepository: candidate.provenance.upstreamRepository,
      upstreamRepositoryUrl: candidate.provenance.upstreamRepositoryUrl,
      upstreamCommit: candidate.provenance.upstreamCommit,
      upstreamPath: candidate.provenance.upstreamPath,
      ...(candidate.provenance.upstreamCaseId
        ? { upstreamCaseId: candidate.provenance.upstreamCaseId }
        : {}),
      ...(candidate.provenance.upstreamBlobSha
        ? { upstreamBlobSha: candidate.provenance.upstreamBlobSha }
        : {}),
      licenseSpdx: candidate.provenance.licenseSpdx,
      licensePath: candidate.provenance.licensePath,
    },
  };
}

function totalCharacters(candidate: ImportedEvaluationCandidate): number {
  return [...candidate.sourceFiles, ...(candidate.targetFiles ?? [])].reduce(
    (total, file) => total + file.content.length,
    0,
  );
}

function hasTestEvidence(candidate: ImportedEvaluationCandidate): boolean {
  return Boolean(
    candidate.upstreamEvidence?.testDataPresent ||
      candidate.upstreamEvidence?.structuredTests?.length ||
      candidate.upstreamEvidence?.javaTestSource?.trim(),
  );
}

function selectionRank(stratum: PilotSizeStratum, candidateId: string): string {
  return sha256(`${COBOL_JAVATRANS_PILOT_ID}:${stratum}:${candidateId}`);
}

function extractTaskDescription(candidate: ImportedEvaluationCandidate): string {
  const java = candidate.upstreamEvidence?.problemDescriptions?.java ?? '';
  const commentStart = java.indexOf('/**');
  const commentEnd = java.indexOf('*/', commentStart + 3);
  if (commentStart >= 0 && commentEnd > commentStart) {
    const description = java
      .slice(commentStart + 3, commentEnd)
      .split(/\r?\n/)
      .map((line) => line.replace(/^\s*\*?\s?/, '').trim())
      .filter((line) => line && !line.startsWith('>>>'))
      .join(' ')
      .trim();
    if (description) return description.replace(/`/g, '\\`');
  }
  return 'present in upstreamEvidence.problemDescriptions in the candidate manifest';
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}
