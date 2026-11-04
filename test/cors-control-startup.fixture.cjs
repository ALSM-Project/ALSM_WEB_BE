// Real Nest/ConfigModule/production main.ts, with an isolated root and no database/queues.
require('reflect-metadata');
require('ts-node/register');
const { Module: NodeModule } = require('node:module');
const { Controller, Get, Module } = require('@nestjs/common');
const { ConfigModule } = require('@nestjs/config');
const { NestFactory } = require('@nestjs/core');
const { environmentValidationSchema } = require('../src/config/environment.validation.ts');
const {
  ConversionWorkerRunner,
} = require('../src/modules/conversions/infrastructure/conversion-worker.runner.ts');
const {
  ValidationWorkerRunner,
} = require('../src/modules/validation/infrastructure/validation-worker.runner.ts');

const frontend = 'https://frontend.example.invalid';
const configurations = {
  valid: ' \t HTTPS://FRONTEND.EXAMPLE.INVALID:443 , https://bücher.example.invalid \r\n ',
  control1: frontend + '\u0001',
  control31: frontend + '\u001f',
  inside: 'https://front\u0001end.example.invalid',
  mixed: frontend + ',https://other.example.invalid\u001f',
  wildcard: '*',
};
const [name, mode] = process.argv.slice(2);
if (!(name in configurations) || !['joi', 'factory'].includes(mode))
  throw new Error('Unknown isolated CORS startup case');
process.env.CORS_ORIGINS = configurations[name];
const facts = {
  name,
  mode,
  listenAttempted: false,
  realHttpListening: false,
  rejected: false,
  serverClosed: false,
};
let application,
  finished = false;
async function finish(error) {
  if (finished) return;
  finished = true;
  if (error) {
    facts.rejected = true;
    facts.error = error.message;
  }
  try {
    await application?.close();
    facts.serverClosed = true;
  } catch (cleanup) {
    facts.cleanupError = cleanup.message;
  }
  console.log('CORS_STARTUP_RESULT ' + JSON.stringify(facts));
}
process.on('unhandledRejection', (error) => {
  void finish(error);
});
process.on('uncaughtException', (error) => {
  void finish(error);
});

class ProbeController {
  read() {
    return { ok: true };
  }
}
Controller('cors-startup-probe')(ProbeController);
Get()(
  ProbeController.prototype,
  'read',
  Object.getOwnPropertyDescriptor(ProbeController.prototype, 'read'),
);
class IsolatedRoot {}
Module({
  imports:
    mode === 'joi'
      ? [
          ConfigModule.forRoot({
            ignoreEnvFile: true,
            isGlobal: true,
            validationSchema: environmentValidationSchema,
          }),
        ]
      : [],
  controllers: [ProbeController],
  // Worker execution is outside this HTTP/config test; no real worker is constructed.
  providers: [
    { provide: ConversionWorkerRunner, useValue: { start() {} } },
    { provide: ValidationWorkerRunner, useValue: { start() {} } },
  ],
})(IsolatedRoot);
const rootPath = require.resolve('../src/app.module.ts');
const root = new NodeModule(rootPath);
root.filename = rootPath;
root.loaded = true;
root.exports = { AppModule: IsolatedRoot };
require.cache[rootPath] = root;

const create = NestFactory.create.bind(NestFactory);
NestFactory.create = async (rootModule) => {
  // Delegate to the real factory. Throw on startup errors instead of terminating the test process.
  application = await create(rootModule, { logger: false, abortOnError: false });
  const listen = application.listen.bind(application);
  const observedListen = async () => {
    facts.listenAttempted = true;
    const result = await listen(0, '127.0.0.1');
    facts.realHttpListening = true;
    const port = application.getHttpServer().address().port;
    const url = `http://127.0.0.1:${port}/api/v1/cors-startup-probe`;
    const approved = await fetch(url, { headers: { Origin: frontend } });
    const denied = await fetch(url, { headers: { Origin: 'https://unapproved.example.invalid' } });
    const preflight = await fetch(url, {
      method: 'OPTIONS',
      headers: {
        Origin: frontend,
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'authorization,content-type',
      },
    });
    facts.http = {
      approvedStatus: approved.status,
      approvedOrigin: approved.headers.get('access-control-allow-origin'),
      approvedCredentials: approved.headers.get('access-control-allow-credentials'),
      deniedOrigin: denied.headers.get('access-control-allow-origin'),
      deniedCredentials: denied.headers.get('access-control-allow-credentials'),
      preflightStatus: preflight.status,
      preflightOrigin: preflight.headers.get('access-control-allow-origin'),
      preflightHeaders: preflight.headers.get('access-control-allow-headers'),
    };
    setImmediate(() => {
      void finish();
    });
    return result;
  };
  // Nest's application proxy does not support replacing instance methods via assignment.
  return new Proxy(application, {
    get(target, property) {
      return property === 'listen' ? observedListen : Reflect.get(target, property);
    },
  });
};
const watchdog = setTimeout(() => {
  void finish(new Error('Isolated startup timed out'));
  process.exitCode = 1;
}, 20000);
watchdog.unref();
require('../src/main.ts');
