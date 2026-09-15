import { spawn } from 'child_process';

export interface ToolRunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface ToolRunOptions {
  cwd: string;
  timeoutMs: number;
}

/** Runs an external conversion tool (python/java) as a child process and captures its output. Never throws on a non-zero/failing exit code — callers must inspect stdout, since neither tool reports failures reliably via exit code. */
export function runConversionTool(
  executable: string,
  args: string[],
  options: ToolRunOptions,
): Promise<ToolRunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd: options.cwd });
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, options.timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

/** Strips ANSI color codes (used by convert2fe for success/failure markers) so log text and ErrorLogRecord content stay plain. */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\[[0-9;]*m/g, '');
}
