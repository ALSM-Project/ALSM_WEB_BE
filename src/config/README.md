# Configuration

`config/` owns environment configuration and startup validation for NestJS,
MongoDB, Redis, JWT, CORS, and related runtime settings. New required variables
must be documented in `.env.example`, validated during startup, and reflected
in the root README when developers need to configure them.

No secrets may be committed. Credentials, keys, tokens, and production values
belong in environment management, not source control or logs.

Related: [`RULE.md`](../../RULE.md) · [Developer Handbook](../../docs/engineering/DEVELOPER_HANDBOOK.md)
