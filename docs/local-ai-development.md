# Local application AI development

Each developer runs their own FE1, NestJS API/workers, MongoDB, Redis, converter
tools and private backend Gemini key. No shared running backend is required.
This guide configures the normal application only. It does not authorize a live
smoke test, spending, Paid Tier, or any D3A–D3K research execution.

## Prerequisites and checkout layout

- Node >=22.12 compatible with the frontend lockfile (Node 24.12 was used for
  verification), npm, Docker, a working Python 3 installation, JDK 21 and Maven >=3.6.
- Verify `node --version`, `npm --version`, `python --version`, `java -version`,
  `mvn --version`, `docker version`. A Windows Store `python` alias is insufficient.
- GitHub read access to all repositories, including private `ALSM_TOOL_BE`.
- Use the team's reviewed/integrated application branches for both web repos.
  These changes must be integrated by the maintainer before a fresh `develop`
  checkout includes them. Do not merge the D3K branch to obtain application fixes.

Fresh checkout example (do not clone over existing directories):

```powershell
Set-Location E:\ALSM
git clone --branch develop https://github.com/ALSM-Project/ALSM_WEB_BE.git
git clone --branch develop https://github.com/ALSM-Project/ALSM_WEB_FE_1.git
git clone https://github.com/ALSM-Project/ALSM_TOOL.git
git clone https://github.com/ALSM-Project/ALSM_TOOL_BE.git
mvn -f .\ALSM_TOOL_BE\pom.xml clean package -DskipTests
```

For existing checkouts, use `git pull --ff-only` on the agreed team branch with a
clean worktree. Record `git rev-parse HEAD` in each repo for reproducible reports.
Reviewed converter references were `ALSM_TOOL` main
`8d213f2210e1c857aa3ec58cf188682898b8f2f7` and `ALSM_TOOL_BE` main
`d045206c6ee2716b353c20497fd3b8e258a9091d`; coordinate converter upgrades separately.

The Python entry point is `ALSM_TOOL/py/convert2fe/bms2react.py`; the reviewed
entry point uses the standard library. The Java build creates
`ALSM_TOOL_BE/target/akaBatch-1.0.jar`. Keep the Java repo's `Config.properties`
in its root or beside the JAR: the backend copies it into each job directory.
Python/Java are deterministic conversion tools; AI semantic validation is a
separate action after conversion completes.

## Local infrastructure

The existing application Compose file is not a complete host-development setup:
it has no MongoDB service, does not publish Redis to host Node and does not install
the converter toolchains or share API/worker job storage. Run Node on the host and
use Docker for infrastructure:

```powershell
docker run -d --name alsm-dev-mongo -p 127.0.0.1:27017:27017 -v alsm-dev-mongo:/data/db mongo:8.0 mongod --replSet rs0 --bind_ip_all
docker exec alsm-dev-mongo mongosh --quiet --eval "rs.initiate({_id:'rs0',members:[{_id:0,host:'127.0.0.1:27017'}]})"
docker exec alsm-dev-mongo mongosh --quiet --eval "db.hello().isWritablePrimary"
docker run -d --name alsm-dev-redis -p 127.0.0.1:6379:6379 -v alsm-dev-redis:/data redis:8-alpine redis-server --appendonly yes --maxmemory-policy noeviction
```

Wait for the MongoDB primary check to return `true`. Replica-set support is
required for transaction-backed application operations. These loopback-only,
unauthenticated containers are for local development. On later runs use
`docker start alsm-dev-mongo alsm-dev-redis`; do not reinitialize the replica set.
Each developer needs separate database/Redis/storage state. Do not share a queue
between stacks that point at different databases or storage directories.

## Backend configuration

```powershell
Set-Location E:\ALSM\ALSM_WEB_BE
npm ci
if (!(Test-Path .env)) { Copy-Item .env.example .env }
```

Edit `.env` privately; never paste its contents into chat, tickets or logs. Retain
unrelated template settings and override these values for host-run development:

```dotenv
NODE_ENV=development
PORT=3000
MONGODB_URI=mongodb://127.0.0.1:27017/alsm_dev?replicaSet=rs0&directConnection=true
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD=
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
STORAGE_ROOT=./storage
PYTHON_EXECUTABLE=python
TOOL_CONVERT_DIR=../ALSM_TOOL/py/convert2fe
JAVA_EXECUTABLE=java
TOOL2JAVA_JAR_PATH=../ALSM_TOOL_BE/target/akaBatch-1.0.jar
CONVERSION_WORKER_ENABLED=true
VALIDATION_WORKER_ENABLED=true
VALIDATION_WORKER_CONCURRENCY=1
VALIDATION_JOB_ATTEMPTS=1
VALIDATION_JOB_BACKOFF_MS=5000
AI_VALIDATION_ENABLED=true
AI_PROVIDER=gemini
GEMINI_API_KEY=<your-own-private-backend-key>
GEMINI_MODEL=gemini-3.5-flash
GEMINI_ALLOWED_MODELS=gemini-3.5-flash
AI_TIMEOUT_MS=60000
AI_MAX_RETRIES=0
GEMINI_MIN_REQUEST_INTERVAL_MS=60000
AI_PROMPT_VERSION=semantic-cobol-java-v1
AI_EVAL_ALLOW_LIVE_PROVIDER=false
```

