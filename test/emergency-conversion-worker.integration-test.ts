import { ConfigService } from '@nestjs/config';
import * as assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Queue } from 'bullmq';
import { Connection, createConnection, Types } from 'mongoose';
import {
  ConversionEnginePort,
  ConversionJobRecord,
  ConversionJobStatus,
  ConversionPriority,
} from '../src/modules/conversions/domain/conversion-job.types';
import { ConversionType } from '../src/modules/projects/domain/project.types';
import {
  ConversionJob,
  ConversionJobSchema,
} from '../src/modules/conversions/infrastructure/conversion-job.schema';
import { MongoConversionJobRepository } from '../src/modules/conversions/infrastructure/mongo-conversion-job.repository';
import {
  BullMqConversionQueue,
  CONVERSION_QUEUE_NAME,
} from '../src/modules/conversions/infrastructure/bullmq-conversion.queue';
import { ConversionWorkerRunner } from '../src/modules/conversions/infrastructure/conversion-worker.runner';
import { BmsDspfConversionAdapter } from '../src/modules/conversions/infrastructure/bms-dspf-conversion.adapter';
import { ScreenRepository } from '../src/modules/screens/domain/screen.types';
import { StoragePort } from '../src/shared/storage/storage.port';
import { ErrorLogRepository } from '../src/modules/conversions/domain/error-log.types';

jest.setTimeout(30000);

const OWNER = 'emergency-20261017';
const MARKER = '_emergency_worker_ownership';
interface OwnedContainer {
  Config: { Labels?: Record<string, string> };
  State: { Running: boolean };
  NetworkSettings: { Ports: Record<string, { HostIp: string; HostPort: string }[] | null> };
}
function verifyOwnedServices(): void {
  for (const [name, servicePort, hostPort] of [
    [`alsm-${OWNER}-mongo`, '27017/tcp', '27117'],
    [`alsm-${OWNER}-redis`, '6379/tcp', '6397'],
  ]) {
    const entries = JSON.parse(
      execFileSync('docker', ['inspect', name], {
        encoding: 'utf8',
        windowsHide: true,
      }),
    ) as OwnedContainer[];
    assert.equal(entries.length, 1);
    assert.equal(entries[0].Config.Labels?.['alsm.owner'], OWNER);
    assert.equal(entries[0].State.Running, true);
    const bindings = entries[0].NetworkSettings.Ports[servicePort];
    assert.ok(bindings && bindings.length === 1);
    assert.equal(bindings[0].HostIp, '127.0.0.1');
    assert.equal(bindings[0].HostPort, hostPort);
  }
}

// Explicit owned loopback services only. This test never reads production .env.
// Success cases use a clearly labeled fixture engine, proving queue/persistence plumbing only.
const ownedIntegration =
  process.env.ALSM_EMERGENCY_WORKER_TEST === 'owned-local-only' ? describe : describe.skip;
