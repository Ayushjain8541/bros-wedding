# Private bilingual invitation

A Next.js application foundation for a private English/Hindi invitation. Committed content and test replies are synthetic. Protected pages must load authorized repository content; synthetic defaults are test/operator tools, never a production fallback. No public invitation or marketing page is generated.

## Toolchain

Use Node **24.19.0** (`.node-version`) and pnpm **10.34.9** (`packageManager`). Run `corepack enable` if available, or `npx pnpm@10.34.9 <command>`. Direct dependencies are exact pins in `package.json`; `pnpm-lock.yaml` locks transitive packages. Versions and peer/engine compatibility were checked against the official npm registry on 27 October 2026.

| Library | Version |
| --- | --- |
| Next.js / eslint-config-next | 16.4.3 |
| React / React DOM | 19.3.1 |
| next-intl | 4.14.9 |
| Motion | 14.6.0 |
| React Hook Form | 7.91.0 |
| Zod | 4.6.7 |
| Supabase JS / SSR | 2.118.0 / 0.12.7 |
| postgres | 3.4.9 |
| libphonenumber-js | 1.13.15 |
| Tailwind / PostCSS plugin | 4.3.3 |
| TypeScript | 5.9.3 |
| ESLint | 9.39.5 |
| Vitest / jsdom | 5.0.5 / 30.1.3 |
| Playwright | 1.64.1 |

ESLint 9 is used because Next's React/import/accessibility plugins currently declare compatibility through version 9. Its upstream maintenance warning is recorded; move to ESLint 10 once those peer contracts support it. TypeScript stays on the compatible 5.9 line. The install does not enable dependency lifecycle scripts automatically; native optional binaries are supplied by platform packages and the verified test/build commands work with this default.

## Local setup

1. Install dependencies with `pnpm install --frozen-lockfile`.
2. Copy `.env.example` to ignored `.env.local`, then supply local values. Blank entries are intentional; never commit credentials. `DATABASE_URL` is the restricted application role, `DATABASE_ADMIN_URL` is operator-only. The app's future request handlers must never use the admin URL.
3. Unit tests, lint, typecheck, and build do not require Docker or a database. Persistent integration/E2E work needs a running local Supabase stack. The standard Supabase CLI stack uses Docker; the experimental native Apple silicon runtime can be used where supported. No remote project is provisioned by the test scripts.
4. Provision isolated `wedding_dev` and `wedding_test` databases with restricted application roles. Supply `TEST_DATABASE_URL` for the restricted test role and `TEST_DATABASE_ADMIN_URL` for resets/migrations on the same local test database. Supabase Auth/Storage remains in the stack's own database; do not assume each isolated application database has a Storage schema.
5. Set the local stack's `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and server-only `SUPABASE_SECRET_KEY`. `.env.example` documents the complete runtime/operator variable contract, including origin, rate-limit HMAC secret, and backup key.

## Commands

- `pnpm dev`: local Next development server.
- `pnpm test [path]`: unit/component tests, excluding integration and E2E.
- `pnpm test:integration [path]`: loads ignored `.env.local`, validates a dedicated loopback test database, checks connectivity, locks its use, starts Next on `127.0.0.1:3100` with the restricted role and matching `APP_ORIGIN`, polls safe `/api/health`, runs serialized integration tests, then stops the server. Tests receive `TEST_APP_ORIGIN=http://127.0.0.1:3100`; the schema operator is supplied separately. Hosted databases, non-test database names, query-string connection overrides, and occupied ports are refused.
- `pnpm test:e2e`: Playwright, with its own managed test server on `127.0.0.1:3200`; install browsers first with `pnpm exec playwright install`. Synthetic database seeds and a local Supabase stack are required. Integration/E2E acquire the same database lock and cannot reset one another concurrently.
- `pnpm typecheck`, `pnpm lint`, `pnpm build`: TypeScript, ESLint, production build.

## Private operator seed

