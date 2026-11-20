# Incodet Agent Hub PRD

Nov 5, 2026 · @Asif Khan

## Summary

Agent Hub is a self-hosted Next.js app that replaces GoHighLevel for Incodet's AI receptionist offer. It gives one workspace per client business, with the voice agent, web chat agent, booking, a lightweight CRM and owner notifications in one dashboard. It replaces the five-tool stack (Vapi, Make, Cal.com, Google Sheets, Telegram glue) with one app plus Vapi.

**Core decisions**

- **Vapi stays the voice runtime, with a pool of lent accounts for demos.** Booking logic, CRM, notifications and chat all live in Agent Hub.
- **Vapi calls Agent Hub's own tool endpoints** for availability and booking, instead of Vapi's built-in Google Calendar tool. Every booking is then logged in the hub as well as in Google Calendar.
- **Make, Cal.com and Google Sheets are dropped.** The hub receives webhooks itself, serves its own booking page and stores leads in Postgres.
- **Chat runs on the hub, not on Vapi.** It uses an OpenAI-compatible LLM (OpenRouter by default) with the same knowledge and the same booking tools as the voice agent, so chat does not spend Vapi credit.
- **Every API key is entered in the GUI,** encrypted at rest, with a "Test connection" button.
- **UI quality is out of scope.** Correctness, logging and reliability are in scope.

## Goals and non-goals

The MVP succeeds when a new niche demo (site plus voice, chat, booking and notifications) goes live in under 60 minutes, with no code changes.

**Goals**

1. Run voice calls, web chat, lead forms and self-booking for many client workspaces from one dashboard.
2. Log every call, chat and form as a contact plus conversation, and notify the owner within 60 seconds.
3. Connect every external service through GUI forms. No keys in code, no redeploy to add a client.
4. Cost nothing for demos beyond Vapi minutes (free tiers for database, hosting, email and Telegram).
5. Be ready to serve the first paying clients with the same code.

**Non-goals for the MVP**

- Polished UI or branding
- Sales pipelines, opportunities, invoicing or payments
- Email or SMS marketing campaigns
- Outbound calling (Vapi free numbers are inbound only)
- Client-facing logins (owners get notifications only; a read-only portal is P2)
- Mobile app

**Success criteria**

| Metric | Target |
| --- | --- |
| Time to launch a new demo workspace from a template | Under 60 minutes |
| Call or chat logged with summary after it ends | 100% of calls, within 60 seconds |
| Owner notification delivered | Within 60 seconds, failures retried and logged |
| Double bookings in testing | 0 across 20 test bookings |
| Booking tool reply time during a call | Under 1.5 seconds |

## Users and core flows

Four people touch the system; only the admin logs in during the MVP.

| User | Who | What they do |
| --- | --- | --- |
| Admin | Incodet team (Asif, Alif, Monir) | Create workspaces, connect keys, edit agents, read logs |
| Business owner | The client (salon, roofer) | Receives notifications, confirms bookings by replying or calling back |
| Caller | The business's customer on the phone or web voice button | Talks to the voice agent, gets booked |
| Web visitor | Customer on the business website | Uses chat, the lead form or the booking page |

**Flow A: inbound call or web voice call**

1. Caller dials the Vapi number or presses the voice button on the site.
2. Vapi runs the assistant that Agent Hub synced for this workspace. The first message states it is an AI assistant and the call may be recorded.
3. When the caller wants a time, Vapi calls `check_availability` on Agent Hub. The hub reads Google Calendar free/busy plus its own appointments and returns up to 3 open slots.
4. Caller picks a slot. Vapi calls `book_appointment`. The hub creates the contact, the appointment and the Google Calendar event, then returns a confirmation sentence.
5. Call ends. Vapi posts the end-of-call report. The hub stores transcript, summary, recording URL, cost and structured fields, then notifies the owner.
6. If the caller will not book, the agent calls `capture_lead` so the owner can follow up.

**Flow B: web chat**

1. Visitor opens the chat bubble from the hub's embed script.
2. The hub streams replies from the LLM with the workspace knowledge and the same tools as Flow A.
3. Booking or lead capture follows steps 3 to 6 of Flow A. Owner is notified when the chat books, captures a lead or goes idle for 10 minutes.

