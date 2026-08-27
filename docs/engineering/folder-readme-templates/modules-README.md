# Business Modules

`src/modules/` contains ALSM business modules. Each module owns a coherent business capability and follows the dependency direction defined in `/RULE.md`.

## Rules

- Organize by business capability, not global technical type.
- Do not import another module's Infrastructure implementation.
- Expose only intentional public contracts.
- Keep organization isolation explicit.
- Important modules should contain their own `README.md`.

## Standard shape

```text
<module>/
├── domain/
├── application/
├── infrastructure/
├── presentation/
├── <module>.module.ts
└── README.md
```
