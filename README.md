# Attica owner listings

Daily check of private-owner (ιδιώτες) homes for sale across Attica on xe.gr, Spitogatos, Indomio, Spiti24 and Plot.
One row per home (the same home on several portals is merged), status + notes for the team.

## Railway variables
| Variable | What |
|---|---|
| `DATABASE_URL` | reference the Postgres plugin: `${{Postgres.DATABASE_URL}}` |
| `XE_USER` / `XE_PASS` | xe.gr login (optional if you use cookies) |
| `SPITOGATOS_USER` / `SPITOGATOS_PASS` | Spitogatos login |
| `RUN_HOUR_ATHENS` | hour of the daily check, default `7` |
| `XE_COOKIES`, `SPITOGATOS_COOKIES` | optional: JSON cookie export from a signed-in browser |

Sessions are kept in the database, so a login only happens when a session expires.
If a site shows a CAPTCHA or login code, it is **not** bypassed: the page header shows a warning for that site.
`POST /api/run` (with the team password) starts a check immediately.
| `TEAM_PASSWORD` | shared password for the team page (any username) |
| `STRIPE_SECRET_KEY` | Stripe secret key (subscriptions). Without it, sign-up works but checkout says payments are not enabled yet |
| `CONTACT_EMAIL`, `PUBLIC_URL`, `PRICE_MONTH_CENTS`, `PRICE_YEAR_CENTS` | optional: contact address shown on the pages, the public address (https://propertyradar.gr), prices (default 4900 / 49900) |
