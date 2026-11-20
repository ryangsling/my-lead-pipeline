# The Incodet Agent Hub App

## Business Requirements

This project is building a self-hosted, multi-workspace Next.js app that replaces GoHighLevel (and the Vapi + Make + Cal.com + Google Sheets + Telegram stack) for Incodet's AI receptionist offer. The full spec is `Incodet Agent Hub PRD.md`. Key features:

- One workspace per client business, with clone-from-template, so a new niche demo goes live in under 60 minutes with no code changes
- Voice agent managed in the hub and synced to Vapi, calling the hub's own tools for availability, booking and lead capture
- Web chat agent that runs on the hub through an OpenAI-compatible LLM, with the same knowledge and tools as voice
- Booking engine on Google Calendar with a public `/book/<slug>` page and zero double bookings
- Lightweight CRM: contacts, conversations, transcripts, recordings, cost and structured call fields
- Owner notifications by Telegram and email within 60 seconds, retried and logged
- One script tag embed for chat, voice button and lead form on Lovable sites
- Every API key entered in the GUI, encrypted at rest, with a "Test connection" button
- Ordered pool of lent Vapi accounts for demo workspaces, with automatic switching

Only the Incodet admins log in. Owners, callers and web visitors never have accounts.

## Limitations

The MVP is P0 in the PRD plus the Vapi account pool. Out of scope:

- Polished UI or branding
- Pipelines, invoicing, payments, marketing campaigns
- Outbound calling
- Client logins and the owner portal (P2)
- Mobile app
- WhatsApp (P2)
- P1 items: reschedule or cancel by phone and `find_booking`, customer reminders, prompt version history, CSV export, usage page

One calendar per workspace. Agent bookings are final (status `booked`). Vercel Hobby is for demos only; paying clients need Vercel Pro or another host first.

## Technical Decisions

- Frontend: Next.js 16 App Router, React 19, TypeScript, Tailwind CSS 4, stock shadcn/ui
- Next.js 16 differs from older versions. Read the relevant guide in `node_modules/next/dist/docs/` before writing framework code
- Backend: Next.js route handlers and server actions in the same repo; `proxy.ts` (not `middleware.ts`) for session refresh; `after()` for work after a webhook reply
- Packaging / deployment: one repo; Vercel in `lhr1`, local dev through a `cloudflared` tunnel; embed scripts bundled to `public/` with esbuild
- Package manager: pnpm, Node 24
- Voice: Vapi REST API, `@vapi-ai/web` for web calls; 11labs `eleven_flash_v2_5` and gpt-4o-mini inside calls
- Chat: Vercel AI SDK with `@ai-sdk/openai-compatible`, OpenRouter as the default base URL
- Calendar: `googleapis`, one OAuth app, one refresh token per workspace
- Email: Resend, with SMTP through `nodemailer` as fallback; Telegram Bot API over plain `fetch`
- Database: Supabase Postgres in `eu-west-2`, Drizzle ORM, `postgres` driver through the transaction pooler (`prepare: false`); RLS on with no policies
- Auth: Supabase Auth, email and password, allowlisted by `ADMIN_EMAILS`, public signups off
- Testing: Vitest, MSW for external APIs, Docker Postgres for integration tests, Playwright for E2E
- Scheduling: Vercel Cron daily for `/api/cron/health`; cron-job.org every minute for `/api/cron/sweep`, because Hobby crons run once a day
- Dates: `luxon`, UTC in the database, workspace timezone at the edges. Phones: `libphonenumber-js`, stored as E.164

## Starting Point

Parts 1 and 2 of `docs/PLAN.md` are done: scaffold, schema, migrations and tests exist. Accounts already held: Vapi, ElevenLabs, OpenRouter. Bloom (UK salon, Europe/London) is the first workspace and the test bed.

## Design System

Reference: none. `design/DESIGN.md` does not exist in this repo, and the PRD makes UI quality a non-goal.

- Palette: stock shadcn/ui neutral theme, no custom colors
- Type: the shadcn/ui starter defaults, with no custom typefaces
- Signature element: none, on purpose
- Constraints: no custom design work; no marketing or landing pages; dashboard screens are shadcn tables and forms
- Motion: none beyond shadcn defaults

The embed widgets on client sites use system fonts and take their accent color from `embeds.theme`.

## Coding Standards

1. Use latest versions of libraries and idiomatic approaches as of today
2. Keep it simple - NEVER over-engineer, ALWAYS simplify, NO unnecessary defensive programming. No extra features - focus on simplicity.
3. Be concise. Keep README minimal. IMPORTANT: no emojis ever
4. When hitting issues, always identify root cause before trying a fix. Do not guess. Prove with evidence, then fix the root cause.

## Project-Specific Rules

1. Every query on client-owned data filters by `workspace_id`. The workspace comes from the session, the assistant id or the embed key, never from LLM or request-body input.
2. Secrets are encrypted with AES-256-GCM, decrypted only on the server and never sent to the browser. Only masked values and public keys leave the server.
3. Store each raw webhook in `webhook_events` first, then process; return 200 fast. Use the Vapi call id as the idempotency key.
4. Tool endpoints answer within 1.5 seconds. Every slot is validated on the server, whatever the LLM sent.
5. Store times in UTC and show them in the workspace timezone. Keep prices as text.
6. The first message always says it is an AI assistant and that calls may be recorded. No prompt ever tells the agent to deny being AI.
7. Telegram and email carry only name, phone, service, time, a 2-line summary and a hub link.
8. Vapi request and response shapes come from `docs/vapi-contract.md` and captured fixtures. Check it before touching Vapi code.
9. Do not build past P0 without an explicit request.

## Working Documentation

All documents for planning and executing this project will be in the docs/ directory.
Please review the docs/PLAN.md document before proceeding. Read docs/HANDOFF.md first for the current state, commands and gotchas.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