**Flow C: lead form**

1. Visitor submits the embedded form.
2. The hub validates it (honeypot, rate limit), creates or updates the contact, logs a conversation of channel `form` and notifies the owner.

**Flow D: self-booking page**

1. Visitor opens `/book/<workspace-slug>` (link or iframe).
2. Picks a service, then a slot from the same availability engine, then enters name, phone and email.
3. The hub books exactly as in Flow A step 4.

**Flow E: owner handles the booking**

1. Owner gets the Telegram or email message with name, phone, service, time and a short summary.
2. Owner confirms or changes the time with the customer. Admin (or the owner in P2) marks the appointment `confirmed`, `rescheduled` or `cancelled` in the hub, which updates Google Calendar.

## Architecture and stack

One Next.js app does everything except the live voice call, which stays on Vapi. The diagram below shows what calls what.

&#91;embedded content: Agent Hub architecture · 1 app, 4 outside services\]

Calls and the voice button reach Vapi first; Vapi then calls the hub's tool API to check slots and book. Chat, forms and the booking page talk to the hub directly.

| Layer | Choice | Why |
| --- | --- | --- |
| App framework | Next.js (App Router) + TypeScript | API routes and dashboard in one repo, deploys to Vercel as is |
| Database + auth | Supabase (Postgres + Auth) free tier | Same stack Lovable uses; one admin login via email |
| ORM | Drizzle | Typed queries, simple migrations |
| Dashboard UI | shadcn/ui tables and forms, no custom design | UI quality is a non-goal |
| Voice runtime | Vapi (assistant, phone number, web SDK) | Already chosen; free US number |
| Voice and LLM inside calls | ElevenLabs (own key), Vapi gpt-4o-mini | Already chosen |
| Chat LLM | OpenRouter, OpenAI-compatible API, model set per workspace | Key already held; any model swap is a dropdown |
| Calendar | Google Calendar API | Owners already use it; free |
| Email | Resend API, or SMTP (Gmail app password) as fallback | Free tier enough for notifications |
| Messaging | Telegram Bot API (P0), WhatsApp Cloud API (P2) | Telegram is free and instant |
| Scheduled jobs | Vercel Cron | Reminders and health checks |
| Local dev tunnel | cloudflared or ngrok | Vapi needs a public URL to reach a local machine |

## Data model

Fifteen tables (the 15th, vapi\_accounts, is defined in the account pool section); every client-owned row carries `workspace_id`, so one database serves all clients.

| Table | Key fields | Notes |
| --- | --- | --- |
| `workspaces` | id, slug, name, niche, country, timezone, phone\_display, business\_info (jsonb), status | One per client or demo. `business_info` = hours, address, service area, FAQ, policies |
| `integrations` | id, workspace\_id (null = global), provider, credentials\_encrypted, config (jsonb), status, last\_tested\_at, last\_error | provider: vapi, google, openrouter, telegram, resend, smtp, whatsapp |
| `assistants` | id, workspace\_id, vapi\_assistant\_id, persona\_name, first\_message, system\_prompt, knowledge, model, voice\_provider, voice\_id, max\_duration\_s, structured\_schema (jsonb), synced\_at, sync\_error | Source of truth is the hub; Vapi is a copy |
| `phone_numbers` | id, workspace\_id, vapi\_phone\_number\_id, e164, assistant\_id | Reassign one free number between demos |
| `services` | id, workspace\_id, name, duration\_min, buffer\_min, price\_text, active | Price is text ("from £45") to avoid quoting errors |
| `calendars` | id, workspace\_id, google\_calendar\_id, working\_hours (jsonb), slot\_step\_min, min\_notice\_hours, max\_days\_ahead | One per workspace in MVP |
| `contacts` | id, workspace\_id, name, phone\_e164, email, source, tags, notes, created\_at | Unique on (workspace\_id, phone\_e164) |
| `appointments` | id, workspace\_id, contact\_id, service\_id, start\_at, end\_at, status, google\_event\_id, source, conversation\_id, notes | status: requested, booked, confirmed, rescheduled, cancelled, no\_show |
| `conversations` | id, workspace\_id, contact\_id, channel, external\_id, started\_at, ended\_at, duration\_s, cost\_usd, summary, structured (jsonb), recording\_url, outcome | channel: phone, web\_voice, chat, form. external\_id = Vapi call id |
| `messages` | id, conversation\_id, role, content, tool\_name, created\_at | Chat turns and call transcript lines |
| `notification_channels` | id, workspace\_id, type, target, events (array), active | type: telegram, email, whatsapp |
| `notification_log` | id, workspace\_id, channel\_id, event, status, attempts, error, sent\_at | Retries and audit |
| `embeds` | id, workspace\_id, public\_key, allowed\_origins (array), voice\_enabled, chat\_enabled, form\_enabled, theme (jsonb) | public\_key is a random `pk_` string, not a Vapi key |
| `webhook_events` | id, source, event\_type, external\_id, raw (jsonb), received\_at, processed\_at, error | Stores every inbound webhook; makes processing idempotent |

