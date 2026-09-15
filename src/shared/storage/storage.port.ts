export interface StoredFileInput {
  relativePath: string;
  content: Buffer;
}

export interface StoredFile {
  relativePath: string;
  content: Buffer;
}

export interface StoragePort {
  /** Persists files under a logical scope (e.g. `org/<id>/project/<id>/sources/<uuid>`) and returns a storage reference. */
  writeFiles(scopeKey: string, files: StoredFileInput[]): Promise<string>;
  /** Resolves a storage reference to an absolute filesystem path, for tools that need a real directory to read/write. */
  resolvePath(storageReference: string): string;
  /** Reads every file previously written under a storage reference. */
  readFiles(storageReference: string): Promise<StoredFile[]>;
}

export const STORAGE_PORT = Symbol('STORAGE_PORT');
