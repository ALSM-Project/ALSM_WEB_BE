import { copyFileSync, readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import { basename, dirname, extname, join, relative } from 'path';
import {
  EXTERNAL_IMPORT_SCHEMA_VERSION,
  ImportedCandidateManifest,
  ImportedEvaluationCandidate,
  ImportedReviewManifest,
  UpstreamMetadata,
} from './external-import.types';
import {
  calculateContextCompatibility,
  normalizeImportedPath,
  sha256,
} from './external-import.utils';
import {
  validateImportedCandidateManifest,
  validateImportedReviewManifest,
} from './external-import.validator';
import { checkoutPinnedMain, upstreamBlobSha } from './external-import.git';
import { ensureImportDirectory, writeImportJson } from './external-import.io';
import { ImportSecurityFlag, scanImportedText } from './external-import.security';
import { parseNamedArguments } from './evaluation.io';

const REPOSITORY = 'aws-samples/aws-mainframe-modernization-carddemo';
const REPOSITORY_URL = 'https://github.com/aws-samples/aws-mainframe-modernization-carddemo.git';
const LICENSE_PATH = 'LICENSE';
const NOTICE_PATH = 'NOTICE';
const DEFAULT_SUBSET_SIZE = 12;

const FEATURE_PATTERNS: Array<{ tag: string; pattern: RegExp }> = [
  { tag: 'EXEC_CICS', pattern: /\bEXEC\s+CICS\b/i },
  { tag: 'EXEC_SQL', pattern: /\bEXEC\s+SQL\b/i },
  { tag: 'READ', pattern: /\bREAD\b/i },
  { tag: 'WRITE', pattern: /\bWRITE\b/i },
  { tag: 'REWRITE', pattern: /\bREWRITE\b/i },
  { tag: 'START', pattern: /\bSTART\b/i },
  { tag: 'CALL', pattern: /\bCALL\b/i },
  { tag: 'COPY', pattern: /\bCOPY\b/i },
  { tag: 'COMP_3', pattern: /\bCOMP-3\b/i },
  { tag: 'REDEFINES', pattern: /\bREDEFINES\b/i },
  { tag: 'OCCURS_DEPENDING_ON', pattern: /\bOCCURS\b[^.\n]*\bDEPENDING\s+ON\b/i },
  { tag: 'OCCURS', pattern: /\bOCCURS\b/i },
  { tag: 'PERFORM', pattern: /\bPERFORM\b/i },
  { tag: 'GO_TO', pattern: /\bGO\s+TO\b/i },
  { tag: 'FILE_CONTROL', pattern: /\bFILE-CONTROL\b/i },
  { tag: 'MQ_CALLS', pattern: /\bCALL\s+["']MQ[A-Z0-9]+["']|\bMQ[A-Z0-9-]+\b/i },
  { tag: 'IMS_CALLS', pattern: /\b(?:CBLTDLI|AIBTDLI|IMS[-A-Z0-9]*)\b/i },
];

export interface AwsRepositoryFile {
  path: string;
  content: string;
  blobSha: string;
}

interface AwsProgramAnalysis {
  program: AwsRepositoryFile;
  featureTags: string[];
  sizeClass: 'SIZE_SMALL' | 'SIZE_MEDIUM' | 'SIZE_LARGE';
  resolvedCopybooks: AwsRepositoryFile[];
  unresolvedDependencies: string[];
  securityFlags: ImportSecurityFlag[];
}

export interface AwsCardDemoImportInput {
  files: AwsRepositoryFile[];
  commit: string;
  retrievedAt: string;
  subsetSize?: number;
}

export interface AwsCardDemoImportResult {
  manifest: ImportedCandidateManifest;
  reviews: ImportedReviewManifest;
  analyses: AwsProgramAnalysis[];
  statistics: {
    availableCobolProgramCount: number;
    selectedSubsetCount: number;
    resolvedCopybookDependencyCount: number;
    unresolvedDependencyCount: number;
    unresolvedProgramCount: number;
    securityFlagCount: number;
    excludedForSecurityCount: number;
  };
  securityFlags: ImportSecurityFlag[];
}

export function buildAwsCardDemoImport(input: AwsCardDemoImportInput): AwsCardDemoImportResult {
  const files = input.files.map((file) => ({ ...file, path: normalizeImportedPath(file.path) }));
  const programs = files
    .filter((file) => basename(dirname(file.path)).toLowerCase() === 'cbl')
    .filter((file) => ['.cbl', '.cob'].includes(extname(file.path).toLowerCase()))
    .sort((left, right) => left.path.localeCompare(right.path));
  const copybooks = files.filter(
    (file) =>
      ['cpy', 'cpy-bms'].includes(basename(dirname(file.path)).toLowerCase()) &&
      extname(file.path).toLowerCase() === '.cpy',
  );
  const analyses = programs.map((program) => analyzeProgram(program, copybooks));
  const securityFlags = analyses.flatMap((analysis) => analysis.securityFlags);
  const safe = analyses.filter((analysis) => analysis.securityFlags.length === 0);
  const selected = selectAwsSubset(safe, input.subsetSize ?? DEFAULT_SUBSET_SIZE);
  const candidates = selected.map((analysis) => buildCandidate(analysis, input));
  const manifest = validateImportedCandidateManifest({
    schemaVersion: EXTERNAL_IMPORT_SCHEMA_VERSION,
    sourceDataset: 'AWS_CARDDEMO',
    licenseStatus: 'RECORDED',
    candidateCount: candidates.length,
    candidates,
  });
  const reviews = validateImportedReviewManifest(
    {
      schemaVersion: EXTERNAL_IMPORT_SCHEMA_VERSION,
      sourceDataset: 'AWS_CARDDEMO',
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
        targetJavaStatus: 'MISSING',
        targetFiles: null,
        targetJavaProvenance: null,
      })),
    },
    manifest,
  );
  return {
    manifest,
    reviews,
    analyses,
    statistics: {
      availableCobolProgramCount: programs.length,
      selectedSubsetCount: selected.length,
      resolvedCopybookDependencyCount: selected.reduce(
        (count, analysis) => count + analysis.resolvedCopybooks.length,
        0,
      ),
      unresolvedDependencyCount: selected.reduce(
        (count, analysis) => count + analysis.unresolvedDependencies.length,
        0,
      ),
      unresolvedProgramCount: analyses.filter(
        (analysis) => analysis.unresolvedDependencies.length > 0,
      ).length,
      securityFlagCount: securityFlags.length,
      excludedForSecurityCount: analyses.filter((analysis) => analysis.securityFlags.length > 0)
        .length,
    },
    securityFlags,
  };
}