All times are stored in UTC and shown in the workspace timezone (for example Europe/London).

## Functional requirements

P0 is the MVP that replaces GoHighLevel for demos; P1 is needed before the first paying client; P2 comes later.

| ID | Module | Requirement | Priority |
| --- | --- | --- | --- |
| W1 | Workspaces | Create, edit, archive a workspace (name, slug, niche, country, timezone, business info) | P0 |
| W2 | Workspaces | Clone a workspace as a template (assistant, services, hours, notifications) and change only the business details | P0 |
| W3 | Workspaces | Workspace switcher in the header; every page is scoped to one workspace | P0 |
| I1 | Integrations | Settings page with one form per provider; fields masked after save | P0 |
| I2 | Integrations | "Test connection" button per provider showing success or the exact error | P0 |
| I3 | Integrations | Global keys (Vapi, OpenRouter, Resend) with optional per-workspace override | P0 |
| I4 | Integrations | "Connect Google Calendar" button per workspace, then a calendar picker | P0 |
| A1 | Agent builder | Form: persona name, first message, system prompt, knowledge, voice id, model, max call length | P0 |
| A2 | Agent builder | "Sync to Vapi" creates or updates the Vapi assistant, attaches hub tools and the hub webhook; shows sync status and error | P0 |
| A3 | Agent builder | Prompt template with variables filled from workspace data: {{business\_name}}, {{services}}, {{hours}}, {{today}}, {{timezone}} | P0 |
| A4 | Agent builder | Structured fields to extract per call (name, phone, email, service, preferred time, booked, urgency) | P0 |
| A5 | Agent builder | Assign a Vapi phone number to the assistant from a dropdown | P0 |
| A6 | Agent builder | "Test in browser" button that starts a web call with the current assistant | P0 |
| A7 | Agent builder | Version history of prompts with one-click restore | P1 |
| B1 | Booking | Services with duration and buffer; working hours per weekday; minimum notice; max days ahead | P0 |
| B2 | Booking | Availability engine: working hours minus Google busy times minus hub appointments, in workspace timezone | P0 |
| B3 | Booking | Book with a lock so two requests cannot take the same slot | P0 |
| B4 | Booking | Create, move and cancel the Google Calendar event with the booking | P0 |
| B5 | Booking | Public booking page `/book/<slug>` | P0 |
| B6 | Booking | Reschedule and cancel by phone (agent finds the booking by caller phone) | P1 |
| B7 | Booking | Reminder message to the customer 24 hours before (email first, SMS or WhatsApp later) | P1 |
| C1 | CRM | Contacts list with search, source filter and detail page (all conversations and appointments) | P0 |
| C2 | CRM | De-duplicate contacts by phone, then email | P0 |
| C3 | CRM | Export contacts and appointments as CSV | P1 |
| V1 | Conversations | List of calls, chats and forms with channel, duration, cost, outcome, summary | P0 |
| V2 | Conversations | Detail page: transcript, recording player, structured fields, tool calls with their results | P0 |
| V3 | Conversations | Usage page: Vapi minutes and cost per workspace per month | P1 |
| N1 | Notifications | Channels per workspace: Telegram chat, email addresses; choose events per channel | P0 |
| N2 | Notifications | Events: new booking, lead captured, call ended without booking, form submitted, booking cancelled | P0 |
| N3 | Notifications | Retry 3 times with backoff; log every attempt; "Send test" button | P0 |
| N4 | Notifications | WhatsApp Cloud API channel | P2 |
| E1 | Embeds | Snippet generator: one script tag, toggles for chat, voice button, form | P0 |
| E2 | Embeds | Allowed origins list per embed; requests from other origins are rejected | P0 |
| H1 | Chat agent | Streaming chat over the workspace knowledge with the same tools as voice | P0 |
| H2 | Chat agent | Rate limit per visitor; hand off to "leave your number" when out of scope | P0 |
| D1 | Dashboard | Home page per workspace: today's bookings, last 10 conversations, integration health | P0 |
| D2 | Dashboard | Read-only owner portal login | P2 |

