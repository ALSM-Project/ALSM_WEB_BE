import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ConfigService } from '@nestjs/config';
import { LocalDiskStorageAdapter } from '../src/shared/storage/local-disk-storage.adapter';

describe('LocalDiskStorageAdapter', () => {
  let root: string;
  let adapter: LocalDiskStorageAdapter;

  beforeEach(async () => {
    root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'alsm-storage-root-'));
    const config = { get: jest.fn(() => root) };
    adapter = new LocalDiskStorageAdapter(config as unknown as ConfigService);
  });

  afterEach(async () => {
    await fs.promises.rm(root, { recursive: true, force: true });
  });

  it('writes and reads files back under a scope key', async () => {
    const reference = await adapter.writeFiles('sources/proj-1', [
      { relativePath: 'LOGIN.bms', content: Buffer.from('hello') },
      { relativePath: 'nested/COPY.CPY', content: Buffer.from('world') },
    ]);

    expect(reference.startsWith('sources/proj-1/')).toBe(true);

    const files = await adapter.readFiles(reference);
    const byPath = Object.fromEntries(files.map((f) => [f.relativePath, f.content.toString('utf8')]));
    expect(byPath['LOGIN.bms']).toBe('hello');
    expect(byPath['nested/COPY.CPY']).toBe('world');
  });

  it('resolvePath stays within the storage root', () => {
    const reference = 'sources/proj-1/abc';
    const resolved = adapter.resolvePath(reference);
    expect(resolved.startsWith(path.resolve(root))).toBe(true);
  });

  it('rejects a storage reference that tries to escape the storage root', () => {
    expect(() => adapter.resolvePath('../../etc/passwd')).toThrow(/traversal/i);
  });

  it('rejects an uploaded relativePath that tries to escape the target directory', async () => {
    await expect(
      adapter.writeFiles('sources/proj-1', [{ relativePath: '../../evil.txt', content: Buffer.from('x') }]),
    ).rejects.toThrow(/traversal/i);
  });
});