`WEDDING_SEED_FILE` points to a private JSON file excluded from Git. `readWeddingSeed(path)` is server-only, explicitly invoked by operator seeding code. It rejects missing/malformed files with a safe domain error and never falls back to synthetic content. Shape: `{events: WeddingEvent[8], content: ContentSnapshot, settings: SiteSettings}`. It validates bilingual fields, the eight stable event IDs and exact group memberships, ISO dates/timestamps, positive event windows, safe map/help URLs, approval flags, photo references, help-phone consistency, and party-size limits. `ContentSnapshot` includes bilingual `couple` names and `wedding` date/venue/address/map metadata, keeping personal names and venue details out of public client source.

Canonical private timestamps/story/families/help links are verified locally with an independently checked ignored expected JSON. Set `WEDDING_SEED_FILE` and test-only `WEDDING_SEED_EXPECTED_FILE`, then run `pnpm test tests/unit/wedding.test.ts`. The expected JSON contains `eventWindows` (arrays of ID/start/end), `story`, `families`, and `settings`. CI uses synthetic data with the same eight/six authorization shape and skips this private-content check. Never publish canonical seed or expected files, live replies, tokens, backups, or exports.

## Language and visual foundation

English/Hindi dictionaries contain UI phrases only. Personal content and restricted events come from authorized data. Hindi defaults remain unapproved and require family review. Locale comes from the current request's `locale` cookie; there is no mutable global locale and no locale-keyed form remount. Later language controls must preserve future RSVP state.

Latin headings use Cormorant Garamond and body/Devanagari use Noto Sans Devanagari, self-hosted via pinned Fontsource packages under SIL Open Font License 1.1. Body line-height is 1.75, Hindi 1.85. Ivory, coral, blush, peach, sage, teal, and gold-beige tokens follow the supplied watercolor mockup. Dark ink variants serve text/actions; pale decorative accents must not be used for small text. Reduced motion and keyboard focus styles are provided. Official logo, approved photography, Hindi review, and ceremony-copy approval remain operator inputs.

## Database foundation and local operators

`supabase/schemas/00_wedding.sql` declares the private schema; the CLI-generated migration is replayed by the test helper into `wedding_test`. All wedding tables have forced RLS and explicit server-only grants. `wedding_app` must already exist as a restricted login without superuser, BYPASSRLS, schema ownership or CREATE privileges; the migration never sets its password. `anon`, `authenticated` and PUBLIC receive no wedding schema/table/function access. The application connects with a bounded five-connection pool; hosted connections require verified TLS. Organizer UUIDs are an app allowlist, with actual identity verification via the separate Auth API in organizer services.

Before each CLI command inspect its `--help`. Use the bundled PostgreSQL `psql --dbname <dedicated-local-admin-url> --single-transaction --set ON_ERROR_STOP=1 --file supabase/schemas/00_wedding.sql` for initial operator schema creation in an empty `wedding_dev`; supply secrets through a local operator wrapper, never paste them into logs or committed scripts. CLI 2.122 `db query --file` uses a prepared statement and rejects multiple top-level commands: use a single `DO` wrapper when iterating this DDL through that CLI, as verified locally. Its explicit local URL also needs `sslmode=disable` for this native server; application/test URLs reject query overrides and the local driver chooses plaintext explicitly. Verified TLS remains mandatory for hosted application connections. Never run a stack-wide reset against the vendor `postgres` database. Supabase's native runtime can run Auth/Storage in its vendor database while wedding data lives in separate `wedding_dev`/`wedding_test` databases. Test helpers verify loopback URLs, exact `wedding_test` name, matching admin/app targets and actual server identity before dropping only `wedding`; resets are serialized with a database advisory lock.

