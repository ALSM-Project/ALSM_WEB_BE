import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { StoragePort, StoredFile, StoredFileInput } from './storage.port';

/** Local filesystem implementation of StoragePort, rooted at STORAGE_ROOT. Swap for an S3/GridFS adapter later without touching callers. */
@Injectable()
export class LocalDiskStorageAdapter implements StoragePort {
  private readonly root: string;

  constructor(config: ConfigService) {
    this.root = path.resolve(config.get<string>('STORAGE_ROOT') || './storage');
  }

  async writeFiles(scopeKey: string, files: StoredFileInput[]): Promise<string> {
    const storageReference = [this.sanitizeSegment(scopeKey), randomUUID()].join('/');
    const targetDir = this.resolvePath(storageReference);
    await fs.promises.mkdir(targetDir, { recursive: true });
    for (const file of files) {
      const filePath = this.resolveWithinDir(targetDir, file.relativePath);
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
      await fs.promises.writeFile(filePath, file.content);
    }
    return storageReference;
  }

  resolvePath(storageReference: string): string {
    return this.resolveWithinDir(this.root, storageReference);
  }

  async readFiles(storageReference: string): Promise<StoredFile[]> {
    const dir = this.resolvePath(storageReference);
    const out: StoredFile[] = [];
    await this.collect(dir, dir, out);
    return out;
  }

  private async collect(rootDir: string, currentDir: string, out: StoredFile[]): Promise<void> {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await this.collect(rootDir, fullPath, out);
      } else if (entry.isFile()) {
        out.push({
          relativePath: path.relative(rootDir, fullPath).split(path.sep).join('/'),
          content: await fs.promises.readFile(fullPath),
        });
      }
    }
  }

  private sanitizeSegment(segment: string): string {
    const parts = segment
      .replace(/\\/g, '/')
      .split('/')
      .filter((part) => part && part !== '.' && part !== '..');
    if (parts.length === 0) {
      throw new Error('Invalid storage scope key');
    }
    return parts.join('/');
  }

  private resolveWithinDir(baseDir: string, relativePath: string): string {
    const base = path.resolve(baseDir);
    const resolved = path.resolve(base, relativePath);
    if (resolved !== base && !resolved.startsWith(base + path.sep)) {
      throw new Error('Path traversal detected in storage reference');
    }
    return resolved;
  }
}
