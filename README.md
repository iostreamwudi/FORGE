# FORGE

Phase 0 of a local-first adaptive strength coach built with React Native, Expo, TypeScript, and Expo Router.

## Run

```bash
pnpm install
pnpm start
```

Press `i` for iOS Simulator or `a` for Android Emulator. You can also scan the QR code with an Expo-compatible development client.

The repository now also contains a real local API service in [`server/index.mjs`](server/index.mjs). It requires Node.js 22.5+ for the built-in SQLite runtime and refuses to start without a session secret:

```bash
FORGE_SESSION_SECRET='use-a-random-secret-with-at-least-32-characters' pnpm api
```

Copy [`.env.api.example`](.env.api.example) to a private server environment before deployment. Production exports also require an HTTPS `FORGE_PUBLIC_BASE_URL`; without it, the server can generate an export file but will not expose a download address. The API intentionally returns explicit `503` responses for unconfigured email, Coach, nutrition, or exercise providers; it does not seed demo accounts or catalog records.

Coach AI local setup is documented in [docs/COACH_AI_INTEGRATION.md](docs/COACH_AI_INTEGRATION.md). The local `.env.local` file is intentionally ignored by git.

## Architecture

Routes in `app/` stay thin. Product UI lives in `src/features`, shared native UI and tokens in `src/design-system`, domain models in `src/types`, and local-first persistence/API boundaries in `src/data`. The app ships without bundled mock or demo records; empty states reflect missing real user or service data.
