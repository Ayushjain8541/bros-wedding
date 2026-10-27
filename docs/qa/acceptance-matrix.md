# Acceptance evidence matrix

**Launch UNAPPROVED.** This maps the original PDF section 10 and additional privacy/recovery requirements to executable local checks. Local synthetic evidence is distinct from family, real-device and hosted approval.

| Requirement | Automated evidence | External gate |
|---|---|---|
| Group 1 eight / Group 2 six, selection and crafted rejection | `invitation.spec.ts`, `rsvp.spec.ts`, `launch.spec.ts`, `rsvp-http.test.ts` | Physical invitation paths UNVERIFIED |
| Access gate cannot be bypassed through direct routes | `access.spec.ts`, `access.test.ts`, `organizer.test.ts` | Hosted ingress and redirects UNVERIFIED |
| Three mandatory full names and three DB guests; resize removes abandoned records | `rsvp.spec.ts`, `launch.spec.ts`, `rsvp-service.test.ts` | Physical phone entry UNVERIFIED |
| Save/edit survives reload, one record, metrics/night demand recalculate | `rsvp.spec.ts`, `launch.spec.ts`, `exports.test.ts`, `metrics.test.ts` | Hosted persistence/restarts UNVERIFIED |
| Correct Feb 2027 and exact private approved source values | `launch.spec.ts` synthetic 2027 date fixture; `wedding.test.ts` private canonical fixture enabled locally | Family sign-off UNVERIFIED; public CI skips private fixture |
| Logo excludes old 2026 text | No automatic bitmap claim | UNVERIFIED: only placeholder supplied |
| Map/call/WhatsApp targets | `invitation.spec.ts`, `launch.spec.ts` check configured href values | Actual phone app handoff/contact/map validity UNVERIFIED |
| English/Hindi 320/390/768/1440, keyboard, no overflow | `invitation.spec.ts`, `launch.spec.ts`, ignored screenshots for both engines | Actual copy, large-text and physical devices UNVERIFIED |
| Skip/replay/reduced motion, no background music | `reveal.test.tsx`, `invitation.spec.ts`, `launch.spec.ts` | Physical WhatsApp browser UNVERIFIED |
| Guest/admin and database isolation | `organizer.test.ts`, `database.test.ts`, `content.test.ts`, restored app role/RLS checks | Hosted policies/settings UNVERIFIED |
| Organizer editing, sources, filters, safe private exports | `organizer.spec.ts`, `organizer.test.ts`, `exports.test.ts`, `csv.test.ts` | Real staging/production smoke UNVERIFIED |
| Content/photo edit authorization, conflict, cleanup debt | `content.spec.ts`, `content.test.ts`, `content-editor.test.tsx` | Approved assets/content and ongoing reconciliation UNVERIFIED |
| Backups and actual separate restore with usable edit link | `restore.test.ts`: nonempty party/content/photo, encrypted dump, checksum/key/missing-file failures, restricted restored DB, real restored HTTP edit | Offhost scheduler/retention, provider-loss restore and production scale RTO UNVERIFIED |
| Idempotency, conflicts, rollback and honest uncertain-save UI | `rsvp-service.test.ts`, `rsvp-http.test.ts`, `rsvp.spec.ts`, `rsvp-form.test.tsx` | Real network/device smoke UNVERIFIED |

CI runs the full synthetic suite on a disposable local Supabase Docker stack and creates a separate `wedding_test` application database. It never uses production secrets or applies app migrations to vendor postgres. This workflow has not been executed by GitHub Actions during local development. Native local lifecycle, restricted role, Auth settings and Storage are checked by `node --env-file=.env.local scripts/ci-bootstrap.mjs --verify`. The actual fresh bootstrap path also passed against a transient standalone native PostgreSQL 17 cluster: restricted database and private env creation, lifecycle verification, and repeat-bootstrap refusal; that cluster was stopped/deleted. Docker is unavailable on the development machine; the Docker startup/teardown path remains UNVERIFIED.

Browser versions and screenshots are generated under ignored `test-results/` by launch tests. Chromium and WebKit desktop/mobile emulation are automation engines, not a claim about an installed Safari or physical iPhone. Keyboard focus/labels/reduced motion checks are bounded acceptance checks, not a comprehensive assistive-technology audit.
