# ADR-003: Keep Conversion Algorithms Outside the Backend

- **Status:** Accepted
- **Date:** 2026-08-27
- **Decision owners:** ALSM project team

## Context

ALSM has two core conversion capabilities:

- BMS/DSPF to modern frontend output;
- COBOL to Java.

The conversion algorithms may evolve independently and may be implemented in a language/runtime different from the Node.js platform backend.

Embedding parser/mapping/generator logic directly into the API would couple platform workflow to conversion implementation and make long-running work unsafe for HTTP request handling.

## Decision

The backend does not implement actual conversion algorithms.

The backend defines a port such as:

```ts
export interface ConversionEnginePort {
  execute(input: ConversionEngineInput): Promise<ConversionEngineOutput>;
}
```

Infrastructure adapters integrate external Conversion Tools.

Conversion runs asynchronously:

```text
HTTP request
  -> persist Conversion Job
  -> enqueue job ID in BullMQ
  -> return

Worker
  -> load job
  -> choose conversion strategy
  -> invoke ConversionEnginePort adapter
  -> persist result/version
```

## Consequences

### Positive

- backend remains focused on platform/business workflow;
- tool implementation language is independent;
- conversion can be scaled/tested separately later;
- API does not block on long-running conversion work;
- tool versions can be traced per conversion version/job.

### Negative / Trade-offs

- requires an explicit integration protocol/adapter;
- tool failures/timeouts must be mapped into job/business errors;
- end-to-end environments need both platform and tool integration once tools are available.

## Alternatives Considered

### Implement converter directly in NestJS services

Rejected because it violates platform/tool separation and makes API/worker code tightly coupled to parsing/generation logic.

### Call converter synchronously from Controller

Rejected because conversion may be long-running and retryable.

## Compliance / Implementation Notes

Backend must not implement:

- BMS parser;
- DSPF parser;
- COBOL parser;
- field/paragraph mapping algorithm;
- frontend generator;
- Java generator.

When tools are unavailable, do not fake successful conversion output. Use a disabled Worker/integration mode or explicit not-configured behavior.

## Related Documents

- `/RULE.md`
- `PROJECT_STRUCTURE_GUIDELINES.md`
