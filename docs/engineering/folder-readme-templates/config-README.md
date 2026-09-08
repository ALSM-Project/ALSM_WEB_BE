# Configuration

`src/config/` centralizes ALSM backend configuration and startup validation.

## Rules

- Read environment variables centrally.
- Validate required values at startup.
- Add every developer-facing variable to `.env.example`.
- Never commit production secrets.
- Do not scatter `process.env` reads through business modules.
- Docker service hostnames are `mongodb` and `redis` inside the Compose network.
