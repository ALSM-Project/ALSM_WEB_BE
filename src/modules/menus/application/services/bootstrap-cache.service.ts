import { Injectable, Logger } from '@nestjs/common';
import { SessionBootstrapPayload } from '../types/session-bootstrap.types';

interface CacheEntry {
  data: SessionBootstrapPayload;
  cachedAt: number;
  revalidateAt: number;
  expiresAt: number;
}

@Injectable()
export class BootstrapCacheService {
  private readonly logger = new Logger(BootstrapCacheService.name);
  private readonly cache = new Map<string, CacheEntry>();

  // Stale-while-revalidate defaults:
  // Fresh for 60 seconds.
  // Stale (revalidate in background) for 5 minutes.
  // Expired after 15 minutes.
  private readonly FRESH_TTL_MS = 60 * 1000;
  private readonly EXPIRE_TTL_MS = 15 * 60 * 1000;

  get(userId: string, orgId: string | null, contractId: string | null): { data: SessionBootstrapPayload; isStale: boolean } | null {
    const key = this.buildKey(userId, orgId, contractId);
    const entry = this.cache.get(key);
    if (!entry) return null;

    const now = Date.now();
    if (now > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    const isStale = now > entry.revalidateAt;
    return { data: entry.data, isStale };
  }

  getByUserId(userId: string): { data: SessionBootstrapPayload; isStale: boolean } | null {
    const prefix = `bootstrap:user:${userId}:`;
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (key.startsWith(prefix)) {
        if (now > entry.expiresAt) {
          this.cache.delete(key);
          continue;
        }
        return { data: entry.data, isStale: now > entry.revalidateAt };
      }
    }
    return null;
  }

  set(userId: string, orgId: string | null, contractId: string | null, payload: SessionBootstrapPayload): void {
    const key = this.buildKey(userId, orgId, contractId);
    const now = Date.now();
    this.cache.set(key, {
      data: payload,
      cachedAt: now,
      revalidateAt: now + this.FRESH_TTL_MS,
      expiresAt: now + this.EXPIRE_TTL_MS,
    });
  }

  /**
   * Event-driven cache invalidation (Big Tech requirement).
   * Automatically invoked whenever contract changes, role changes, or org status updates.
   */
  invalidate(userId?: string, orgId?: string, contractId?: string): void {
    if (!userId && !orgId && !contractId) {
      this.cache.clear();
      this.logger.log('Bootstrap cache fully cleared');
      return;
    }

    let purgedCount = 0;
    for (const [key] of this.cache.entries()) {
      let match = false;
      if (userId && key.includes(`user:${userId}`)) match = true;
      if (orgId && key.includes(`org:${orgId}`)) match = true;
      if (contractId && key.includes(`contract:${contractId}`)) match = true;

      if (match) {
        this.cache.delete(key);
        purgedCount++;
      }
    }
    this.logger.log(`Bootstrap cache purged ${purgedCount} entries (userId=${userId}, orgId=${orgId}, contractId=${contractId})`);
  }

  private buildKey(userId: string, orgId: string | null, contractId: string | null): string {
    return `bootstrap:user:${userId}:org:${orgId || 'none'}:contract:${contractId || 'none'}`;
  }
}
