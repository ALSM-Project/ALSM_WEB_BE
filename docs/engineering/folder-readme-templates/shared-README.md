# Shared Technical Infrastructure

`src/shared/` contains only technical code genuinely reused across multiple business modules.

## Allowed examples

- generic errors
- logging primitives
- security primitives
- database connection helpers
- queue connection helpers
- common decorators/types with no business ownership

## Not allowed

- Project business rules
- Conversion business rules
- Billing policies
- Organization membership rules
- application services that belong to one module

> `shared/` is not a dumping ground. If a concept has a clear business owner, keep it in that module.
