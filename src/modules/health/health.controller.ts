import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    @InjectConnection() private readonly mongo: Connection,
    private readonly config: ConfigService,
  ) {}

  @Get()
  async health(): Promise<{ status: string; services: { mongodb: string; redis: string } }> {
    const mongodb = this.mongo.readyState === 1 ? 'up' : 'down';
    let redis = 'down';
    const client = new Redis({
      host: this.config.getOrThrow('REDIS_HOST'),
      port: this.config.getOrThrow<number>('REDIS_PORT'),
      password: this.config.get<string>('REDIS_PASSWORD') || undefined,
      maxRetriesPerRequest: 1,
      connectTimeout: 1000,
      lazyConnect: true,
    });

    try {
      await client.connect();
      await client.ping();
      redis = 'up';
    } catch {
      /* reported below */
    } finally {
      client.disconnect();
    }

    const isDev = process.env.NODE_ENV !== 'production';
    const status = mongodb === 'up' && (redis === 'up' || isDev) ? 'ok' : 'degraded';
    const body = { status, services: { mongodb, redis } };

    if (mongodb === 'down' || (!isDev && redis === 'down')) {
      throw new ServiceUnavailableException({
        code: 'DEPENDENCY_UNAVAILABLE',
        message: 'One or more essential dependencies are unavailable',
        details: body,
      });
    }

    return body;
  }
}