export function scanCobolFeatures(content: string): string[] {
  const code = cobolCodeOnly(content);
  const tags = FEATURE_PATTERNS.filter(({ pattern }) => pattern.test(code)).map(({ tag }) => tag);
  if (/\bEXEC\s+CICS\b/i.test(code)) tags.push('CICS_ORIENTED');
  else tags.push('BATCH_STYLE');
  if (/\bFILE-CONTROL\b/i.test(code) && /\b(?:READ|WRITE|REWRITE|START)\b/i.test(code)) {
    tags.push('VSAM_FILE_IO');
  }
  return [...new Set(tags)].sort();
}

export function parseCopyDependencies(content: string): string[] {
  const code = cobolCodeOnly(content);
  const dependencies = new Set<string>();
  const pattern = /\bCOPY\s+["']?([A-Z0-9_-]+)["']?/gi;
  for (const match of code.matchAll(pattern)) dependencies.add(match[1].toUpperCase());
  return [...dependencies].sort();
}

export function selectAwsSubset(
  analyses: AwsProgramAnalysis[],
  subsetSize: number,
): AwsProgramAnalysis[] {
  if (subsetSize < 1) throw new Error('AWS subset size must be positive');
  const resolved = analyses.filter((analysis) => analysis.unresolvedDependencies.length === 0);
  const unresolved = analyses.filter((analysis) => analysis.unresolvedDependencies.length > 0);
  const pool = resolved.length >= subsetSize ? resolved : [...resolved, ...unresolved];
  const selected: AwsProgramAnalysis[] = [];
  const coveredTags = new Set<string>();
  const coveredSizes = new Set<string>();
  const frequencies = tagFrequencies(pool);

  while (selected.length < Math.min(subsetSize, pool.length)) {
    const remaining = pool.filter((analysis) => !selected.includes(analysis));
    remaining.sort((left, right) => {
      const scoreDifference =
        selectionScore(right, selected, coveredTags, coveredSizes, frequencies) -
        selectionScore(left, selected, coveredTags, coveredSizes, frequencies);
      return scoreDifference || left.program.path.localeCompare(right.program.path);
    });
    const next = remaining[0];
    selected.push(next);
    next.featureTags.forEach((tag) => coveredTags.add(tag));
    coveredSizes.add(next.sizeClass);
  }
  return selected;
}

function analyzeProgram(
  program: AwsRepositoryFile,
  copybooks: AwsRepositoryFile[],
): AwsProgramAnalysis {
  const resolved = new Map<string, AwsRepositoryFile>();
  const unresolved = new Set<string>();
  const visited = new Set<string>();
  resolveDependencies(program, copybooks, resolved, unresolved, visited);
  const sizeClass = classifySize(program.content.length);
  const featureTags = scanCobolFeatures(program.content);
  if (resolved.size >= 5) featureTags.push('COPYBOOK_HEAVY');
  featureTags.push(sizeClass);
  return {
    program,
    featureTags: [...new Set(featureTags)].sort(),
    sizeClass,
    resolvedCopybooks: [...resolved.values()].sort((left, right) =>
      left.path.localeCompare(right.path),
    ),
    unresolvedDependencies: [...unresolved].sort(),
    securityFlags: scanImportedText(program.path, program.content),
  };
}

function resolveDependencies(
  owner: AwsRepositoryFile,
  copybooks: AwsRepositoryFile[],
  resolved: Map<string, AwsRepositoryFile>,
  unresolved: Set<string>,
  visited: Set<string>,
): void {
  for (const dependency of parseCopyDependencies(owner.content)) {
    const key = `${owner.path}:${dependency}`;
    if (visited.has(key)) continue;
    visited.add(key);
    const match = resolveCopybook(owner.path, dependency, copybooks);
    if (!match) {
      unresolved.add(dependency);
      continue;
    }
    resolved.set(match.path, match);
    resolveDependencies(match, copybooks, resolved, unresolved, visited);
  }
}

function resolveCopybook(
  ownerPath: string,
  dependency: string,
  copybooks: AwsRepositoryFile[],
): AwsRepositoryFile | undefined {
  const ownerRoot = dirname(dirname(ownerPath));
  const matches = copybooks.filter(
    (file) => basename(file.path, extname(file.path)).toUpperCase() === dependency,
  );
  const ranked = matches.sort((left, right) => {
    const leftLocal = dirname(dirname(left.path)) === ownerRoot ? 0 : 1;
    const rightLocal = dirname(dirname(right.path)) === ownerRoot ? 0 : 1;
    return leftLocal - rightLocal || left.path.localeCompare(right.path);
  });
  if (ranked.length > 1) {
    const bestRoot = dirname(dirname(ranked[0].path));
    const sameRank = ranked.filter((file) => dirname(dirname(file.path)) === bestRoot);
    if (sameRank.length > 1) return undefined;
  }
  return ranked[0];
}

function buildCandidate(
  analysis: AwsProgramAnalysis,
  input: AwsCardDemoImportInput,
): ImportedEvaluationCandidate {
  const sourceFiles = [analysis.program, ...analysis.resolvedCopybooks].map((file) => ({
    path: file.path,
    content: file.content,
  }));
  const newlyCovered = analysis.featureTags.join(', ');
  return {
    candidateId: `external-aws-${analysis.program.path
      .toLowerCase()
      .replace(/\.[^.]+$/, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')}`,
    sourceDataset: 'AWS_CARDDEMO',
    sourceFiles,
    provenance: {
      upstreamRepository: REPOSITORY,
      upstreamRepositoryUrl: REPOSITORY_URL.replace(/\.git$/, ''),
      upstreamCommit: input.commit,
      upstreamPath: analysis.program.path,
      upstreamBlobSha: analysis.program.blobSha,
      fileIntegrity: [analysis.program, ...analysis.resolvedCopybooks].map((file) => ({
        candidatePath: file.path,
        upstreamPath: file.path,
        upstreamBlobSha: file.blobSha,
        contentSha256: sha256(file.content),
      })),
      licenseSpdx: 'Apache-2.0',
      licensePath: 'LICENSE.upstream.txt',
      noticePath: 'NOTICE.upstream.txt',
      retrievedAt: input.retrievedAt,
    },
    featureTags: analysis.featureTags,
    dependencyStatus: analysis.unresolvedDependencies.length === 0 ? 'RESOLVED' : 'UNRESOLVED',
    copybookDependencies: analysis.resolvedCopybooks.map((file) => file.path),
    unresolvedDependencies: analysis.unresolvedDependencies,
    selectionReason: `Deterministic structural-coverage selection: ${newlyCovered}; ${analysis.resolvedCopybooks.length} repository copybook(s) resolved.`,
    contextCompatibility: calculateContextCompatibility(sourceFiles),
    groundTruthStatus: 'SOURCE_ONLY_PENDING_CONVERSION',
    scorable: false,
    humanReviewRequired: true,
  };
}

function selectionScore(
  analysis: AwsProgramAnalysis,
  selected: AwsProgramAnalysis[],
  coveredTags: Set<string>,
  coveredSizes: Set<string>,
  frequencies: Map<string, number>,
): number {
  const novelty = analysis.featureTags.reduce(
    (score, tag) => score + (coveredTags.has(tag) ? 0 : 100 / (frequencies.get(tag) ?? 1)),
    0,
  );
  const sizeNovelty = coveredSizes.has(analysis.sizeClass) ? 0 : 30;
  const copybookValue = analysis.resolvedCopybooks.length > 0 ? 10 : 0;
  const maximumSimilarity = selected.reduce(
    (maximum, candidate) => Math.max(maximum, jaccard(analysis.featureTags, candidate.featureTags)),
    0,
  );
  const dependencyPenalty = analysis.unresolvedDependencies.length * 1_000;
  return novelty + sizeNovelty + copybookValue - maximumSimilarity * 10 - dependencyPenalty;
}

function tagFrequencies(analyses: AwsProgramAnalysis[]): Map<string, number> {
  const frequencies = new Map<string, number>();
  analyses.forEach((analysis) =>
    analysis.featureTags.forEach((tag) => frequencies.set(tag, (frequencies.get(tag) ?? 0) + 1)),
  );
  return frequencies;
}

function jaccard(left: string[], right: string[]): number {
  const a = new Set(left);
  const b = new Set(right);
  const intersection = [...a].filter((value) => b.has(value)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}

function classifySize(characters: number): 'SIZE_SMALL' | 'SIZE_MEDIUM' | 'SIZE_LARGE' {
  if (characters < 10_000) return 'SIZE_SMALL';
  if (characters < 50_000) return 'SIZE_MEDIUM';
  return 'SIZE_LARGE';
}

function cobolCodeOnly(content: string): string {
  return content
    .split(/\r\n|\n|\r/)
    .filter((line) => line.length < 7 || !['*', '/'].includes(line[6]))
    .map((line) => line.replace(/\*>.*$/, ''))
    .join('\n');
}

function main(): void {
  const args = parseNamedArguments(process.argv.slice(2), new Set(['output']));
  const outputDirectory = ensureImportDirectory(
    args.get('output') ?? 'evaluation/ai-validation/imports/aws-carddemo',
  );
  const checkout = checkoutPinnedMain(REPOSITORY_URL);
  try {
    const licensePath = join(checkout.path, LICENSE_PATH);
    const noticePath = join(checkout.path, NOTICE_PATH);
    const license = readFileSync(licensePath);
    const notice = readFileSync(noticePath);
    if (!license.toString('utf8').includes('Apache License')) {
      throw new Error('Expected Apache-2.0 license text was not found at the pinned commit');
    }
    const retrievedAt = new Date().toISOString();
    const files = collectAwsSourceFiles(checkout.path, checkout.commit);
    const result = buildAwsCardDemoImport({
      files,
      commit: checkout.commit,
      retrievedAt,
    });
    const upstream: UpstreamMetadata = {
      repository: REPOSITORY,
      repositoryUrl: REPOSITORY_URL.replace(/\.git$/, ''),
      commit: checkout.commit,
      retrievedAt,
      license: { spdx: 'Apache-2.0', sourcePath: LICENSE_PATH, sha256: sha256(license) },
      notice: { sourcePath: NOTICE_PATH, sha256: sha256(notice) },
      licenseStatus: 'RECORDED',
      importStatistics: result.statistics,
    };
    copyFileSync(licensePath, join(outputDirectory, 'LICENSE.upstream.txt'));
    copyFileSync(noticePath, join(outputDirectory, 'NOTICE.upstream.txt'));
    writeImportJson(join(outputDirectory, 'upstream.json'), upstream);
    writeImportJson(join(outputDirectory, 'candidates.json'), result.manifest);
    writeImportJson(join(outputDirectory, 'review-template.json'), result.reviews);
    writeFileSync(join(outputDirectory, 'SELECTION.md'), renderSelection(result.manifest), 'utf8');
    process.stdout.write(
      `${JSON.stringify({ commit: checkout.commit, ...result.statistics }, null, 2)}\n`,
    );
  } finally {
    checkout.cleanup();
  }
}

function collectAwsSourceFiles(checkoutPath: string, commit: string): AwsRepositoryFile[] {
  return walk(join(checkoutPath, 'app'))
    .map((absolutePath) => normalizeImportedPath(relative(checkoutPath, absolutePath)))
    .filter((path) => {
      const parent = basename(dirname(path)).toLowerCase();
      return (
        (parent === 'cbl' && ['.cbl', '.cob'].includes(extname(path).toLowerCase())) ||
        (['cpy', 'cpy-bms'].includes(parent) && extname(path).toLowerCase() === '.cpy')
      );
    })
    .sort()
    .map((path) => ({
      path,
      content: readFileSync(join(checkoutPath, path), 'utf8'),
      blobSha: upstreamBlobSha(checkoutPath, commit, path),
    }));
}

function walk(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function renderSelection(manifest: ImportedCandidateManifest): string {
  const rows = manifest.candidates.map((candidate) => {
    const program = candidate.sourceFiles[0];
    return `| ${candidate.candidateId} | \`${candidate.provenance.upstreamPath}\` | ${program.content.length} | ${(candidate.featureTags ?? []).join(', ')} | ${(candidate.copybookDependencies ?? []).join(', ') || 'None'} | ${candidate.contextCompatibility.status} | ${candidate.selectionReason} |`;
  });
  return `# AWS CardDemo Deterministic Selection

Structural tags are static keyword evidence only and do not assert business semantics.

| Candidate | Upstream path | Size (characters) | Structural tags | Copybooks | Context compatibility | Selection reason |
| --- | --- | ---: | --- | --- | --- | --- |
${rows.join('\n')}
`;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'AWS CardDemo import failed'}\n`,
    );
    process.exitCode = 1;
  }
}
