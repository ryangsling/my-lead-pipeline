# Implementation progress

Part 0 DONE: The production build bundles Geist Sans and Geist Mono from the locked geist package. Both existing CSS variables are preserved.

Checked the layout, stylesheets, Next config, package scripts, server pages, routes, and provider clients for build-time downloads. The Google Fonts imports were the only application build-time fetches found. The remaining external requests run when users or webhooks invoke integrations, booking, authentication, or notifications. Dependency installation still needs a registry or a populated cache.

The production build, typecheck, lint, 49 unit tests, and 105 integration tests passed. A new Playwright test against the production server loaded both font families from same-origin WOFF2 files.

Part 1 DONE: Calendar reads fail closed with a 900 ms deadline. Archived workspaces decline tools, provider errors are bounded, the captured fixture uses synthetic identifiers, and each workspace controls recording with a fixed disclosure on sync. The redaction contract supersedes the earlier exact-error requirement. Typecheck, lint, 49 unit tests and 113 integration tests passed.

Part 2 DONE: Voice calls replay completed tool receipts, book five-minute slot IDs scoped to the call and service, validate bounded arguments, and resolve relative dates in the workspace timezone. Concurrent and lost-response retries, expiry, and near-midnight behavior passed with 49 unit tests and 116 integration tests. Typecheck and lint passed.

Part 3 DONE: Documented US trade intake, escalation, coverage, estimate visits and disposition in four implementation commits. Typecheck, lint, 49 unit tests and 116 integration tests passed.

Part 4 DONE: Shipped default-off transfer, ZIP coverage and estimates, job intake and call dispositions, and synchronous urgent alerts. Typecheck, lint, 51 unit tests and 124 integration tests passed.

Part 5 DONE: Reused authenticated workspace, service and calendar context and one OAuth client per tool invocation. The timing script checks successful cache hits, misses and bookings separately. Vercel now targets iad1 and the deployment guide covers data migration. Typecheck, lint, 51 unit tests and 125 integration tests passed.

For a single new tool call, the current SQL path issues 10 statements for a successful cached offer, 11 for a miss, 17 for a successful booking, and 9 for a lead with one phone lookup. These counts include routing, the receipt and message writes. They exclude BEGIN and COMMIT. Urgent intake issues 13 statements with no subscribed channels or 23 with successful Telegram and Resend delivery through two global connections. Transport fallback and duplicate calls vary. Deployed latency requires a timing run.