ownedIntegration('Emergency actual BullMQ + Mongo worker integration', () => {
  const runId = randomUUID();
  const dbName = `alsm_emergency_worker_${runId.replace(/-/g, '')}`;
  const values: Record<string, unknown> = {
    CONVERSION_WORKER_ENABLED: true,
    REDIS_HOST: '127.0.0.1',
    REDIS_PORT: 6397,
  };
  const config = {
    get: (key: string) => values[key],
    getOrThrow: (key: string) => values[key],
  } as unknown as ConfigService;
  const screens = {
    updateStatus: jest.fn().mockResolvedValue(undefined),
  } as unknown as ScreenRepository;
  let connection: Connection;
  let repository: MongoConversionJobRepository;
  let queue: BullMqConversionQueue;
  let inspection: Queue;
  let runners: ConversionWorkerRunner[] = [];
  const queueIds: string[] = [];
  let ownsDatabase = false;

  beforeAll(async () => {
    verifyOwnedServices();
    connection = await createConnection(`mongodb://127.0.0.1:27117/${dbName}`).asPromise();
    assert.equal(connection.host, '127.0.0.1');
    assert.equal(connection.port, 27117);
    assert.equal(
      (await connection.db!.listCollections().toArray()).length,
      0,
      'Refuse nonempty DB',
    );
    await connection.collection(MARKER).insertOne({ runId, owner: OWNER, dbName });
    ownsDatabase = true;
    repository = new MongoConversionJobRepository(
      connection.model(ConversionJob.name, ConversionJobSchema),
    );
    queue = new BullMqConversionQueue(config);
    inspection = new Queue(CONVERSION_QUEUE_NAME, {
      connection: { host: '127.0.0.1', port: 6397 },
    });
    await inspection.waitUntilReady();
    const counts = await inspection.getJobCounts(
      'active',
      'waiting',
      'delayed',
      'prioritized',
      'waiting-children',
    );
    assert.equal(
      Object.values(counts).reduce((sum, count) => sum + count, 0),
      0,
      'Other queue work exists; serialize the owned integration suites',
    );
  });

  afterEach(async () => {
    await Promise.all(runners.map((runner) => runner.onModuleDestroy()));
    runners = [];
  });

  afterAll(async () => {
    if (inspection) {
      for (const id of queueIds) {
        const entry = await inspection.getJob(id);
        if (entry) await entry.remove();
      }
      await inspection.close();
    }
    if (queue) await queue.onModuleDestroy();
    if (connection) {
      try {
        if (ownsDatabase) {
          verifyOwnedServices();
          assert.equal(connection.name, dbName);
          assert.equal(connection.host, '127.0.0.1');
          assert.equal(connection.port, 27117);
          assert.match(dbName, /^alsm_emergency_worker_[a-f0-9]{32}$/);
          assert.ok(
            await connection.collection(MARKER).findOne({ runId, owner: OWNER, dbName }),
            'Database ownership marker missing',
          );
          await connection.dropDatabase();
        }
      } finally {
        await connection.close();
      }
    }
  });

  async function createJob(priority = ConversionPriority.NORMAL): Promise<ConversionJobRecord> {
    return repository.create({
      organizationId: new Types.ObjectId().toString(),
      projectId: new Types.ObjectId().toString(),
      createdBy: new Types.ObjectId().toString(),
      conversionType: ConversionType.BMS_DSPF_TO_FRONTEND,
      status: ConversionJobStatus.QUEUED,
      priority,
      attemptCount: 0,
      maxAttempts: 3,
      inputReference: 'fixture-source',
    });
  }

  async function enqueue(job: ConversionJobRecord, generation = 0): Promise<void> {
    queueIds.push(`${job.id}-${generation}`);
    await queue.enqueue(job.id, job.priority, generation);
  }

  function start(engine: ConversionEnginePort): void {
    const runner = new ConversionWorkerRunner(config, repository, engine, screens);
    runners.push(runner);
    runner.start();
  }

  async function waitFor(
    job: ConversionJobRecord,
    status: ConversionJobStatus,
  ): Promise<ConversionJobRecord> {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const current = await repository.findById(job.id, job.organizationId);
      if (current?.status === status) return current;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`Timed out waiting for ${status}`);
  }

  it('allows one atomic claim, rejects stale completion, and recovers an expired lease', async () => {
    const job = await createJob();
    const claims = await Promise.all(
      ['first', 'second'].map((token) =>
        repository.markProcessing(job.id, token, new Date(Date.now() + 10000), 0),
      ),
    );
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(
      await repository.markCompleted(job.id, { resultReference: 'stale' }, undefined, 'wrong'),
    ).toBeNull();
    expect(
      await repository.renewProcessingLease(job.id, 'wrong', new Date(Date.now() + 20000)),
    ).toBe(false);
    await connection.model(ConversionJob.name).updateOne(
      { _id: job.id },
      {
        $set: { processingLeaseExpiresAt: new Date(Date.now() - 1) },
      },
    );
    expect(
      await repository.markProcessing(job.id, 'recovered', new Date(Date.now() + 10000), 0),
    ).toMatchObject({ attemptCount: 2 });
    expect(
      await repository.markCompleted(
        job.id,
        { resultReference: 'fixture-recovered' },
        undefined,
        'recovered',
      ),
    ).toMatchObject({
      status: ConversionJobStatus.COMPLETED,
      resultReference: 'fixture-recovered',
    });
  });

  it('deduplicates concurrent enqueues across two actual workers (fixture engine plumbing)', async () => {
    const execute = jest.fn().mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return { resultReference: 'fixture-output', toolVersion: 'fixture-plumbing-only' };
    });
    start({ execute });
    start({ execute });
    const job = await createJob();
    await Promise.all([enqueue(job), enqueue(job), enqueue(job)]);
    const completed = await waitFor(job, ConversionJobStatus.COMPLETED);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(completed.attemptCount).toBe(1);
    expect(completed.toolVersion).toBe('fixture-plumbing-only');
    expect(await repository.findById(job.id, new Types.ObjectId().toString())).toBeNull();
  });

  it('consumes queued HIGH before NORMAL before LOW with one actual worker (fixture plumbing)', async () => {
    const low = await createJob(ConversionPriority.LOW);
    const normal = await createJob(ConversionPriority.NORMAL);
    const high = await createJob(ConversionPriority.HIGH);
    // Queue all three before the worker starts, in the opposite order from priority.
    await enqueue(low);
    await enqueue(normal);
    await enqueue(high);

    const consumed: string[] = [];
    start({
      execute: async (input) => {
        consumed.push(input.conversionJobId);
        return {
          resultReference: `fixture-priority/${input.conversionJobId}`,
          toolVersion: 'fixture-plumbing-only',
        };
      },
    });
    const completed = await Promise.all(
      [low, normal, high].map((job) => waitFor(job, ConversionJobStatus.COMPLETED)),
    );

    expect(consumed).toEqual([high.id, normal.id, low.id]);
    expect(completed.map((job) => job.attemptCount)).toEqual([1, 1, 1]);
  });

  it('executes actual adapter failure through BullMQ retries, then supports a distinct manual retry', async () => {
    const adapter = new BmsDspfConversionAdapter(
      config,
      {} as StoragePort,
      {} as ErrorLogRepository,
    );
    start(adapter);
    const job = await createJob();
    await enqueue(job);
    const failed = await waitFor(job, ConversionJobStatus.FAILED);
    expect(failed.attemptCount).toBe(3);
    expect(failed.errorCode).toBe('CONVERSION_ENGINE_UNAVAILABLE');
    expect(failed.resultReference).toBeUndefined();
    expect(failed.toolVersion).toBeUndefined();
    const retried = await repository.retry(job.id, job.organizationId);
    expect(retried).toMatchObject({ attemptCount: 0, executionGeneration: 1 });
    await enqueue(retried!, 1);
    expect((await waitFor(job, ConversionJobStatus.FAILED)).attemptCount).toBe(3);
    expect(
      await repository.markProcessing(job.id, 'old-delivery', new Date(Date.now() + 10000), 0),
    ).toBeNull();
  });

  it('actually redelivers a transient failure and persists the second attempt (fixture plumbing)', async () => {
    const execute = jest
      .fn()
      .mockRejectedValueOnce(new Error('fixture transient failure'))
      .mockResolvedValue({ resultReference: 'fixture-second-attempt' });
    start({ execute });
    const job = await createJob();
    await enqueue(job);
    expect((await waitFor(job, ConversionJobStatus.COMPLETED)).attemptCount).toBe(2);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('reconciles terminal stalled execution only after lease expiry and for its exact generation', async () => {
    const job = await createJob();
    await repository.markProcessing(job.id, 'owner', new Date(Date.now() + 10000), 0);
    expect(await repository.markAbandonedFailed(job.id, 0)).toBe(false);
    await connection.model(ConversionJob.name).updateOne(
      { _id: job.id },
      {
        $set: { processingLeaseExpiresAt: new Date(Date.now() - 1) },
      },
    );
    expect(await repository.markAbandonedFailed(job.id, 1)).toBe(false);
    expect(await repository.markAbandonedFailed(job.id, 0)).toBe(true);
    expect(await repository.findById(job.id, job.organizationId)).toMatchObject({
      status: ConversionJobStatus.FAILED,
      errorCode: 'CONVERSION_WORKER_STALLED',
    });
    expect(
      await repository.markCompleted(job.id, { resultReference: 'stale' }, undefined, 'owner'),
    ).toBeNull();
  });
});
