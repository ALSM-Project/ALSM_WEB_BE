// Test-only helpers. They never discover or terminate arbitrary machine processes.
const { setTimeout: delay } = require('node:timers/promises');

async function bounded(work, milliseconds, label) {
  let timer;
  try {
    return await Promise.race([Promise.resolve().then(work), new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} exceeded ${milliseconds}ms`)), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

async function cleanupAll(steps) {
  const errors = [];
  for (const [label, work, milliseconds = 5000] of steps) {
    try { await bounded(work, milliseconds, label); } catch (error) { errors.push(error); }
  }
  if (errors.length) throw new AggregateError(errors, 'Owned test resource cleanup failed');
}

function fixtureEngines() {
  const controllers = new Set();
  return {
    async execute(engine, input) {
      const controller = new AbortController();
      controllers.add(controller);
      let onAbort;
      try {
        return await Promise.race([
          Promise.resolve().then(() => { controller.signal.throwIfAborted(); return engine(input, controller.signal); }),
          new Promise((_resolve, reject) => {
            onAbort = () => reject(new Error('Fixture engine aborted for cleanup'));
            controller.signal.addEventListener('abort', onAbort, { once: true });
          }),
        ]);
      } finally {
        controller.signal.removeEventListener('abort', onAbort);
        controllers.delete(controller);
      }
    },
    abortAll() { for (const controller of controllers) controller.abort(); },
  };
}

async function stopOwnedChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  // The ChildProcess object is returned directly by this test's own spawn().
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill();
  await bounded(() => exited, 5000, 'Owned child exit');
}

const pause = (milliseconds, signal) => delay(milliseconds, undefined, { signal });
module.exports = { bounded, cleanupAll, fixtureEngines, stopOwnedChild, pause };
