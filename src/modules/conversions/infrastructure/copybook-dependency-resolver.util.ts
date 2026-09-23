/**
 * Static analysis of COBOL `COPY` statements: extracts every COPY reference from a program
 * or copybook's source text, matches each against the files uploaded in the same bundle, and
 * builds a (possibly nested) dependency tree — without ever shelling out to tool2java.
 *
 * Matching scope is deliberately limited to files within one upload bundle: that is exactly
 * what tool2java itself sees when it later resolves COPY statements (same-directory lookup,
 * confirmed against tool2java's own Preprocessor.java), so reporting RESOLVED for a file
 * outside that scope would be a false positive the real conversion could never back up.
 */

export type DependencyStatus = 'RESOLVED' | 'MISSING' | 'AMBIGUOUS' | 'CIRCULAR_DEPENDENCY' | 'PARSE_ERROR';
export type ProgramDependencyStatus = 'READY_FOR_CONVERSION' | 'BLOCKED' | 'NOT_ANALYZED';

export interface DependencyEntry {
  copyName: string;
  resolvedFile?: string;
  status: DependencyStatus;
  candidates?: string[];
  message?: string;
  lineNumber?: number;
  dependencies?: DependencyEntry[];
}

export interface ProgramAnalysis {
  program: string;
  status: ProgramDependencyStatus;
  dependencies: DependencyEntry[];
}

export interface BundleFile {
  name: string;
  content: string;
}

const COPY_STATEMENT_RE = /\bCOPY\b\s+([A-Za-z0-9][A-Za-z0-9-]*)/gi;
const PROGRAM_EXTENSIONS = ['.cbl', '.cob'];

/** Blanks out COBOL comment lines (fixed-format '*' in column 7, and free-format inline
 * '*>') so they never contribute false-positive COPY matches, while preserving every
 * original line so line numbers reported to the user stay accurate. */
function stripComments(source: string): string {
  return source
    .split('\n')
    .map((line) => {
      if (line.length > 6 && line[6] === '*') return '';
      const inlineIndex = line.indexOf('*>');
      return inlineIndex >= 0 ? line.slice(0, inlineIndex) : line;
    })
    .join('\n');
}

export function extractCopyStatements(source: string): { copyName: string; lineNumber: number }[] {
  const cleaned = stripComments(source);
  const results: { copyName: string; lineNumber: number }[] = [];
  for (const match of cleaned.matchAll(COPY_STATEMENT_RE)) {
    const copyName = match[1];
    const lineNumber = cleaned.slice(0, match.index).split('\n').length;
    results.push({ copyName, lineNumber });
  }
  return results;
}

/** Matching is by basename only — a COPY statement never spells out a directory, and the
 * spec requires candidates to be found "anywhere in the source tree" regardless of which
 * subfolder they live in (two files with the same basename in different subfolders are
 * exactly the AMBIGUOUS case, not two independent non-matches). */
export function normalizeCopyName(name: string): string {
  const basename = name.split(/[/\\]/).pop() ?? name;
  return basename
    .trim()
    .toLowerCase()
    .replace(/\.(cpy|cbl|cob)$/i, '');
}

/** Maps a normalized copybook name -> every uploaded file whose (normalized) name matches it.
 * Built once per bundle so resolution is a map lookup, not a re-scan, per file. */
export function buildCopybookIndex(files: BundleFile[]): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const file of files) {
    const key = normalizeCopyName(file.name);
    const existing = index.get(key);
    if (existing) existing.push(file.name);
    else index.set(key, [file.name]);
  }
  return index;
}

interface ResolvedCopyName {
  status: DependencyStatus;
  resolvedFile?: string;
  candidates?: string[];
}

/** Exact match only — never guesses a "close enough" file. Priority: literal filename
 * (as written in the COPY statement, case-insensitive) first, then the name normalized
 * (extension stripped). Ambiguous when more than one file shares the resolved key. */
function resolveCopyName(copyName: string, index: Map<string, string[]>): ResolvedCopyName {
  const literalKey = normalizeCopyName(copyName + (/\.[A-Za-z]+$/.test(copyName) ? '' : '.cpy'));
  const normalizedKey = normalizeCopyName(copyName);

  const candidates = index.get(literalKey) ?? index.get(normalizedKey) ?? [];

  if (candidates.length === 0) return { status: 'MISSING' };
  if (candidates.length === 1) return { status: 'RESOLVED', resolvedFile: candidates[0] };
  return { status: 'AMBIGUOUS', candidates: [...candidates] };
}

