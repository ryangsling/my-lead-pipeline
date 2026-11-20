# Handoff to Codex

Written 2026-11-06 by Claude Code. Read this, then `AGENTS.md`, then `docs/PLAN.md`. The spec is `Incodet Agent Hub PRD.md`.

## Where things stand

- Parts 1 to 7 are done and checked locally. Part 5 is complete except the physical phone-number check (the Vapi account has no numbers) and the day-old date recheck. Nothing is committed yet; the whole tree is untracked on branch `master`.
- The real Supabase project is `kyjrpgxwcpgdbjvnalkr`. Always pass that as `project_id` if you use a Supabase tool. Never touch other projects.
- PAUSE 2 is done: Vapi, OpenRouter, Resend and Telegram keys are saved (encrypted) in the database and pass Test connection. SMTP is skipped on purpose.
- OpenRouter uses the free model `nvidia/nemotron-3.5-lightning:free`. It lists tool support, but nobody has tried real tool calls yet. If it behaves badly in the chat agent, change the model setting, not code.
- Parts 6 to 8 are code complete and tested (unit 45, integration 91, E2E booking 3, build passes). Google is connected and form bookings reach the real calendar with name and phone in the event (2026-11-10). **Still to do by the user:** the PAUSE 5 voice bookings (4 to 5, not 20, to save Vapi credit), then say "4-5 voice bookings done, 0 double bookings".
- Part 8 ingests `end-of-call-report` inside `after()` (`src/lib/conversations/ingest.ts`). Tests that post to the webhook route must mock `after` from `next/server` and await it (see `tests/int/conversations.test.ts`).
- The recording URL in a report is a private R2 link that returns 400. The player goes through `/api/conversations/[id]/recording`, which redirects to a fresh signed link from Vapi.
- Sync fails with "Couldn't Find 11labs Voice" for every voice id (checked 2026-11-15, including ElevenLabs premade Rachel, on a throwaway assistant). That means the ElevenLabs key saved inside Vapi (dashboard, Provider Keys) is broken; the hub code is not involved. Fix it in the Vapi dashboard, then press Sync.
- E2E specs that log in need `E2E_ADMIN_EMAIL` and `E2E_ADMIN_PASSWORD` passed inline (never saved) and `APP_URL=http://localhost:3000`, because the Playwright base URL follows `APP_URL`, which is the tunnel. `tests/e2e/crm.spec.ts` passed on 2026-11-15; install the browser once with `pnpm exec playwright install chromium-headless-shell`.
- Part 7 measured tool latency 2.1 to 3.5 s from the dev PC, because each database round trip to Supabase is 170 ms or more there. Re-measure on Vercel in Part 13 (`pnpm exec tsx --env-file=.env.local scripts/measure-tools.ts bloom <baseUrl>`).
- `tests/fixtures/vapi/tool-calls.json` is synthetic. Replace it with a captured payload after a real booking call. `end-of-call-report.json` is a real capture.
- The quick tunnel URL changes when cloudflared restarts; update `APP_URL` and re-sync the assistant when it does.
- Part 9 (notifications) is code complete (unit 49, integration 105). The user must add a Telegram and an email channel on `/w/bloom/notifications`, press Send test, then place one voice or booking-page booking to see `booking_new` arrive. Telegram and Resend keys are already saved and tested. `notify()` is in `src/lib/notifications/send.ts`; tests that call routes using `after()` must mock `next/server` (see `tests/int/conversations.test.ts`).
- Part 10 started: only `ai` 7.0.173 and `@ai-sdk/openai-compatible` 3.0.92 are installed (docs in `node_modules/ai/docs`, tools use `inputSchema`). No Part 10 code is written yet.
- **Next: Part 10 (chat agent)**, after the user has checked real delivery. PAUSE 5 voice bookings are still open.
- Do not build past P0 (AGENTS.md rule 9). Work one part at a time and tick the boxes in `docs/PLAN.md` as you finish.

## Commands

```
pnpm dev                 # app on http://localhost:3000
pnpm exec tsc --noEmit
pnpm exec eslint src tests
pnpm test                # unit
pnpm test:int            # integration, needs Docker Postgres (docker-compose.yml, port 54322)
pnpm test:e2e            # Playwright, see credentials note below
pnpm exec next typegen   # regenerate RouteContext, PageProps, LayoutProps after adding routes
```

Check `package.json` for the exact script names. Free port 3000 with `fuser -k 3000/tcp`. Do not use `pkill -f "next dev"`; it kills the calling shell.

