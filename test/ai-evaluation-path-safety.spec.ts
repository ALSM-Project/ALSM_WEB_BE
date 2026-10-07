import * as fs from 'fs';
import { join, resolve, win32, posix } from 'path';
import { ConfigService } from '@nestjs/config';
import {
  isPathWithin,
  resolveEvaluationPath,
} from '../evaluation/ai-validation/src/evaluation-path-safety';
import {
  assertLegacyOutputOutsideMultiday,
  checkpointLocation,
} from '../evaluation/ai-validation/src/multiday-store';
import { main } from '../evaluation/ai-validation/src/live-run.cli';
import * as factory from '../evaluation/ai-validation/src/live-validator.factory';

const windowsRoot = 'C:\\repo\\evaluation\\ai-validation\\results\\multiday';

describe('evaluation path safety with explicit platform semantics', () => {
  it.each([
    windowsRoot,
    windowsRoot + '\\run-1',
    windowsRoot.toUpperCase() + '\\RUN-1',
    windowsRoot + '\\.\\run-1',
    windowsRoot + '\\..\\multiday\\run-1',
    windowsRoot + '\\',
    windowsRoot + '\\run-1\\',
    'C:/repo/evaluation/ai-validation/results\\multiday/run-1',
  ])('recognizes reserved Windows path %s', (candidate) => {
    expect(isPathWithin(windowsRoot, resolveEvaluationPath(candidate, win32), win32)).toBe(true);
  });

  it.each([
    '\\\\?\\' + windowsRoot + '\\run-1',
    '//?/C:/repo/evaluation/ai-validation/results\\multiday/run-1',
    '\\\\?\\UNC\\server\\share\\repo\\results\\multiday',
    '//?/UNC/server/share/repo/results/multiday',
    '\\\\.\\' + windowsRoot,
    '//./C:/repo/results/multiday',
    '\\??\\' + windowsRoot,
    '/??/C:/repo/results/multiday',
    '\\\\?\\C:\\ordinary',
    'C:\\repo\\results\\multiday.\\run-1',
    'C:\\repo\\results\\multiday \\run-1',
    'C:\\repo\\results\\nul',
    'C:\\repo\\results\\multiday:stream',
  ])('rejects unsafe Windows user input %s', (candidate) => {
    expect(() => resolveEvaluationPath(candidate, win32)).toThrow(/forbidden/);
  });

  it.each(['multiday-old', 'multiday2', 'ordinary-run', 'legacy'])('allows sibling %s', (name) => {
    const candidate = resolveEvaluationPath(win32.join(win32.dirname(windowsRoot), name), win32);
    expect(isPathWithin(windowsRoot, candidate, win32)).toBe(false);
  });

  it('compares ordinary UNC paths with Windows component and case semantics', () => {
    const root = '\\\\server\\share\\repo\\results\\multiday';
    expect(
      isPathWithin(
        root,
        resolveEvaluationPath('\\\\SERVER\\SHARE\\repo\\results\\multiday\\run', win32),
        win32,
      ),
    ).toBe(true);
    expect(isPathWithin(root, '\\\\server\\other-share\\repo\\results\\multiday', win32)).toBe(
      false,
    );
    expect(
      isPathWithin(windowsRoot, 'D:\\repo\\evaluation\\ai-validation\\results\\multiday', win32),
    ).toBe(false);
  });

  it('preserves POSIX case-sensitive component boundaries', () => {
    expect(
      isPathWithin('/repo/multiday', resolveEvaluationPath('/repo/./multiday/run', posix), posix),
    ).toBe(true);
    expect(isPathWithin('/repo/multiday', '/repo/MULTIDAY/run', posix)).toBe(false);
    expect(isPathWithin('/repo/multiday', '/repo/multiday-old', posix)).toBe(false);
  });
});

