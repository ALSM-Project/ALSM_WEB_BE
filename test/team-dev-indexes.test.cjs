const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const mongoose = require('mongoose');
const { setup, verifyOwnedMongo } = require('./team-dev-indexes.cjs');

test('owned development index setup is idempotent and fails closed on drift/duplicates', async () => {
  await assert.rejects(setup('production'), /Only uniquely named owned development/);
  const database = `alsm_team_dev_${randomUUID().replaceAll('-', '')}`;
  const first = await setup(database);
  assert.deepEqual(await setup(database), first);
  const connection = await mongoose
    .createConnection(`mongodb://127.0.0.1:27117/${database}`, { autoIndex: false })
    .asPromise();
  const db = connection.db;
  try {
    const assignments = db.collection('team_job_assignments');
    const spec = first.collections
      .find((c) => c.collection === 'team_job_assignments')
      .indexes.find((i) => i.name === 'one_active_team_job_assignment');
    assert.equal(spec.unique, true);
    assert.deepEqual(spec.key, { organizationId: 1, jobId: 1 });
    assert.deepEqual(spec.partialFilterExpression, { revokedAt: null });
    await assignments.dropIndex(spec.name);
    await assignments.createIndex({ jobId: 1 }, { name: spec.name });
    await assert.rejects(setup(database), /Index drift/);
    assert.equal((await assignments.indexes()).find((i) => i.name === spec.name).unique, undefined);
    await assignments.dropIndex(spec.name);
    const { v: _version, ns: _namespace, ...createSpec } = spec;
    const org = new mongoose.Types.ObjectId(),
      job = new mongoose.Types.ObjectId();
    const ids = [new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()];
    await assignments.insertMany(
      ids.map((_id) => ({ _id, organizationId: org, jobId: job, revokedAt: null })),
    );
    await assert.rejects(setup(database), /duplicate key/);
    assert.equal(await assignments.countDocuments(), 2); // No deletion/backfill hidden in setup.
    await assignments.deleteOne({ _id: ids[1] }); // Explicit owned test fixture cleanup only.
    await assignments.createIndexes([createSpec]);
    assert.equal((await setup(database)).database, database);
    console.log(
      `Verified ${first.collections.length} declared collections, ${first.collections.flatMap((c) => c.indexes).length} indexes; repeated setup, drift rejection, duplicate rejection and recovery`,
    );
  } finally {
    verifyOwnedMongo();
    assert.equal(connection.name, database);
    assert.ok(
      await db
        .collection('_team_dev_owner')
        .findOne({ owner: 'team-readiness-indexes-v1', database }),
    );
    await connection.dropDatabase();
    await connection.close();
  }
});