function buildMissingMessage(copyName: string, referencedBy: string): string {
  return `COPYBOOK '${copyName}' referenced by '${referencedBy}' could not be found.`;
}

function buildAmbiguousMessage(copyName: string, referencedBy: string): string {
  return `COPYBOOK '${copyName}' referenced by '${referencedBy}' matches multiple files.`;
}

function buildCircularMessage(chain: string[]): string {
  return `Circular copybook dependency detected: ${chain.join(' -> ')}`;
}

/** Recursively resolves one file's direct + nested COPY dependencies. `visitingPath` tracks
 * the current recursion chain (by normalized name) to detect cycles; `cache` memoizes a
 * copybook's own resolved subtree so a copybook referenced by many programs in the same
 * bundle is only ever parsed/resolved once. */
function resolveDependenciesOf(
  fileName: string,
  contentByName: Map<string, string>,
  index: Map<string, string[]>,
  visitingPath: string[],
  cache: Map<string, DependencyEntry[]>,
): DependencyEntry[] {
  const cacheKey = normalizeCopyName(fileName);
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const content = contentByName.get(fileName);
  if (content === undefined) return [];

  let statements: { copyName: string; lineNumber: number }[];
  try {
    statements = extractCopyStatements(content);
  } catch (error) {
    return [
      {
        copyName: fileName,
        status: 'PARSE_ERROR',
        message: `Unable to parse COPY statements in '${fileName}': ${error instanceof Error ? error.message : String(error)}`,
      },
    ];
  }

  const entries: DependencyEntry[] = statements.map(({ copyName, lineNumber }) => {
    const normalized = normalizeCopyName(copyName);

    if (visitingPath.includes(normalized)) {
      const chain = [...visitingPath, normalized];
      return {
        copyName,
        status: 'CIRCULAR_DEPENDENCY',
        lineNumber,
        message: buildCircularMessage(chain),
      };
    }

    const resolved = resolveCopyName(copyName, index);
    if (resolved.status === 'MISSING') {
      return { copyName, status: 'MISSING', lineNumber, message: buildMissingMessage(copyName, fileName) };
    }
    if (resolved.status === 'AMBIGUOUS') {
      return {
        copyName,
        status: 'AMBIGUOUS',
        lineNumber,
        candidates: resolved.candidates,
        message: buildAmbiguousMessage(copyName, fileName),
      };
    }

    const resolvedFile = resolved.resolvedFile as string;
    const nested = resolveDependenciesOf(resolvedFile, contentByName, index, [...visitingPath, normalized], cache);
    return {
      copyName,
      status: 'RESOLVED',
      resolvedFile,
      lineNumber,
      ...(nested.length > 0 ? { dependencies: nested } : {}),
    };
  });

  cache.set(cacheKey, entries);
  return entries;
}

function isFullyResolved(entries: DependencyEntry[]): boolean {
  return entries.every((entry) => entry.status === 'RESOLVED' && (!entry.dependencies || isFullyResolved(entry.dependencies)));
}

export function resolveProgram(programFile: string, contentByName: Map<string, string>, index: Map<string, string[]>, cache: Map<string, DependencyEntry[]>): ProgramAnalysis {
  const dependencies = resolveDependenciesOf(programFile, contentByName, index, [normalizeCopyName(programFile)], cache);
  return {
    program: programFile,
    status: isFullyResolved(dependencies) ? 'READY_FOR_CONVERSION' : 'BLOCKED',
    dependencies,
  };
}

/** Entry point: analyzes every `.cbl`/`.cob` program file in one upload bundle against the
 * whole bundle's file set, returning one ProgramAnalysis per program keyed by its file name.
 * The copybook index and per-copybook resolution cache are each built exactly once and
 * shared across every program in the bundle. */
export function analyzeBundle(files: BundleFile[]): Map<string, ProgramAnalysis> {
  const index = buildCopybookIndex(files);
  const contentByName = new Map(files.map((f) => [f.name, f.content]));
  const cache = new Map<string, DependencyEntry[]>();

  const results = new Map<string, ProgramAnalysis>();
  for (const file of files) {
    const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
    if (!PROGRAM_EXTENSIONS.includes(ext)) continue;
    results.set(file.name, resolveProgram(file.name, contentByName, index, cache));
  }
  return results;
}
