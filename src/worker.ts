import { NestFactory } from '@nestjs/core'; import { AppModule } from './app.module'; import { ConversionWorkerRunner } from './modules/conversions/infrastructure/conversion-worker.runner';
async function bootstrapWorker(): Promise<void> { const app = await NestFactory.createApplicationContext(AppModule); app.get(ConversionWorkerRunner).start(); } void bootstrapWorker();