## Integrations

Every key below is typed into the Settings page, never into code; only the encryption key and the Google OAuth app live in environment variables.

| Provider | Used for | GUI fields | Test connection does | Notes |
| --- | --- | --- | --- | --- |
| Vapi | Voice agent, phone number, web voice | Private API key, public API key, webhook secret (generated by the hub) | Lists assistants and phone numbers | Hub creates and patches assistants through the Vapi API; ElevenLabs key is added inside Vapi's own Integrations page |
| Google Calendar | Availability and events | "Connect Google" button (OAuth), then calendar dropdown | Reads free/busy for the next 7 days | See the refresh token risk in Risks |
| OpenRouter | Chat agent LLM | API key, model id (for example openai/gpt-4o-mini) | Sends a 1-token request | Any OpenAI-compatible base URL can replace it |
| Telegram | Owner and team notifications | Bot token, chat id (with a "find my chat id" helper) | Sends "Agent Hub test message" | Create the bot with BotFather; owner presses Start once |
| Resend | Notification email | API key, from address | Sends a test email to the admin | Needs a verified sending domain such as incodet.com |
| SMTP (fallback) | Notification email | Host, port, user, app password, from address | Sends a test email | Gmail needs an app password and 2-step verification |
| WhatsApp Cloud API (P2) | Owner notifications | Phone number id, access token, template name | Sends an approved template | Requires Meta Business verification and approved templates |

**Vapi assistant config the hub sends on every sync**

- `model`: provider openai, model gpt-4o-mini, system prompt rendered from the template, tools = the 4 hub tools below
- `voice`: provider 11labs, voice id from the form, model eleven\_flash\_v2\_5
- `firstMessage`: includes the AI and recording notice
- `maxDurationSeconds`: from the form (default 240 for demos)
- `server.url`: `https://<hub>/api/vapi/webhook`, with the workspace webhook secret
- `analysisPlan` / structured output: the schema from requirement A4

**Hub tools exposed to the voice and chat agents**

| Tool | Arguments | Returns |
| --- | --- | --- |
| `check_availability` | service, date or date range, preferred time of day | Up to 3 open slots as spoken text plus ISO times |
| `book_appointment` | service, start time (ISO), name, phone, email (optional), notes | Confirmation sentence and booking reference, or the reason it failed |
| `capture_lead` | name, phone, email, reason, preferred callback time | "Saved, the team will call you" |
| `find_booking` (P1) | caller phone | The caller's next booking, for reschedule or cancel |

## Vapi account pool (demo workspaces only)

Demo workspaces draw from an ordered pool of Vapi accounts that their owners lend willingly; when one account's credit runs low, the next one takes the following call. Paid client workspaces never use the pool.

**How it works**

1. Admin adds each account in Settings: label, owner name, private key, public key, budget (default $10), order.
2. The hub keeps every demo assistant synced into every pool account ahead of time (warm standby), so a switch is a pointer change, not a rebuild.
3. The active account is the first one in order with status `active`.
4. After each call, the hub adds the call cost from the end-of-call report to that account's spend.
5. When spend reaches budget minus a $0.50 buffer, or Vapi rejects a call or sync with a billing or credit error, the hub marks the account `exhausted` and promotes the next one.
6. The switch applies to the next call. A call already in progress is never moved.

**Requirements**

