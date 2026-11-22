# Implementation progress

Part 0 DONE: The production build bundles Geist Sans and Geist Mono from the locked geist package. Both existing CSS variables are preserved.

Checked the layout, stylesheets, Next config, package scripts, server pages, routes, and provider clients for build-time downloads. The Google Fonts imports were the only application build-time fetches found. The remaining external requests run when users or webhooks invoke integrations, booking, authentication, or notifications. Dependency installation still needs a registry or a populated cache.

The production build, typecheck, lint, 49 unit tests, and 105 integration tests passed. A new Playwright test against the production server loaded both font families from same-origin WOFF2 files.

Part 1 DONE: Calendar reads fail closed with a 900 ms deadline. Archived workspaces decline tools, provider errors are bounded, the captured fixture uses synthetic identifiers, and each workspace controls recording with a fixed disclosure on sync. The redaction contract supersedes the earlier exact-error requirement. Typecheck, lint, 49 unit tests and 113 integration tests passed.