Also replace `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` with unique private
values of at least 32 characters each. `MFA_ENCRYPTION_KEY` must be canonical
Base64 of 32 cryptographically random bytes. Generate/store these privately;
do not use public template placeholders. `OPENAI_API_KEY` is unnecessary for
Gemini and can remain empty. Keep `.env.example` credential-free. Private `.env`
variants are ignored; examples ending in `.example` remain reviewable.

Select a model actually available to the developer's Google project, and update
both `GEMINI_MODEL` and `GEMINI_ALLOWED_MODELS` after review. The allowlist is
comma-separated; only the configured model is requested. There is no implicit
fallback to other models or `latest` aliases. Missing provider prerequisites
are configuration errors, not permission to use another provider.

Start one process from the backend directory:

```powershell
npm run start:dev
```

The API starts conversion and validation consumers when the flags above are true.
Do not additionally run `npm run worker:dev` in this topology. For a deliberately
separate worker, set both worker flags false in the API process and true in the
worker process; use the same backend directory, MongoDB, Redis and storage root.
Multiple consumers increase concurrency and do not share process-local pacing.

Health: `http://localhost:3000/api/v1/health`.
Swagger: `http://localhost:3000/api/docs`.

## FE1 configuration

Use `ALSM_WEB_FE_1`. Put this public setting in its private `.env.local`:

```dotenv
VITE_API_BASE_URL=http://localhost:3000
```

The client adds `/api/v1`; do not add that suffix to the variable. Never place any
provider credential in a frontend variable, particularly `VITE_*`, which is
bundled into browser code.

```powershell
Set-Location E:\ALSM\ALSM_WEB_FE_1
npm ci
npm run dev -- --host localhost --port 5173 --strictPort
```

Use an authenticated organization/project member account and a completed
`BMS_DSPF_TO_FRONTEND` or `COBOL_TO_JAVA` conversion. Validation is explicitly
requested through the application; polling does not request another provider run.

## Request limits, outcomes and troubleshooting

- Both Gemini adapters use the same application transport, configured model,
  allowlist, authentication header, per-HTTP-attempt timeout and process-local
  request-start pacing. The backend sends no credential in a URL and stores/logs
  only sanitized provider failure information.
- `AI_MAX_RETRIES` is the number of additional HTTP attempts, bounded to 0–5.
  At most `AI_MAX_RETRIES + 1` requests are dispatched by one claimed adapter
  execution. A malformed/refused response, authentication rejection, rejected
  model or known daily-quota exhaustion does not trigger provider retries.
- BullMQ does not replay exhausted provider failures. Queue attempts remain
  available for infrastructure failures before provider execution. Job IDs and
  active-run deduplication remain in place.
- An atomic, journaled/majority-acknowledged MongoDB claim precedes provider
  execution. If a worker stops after that claim without saving results, redelivery
  fails with `VALIDATION_PROVIDER_EXECUTION_UNCONFIRMED` instead of calling again.
  This deliberately favors avoiding duplicate calls over automatic recovery; even
  a crash before the first HTTP request can require a new owner-reviewed run.
  Persisted results are reconciled without dispatch. This is not an exactly-once
  guarantee if database durability is lost or an administrator restores old state.
- `AI_COMPLETED` means the provider returned accepted output; it does not prove
  semantic equivalence. `HEURISTIC_FALLBACK` means BMS used rules after provider
  failure, including its safe `providerFailureCode`. `HEURISTIC_ONLY` means no AI
  execution was established. COBOL provider failures produce `FAILED` runs.
  Historical runs without provenance are shown as outcome unavailable.
- `AI_PROVIDER_DAILY_QUOTA_EXCEEDED`: wait for reset/check project quota; do not
  repeatedly rerun. Authentication/rejected-model errors require configuration
  correction. Timeouts/network/server errors use only the configured bounded
  retry budget. Do not automatically rerun an interrupted/unconfirmed execution.

Google enforces model/project RPM, input-token and daily limits. Separate keys
in one project share quota; private keys alone do not provide independent quota.
Check active limits in AI Studio. A 60-second local interval is conservative
pacing, not a quota guarantee or spending authorization. References:
[Google limits](https://ai.google.dev/gemini-api/docs/rate-limits),
[models](https://ai.google.dev/gemini-api/docs/models),
[Vite environment variables](https://vite.dev/guide/env-and-mode).

## Offline verification and live-test boundary

Backend: `npm run test:offline`, `npm run lint`,
`node node_modules/typescript/bin/tsc --noEmit`, `npm run build`.
The offline runner excludes inherited private environment values and blocks
unmocked fetch/provider HTTP. Tests install closed fake transports with synthetic
credentials. Use `npm run test:offline -- --runTestsByPath <test-path>` for focused
checks. Frontend: `npm test`, `npm run lint`, `npm run build` (includes typecheck).

Normal application AI remains independently configurable. Safe template defaults
are disabled/fake, and the research live-provider setting remains false. No
application runtime imports evaluation/research code. D3A–D3K trust, signing,
native activation and historical artifacts are outside this setup.

Before a separately approved live smoke test: integrate/review both application
branches; provision private credentials and an available allowlisted model;
confirm project quota/billing constraints, working converters and local services;
create a suitable authenticated test account/project; agree on small synthetic
inputs and the maximum request count. This implementation and its fake test results
grant no live-test or spending authorization.