| ID | Requirement | Priority |
| --- | --- | --- |
| P1 | `vapi_accounts` table: id, label, owner\_name, credentials\_encrypted, budget\_usd, spent\_usd, order, status (active, exhausted, disabled), phone\_number\_id, last\_error | P0 |
| P2 | Pool page: list accounts with spend bar, status, "Make active", "Disable", drag to reorder | P0 |
| P3 | Warm standby sync of every demo assistant into every active pool account, with per-account sync status | P0 |
| P4 | Automatic switch on budget threshold or credit error, logged in `webhook_events` | P0 |
| P5 | Telegram alert at 80% of an account's budget, on every switch, and when only one account is left | P0 |
| P6 | Embed config always returns the active account's public key, assistant id and phone number | P0 |

**When the pool is empty (P0):** the voice button shows the recorded demo video and a "leave your number, we'll call you back" form, and the hub sends a Telegram alert. A voice fallback to ElevenLabs Agents on the Creator plan is P2.

**Rule for Lovable sites:** never hardcode the Vapi phone number. Each pool account has its own free number, so the number changes on a switch. Put `<span data-agenthub-phone></span>` where the number shows and the embed script fills it, with the matching `tel:` link.

**Risks of the pool**

- Vapi's terms may not allow one person to run several accounts or to use accounts owned by others. A ban could hit every pool account at once, including your friends' accounts. Read the current terms before relying on it, and rely on the empty-pool fallback above.
- Spend from the hub's own tracking can lag Vapi's real balance, so keep the $0.50 buffer.
- Each friend's account needs its own free number created once; the hub can create it through the API when the account is added.

## API endpoints

Four groups, each with its own auth: admin session, Vapi secret, public embed key, and cron secret.

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET, POST, PATCH | `/api/workspaces`, `/api/workspaces/:id` | Admin session | Workspace CRUD and clone (`POST /api/workspaces/:id/clone`) |
| GET, PUT | `/api/integrations/:provider` | Admin session | Save encrypted credentials; never returns secrets, only masked values |
| POST | `/api/integrations/:provider/test` | Admin session | Runs the provider test and stores status |
| GET | `/api/google/oauth/start`, `/api/google/oauth/callback` | Admin session | Google consent and token storage |
| PUT | `/api/assistants/:id` | Admin session | Save the agent form |
| POST | `/api/assistants/:id/sync` | Admin session | Push the assistant to Vapi |
| GET, POST, PATCH | `/api/contacts`, `/api/appointments`, `/api/conversations` | Admin session | CRM screens; PATCH appointment status also updates Google Calendar |
| POST | `/api/notifications/test` | Admin session | Sends a test message to a channel |
| POST | `/api/vapi/tools` | `x-vapi-secret` header | Receives `tool-calls`, runs the hub tool, replies `{ results: [{ toolCallId, result }] }` |
| POST | `/api/vapi/webhook` | `x-vapi-secret` header | Receives `end-of-call-report` and `status-update`; stores, then notifies |
| GET | `/api/public/:pk/config` | Embed key + origin | Returns chat and voice settings, the Vapi public key and assistant id |
| POST | `/api/public/:pk/chat` | Embed key + origin + rate limit | Streams a chat reply; runs tools server side |
| POST | `/api/public/:pk/lead` | Embed key + origin + honeypot + rate limit | Lead form submission |
| GET | `/api/public/:pk/slots` | Embed key | Open slots for a service and date |
| POST | `/api/public/:pk/book` | Embed key + rate limit | Self-booking |
| GET | `/book/:slug` | Public | Booking page |
| GET | `/embed.js` | Public | The single embed script |
| GET | `/api/cron/reminders`, `/api/cron/health` | `CRON_SECRET` | Reminders (P1) and integration health checks |

**Webhook rules**

- Store the raw payload in `webhook_events` first, then process; return 200 fast.
- Use the Vapi call id as the idempotency key, so a retried webhook never creates a second contact or notification.
- Tool endpoints must answer within 1.5 seconds; cache Google free/busy for 60 seconds per calendar.
- Confirm the exact Vapi request and response shapes in the Vapi server-events and custom-tools docs before coding.

## Embeds for client websites

A Lovable site needs one script tag; everything else is configured in the hub, so changing an agent never means editing the site.

