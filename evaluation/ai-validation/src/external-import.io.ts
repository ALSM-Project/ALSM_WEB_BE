import { mkdirSync, writeFileSync } from 'fs';
import { resolve } from 'path';

export function writeImportJson(path: string, value: unknown): void {
  writeFileSync(resolve(path), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function ensureImportDirectory(path: string): string {
  const absolutePath = resolve(path);
  mkdirSync(absolutePath, { recursive: true });
  return absolutePath;
}
