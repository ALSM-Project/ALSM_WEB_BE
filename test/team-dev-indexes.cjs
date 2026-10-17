// Deliberately has no .env/AppModule import and accepts no URI, credentials or host.
// Run after npm run build. Only this task's labeled loopback Mongo is allowed.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const mongoose = require('mongoose');
require('reflect-metadata');
const owner = 'team-readiness-indexes-v1';
function verifyOwnedMongo(replicaSet = false) {
  const name = replicaSet ? 'alsm-priorities-20261017-mongo-rs' : 'alsm-emergency-20261017-mongo';
  const [info] = JSON.parse(
    execFileSync('docker', ['inspect', name], {
      encoding: 'utf8',
      windowsHide: true,
    }),
  );
  const ports = info.NetworkSettings.Ports['27017/tcp'];
  if (
    !info.State.Running ||
    info.Config.Labels['alsm.owner'] !==
      (replicaSet ? 'priorities-20261017' : 'emergency-20261017') ||
    ports?.length !== 1 ||
    ports[0].HostIp !== '127.0.0.1' ||
    ports[0].HostPort !== (replicaSet ? '27127' : '27117')
  )
    throw new Error('Owned development Mongo guard failed');
}
function declaredIndexes() {
  const manifest = new Map();
  const sources = path.resolve(__dirname, '../src/modules');
  function visit(directory) {
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, item.name);
      if (item.isDirectory()) visit(file);
      else if (item.name.endsWith('.schema.ts')) {
        // Nest builds can leave stale JS from another branch. Only load compiled
        // counterparts of schemas that actually exist in this checkout.
        const compiled = path
          .resolve(__dirname, '../dist/modules', path.relative(sources, file))
          .replace(/\.ts$/, '.js');
        for (const schema of Object.values(require(compiled))) {
          if (!(schema instanceof mongoose.Schema) || !schema.options.collection) continue;
          const collection = schema.options.collection;
          if (!manifest.has(collection)) manifest.set(collection, new Map());
          for (const [key, options] of schema.indexes()) {
            const { background: _background, ...declared } = options;
            const spec = {
              key,
              ...declared,
              name:
                options.name ||
                Object.entries(key)
                  .map(([k, v]) => `${k}_${v}`)
                  .join('_'),
            };
            const previous = manifest.get(collection).get(spec.name);
            if (previous && JSON.stringify(previous) !== JSON.stringify(spec))
              throw new Error(`Conflicting schema indexes: ${collection}/${spec.name}`);
            manifest.get(collection).set(spec.name, spec);
          }
        }
      }
    }
  }
  visit(sources);
  return manifest;
}
function sameIndex(existing, expected) {
  for (const option of [
    'key',
    'unique',
    'sparse',
    'partialFilterExpression',
    'expireAfterSeconds',
    'collation',
  ]) {
    const normalize = (value) => (value === false ? undefined : value);
    if (JSON.stringify(normalize(existing[option])) !== JSON.stringify(normalize(expected[option])))
      return false;
  }
  return !existing.hidden;
}
async function setup(database, { replicaSet = false } = {}) {
  if (!/^alsm_team_dev_[a-f0-9]{32}$/.test(database))
    throw new Error('Only uniquely named owned development databases are allowed');
  verifyOwnedMongo(replicaSet);
  const manifest = declaredIndexes();
  const connection = await mongoose
    .createConnection(
      `mongodb://127.0.0.1:${replicaSet ? '27127' : '27117'}/${database}${replicaSet ? '?replicaSet=alsmPriorities&directConnection=true' : ''}`,
      {
        autoIndex: false,
        autoCreate: false,
      },
    )
    .asPromise();
  try {
    const db = connection.db;
    if (replicaSet && (await db.admin().command({ hello: 1 })).setName !== 'alsmPriorities')
      throw new Error('Owned replica-set identity mismatch');
    const collections = await db.listCollections().toArray();
    if (!collections.length) await db.collection('_team_dev_owner').insertOne({ owner, database });
    if (!(await db.collection('_team_dev_owner').findOne({ owner, database })))
      throw new Error('Existing database is not owned by this procedure');
    // Preflight definition drift across all collections before issuing any createIndexes.
    for (const [collection, indexes] of manifest) {
      if (!collections.some((c) => c.name === collection)) continue;
      const actual = await db.collection(collection).indexes();
      for (const expected of indexes.values()) {
        const existing = actual.find(
          (i) => i.name === expected.name || JSON.stringify(i.key) === JSON.stringify(expected.key),
        );
        if (existing && (existing.name !== expected.name || !sameIndex(existing, expected)))
          throw new Error(
            `Index drift: ${collection}/${expected.name}; no drop, repair or backfill attempted`,
          );
      }
    }
    for (const [collection, indexes] of manifest) {
      if (!collections.some((c) => c.name === collection)) await db.createCollection(collection);
      if (indexes.size) await db.collection(collection).createIndexes([...indexes.values()]);
    }
    const result = [];
    for (const [collection, indexes] of manifest) {
      const actual = await db.collection(collection).indexes();
      for (const expected of indexes.values()) {
        if (!actual.some((i) => i.name === expected.name && sameIndex(i, expected)))
          throw new Error(`Index verification failed: ${collection}/${expected.name}`);
      }
      if (!actual.some((i) => i.name === '_id_' && JSON.stringify(i.key) === '{"_id":1}'))
        throw new Error(`Missing permanent identity fence: ${collection}`);
      result.push({ collection, indexes: actual });
    }
    return {
      database,
      host: replicaSet ? '127.0.0.1:27127' : '127.0.0.1:27117',
      owner,
      autoIndex: false,
      collections: result,
      productionAccess: false,
    };
  } finally {
    await connection.close();
  }
}
module.exports = { setup, verifyOwnedMongo, declaredIndexes, sameIndex };
if (require.main === module) {
  const args = process.argv.slice(2);
  const replicaSet = args[0] === '--replica-set';
  if (replicaSet) args.shift();
  if (args.length && (args.length !== 2 || args[0] !== '--database'))
    throw new Error(
      'Usage: node test/team-dev-indexes.cjs [--replica-set] [--database alsm_team_dev_<32hex>]',
    );
  setup(args[1] || `alsm_team_dev_${randomUUID().replaceAll('-', '')}`, { replicaSet })
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
