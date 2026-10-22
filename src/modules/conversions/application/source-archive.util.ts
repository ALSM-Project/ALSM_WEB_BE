import { BadRequestException } from '@nestjs/common';
import * as path from 'path';
import type JSZipType from 'jszip';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const JSZip = require('jszip') as typeof JSZipType;

export interface SourceUpload {
  originalname: string;
  buffer: Buffer;
  size: number;
}

export interface ExpandedUploads {
  files: SourceUpload[];
  /** Archive entries that were skipped (unsupported extension, hidden/system files). */
  ignored: string[];
}

export interface ArchiveLimits {
  maxEntries: number;
  maxFileBytes: number;
  maxTotalBytes: number;
}

const ARCHIVE_EXTENSION = '.zip';

export function isArchive(fileName: string): boolean {
  return path.extname(fileName).toLowerCase() === ARCHIVE_EXTENSION;
}

/** Entries that are never source: directories, macOS metadata and dot-files. */
function isNoise(entryName: string): boolean {
  const base = path.posix.basename(entryName);
  return (
    entryName.startsWith('__MACOSX/') || entryName.includes('/__MACOSX/') || base.startsWith('.')
  );
}

function declaredSize(entry: unknown): number | undefined {
  // JSZip exposes the size from the zip directory without inflating the entry.
  const size = (entry as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize;
  return typeof size === 'number' ? size : undefined;
}

/**
 * Replaces every `.zip` in an upload with the supported source files it contains. Files are
 * flattened to their basename (conversion sources are stored by name only, and this also
 * neutralises `../` path-traversal names). Entries whose extension is not in `allowed` are
 * skipped and reported; an archive with nothing usable is rejected. The sizes declared in the
 * archive are checked before anything is inflated so a zip bomb cannot exhaust memory.
 */
export async function expandZipArchives(
  uploads: SourceUpload[],
  allowedExtensions: string[],
  limits: ArchiveLimits,
): Promise<ExpandedUploads> {
  const files: SourceUpload[] = [];
  const ignored: string[] = [];
  let totalBytes = 0;

  for (const upload of uploads) {
    if (!isArchive(upload.originalname)) {
      files.push(upload);
      continue;
    }

    let archive: JSZipType;
    try {
      archive = await JSZip.loadAsync(upload.buffer);
    } catch {
      throw new BadRequestException({
        code: 'INVALID_ARCHIVE',
        message: `Archive "${upload.originalname}" could not be read as a ZIP file`,
      });
    }

    const entries = Object.values(archive.files).filter((entry) => !entry.dir);
    if (entries.length > limits.maxEntries) {
      throw new BadRequestException({
        code: 'ARCHIVE_TOO_LARGE',
        message: `Archive "${upload.originalname}" contains more than ${limits.maxEntries} files`,
      });
    }

    let usable = 0;
    for (const entry of entries) {
      const baseName = path.posix.basename(entry.name.replace(/\\/g, '/'));
      const extension = path.extname(baseName).toLowerCase();
      if (isNoise(entry.name) || !allowedExtensions.includes(extension)) {
        ignored.push(`${upload.originalname}/${entry.name}`);
        continue;
      }

      const declared = declaredSize(entry);
      if (
        declared !== undefined &&
        (declared > limits.maxFileBytes || totalBytes + declared > limits.maxTotalBytes)
      ) {
        throw new BadRequestException({
          code: 'ARCHIVE_TOO_LARGE',
          message: `Archive "${upload.originalname}" expands to more than the allowed size`,
        });
      }
      const buffer = await entry.async('nodebuffer');
      totalBytes += buffer.length;
      if (buffer.length > limits.maxFileBytes || totalBytes > limits.maxTotalBytes) {
        throw new BadRequestException({
          code: 'ARCHIVE_TOO_LARGE',
          message: `Archive "${upload.originalname}" expands to more than the allowed size`,
        });
      }
      files.push({ originalname: baseName, buffer, size: buffer.length });
      usable += 1;
    }

    if (usable === 0) {
      throw new BadRequestException({
        code: 'EMPTY_ARCHIVE',
        message: `Archive "${upload.originalname}" contains no supported source files (${allowedExtensions.join(', ')})`,
      });
    }
  }

  return { files, ignored };
}