## Rules the user cares about

- Simple and incremental. No emojis anywhere. Find the root cause with evidence before fixing.
- Use the latest library APIs. Next.js 16 differs from older versions: read `node_modules/next/dist/docs/` before framework code.
- Coding Standards in `AGENTS.md` must stay exactly as written.
- Do not commit unless the user asks.

## Secrets

- Never print or read values from `.env.local` into the conversation. It is git-ignored and holds real pooler URLs, `ENCRYPTION_KEY`, `ADMIN_EMAILS` and more.
- If `ENCRYPTION_KEY` changes, every saved provider key becomes undecryptable. Do not change it.
- The E2E test needs a real admin login. `.env.local` has placeholder `E2E_ADMIN_EMAIL` and `E2E_ADMIN_PASSWORD` for an account that does not exist. Ask the user for the login and pass it as inline env vars for one run. Never write it to a file.
- E2E runs leave archived `e2e-*` workspaces (and fake Vapi override rows) in the real database. Harmless.
- The e2e test email must stay out of Vercel's `ADMIN_EMAILS`.

## Gotchas already paid for

- Integration tests that mock Google with MSW must call `startGoogle()` from `tests/int/helpers/world.ts` after the first database query; MSW active first breaks the Postgres socket with ENOTCONN.
- Phone numbers: `normalizePhone` accepts valid or possible numbers of 8+ digits, because `isValid` rejects 07700 900xxx, which the plan uses as its example.
- The Agent form's "Call model (Vapi)" is the voice model inside Vapi and defaults to `gpt-4o-mini` per the PRD. The OpenRouter model in integrations is for the web chat agent only; it never affects voice calls.
- Vapi end-of-call reports echo `message.assistant.model.tools[].server.headers` and `message.assistant.server.headers` with `x-vapi-secret`. `stripServerHeaders` in the webhook removes all `server.headers` before the raw payload is stored; never store them.
- In a captured report, `message.call.cost` was 0 and `message.call.status` was still `queued`. Use `message.cost`, `message.costBreakdown.total`, `message.analysis.summary` and `message.endedReason`.
- Next.js dev blocks tunnel hosts by default. `next.config.ts` allows `*.trycloudflare.com` via `allowedDevOrigins` and `experimental.serverActions.allowedOrigins`; without that, the page loads but its buttons do nothing.
- `cacheComponents` and `partialPrefetching` are off (decision D17). Turning them on breaks the build on every signed-in page.
- `proxy.ts`, not `middleware.ts`. It refreshes the session with `getClaims()`; `requireAdmin` uses `getUser()`.
- Admin API routes use `withAdmin(async (admin, request, ctx) => ...)` from `src/lib/api.ts`. Scope by `workspace_id` from the session or assistant id, never from request bodies.
- Env is validated in `src/lib/env.ts`. `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are optional, so Part 6 must check they are set before use.
- Integrations: `getIntegration(workspaceId, provider)` returns the workspace row, else the global row. Vapi, OpenRouter and Resend allow per-workspace overrides; Telegram and SMTP do not.
- Base URLs: strip trailing slashes before appending paths (this broke the OpenRouter test once). Do the same in the Part 10 chat client.
- MSW 3: use `server.listen({ onUnhandledFrame: "error" })`, not `onUnhandledRequest`.
- Zod 4: `z.flattenError`, `z.uuid()`.
- The user's network to `api.telegram.org` is flaky (about half of connections time out). A Telegram "fetch failed" is the network, not the code. Retry.
- Playwright: `getByRole("alert")` matches Next's route announcer too; use `getByText`. Wait for the DELETE response before navigating away.
- Vapi request and response shapes must come from `docs/vapi-contract.md` and captured fixtures. Part 5 writes that file, so read the current Vapi docs and do not guess.

## Part 5 in one line

Done: `/w/[slug]/agent`, Vapi client and sync (assistant, three tools, structured output), webhook stub at `/api/vapi/webhook`, phone number dropdown, and "Test in browser". Sync keeps tools at `/api/vapi/tools` (Part 7) and the assistant at `/api/vapi/webhook`. `assistant_syncs.vapi_account_id` is nullable so own-mode works; pool mode still arrives in Part 15. A real web call was captured: `message.cost` (not `message.call.cost`, which was 0), summary at `message.analysis.summary`, recording at `message.artifact.recordingUrl`, structured outputs at `message.artifact.structuredOutputs[id].result`. The report echoes `x-vapi-secret` in `server.headers`; the webhook strips every `server.headers` before storing raw.
