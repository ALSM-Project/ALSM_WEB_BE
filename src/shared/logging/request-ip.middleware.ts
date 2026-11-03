import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { requestIpStorage } from './request-ip.storage';

// Captures the client IP (honoring X-Forwarded-For when behind a proxy)
// into request-scoped storage so downstream audit writes can record it.
@Injectable()
export class RequestIpMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    const forwarded = req.headers['x-forwarded-for'];
    let ip =
      (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0].trim() ||
      req.ip ||
      req.socket?.remoteAddress ||
      '';

    // Normalize IPv6 loopback and IPv4-mapped IPv6 addresses to standard IPv4
    if (ip === '::1' || ip === '::ffff:127.0.0.1' || ip === '0:0:0:0:0:0:0:1') {
      ip = '127.0.0.1';
    } else if (ip.startsWith('::ffff:')) {
      ip = ip.replace('::ffff:', '');
    }

    requestIpStorage.run(ip, () => next());
  }
}