```html
<script src="https://hub.incodet.com/embed.js" data-key="pk_xxxxxxxx" async></script>
```

| Piece | How it appears | Behaviour |
| --- | --- | --- |
| Chat bubble | Bottom-right button, opens a panel | Calls `/api/public/:pk/chat`; can book and capture leads |
| Voice button | Any element with `data-agenthub-voice`, or a floating button | Loads the Vapi web SDK with the workspace's Vapi public key and assistant id, then starts a web call; shows connecting, live and ended states |
| Lead form | `<div data-agenthub-form></div>` placed 2 to 3 times | Name, phone, email, service, message; honeypot field; success message |
| Booking page | Link or iframe to `/book/<slug>` | Same availability engine as the agents |

**Lovable prompt block to paste**

```markdown
INTEGRATIONS
Add this script before </body> in index.html:
<script src="https://hub.incodet.com/embed.js" data-key="PK_FROM_AGENT_HUB" async></script>
Add data-agenthub-voice to the hero "Talk to our receptionist" button and the CTA section button.
Place <div data-agenthub-form></div> in the hero side panel, the contact section and the footer CTA.
Link every "Book now" button to https://hub.incodet.com/book/WORKSPACE_SLUG.
Do not build any other chat, form or booking logic.
```

The embed reads the page origin and the hub rejects it unless it is in the embed's allowed origins (add the Lovable preview domain and the custom domain).

## Security, privacy and compliance

The hub holds client customers' names, phone numbers and call recordings, so these rules are P0, not polish.

- **Secrets:** encrypt every credential with AES-256-GCM using `ENCRYPTION_KEY` from env. Decrypt only on the server. The browser only ever sees masked values and the public keys.
- **Database access:** all queries run on the server with the service role. Turn on Supabase row level security and deny all to the anon key, so a leaked anon key reads nothing.
- **Vapi endpoints:** reject any request without the right `x-vapi-secret`. Per-workspace secrets, so one leak exposes one client.
- **Public endpoints:** embed key + allowed origin check + rate limit per IP (for example 20 chat messages per 10 minutes) + honeypot on forms. Cap chat to 30 turns per session.
- **Vapi spend:** max call length per assistant; restrict the Vapi public key to the hub's allowed origins and assistants; daily cost alert to Telegram when a workspace passes a set dollar amount.
- **AI disclosure:** the first message always says it is an AI assistant and that calls may be recorded. The prompt never tells the agent to deny being AI.
- **Data retention:** per-workspace setting to delete transcripts and recordings after N days (default 90). A "delete contact" action removes the contact, its conversations and its messages.
- **UK and EU clients:** keep a short data processing note in the client contract; Incodet is the processor, the business is the controller.
- **Notification content:** Telegram and email carry name, phone, service, time and a 2-line summary only, plus a link to the hub for the full transcript.

## Deployment

The same repo runs locally for building and on Vercel for demos; only the public URL changes.

**Local**

1. Node 20+, `pnpm install`, copy `.env.example` to `.env.local`.
2. Create a free Supabase project, run `pnpm db:migrate`.
3. `pnpm dev`, then start a tunnel (`cloudflared tunnel --url http://localhost:3000`) and set `APP_URL` to the tunnel URL. Vapi and Google cannot reach `localhost` without it.
4. Re-run "Sync to Vapi" whenever the tunnel URL changes, so the assistant points at the new webhook.

**Vercel**

1. Import the repo, add the env vars below, deploy.
2. Point a subdomain such as `hub.incodet.com` at it, then set `APP_URL`.
3. Add the Google OAuth redirect URL for that domain in Google Cloud Console.
4. Add cron jobs in `vercel.json` for `/api/cron/health` (and reminders in P1).

**Environment variables (the only config outside the GUI)**

| Variable | Purpose |
| --- | --- |
| `APP_URL` | Public base URL used in webhooks and embed code |
| `DATABASE_URL` | Supabase Postgres connection string |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Auth and server access |
| `ENCRYPTION_KEY` | 32-byte key for credentials at rest; losing it means re-entering every key |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | One Google OAuth app for all workspaces |
| `CRON_SECRET` | Protects cron routes |
| `ADMIN_EMAILS` | Comma list of who may log in |

