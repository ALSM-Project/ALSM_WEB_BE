# Configuration

`config/` owns environment configuration and startup validation for NestJS,
MongoDB, Redis, JWT, CORS, and related runtime settings. New required variables
must be documented in `.env.example`, validated during startup, and reflected
in the root README when developers need to configure them.

No secrets may be committed. Credentials, keys, tokens, and production values
belong in environment management, not source control or logs.

## Browser origins

`CORS_ORIGINS` is a required comma-separated list of explicit HTTP(S) origins:
scheme, hostname and optional port, without a trailing slash, path, query, fragment,
userinfo or wildcard. Empty/malformed entries invalidate the entire list at startup.
Whitespace around entries is trimmed; scheme/host case, IDN names and default ports
are normalized with the URL parser, and duplicates are removed. Requests are matched
by the resulting exact origin tuple, never hostname prefixes/subdomains.

After the documented surrounding configuration-whitespace trim, every remaining
ASCII C0 control (U+0000–U+001F) and DEL (U+007F) is rejected before URL parsing.
Controls inside an entry or a non-whitespace control at its boundary invalidate the
entire allowlist. Incoming Origin callback values are not trimmed: controls and
whitespace are denied rather than silently normalized. Invalid configuration fails
Joi startup validation and the production factory's independent pre-listen check.

The same explicit-list rule applies in every environment. There is no automatic
localhost, 127.0.0.1, IPv6-loopback or private-network allowance in production or
development. Web 1's current Vite default is `http://localhost:5173`; Web 2 uses
`http://localhost:3002`. Existing local 3001/3003 portal origins remain in the example.
Only list origins actually used by that environment. A browser opened on 127.0.0.1
needs its explicit 127.0.0.1 origin; localhost is not an alias in an origin policy.
The owned UC-66 browser harness uses `http://127.0.0.1:3017` and its separate explicit
test registration; it does not activate production handlers.

Production must supply the reviewed deployed Frontend origins, normally HTTPS,
through deployment environment management. Do not copy development origins into a
production allowlist or use `*`. This change does not edit the actual `.env` or
deployment settings. `APP_BASE_URL` and portal redirect URLs do not grant CORS access.

Approved CORS responses retain credentials and the installed middleware's existing
methods and preflight header handling, including Authorization and Content-Type.
Unapproved/malformed origins receive no allow-origin/allow-credentials headers.
Requests without Origin, including ordinary server-to-server clients and same-origin
browser requests that omit it, still reach the normal API handlers without CORS
headers. Same-origin requests do not need CORS permission. CORS is a browser response
access policy, not authentication, CSRF protection or a firewall: a request may reach
an API handler despite CORS denial, and existing JWT/session/RBAC checks still apply.

Related: [`RULE.md`](../../RULE.md) · [Developer Handbook](../../docs/engineering/DEVELOPER_HANDBOOK.md)
