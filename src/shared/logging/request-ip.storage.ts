import { AsyncLocalStorage } from 'async_hooks';

// Request-scoped storage for the client IP address. Populated by
// RequestIpMiddleware and read by MongoAuditRepository.append so audit
// entries record the originating IP without threading it through every
// caller.
export const requestIpStorage = new AsyncLocalStorage<string>();
