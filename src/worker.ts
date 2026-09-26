import * as dns from 'node:dns';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConversionWorkerRunner } from './modules/conversions/infrastructure/conversion-worker.runner';
import { ValidationWorkerRunner } from './modules/validation/infrastructure/validation-worker.runner';

try {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch {
  // Ignore DNS fallback failure
}

async function bootstrapWorker(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule);
  app.get(ConversionWorkerRunner).start();
  app.get(ValidationWorkerRunner).start();
}

void bootstrapWorker();