**Hosting limits to check before going live**

- Vercel's free Hobby plan is for personal, non-commercial use. Demos are fine; paying clients need the Pro plan or another host (Railway, Render, a small VPS).
- Check the current function duration and cron frequency limits on the plan you use; reminders need at least an hourly cron.
- Supabase free projects pause after a period of no activity; the health cron keeps it awake.

## Milestones and acceptance tests

Build in six steps; each step ends with tests that must pass before the next starts. Bloom (UK salon) is the first workspace and the test bed.

**M1: Skeleton**

- [ ] Admin can log in; others are refused
- [ ] Create, edit and clone a workspace
- [ ] Settings page saves and masks keys; "Test connection" works for Vapi, Telegram and Resend

**M2: Voice agent sync**

- [ ] Agent form saves and "Sync to Vapi" creates the assistant with the hub webhook and tools
- [ ] "Test in browser" starts a web call with the Bloom assistant
- [ ] Free Vapi number assigned from the dropdown answers with the Bloom assistant

**M3: Booking engine**

- [ ] Google Calendar connects and the calendar picker lists calendars
- [ ] `check_availability` returns only free slots inside working hours, in Europe/London time
- [ ] 20 test bookings by voice create 20 Google events and 0 double bookings
- [ ] Booking page books the same way

**M4: Logging and notifications**

- [ ] Every call creates a conversation with transcript, summary, recording link, cost and structured fields
- [ ] Telegram and email arrive within 60 seconds for booking, lead and no-booking events
- [ ] A resent webhook does not create a duplicate contact or message

**M5: Chat and embeds**

- [ ] One script tag on a Lovable site shows the chat bubble, the voice button and the form
- [ ] Chat can book and capture a lead with the same tools
- [ ] Requests from a non-allowed origin are rejected; spam form submissions are dropped

**M6: Second niche from a template**

- [ ] Clone Bloom into a roofing workspace and go live in under 60 minutes, with no code changes

**M7: Vapi account pool**

- [ ] Two pool accounts added; both show synced assistants and their own free number
- [ ] Setting account 1's budget to its current spend makes the next call run on account 2, with a Telegram alert
- [ ] Demo site shows account 2's phone number without any site edit
- [ ] With every account disabled, the voice button shows the demo video and callback form

## Risks and open questions

The biggest risk is scope: this PRD is the core of GoHighLevel, and building past P0 before the first client delays sales.

| Risk | Effect | Mitigation |
| --- | --- | --- |
| Building takes weeks while outreach stops | No clients, no feedback | Ship P0 only; keep outreach running with the Vapi demo in parallel |
| Google OAuth app left in "Testing" status | Refresh tokens expire after 7 days, booking breaks silently | Publish the OAuth app to production, or for demo calendars use a service account shared on the calendar; health cron alerts on token failure |
| Vapi API or webhook shapes change | Sync or logging breaks | Pin to documented fields, log raw payloads, alert on parse errors |
| One Vapi account for all clients | One bill, one credit pool, one failure point | Per-workspace cost tracking (V3); move big clients to their own Vapi account via the per-workspace key override (I3) |
| Vapi free number is US only | UK and AU prospects will not dial it | Lead with the web voice button; buy local numbers per paying client |
| Small LLM picks wrong tool or time | Wrong bookings in front of a prospect | Tool replies in plain sentences, server-side validation of every slot, 20-call test before each demo |
| Payment card problems from Bangladesh | Cannot top up Vapi or pay Vercel Pro when the first client signs | Solve the payment method before the first paid client |

**Open questions**

- [ ] Does each client get its own Google Calendar, or does Incodet host calendars for owners who have none?
- [ ] Should owners confirm bookings (status `requested`) or are agent bookings final (status `booked`)? Default: final for demos, owner choice per workspace later.
- [ ] Which reminder channel first for UK customers: email or SMS?

**What would change this plan**

- If the first 3 to 5 paying clients all already use Fresha, Booksy or another booking system, the booking engine matters less than an integration with that system.
- If the payment card works for GoHighLevel's agency plan and clients exceed about 15, the cost of building and maintaining this hub may exceed GoHighLevel's fee.
