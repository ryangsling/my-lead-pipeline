# Deployment

## Moving Supabase to us-east-1

1. Create a new Supabase project in US East (North Virginia, us-east-1). Enable email/password authentication, match the existing sign-up policy and configure the app URL and redirect URLs. Supabase projects have independent Auth users and signing keys. Recreate and verify the allowed admin accounts in the destination and plan for admins to sign in again after cutover.
2. Use the new project's direct or session pooler Postgres URL as `MIGRATE_DATABASE_URL` and run `corepack pnpm db:migrate` from the checkout. Confirm all migrations applied before copying data.
3. Stop writes to the source during cutover. From a trusted workstation, use a compatible PostgreSQL client and set `SOURCE_DATABASE_URL` and `DESTINATION_DATABASE_URL` securely for the source and destination direct or session pooler connections. Run `pg_dump --data-only --schema=public --format=custom --file=agent-hub-data.dump "$SOURCE_DATABASE_URL"` followed by `pg_restore --data-only --schema=public --exit-on-error --single-transaction --dbname="$DESTINATION_DATABASE_URL" agent-hub-data.dump` into the empty migrated destination. Protect the dump as production data and check row counts and representative records before resuming writes. This procedure copies Agent Hub tables. Auth users are handled in step 1.
4. In the Vercel project, set `DATABASE_URL` to the destination transaction pooler, `MIGRATE_DATABASE_URL` to the destination direct or session pooler, and set `SUPABASE_URL` and `SUPABASE_ANON_KEY` to the new project. Set `APP_URL`, `ADMIN_EMAILS`, `CRON_SECRET`, and the Google OAuth values used by the deployment. Carry over the existing `ENCRYPTION_KEY` exactly so credentials, refresh tokens and webhook secrets remain readable. Keep env values in the deployment's secret settings.
5. Deploy to Vercel and verify admin login and existing records. If the app URL changed, update Google's authorized OAuth redirect URI. Open each active voice assistant in Agent Hub and click **Sync to Vapi**. Verify the assistant server URL uses the deployed `APP_URL` with `/api/vapi/webhook` and each function tool points to `/api/vapi/tools`. Verify the paid transfer destination webhook on any workspace that enables it.
6. Use a disposable workspace and calendar for timing. Keep the source available until admins verify bookings and callback delivery against the destination.

The Vercel config uses `iad1`. After deploying, run the tool timing script with its own benchmark workspace and calendar. It creates actual bookings against whichever app URL you supply, so keep the benchmark isolated from customer calendars.

## Test by phone

After deployment, use Vapi dashboard web calls with a test workspace, test contacts, and connected email and Telegram channels. Keep live transfer off for these scenarios.

| Call | What to check |
| --- | --- |
| Ask for a normal booking with an in-area ZIP | The assistant offers verified times. Choosing one creates one appointment and one calendar event. |
| Say “Water is pouring through my ceiling right now” | An owner alert arrives before the caller hangs up. The agent gives the configured callback time after the alert is accepted. |
| Say “I smell gas” | The first instruction is to get to safety and call 911 immediately. |
| Give a ZIP outside the service area | The agent declines politely and offers to save a callback lead. Provide the details and verify the job in the hub. |
| Ask only for a price | The agent uses a listed price or says the crew can provide an estimate. |
| Make a spam call | The conversation is classified as spam and sends no owner alert. |
| Ask for a different day before choosing a time | Choosing a new time leaves exactly one booking on the final day. |

Before running the calls, move the database to us-east-1, set the Vercel environment values above, deploy, and sync the test workspace to Vapi. Check live transfer separately if you enable it. Verify the configured number, the backup schedule and the callback after an unanswered transfer.

## Data retention

Before opening the system to real callers, set the workspace retention period, verify the authenticated minute sweep, and record the managed backup and delivered-message limits in the operator inventory. [Retention configuration, restore procedure and provider verification](DATA-RETENTION.md)
