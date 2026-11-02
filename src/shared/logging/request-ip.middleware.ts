import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { requestIpStorage } from './request-ip.storage';

// Captures the client IP (honoring X-Forwarded-For when behind a proxy)
// into request-scoped storage so downstream audit writes can record it.
@Injectable()
export class RequestIpMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    const forwarded = req.headers['x-forwarded-for'];
    const ip =
      (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0].trim() ||
      req.ip ||
      req.socket?.remoteAddress ||
      '';
    requestIpStorage.run(ip, () => next());
  }
}
