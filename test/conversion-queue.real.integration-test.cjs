// ALSMV2-1210: opt-in real Redis + MongoDB, loopback-only owned processes.
// Build first. Set ALSM_QUEUE_REAL_TEST=owned-local-only, ALSM_QUEUE_MONGOD and
// ALSM_QUEUE_REDIS to absolute installed/approved portable executable paths.
// Every engine here is an explicitly labeled orchestration fixture. No converter runs.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const mongoose = require('mongoose');
const Redis = require('ioredis');
const { Queue } = require('bullmq');
const { ConfigService } = require('@nestjs/config');
const { getModelToken } = require('@nestjs/mongoose');
const { startHarness } = require('./conversion-queue.http.integration-test.cjs');

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(work, timeout = 20000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try { return await work(); } catch (error) { last = error; await pause(50); }
  }
  throw last;
}
async function unusedPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
async function main() {
  if (process.env.ALSM_QUEUE_REAL_TEST !== 'owned-local-only') {
    console.log('SKIP real Redis: explicit isolated-test opt-in required'); return;
  }
  const binary = process.env.ALSM_QUEUE_REDIS;
  assert.ok(binary && path.isAbsolute(binary));
  await fs.access(binary);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'alsmv2-1210-'));
  const runId = randomUUID();
  await fs.writeFile(path.join(root, 'owner.json'), JSON.stringify({ runId }));
  const port = await unusedPort();
  let redisProcess, client, inspection, harness;
  const runners = [];
  let passed = 0;
  async function check(name, work) { await work(); passed++; console.log(`PASS ${passed}: ${name}`); }
  function startRedis() {
    redisProcess = spawn(binary, ['--bind', '127.0.0.1', '--port', String(port),
      '--protected-mode', 'yes', '--save', '', '--appendonly', 'yes', '--appendfsync', 'always',
      '--dir', root.replaceAll('\\', '/'), '--maxmemory-policy', 'noeviction'],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    redisProcess.stdout.on('data', () => {});
    redisProcess.stderr.on('data', (data) => process.stderr.write(data));
  }
  async function stopRedis() {
    if (redisProcess && redisProcess.exitCode === null && redisProcess.signalCode === null) {
      const exited = new Promise((resolve) => redisProcess.once('exit', resolve));
      redisProcess.kill(); await exited;
    }
  }
  async function stopWorkers() {
    await Promise.all(runners.splice(0).map((runner) => runner.onModuleDestroy()));
  }
  try {
    startRedis();
    client = new Redis({ host: '127.0.0.1', port, maxRetriesPerRequest: 1, connectTimeout: 1000 });
    client.on('error', () => {});
    await until(async () => assert.equal(await client.ping(), 'PONG'));
    const info = await client.info('server');
    assert.match(info, /redis_version:/);
    console.log(JSON.stringify({ runId, redisPort: port, redisVersion: /redis_version:([^\r]+)/.exec(info)[1], root }));
    process.env.ALSM_QUEUE_HTTP_TEST = 'owned-local-only';
    harness = await startHarness({ redisPort: port });
    const { ConversionJob } = require('../dist/modules/conversions/infrastructure/conversion-job.schema');
    const { MongoConversionJobRepository } = require('../dist/modules/conversions/infrastructure/mongo-conversion-job.repository');
    const { ConversionWorkerRunner } = require('../dist/modules/conversions/infrastructure/conversion-worker.runner');
    const { CONVERSION_QUEUE } = require('../dist/modules/conversions/domain/conversion-job.types');
    const model = harness.app.get(getModelToken(ConversionJob.name));
    const repository = new MongoConversionJobRepository(model);
    const queue = harness.app.get(CONVERSION_QUEUE);
    const config = harness.app.get(ConfigService);
    // This URI belongs only to the freshly spawned loopback replica set.
    const mongoUri = model.db.getClient().s.url;
    assert.match(mongoUri, /^mongodb:\/\/127\.0\.0\.1:/);
    inspection = new Queue('conversion', { connection: { host: '127.0.0.1', port } });
    await inspection.waitUntilReady();
    assert.deepEqual(await inspection.getJobs(['wait', 'active', 'prioritized']), []);
    const mongoBuild = await harness.db.admin().command({ buildInfo: 1 });
    console.log(JSON.stringify({ mongoVersion: mongoBuild.version, database: harness.db.databaseName, mongoAddress: model.db.getClient().options.hosts.map(String) }));
    const screens = { updateStatus: async () => {} };
    function worker(execute, repo = repository) {
      const runner = new ConversionWorkerRunner(config, repo, { execute }, screens, queue);
      runners.push(runner); runner.start(); return runner;
    }
    const fixtureOutput = (input) => ({ resultReference: `fixture-only/${input.conversionJobId}`, toolVersion: 'ALSMV2-1210-fixture-no-conversion' });
    async function create(overrides = {}) {
      return repository.create({ organizationId: harness.ids.orgId, projectId: harness.ids.projectId,
        createdBy: harness.ids.staffId, conversionType: 'BMS_DSPF_TO_FRONTEND', status: 'QUEUED',
        priority: 'NORMAL', attemptCount: 0, maxAttempts: 3, executionGeneration: 0, ...overrides });
    }
    async function state(job, expected) {
      return until(async () => {
        const result = await repository.findById(job.id, job.organizationId);
        assert.equal(result.status, expected); return result;
      });
    }
    async function queueState(id, expected) {
      return until(async () => { const entry = await inspection.getJob(id); assert.ok(entry); assert.equal(await entry.getState(), expected); return entry; });
    }
    await check('real HTTP retry -> BullMQ payload -> real worker claim -> fixture completion', async () => {
      const login = await harness.login();
      const retried = await harness.request('POST', `/conversions/${harness.ids.failedId}/retry`, 201, login.accessToken);
      const delivery = await inspection.getJob(`${retried.id}-1`);
      assert.deepEqual(delivery.data, { conversionJobId: retried.id, executionGeneration: 1 });
      let calls = 0;
      worker(async (input) => { calls++; const persisted = await model.findById(input.conversionJobId).lean();
        assert.equal(persisted.status, 'PROCESSING'); assert.ok(persisted.processingToken);
        assert.ok(persisted.processingLeaseExpiresAt > new Date()); return fixtureOutput(input); });
      const result = await state(retried, 'COMPLETED');
      assert.equal(calls, 1); assert.equal(result.attemptCount, 1);
      assert.equal(result.toolVersion, 'ALSMV2-1210-fixture-no-conversion');
      assert.equal(await model.countDocuments({ _id: retried.id }), 1);
      await queueState(`${retried.id}-1`, 'completed'); await stopWorkers();
    });
    await check('two and five real consumers with duplicate deliveries have one processing owner', async () => {
      for (const consumers of [2, 5]) {
        const job = await create(); let calls = 0;
        for (let i = 0; i < consumers; i++) worker(async (input) => { calls++; await pause(150); return fixtureOutput(input); });
        await Promise.all(Array.from({ length: 5 }, () => queue.enqueue(job.id, job.priority, 0)));
        await inspection.add('duplicate-fixture', { conversionJobId: job.id, executionGeneration: 0 }, { jobId: `${job.id}-duplicate`, attempts: 3, backoff: { type: 'fixed', delay: 200 } });
        assert.equal((await state(job, 'COMPLETED')).attemptCount, 1);
        await queueState(`${job.id}-duplicate`, 'completed');
        assert.equal(calls, 1); await stopWorkers();
      }
    });
    await check('five competing Mongo claims, renewal, expiry and stale-owner fencing', async () => {
      const job = await create();
      const claims = await Promise.all(Array.from({ length: 5 }, (_, i) => repository.markProcessing(job.id, `owner-${i}`, new Date(Date.now() + 45000), 0)));
      assert.equal(claims.filter(Boolean).length, 1);
      const doc = await model.findById(job.id).lean(); const old = doc.processingToken;
      assert.equal(await repository.renewProcessingLease(job.id, old, new Date(Date.now() + 50000)), true);
      await model.updateOne({ _id: job.id }, { $set: { processingLeaseExpiresAt: new Date(0) } });
      assert.equal(await repository.renewProcessingLease(job.id, old, new Date(Date.now() + 45000)), false);
      const recovered = await repository.markProcessing(job.id, 'recovered-owner', new Date(Date.now() + 45000), 0);
      assert.equal(recovered.attemptCount, 2);
      assert.equal(await repository.markCompleted(job.id, fixtureOutput(job), undefined, old), null);
      assert.equal(await repository.markFailed(job.id, 'STALE', 'fixture', old), false);
      assert.equal(await repository.releaseProcessingForRetry(job.id, old), false);
      assert.equal((await repository.markCompleted(job.id, fixtureOutput(job), undefined, 'recovered-owner')).status, 'COMPLETED');
      const exhausted = await create({ attemptCount: 3 });
      assert.equal(await repository.markProcessing(exhausted.id, 'over-budget', new Date(Date.now() + 45000), 0), null);
      assert.equal(await repository.markUndeliveredFailed(exhausted.id, 1, new Date(Date.now() + 1)), false);
    });
    await check('actual priority HIGH -> NORMAL -> LOW and FIFO within NORMAL', async () => {
      const jobs = await Promise.all(['LOW', 'NORMAL', 'HIGH', 'NORMAL'].map((priority) => create({ priority })));
      for (const job of jobs) await queue.enqueue(job.id, job.priority, 0);
      const seen = [];
      worker(async (input) => { seen.push(input.conversionJobId); return fixtureOutput(input); });
      for (const job of jobs) await state(job, 'COMPLETED');
      assert.deepEqual(seen, [jobs[2].id, jobs[1].id, jobs[3].id, jobs[0].id]); await stopWorkers();
    });
    await check('three real exponential attempts fail; manual retry uses one business job and a new generation', async () => {
      const job = await create(); let calls = 0;
      worker(async () => { calls++; throw new Error('Labeled fixture engine failure'); });
      await queue.enqueue(job.id, job.priority, 0);
      const failed = await state(job, 'FAILED'); assert.equal(calls, 3); assert.equal(failed.attemptCount, 3);
      assert.equal(failed.resultReference, undefined); await queueState(`${job.id}-0`, 'failed'); await stopWorkers();
      const retry = await repository.retry(job.id, job.organizationId);
      assert.equal(retry.executionGeneration, 1); assert.equal(retry.attemptCount, 0);
      await queue.enqueue(job.id, job.priority, 1);
      worker(async (input) => fixtureOutput(input));
      assert.equal((await state(job, 'COMPLETED')).attemptCount, 1);
      assert.equal(await model.countDocuments({ _id: job.id }), 1); await stopWorkers();
    });
    await check('stale generations and terminal records never invoke engine; malformed and missing payloads fail visibly', async () => {
      let calls = 0;
      const job = await create({ executionGeneration: 1 });
      assert.equal(await repository.markFailed(job.id, 'STALE_ENQUEUE', 'fixture', undefined, 0), false);
      await queue.enqueue(job.id, job.priority, 0);
      const cancelled = await create({ status: 'CANCELLED' }); await queue.enqueue(cancelled.id, cancelled.priority, 0);
      const completed = await create({ status: 'COMPLETED' }); await queue.enqueue(completed.id, completed.priority, 0);
      await inspection.add('invalid-fixture', { conversionJobId: 'invalid', executionGeneration: -1 }, { jobId: 'invalid-fixture', attempts: 3 });
      const missing = new mongoose.Types.ObjectId().toString(); await queue.enqueue(missing, 'NORMAL', 0);
      worker(async (input) => { calls++; return fixtureOutput(input); });
      await queueState(`${job.id}-0`, 'completed'); await queueState('invalid-fixture', 'failed'); await queueState(`${missing}-0`, 'failed');
      await queueState(`${cancelled.id}-0`, 'completed'); await queueState(`${completed.id}-0`, 'completed');
      assert.equal((await state(job, 'QUEUED')).attemptCount, 0); assert.equal(calls, 0); await stopWorkers();
    });
    await check('old orphaned QUEUED and expired missing-delivery PROCESSING are failed without replay', async () => {
      const orphan = await create(); const expired = await create();
      await model.collection.updateOne({ _id: new mongoose.Types.ObjectId(orphan.id) }, { $set: { updatedAt: new Date(0) } });
      await repository.markProcessing(expired.id, 'crashed-owner', new Date(Date.now() + 1000), 0);
      await model.updateOne({ _id: expired.id }, { $set: { processingLeaseExpiresAt: new Date(0) } });
      let calls = 0; worker(async (input) => { calls++; return fixtureOutput(input); });
      assert.equal((await state(orphan, 'FAILED')).errorCode, 'CONVERSION_QUEUE_DELIVERY_LOST');
      assert.equal((await state(expired, 'FAILED')).errorCode, 'CONVERSION_WORKER_STALLED');
      assert.equal(calls, 0); await stopWorkers();
    });
    await check('unavailable real Mongo connection never invokes engine or reports successful queue completion', async () => {
      const job = await create();
      const disconnected = await mongoose.createConnection(mongoUri, { bufferCommands: false }).asPromise();
      const failedRepository = new MongoConversionJobRepository(disconnected.model(ConversionJob.name, model.schema));
      await disconnected.close();
      let calls = 0;
      worker(async (input) => { calls++; return fixtureOutput(input); }, failedRepository);
      await queue.enqueue(job.id, job.priority, 0);
      await queueState(`${job.id}-0`, 'failed');
      assert.equal(calls, 0); assert.equal((await state(job, 'QUEUED')).attemptCount, 0);
      await model.collection.updateOne({ _id: new mongoose.Types.ObjectId(job.id) }, { $set: { updatedAt: new Date(0) } });
      await stopWorkers();
      worker(async (input) => fixtureOutput(input));
      assert.equal((await state(job, 'FAILED')).errorCode, 'CONVERSION_QUEUE_DELIVERY_LOST');
      await stopWorkers();
    });
    await check('real runner heartbeat renews Mongo lease and a lost owner cannot publish fixture output', async () => {
      const job = await create();
      let finish, entered;
      const handedOff = new Promise((resolve) => { entered = resolve; });
      worker(async (input) => { entered(input); return new Promise((resolve) => { finish = resolve; }); });
      await queue.enqueue(job.id, job.priority, 0);
      await handedOff;
      const initial = await model.findById(job.id).lean();
      await until(async () => {
        const current = await model.findById(job.id).lean();
        assert.ok(current.processingLeaseExpiresAt > initial.processingLeaseExpiresAt);
      }, 15000);
      // Simulate replacement ownership in persistence; the next renewal must fail.
      await model.updateOne({ _id: job.id }, { $set: { processingToken: 'replacement-fixture-owner' } });
      await pause(11000);
      finish({ resultReference: 'unauthorized-fixture-output' });
      await pause(100);
      const current = await model.findById(job.id).lean();
      assert.equal(current.status, 'PROCESSING'); assert.equal(current.resultReference, undefined);
      assert.equal(current.processingToken, 'replacement-fixture-owner');
      await repository.markCompleted(job.id, fixtureOutput(job), undefined, 'replacement-fixture-owner');
      await queueState(`${job.id}-0`, 'completed'); await stopWorkers();
    });
    await check('actual worker process crash recovers BullMQ lock and expired Mongo lease', async () => {
      const job = await create();
      const child = spawn(process.execPath, [__filename], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
        env: { ...process.env, ALSM_QUEUE_FIXTURE_CHILD: 'owned-crash-fixture', ALSM_FIXTURE_MONGO: mongoUri, ALSM_FIXTURE_REDIS_PORT: String(port) } });
      child.stderr.on('data', (data) => process.stderr.write(data));
      const claimed = new Promise((resolve, reject) => {
        child.once('message', resolve); child.once('error', reject);
        child.once('exit', (code) => reject(new Error(`Fixture child exited before claim: ${code}`)));
      });
      try {
        await queue.enqueue(job.id, job.priority, 0);
        const message = await Promise.race([claimed, pause(20000).then(() => { throw new Error('Fixture child claim timeout'); })]);
        assert.equal(message.conversionJobId, job.id);
        console.log('CRASH_FIXTURE_CLAIMED: killing only the owned fixture worker');
        const old = await model.findById(job.id).lean(); assert.equal(old.status, 'PROCESSING');
        const exited = new Promise((resolve) => child.once('exit', resolve)); child.kill(); await exited;
        let calls = 0;
        worker(async (input) => { calls++; return fixtureOutput(input); });
        const result = await until(async () => {
          const record = await repository.findById(job.id, job.organizationId); assert.equal(record.status, 'COMPLETED'); return record;
        }, 120000);
        assert.equal(calls, 1); assert.equal(result.attemptCount, 2);
        console.log('CRASH_FIXTURE_RECOVERED: second claim completed after actual lock expiry');
        assert.equal(await repository.markCompleted(job.id, fixtureOutput(job), undefined, old.processingToken), null);
        await queueState(`${job.id}-0`, 'completed'); await stopWorkers();
      } finally {
        if (child.exitCode === null && child.signalCode === null) { const exited = new Promise((resolve) => child.once('exit', resolve)); child.kill(); await exited; }
      }
    });
    await check('Redis disconnect rejects enqueue in bounded time and reconnect consumes a new real job', async () => {
      worker(async (input) => fixtureOutput(input));
      await stopRedis(); await pause(300);
      const started = Date.now();
      await assert.rejects(queue.enqueue(new mongoose.Types.ObjectId().toString(), 'NORMAL', 0));
      assert.ok(Date.now() - started < 10000);
      const login = await harness.login();
      const failed = await create({ status: 'FAILED' });
      await harness.request('POST', `/conversions/${failed.id}/retry`, 400, login.accessToken);
      assert.equal((await state(failed, 'FAILED')).errorCode, 'CONVERSION_QUEUE_UNAVAILABLE');
      startRedis(); await until(async () => assert.equal(await client.ping(), 'PONG'));
      await until(async () => { await inspection.waitUntilReady(); assert.equal(await inspection.client.then((c) => c.ping()), 'PONG'); });
      const job = await create();
      await until(() => queue.enqueue(job.id, job.priority, 0));
      await state(job, 'COMPLETED'); await stopWorkers();
    });
    console.log(`REAL_INTEGRATION_PASS=${passed}; fixture engines only; HTTP checks=${harness.getPassed()}`);
  } finally {
    await stopWorkers();
    if (inspection) await inspection.close();
    if (harness) await harness.close();
    if (client) client.disconnect();
    await stopRedis();
    const marker = JSON.parse(await fs.readFile(path.join(root, 'owner.json'), 'utf8'));
    assert.equal(marker.runId, runId);
    assert.equal(path.dirname(root), os.tmpdir());
    assert.ok(path.basename(root).startsWith('alsmv2-1210-'));
    await fs.rm(root, { recursive: true });
    console.log('OWNED_REAL_REDIS_AND_MONGO_CLEANUP_COMPLETE');
  }
}
async function crashFixtureChild() {
  assert.equal(process.env.ALSM_QUEUE_REAL_TEST, 'owned-local-only');
  const uri = process.env.ALSM_FIXTURE_MONGO;
  assert.match(uri, /^mongodb:\/\/127\.0\.0\.1:\d+\/alsmv2_1038_[a-f0-9]+\?replicaSet=queue1038$/);
  const port = Number(process.env.ALSM_FIXTURE_REDIS_PORT);
  assert.ok(Number.isInteger(port) && port > 1024 && port < 65536);
  const { ConversionJob, ConversionJobSchema } = require('../dist/modules/conversions/infrastructure/conversion-job.schema');
  const { MongoConversionJobRepository } = require('../dist/modules/conversions/infrastructure/mongo-conversion-job.repository');
  const { BullMqConversionQueue } = require('../dist/modules/conversions/infrastructure/bullmq-conversion.queue');
  const { ConversionWorkerRunner } = require('../dist/modules/conversions/infrastructure/conversion-worker.runner');
  const connection = await mongoose.createConnection(uri).asPromise();
  const repository = new MongoConversionJobRepository(connection.model(ConversionJob.name, ConversionJobSchema));
  const config = new ConfigService({ CONVERSION_WORKER_ENABLED: true, REDIS_HOST: '127.0.0.1', REDIS_PORT: port, REDIS_PASSWORD: '' });
  const queue = new BullMqConversionQueue(config);
  const runner = new ConversionWorkerRunner(config, repository, { execute: async (input) => {
    process.send({ conversionJobId: input.conversionJobId, fixture: 'crash-before-output-no-conversion' });
    await new Promise(() => {});
  } }, { updateStatus: async () => {} }, queue);
  runner.start();
}
(process.env.ALSM_QUEUE_FIXTURE_CHILD === 'owned-crash-fixture' ? crashFixtureChild() : main())
  .catch((error) => { console.error(error); process.exitCode = 1; });