describe('production output guards and provider ordering', () => {
  const reserved = resolve('evaluation/ai-validation/results/multiday');
  const alias = resolve('evaluation/ai-validation/results/alias');
  afterEach(() => jest.restoreAllMocks());

  function mockPaths(mapping: (path: string) => string, missing: string[] = []) {
    jest.spyOn(fs, 'lstatSync').mockImplementation(((p: fs.PathLike) => {
      if (missing.includes(String(p)))
        throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      return {} as fs.Stats;
    }) as typeof fs.lstatSync);
    jest
      .spyOn(fs.realpathSync, 'native')
      .mockImplementation(((p: fs.PathLike) => mapping(String(p))) as typeof fs.realpathSync);
  }

  it('rejects an existing directory junction alias into reserved results', () => {
    mockPaths((p) => (p === alias ? join(reserved, 'run-1') : p));
    expect(() => assertLegacyOutputOutsideMultiday(alias)).toThrow('--checkpoint');
  });

  it('resolves the nearest existing ancestor of a nonexistent alias child', () => {
    const child = join(alias, 'new-child');
    mockPaths((p) => (p === alias ? reserved : p), [child]);
    expect(() => assertLegacyOutputOutsideMultiday(child)).toThrow('--checkpoint');
  });

  it('rejects an existing predictions file symlink into reserved results', () => {
    mockPaths((p) =>
      p === join(alias, 'predictions.json') ? join(reserved, 'run-1/predictions.json') : p,
    );
    expect(() => assertLegacyOutputOutsideMultiday(alias)).toThrow('--checkpoint');
  });

  it('compares against the real reserved root when its ancestor is a junction', () => {
    mockPaths((p) => (p === reserved ? alias : p));
    expect(() => assertLegacyOutputOutsideMultiday(join(alias, 'run-1'))).toThrow('--checkpoint');
  });

  it('fails closed on a dangling or inaccessible alias without exposing its path', () => {
    mockPaths((p) => {
      if (p === alias) throw new Error('sensitive-path');
      return p;
    });
    expect(() => assertLegacyOutputOutsideMultiday(alias)).toThrow(
      'Cannot safely resolve evaluation path',
    );
  });

  it.each(['multiday-old', 'multiday2', 'ordinary-run', 'legacy'])(
    'production guard allows %s',
    (name) => {
      mockPaths((p) => p);
      expect(() =>
        assertLegacyOutputOutsideMultiday(resolve('evaluation/ai-validation/results', name)),
      ).not.toThrow();
    },
  );

  it.each(['legacy', 'checkpoint', 'junction'])(
    'rejects invalid %s output before provider construction/call or write',
    async (mode) => {
      const validate = jest.fn();
      const create = jest.spyOn(factory, 'createLiveValidator').mockReturnValue({
        config: new ConfigService(),
        validator: {
          getMetadata: () => ({ provider: 'gemini', model: 'mock', promptVersion: 'mock' }),
          validate,
        },
      });
      const write = jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {
        throw new Error('Write forbidden');
      });
      const fetch = jest.spyOn(globalThis, 'fetch').mockImplementation(() => {
        throw new Error('Network forbidden');
      });
      if (mode === 'junction') mockPaths((p) => (p === alias ? reserved : p));
      const args = [
        '--dataset',
        'not-read.json',
        '--all',
        '--allow-live-provider',
        '--output',
        mode === 'junction' ? alias : reserved,
      ];
      if (mode === 'checkpoint') args.push('--checkpoint', resolve('outside/checkpoint.json'));
      await expect(main(args, { AI_EVAL_ALLOW_LIVE_PROVIDER: 'true' })).rejects.toThrow(
        /--checkpoint|Checkpoint must/,
      );
      expect(create).not.toHaveBeenCalled();
      expect(validate).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
      expect(write).not.toHaveBeenCalled();
    },
  );

  it('checkpoint confinement still rejects traversal and different output directories', () => {
    expect(() => checkpointLocation(join(reserved, '../checkpoint.json'), reserved)).toThrow(
      'Checkpoint must',
    );
    expect(() => checkpointLocation(join(reserved, 'run-1/checkpoint.json'), alias)).toThrow(
      'Checkpoint must',
    );
  });
});
