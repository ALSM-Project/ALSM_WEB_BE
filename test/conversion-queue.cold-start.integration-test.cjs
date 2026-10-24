// Opt-in real HTTP/Mongo cold-start regression; approved portable Redis starts only
// after the failed request. All engine output is explicitly a fixture, not conversion.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { Queue } = require('bullmq');
const { ConfigService } = require('@nestjs/config');
const { getModelToken } = require('@nestjs/mongoose');
const { startHarness } = require('./conversion-queue.http.integration-test.cjs');
const { cleanupAll, stopOwnedChild } = require('./conversion-test-cleanup.cjs');

async function main() {
  if (process.env.ALSM_QUEUE_COLD_START_TEST !== 'owned-local-only') {
    console.log('SKIP cold-start integration: explicit isolated-test opt-in required'); return;
  }
  const binary = process.env.ALSM_QUEUE_REDIS;
  assert.ok(binary && path.isAbsolute(binary)); await fs.access(binary);
  const listener = net.createServer();
  await new Promise((resolve, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', resolve); });
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'alsmv2-1210-cold-'));
  const runId = randomUUID(); await fs.writeFile(path.join(root, 'owner.json'), JSON.stringify({ runId }));
  let h, redis, inspection, runner;
  try {
    process.env.ALSM_QUEUE_HTTP_TEST = 'owned-local-only';
    h = await startHarness({ redisPort: port });
    const { CONVERSION_QUEUE } = require('../dist/modules/conversions/domain/conversion-job.types');
    const { CONVERSION_QUEUE_READY_TIMEOUT_MS } = require('../dist/modules/conversions/infrastructure/bullmq-conversion.queue');
    const { ConversionJob } = require('../dist/modules/conversions/infrastructure/conversion-job.schema');
    const { MongoConversionJobRepository } = require('../dist/modules/conversions/infrastructure/mongo-conversion-job.repository');
    const { ConversionWorkerRunner } = require('../dist/modules/conversions/infrastructure/conversion-worker.runner');
    const model = h.app.get(getModelToken(ConversionJob.name));
    const repository = new MongoConversionJobRepository(model);
    const queue = h.app.get(CONVERSION_QUEUE);
    const login = await h.login();
    const started = Date.now();
    const response = await fetch(`${h.base}/conversions/${h.ids.failedId}/retry`, { method: 'POST',
      headers: { Authorization: `Bearer ${login.accessToken}` }, signal: AbortSignal.timeout(8000) });
    const body = await response.json();
    const elapsedMs = Date.now() - started;
    assert.equal(response.status, 400); assert.equal(body.code, 'CONVERSION_QUEUE_UNAVAILABLE');
    assert.equal(body.message, 'Conversion job could not be queued');
    assert.ok(!JSON.stringify(body).includes('ECONNREFUSED'));
    assert.ok(elapsedMs < CONVERSION_QUEUE_READY_TIMEOUT_MS + 2500, `Cold HTTP took ${elapsedMs}ms`);
    const failed = await repository.findById(h.ids.failedId, h.ids.orgId);
    assert.equal(failed.status, 'FAILED'); assert.equal(failed.errorCode, 'CONVERSION_QUEUE_UNAVAILABLE');
    assert.equal(failed.errorMessage, 'Conversion job could not be queued');
    assert.equal(failed.executionGeneration, 1); assert.equal(failed.attemptCount, 0);
    assert.equal(failed.resultReference, undefined);
    console.log('PASS cold Redis HTTP failure', JSON.stringify({ runId, redisPort: port, mongoAddress: model.db.getClient().options.hosts.map(String), readinessMs: CONVERSION_QUEUE_READY_TIMEOUT_MS, elapsedMs, status: failed.status, generation: 1 }));
    redis = spawn(binary, ['--bind', '127.0.0.1', '--port', String(port), '--protected-mode', 'yes', '--save', '',
      '--appendonly', 'no', '--dir', root.replaceAll('\\', '/')], { windowsHide: true, stdio: 'ignore' });
    inspection = new Queue('conversion', { connection: { host: '127.0.0.1', port } });
    inspection.on('error', () => {});
    await inspection.waitUntilReady();
    // No add() may execute later on behalf of a request whose readiness timed out.
    await queue.deliveryState(h.ids.failedId, 1);
    assert.equal(await inspection.getJob(`${h.ids.failedId}-1`), undefined);
    assert.equal((await repository.findById(h.ids.failedId, h.ids.orgId)).status, 'FAILED');
    const retry = await h.request('POST', `/conversions/${h.ids.failedId}/retry`, 201, login.accessToken);
    assert.equal(retry.executionGeneration, 2);
    assert.equal(await repository.markFailed(h.ids.failedId, 'STALE', 'fixture', undefined, 1), false);
    assert.equal((await repository.findById(h.ids.failedId, h.ids.orgId)).status, 'QUEUED');
    let calls = 0;
    runner = new ConversionWorkerRunner(h.app.get(ConfigService), repository, { execute: async () => {
      calls++; return { resultReference: 'cold-start-fixture-only', toolVersion: 'fixture-no-conversion' };
    } }, { updateStatus: async () => {} }, queue);
    runner.start();
    for (let i = 0; i < 200; i++) {
      if ((await repository.findById(h.ids.failedId, h.ids.orgId)).status === 'COMPLETED') break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const completed = await repository.findById(h.ids.failedId, h.ids.orgId);
    assert.equal(completed.status, 'COMPLETED'); assert.equal(completed.executionGeneration, 2);
    assert.equal(completed.attemptCount, 1); assert.equal(calls, 1);
    assert.equal(await repository.markFailed(h.ids.failedId, 'STALE', 'fixture', undefined, 1), false);
    console.log('PASS late Redis readiness does not enqueue timed-out generation; new HTTP generation completes once');
  } finally {
    await cleanupAll([
      ['Cold-start worker', async () => { if (runner) await runner.onModuleDestroy(); }],
      ['Cold-start queue inspection', async () => { if (inspection) await inspection.close(); }],
      ['Cold-start Mongo harness', async () => { if (h) await h.close(); }, 20000],
      ['Owned cold-start Redis', () => stopOwnedChild(redis), 6000],
      ['Owned cold-start data', async () => {
        assert.equal(JSON.parse(await fs.readFile(path.join(root, 'owner.json'), 'utf8')).runId, runId);
        assert.equal(path.dirname(root), os.tmpdir()); assert.ok(path.basename(root).startsWith('alsmv2-1210-cold-'));
        assert.ok(!redis || redis.exitCode !== null || redis.signalCode !== null);
        await fs.rm(root, { recursive: true });
      }],
    ]);
    console.log('COLD_START_OWNED_CLEANUP_COMPLETE');
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
