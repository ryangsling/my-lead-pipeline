# Migration history for the integration branch

The workspace branch and the original chat release shared Drizzle entries 0000 through 0008. The workspace history then registered `0009_workspace_booking_branding` through `0017_pii_retention`. GitHub main at `20b36fa` instead registered `0009_chat_provider_chain` at timestamp `1795374804849`.

The integration journal keeps all workspace entries, timestamps, SQL and snapshots through 0017. Chat now occupies the next free index as `0018_chat_provider_chain` at timestamp `1795381738224`, with a new snapshot based on 0017. The original chat SQL remains byte-for-byte at `drizzle/0009_chat_provider_chain.sql` for historical verification. The integration journal references 0018 for chat. Migration 0018 installs the chat changes only when the chat table is absent. A second execution leaves provider rows and notification preferences intact. Migration 0015 backfills workspace IDs for any chat messages that existed before the cutover.

| Database state | Upgrade path |
| --- | --- |
| Empty, through common 0008, or on the workspace history through any of 0009–0017 | Run the normal migration command from this branch. Keep the existing tenant preflight before 0015 on databases with data. |
| Original GitHub main chat history at 0009, without the workspace migrations | Use the ledger preparation below before the normal migration command. |
| Integration history through 0018 | Run the normal migration command. Drizzle has already recorded 0018. |
| A manually combined or otherwise different history | Compare the ledger and actual schema to both branches before migrating. The preparation below is specific to the original main chat history. |

Both upgrade paths and direct replays of 0018 were verified on disposable Postgres. Check the target database ledger before choosing a path.

## Preparing a database on the original chat history

Drizzle uses the latest recorded timestamp as its cutoff. The original chat timestamp is newer than every workspace migration through 0017. Moving only its ledger marker to immediately after 0008 preserves its ID and SQL hash while allowing Drizzle to apply the workspace chain. The schema, application data and SQL files are left intact by the marker update. Migration 0018 refuses to proceed if the retention table from 0017 is absent.

With a verified backup and application writes, background jobs, and other migration runners paused, run this in the session used for schema migrations. It expects the nine common rows plus the exact original chat migration. Then run `corepack pnpm db:migrate` from the integration branch. For databases with data below 0014, first migrate with a temporary copy of the journal ending at 0014. Run the tenant preflight documented in [HANDOFF.md](HANDOFF.md#tenant-relationship-migration) at that point, then resume with the full integration journal.

```sql
BEGIN;
LOCK TABLE drizzle.__drizzle_migrations IN ACCESS EXCLUSIVE MODE;
DO $prepare$
BEGIN
  IF to_regclass('public.chat_providers') IS NULL
    OR to_regclass('public.deletion_log') IS NOT NULL
    OR (SELECT count(*) FROM drizzle.__drizzle_migrations) <> 10
    OR (SELECT max(created_at) FROM drizzle.__drizzle_migrations) IS DISTINCT FROM 1795374804849
    OR (SELECT max(created_at) FROM drizzle.__drizzle_migrations
        WHERE created_at < 1795374804849) IS DISTINCT FROM 1795347544188
  THEN
    RAISE EXCEPTION 'The database does not match the original main chat history.';
  END IF;

  UPDATE drizzle.__drizzle_migrations
  SET created_at = 1795347544189
  WHERE created_at = 1795374804849
    AND hash = '61d3523876b7022d9cdb1d3f303449927a955b3ca38ce048add378bdf0d76541';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The original chat migration hash does not match.';
  END IF;
END
$prepare$;
COMMIT;
```
