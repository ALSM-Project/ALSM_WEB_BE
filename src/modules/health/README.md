# Health Module

## Purpose

Provides the backend health boundary.

## Responsibilities / Non-Responsibilities

Exposes health status for the application and required dependencies. It must not
run conversion tools or contain unrelated business behavior.

## Public Contract

The governed endpoint is `GET /api/v1/health`. Health reporting must not leak
secrets or detailed operational internals.

## Related Documentation

[`RULE.md`](../../../RULE.md) · [Developer Handbook](../../../docs/engineering/DEVELOPER_HANDBOOK.md)
