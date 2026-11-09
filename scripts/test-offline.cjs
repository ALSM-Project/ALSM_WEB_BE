// Keep private host environment values out of application test processes.
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const env = {};
for (const name of ['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'ComSpec', 'USERPROFILE', 'HOME', 'APPDATA', 'LOCALAPPDATA']) {
  if (process.env[name] !== undefined) env[name] = process.env[name];
}
env.NODE_ENV = 'test';
env.AI_EVAL_ALLOW_LIVE_PROVIDER = 'false';
env.GEMINI_MIN_REQUEST_INTERVAL_MS = '0';
env.NODE_OPTIONS = `--require "${path.join(__dirname, 'test-provider-guard.cjs').replace(/\\/g, '/')}"`;
const result = spawnSync(process.execPath, [
  '--max-old-space-size=4096', 'node_modules/jest/bin/jest.js', '--runInBand', ...process.argv.slice(2),
], { cwd: path.join(__dirname, '..'), env, stdio: 'inherit' });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
