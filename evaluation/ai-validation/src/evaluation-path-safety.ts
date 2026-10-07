import * as fs from 'fs';
import { PlatformPath, posix, win32 } from 'path';

export const evaluationPaths = process.platform === 'win32' ? win32 : posix;

// Explicit semantics keep Windows input checks testable on non-Windows CI.
export function resolveEvaluationPath(
  input: string,
  paths: PlatformPath = evaluationPaths,
): string {
  const check = (value: string) => {
    if (!value || value.includes('\0')) throw new Error('Unsafe evaluation path');
    if (paths !== win32) return;
    const normalized = value.replace(/\//g, '\\');
    if (/^\\{2,}[?.]+(?:\\|$)|^\\\?\?(?:\\|$)/.test(normalized))
      throw new Error('Windows device/namespaced evaluation paths are forbidden');
    // Win32 can alias trailing dots/spaces and DOS device names to other targets.
    const components = normalized.replace(/^[a-z]:/i, '').split('\\');
    if (
      components.some(
        (part) =>
          part !== '.' &&
          part !== '..' &&
          (/[. ]$/.test(part) ||
            part.includes(':') ||
            /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)),
      )
    )
      throw new Error('Ambiguous Windows evaluation path is forbidden');
  };
  check(input);
  const resolved = paths.resolve(input);
  check(resolved);
  return resolved;
}

export function isPathWithin(
  root: string,
  candidate: string,
  paths: PlatformPath = evaluationPaths,
): boolean {
  const difference = paths.relative(paths.resolve(root), paths.resolve(candidate));
  return (
    difference === '' || (!paths.isAbsolute(difference) && difference.split(paths.sep)[0] !== '..')
  );
}

// Resolve existing ancestors too: a not-yet-created child can sit below a junction.
// Fail closed on dangling links, permissions, or other resolution errors.
export function resolveExistingEvaluationPath(input: string): string {
  let cursor = input;
  const missing: string[] = [];
  for (;;) {
    try {
      fs.lstatSync(cursor);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw new Error('Cannot safely resolve evaluation path');
      const parent = evaluationPaths.dirname(cursor);
      if (parent === cursor) throw new Error('Cannot safely resolve evaluation path');
      missing.unshift(evaluationPaths.basename(cursor));
      cursor = parent;
      continue;
    }
    try {
      return evaluationPaths.join(fs.realpathSync.native(cursor), ...missing);
    } catch {
      throw new Error('Cannot safely resolve evaluation path');
    }
  }
}
