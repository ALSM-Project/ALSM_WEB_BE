import { createHash } from 'crypto';
import * as path from 'path';
import {
  ContextCompatibility,
  ContextCompatibilityStatus,
  PHASE_3_CONTEXT_LIMITS,
} from './external-import.types';
import { EvaluationCodeFile } from './evaluation.types';

const SOURCE_EXTENSIONS = new Set(['.cob', '.cbl', '.cpy']);
const TARGET_EXTENSIONS = new Set(['.java']);

export function sha256(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

export function normalizeImportedPath(value: string): string {
  if (value.includes('\0')) throw new Error('Imported path contains NUL');
  const normalized = value.replace(/\\/g, '/').replace(/^\.\//, '');
  if (
    normalized.length === 0 ||
    path.posix.isAbsolute(normalized) ||
    /^[a-z]:\//i.test(normalized) ||
    normalized.split('/').includes('..')
  ) {
    throw new Error(`Unsafe imported path: ${value}`);
  }
  return normalized;
}

export function calculateContextCompatibility(
  sourceFiles: EvaluationCodeFile[],
  targetFiles: EvaluationCodeFile[] = [],
): ContextCompatibility {
  const files = [...sourceFiles, ...targetFiles];
  const charactersPerFile = files.map((file) => ({
    path: normalizeImportedPath(file.path),
    characters: file.content.length,
  }));
  const totalCharacters = charactersPerFile.reduce((total, file) => total + file.characters, 0);
  const totalPreparedCharacters = files.reduce(
    (total, file) => total + addLineNumberPrefixes(file.content).length,
    0,
  );
  const status = contextStatus(sourceFiles, targetFiles, totalPreparedCharacters);
  return {
    status,
    sourceFileCount: sourceFiles.length,
    targetFileCount: targetFiles.length,
    totalFileCount: files.length,
    charactersPerFile,
    totalCharacters,
    totalPreparedCharacters,
    limits: { ...PHASE_3_CONTEXT_LIMITS },
  };
}

function contextStatus(
  sourceFiles: EvaluationCodeFile[],
  targetFiles: EvaluationCodeFile[],
  totalPreparedCharacters: number,
): ContextCompatibilityStatus {
  if (
    sourceFiles.some((file) => !SOURCE_EXTENSIONS.has(path.extname(file.path).toLowerCase())) ||
    targetFiles.some((file) => !TARGET_EXTENSIONS.has(path.extname(file.path).toLowerCase()))
  ) {
    return 'UNSUPPORTED_EXTENSION';
  }
  const files = [...sourceFiles, ...targetFiles];
  if (files.length > PHASE_3_CONTEXT_LIMITS.maxFiles) return 'TOO_MANY_FILES';
  if (files.some((file) => file.content.length > PHASE_3_CONTEXT_LIMITS.maxFileCharacters)) {
    return 'FILE_TOO_LARGE';
  }
  if (totalPreparedCharacters > PHASE_3_CONTEXT_LIMITS.maxTotalCharacters) {
    return 'TOTAL_TOO_LARGE';
  }
  return 'COMPATIBLE';
}

function addLineNumberPrefixes(content: string): string {
  return content
    .split(/\r\n|\n|\r/)
    .map((line, index) => `${index + 1} | ${line}`)
    .join('\n');
}
