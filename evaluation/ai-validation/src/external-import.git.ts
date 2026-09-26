import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const APPROVED_REPOSITORIES = new Set([
  'https://github.com/COBOL-Coder/COBOL-Coder.git',
  'https://github.com/aws-samples/aws-mainframe-modernization-carddemo.git',
]);

export interface TemporaryUpstreamCheckout {
  path: string;
  commit: string;
  cleanup(): void;
}

export function checkoutPinnedMain(repositoryUrl: string): TemporaryUpstreamCheckout {
  if (!APPROVED_REPOSITORIES.has(repositoryUrl)) {
    throw new Error(`Upstream repository is not approved: ${repositoryUrl}`);
  }
  const reference = git(['ls-remote', repositoryUrl, 'refs/heads/main']);
  const commit = reference.trim().split(/\s+/)[0];
  if (!/^[a-f0-9]{40}$/.test(commit)) {
    throw new Error(`Unable to resolve a pinned main commit for ${repositoryUrl}`);
  }
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'alsm-phase6-import-'));
  const checkoutPath = join(temporaryRoot, 'upstream');
  try {
    git(['clone', '--filter=blob:none', '--no-checkout', repositoryUrl, checkoutPath]);
    git(['-C', checkoutPath, 'checkout', '--detach', commit]);
  } catch (error) {
    rmSync(temporaryRoot, { recursive: true, force: true });
    throw error;
  }
  return {
    path: checkoutPath,
    commit,
    cleanup: () => rmSync(temporaryRoot, { recursive: true, force: true }),
  };
}

export function checkoutPinnedCommit(
  repositoryUrl: string,
  commit: string,
): TemporaryUpstreamCheckout {
  if (!APPROVED_REPOSITORIES.has(repositoryUrl)) {
    throw new Error(`Upstream repository is not approved: ${repositoryUrl}`);
  }
  if (!/^[a-f0-9]{40}$/.test(commit)) {
    throw new Error(`Invalid pinned commit for ${repositoryUrl}`);
  }
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'alsm-phase6-import-'));
  const checkoutPath = join(temporaryRoot, 'upstream');
  try {
    git(['clone', '--filter=blob:none', '--no-checkout', repositoryUrl, checkoutPath]);
    git(['-C', checkoutPath, 'checkout', '--detach', commit]);
  } catch (error) {
    rmSync(temporaryRoot, { recursive: true, force: true });
    throw error;
  }
  return {
    path: checkoutPath,
    commit,
    cleanup: () => rmSync(temporaryRoot, { recursive: true, force: true }),
  };
}

export function upstreamBlobSha(
  checkoutPath: string,
  commit: string,
  upstreamPath: string,
): string {
  const sha = git(['-C', checkoutPath, 'rev-parse', `${commit}:${upstreamPath}`]).trim();
  if (!/^[a-f0-9]{40}$/.test(sha)) {
    throw new Error(`Unable to resolve upstream blob SHA for ${upstreamPath}`);
  }
  return sha;
}

export function readUpstreamFile(
  checkoutPath: string,
  commit: string,
  upstreamPath: string,
): Buffer {
  return execFileSync('git', ['-C', checkoutPath, 'show', `${commit}:${upstreamPath}`], {
    stdio: ['ignore', 'pipe', 'inherit'],
  });
}

function git(args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
}