Run `node scripts/seed-content.mjs --help` and `node scripts/seed-access.mjs --help` first. Content seeding requires private JSON plus a separately reviewed expected JSON (`--expected` or `WEDDING_SEED_EXPECTED_FILE`) containing `eventWindows`, `story`, `families`, and `settings`. Timestamp windows are compared by instant. Story/families may be exact approved English strings or full bilingual records; the four required cutoff/help settings and any optional supplied settings must match exactly. The existing `readWeddingSeed` validates structure and group eligibility. Then run `node scripts/seed-content.mjs --file <private-json> --expected <private-expected-json>` to seed only local `wedding_dev`, or add `--test` for synthetic `wedding_test`. Both inputs stay ignored and the command prints no personal data. The operator-only Node loader reuses the TypeScript validator; it is never imported by app/browser code.

Storage buckets are created/verified through the real Storage API with `public: false`, a 10 MiB limit and JPEG/PNG/WebP allowlist. Local development uses `wedding-photos-dev`; tests use `wedding-photos-test`. A pre-existing public bucket is rejected. Neither bucket is a public download location. Integration setup never deletes vendor schemas or the development bucket.

To generate/rotate group access, run `node scripts/seed-access.mjs --group group-1` (or `group-2`). Rotation stores a SHA-256 hash of 32 random bytes and revokes existing group sessions. Add `--print-link` only at an explicit local operator terminal when ready to reveal the new link; otherwise no link/token is printed. Add `--test` for the dedicated local test DB. Copy/reissue links only through authorized channels; the script does not send invitations. Committed `supabase/seed.sql` remains synthetic and contains no usable access codes.

The foundation includes future RSVP/admin/session/audit/abuse tables without implementing their route behavior. Composite foreign keys enforce event/group selections, token hashes are unique, travel windows are ordered, and stays are capped at 366 nights as a technical resource bound. Services added later enforce contextual actor authorization, active-event selections, accepted-party child counts, transactional writes and deadline behavior.

## Organizer access

`/admin/login` accepts provisioned email/password accounts; `/admin` and every admin data API verify the current identity through Supabase `getUser`, then check `wedding.organizer_users`. User/app metadata never grants access. Removing an allowlist row takes effect on the next data operation. Auth uses SDK-managed server cookies with HttpOnly, SameSite=Lax, host-only path `/`, and Secure; only explicit `ALLOW_INSECURE_LOCAL_COOKIES=true` with a loopback HTTP origin relaxes Secure. The request proxy refreshes cookies for server-rendered pages. Responses carry private/no-store headers. Login permits five attempts per 15 minutes per trusted IP bucket.

Disable **Allow new users to sign up** in the hosted Supabase Authentication settings before production use, and keep anonymous sign-ins disabled. The committed local `[auth]` settings disable signup globally while the email provider remains available for existing users. Apply equivalent settings to the native runtime (whose configuration is separate), then verify a direct public Auth `/signup` request is rejected; hiding a signup form does not protect Auth. Admin API creation remains available for explicit operator provisioning.

Run `node scripts/provision-organizer.mjs --help` first. From a trusted server terminal, load the intended server environment, supply `ORGANIZER_EMAIL` and a private `ORGANIZER_PASSWORD` (16+ characters) through the process environment, then run `node scripts/provision-organizer.mjs --provision`. For local `.env.local`, Node supports `node --env-file=.env.local scripts/provision-organizer.mjs --provision`. Production uses the same command with the hosted Auth URL, server secret key and restricted TLS database URL. It creates a confirmed account via the admin API and allowlists the returned UUID; it sends no email and prints no credentials. Never prefix the secret key or password with NEXT_PUBLIC_, commit environment files, or pass a password as a command-line argument. Communicate credentials separately through an approved private channel. This build does not provision hosted accounts or deploy.

The organizer desk searches contact/guest names and phones literally, filters decision, group, event and travel dates, flags possible primary-contact duplicates using the same matcher as RSVP creation, and paginates 50 parties by stable UUID cursor. Editors bind both displayed ID and version; a conflict requires reloading. Manual phone/WhatsApp replies retain their source and organizer audit identity. After the deadline a nonblank override reason is required; existing edits remain allowed. All manual creates and organizer edits reuse the transactional RSVP services.
