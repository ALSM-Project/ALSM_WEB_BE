# Shared Technical Primitives

`shared/` contains only truly reusable technical primitives, such as `errors/`,
`logging/`, `security/`, database helpers, queue helpers, decorators, and common
types. It must not become a home for business logic or a shortcut around module
ownership.

Modules retain ownership of their domain rules and data. Keep shared utilities
small, technology-neutral where possible, and free of cross-module business
dependencies.

Related: [`RULE.md`](../../RULE.md) · [Project Structure](../../docs/engineering/PROJECT_STRUCTURE_GUIDELINES.md)
