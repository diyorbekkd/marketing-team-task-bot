# Marketing Team Task Bot

Marketing Team Task Bot is a deterministic task-management system for a five-person marketing team. It is designed to answer practical operational questions—who is doing what, what is due, what is blocked, and where work repeatedly slows down—without using AI in the production application.

The product will expose one shared backend and one Supabase PostgreSQL database through three interfaces:

- a Telegram marketing group for fast shorthand task creation;
- private chat with the Telegram bot for personal workflows and notifications;
- a mobile-first Telegram Mini App for task and team views.

## Stack

- TypeScript and Next.js App Router
- Supabase PostgreSQL
- Telegram Bot API over a webhook
- Zod for runtime boundary validation
- Vitest for domain unit tests

Core business rules and authorization live outside Telegram and UI code so every transport uses the same behavior.

## Local development

The repository currently contains the Sprint 0 foundation. Copy `.env.example` to `.env.local` and provide development credentials when they are available. Never commit that file.

```bash
npm install
npm run dev
```

Useful checks:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Local Supabase commands use the project-pinned CLI:

```bash
npm run supabase:start
npm run supabase:stop
```

Docker is required to run the local Supabase stack. The application skeleton and unit tests do not require live credentials.

## Documentation

- [Product rules](docs/PRODUCT.md)
- [Delivery roadmap](docs/SPRINTS.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Sprint 0 plan](docs/SPRINT_0_PLAN.md)
