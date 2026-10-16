import * as dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');

import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';
import { ApiExceptionFilter } from './shared/errors/api-exception.filter';
import { ConversionWorkerRunner } from './modules/conversions/infrastructure/conversion-worker.runner';
import { ValidationWorkerRunner } from './modules/validation/infrastructure/validation-worker.runner';
import { ContractNotificationEmailOutboxWorker } from './modules/crm/infrastructure/contract-notification-email-outbox.worker';
import { CrmChatWebSocketService } from './modules/crm/infrastructure/crm-chat.websocket';
import { createCorsOptions } from './config/cors-policy';

async function bootstrap(): Promise<void> {
  // Signing-provider webhook verification needs the exact bytes that were signed by the provider.
  // Controllers must still pass rawBody directly to the configured adapter and never log it.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.enableShutdownHooks();

  // Allow up to 10MB payloads for digital signature canvas and official seal uploads
  app.use(json({ limit: '10mb' }));
  app.use(urlencoded({ extended: true, limit: '10mb' }));

  app.use(
    helmet({
      crossOriginOpenerPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      frameguard: false,
      contentSecurityPolicy: false,
    }),
  );

  app.enableCors(createCorsOptions(process.env.CORS_ORIGINS));

  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalFilters(new ApiExceptionFilter());

  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('ALSM API')
      .setDescription('Legacy Modernization Platform backend API')
      .setVersion('v1')
      .addBearerAuth()
      .build(),
  );
  SwaggerModule.setup('api/docs', app, document);

  await app.listen(process.env.PORT ?? 3000);

  // Initialize CRM Chat WebSocket gateway
  try {
    const wsChatService = app.get(CrmChatWebSocketService);
    wsChatService.initialize(app.getHttpServer());
  } catch (wsErr) {
    console.error('Failed to initialize CRM Chat WebSocket server:', wsErr);
  }

  // Automatically start conversion and AI validation BullMQ worker runners
  try {
    const conversionWorker = app.get(ConversionWorkerRunner);
    conversionWorker.start();
    const validationWorker = app.get(ValidationWorkerRunner);
    validationWorker.start();
    const contractEmailWorker = app.get(ContractNotificationEmailOutboxWorker);
    contractEmailWorker.start();
  } catch (workerErr) {
    console.error('Failed to start worker runners in main process:', workerErr);
  }
}

void bootstrap();
// ALSM backend bootstrap initialized
