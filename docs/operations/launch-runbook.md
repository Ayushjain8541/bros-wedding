# Launch and recovery runbook

**Launch: UNAPPROVED.** Local automated acceptance is evidence for this build only. Physical WhatsApp browsers, approved real assets/content, hosted configuration, protected staging, production smoke tests, and an independently stored scheduled backup remain mandatory gates. No account, purchase, deployment or invitation sending is authorized by this document.

## Local prerequisites and commands

Use the exact Node/pnpm/framework versions in README, a local PostgreSQL 17 client, and a running Supabase Auth/Storage service. Set `PG_BIN_DIR` to the existing native Postgres directory or install matching operator clients on the disposable CI host. Commands never print credentials, raw edit links, records or file contents. Keep shell tracing disabled, operator env files mode 0600, and their parent directories mode 0700.

The application uses restricted `wedding_app`; the schema operator uses `DATABASE_ADMIN_URL`. Existing `wedding_dev`, `wedding_test` and vendor `postgres` must never be reset by a restore. Daily backups currently support the **verified local application DB names** `wedding_dev` and `wedding_test`, with their matching private buckets. Hosted backup connectivity and schema mapping are UNVERIFIED and must be implemented/rehearsed for the selected provider before launch. Do not weaken the restore target guard to accommodate production.

Run from the repository with operator variables supplied from an approved secret store:

```sh
node scripts/backup.mjs --help
node scripts/restore.mjs --help
node scripts/backup.mjs --destination /private/backup-root/2026-10-27T000000Z
node scripts/restore.mjs --manifest /private/backup-root/2026-10-27T000000Z/manifest.enc --target wedding_restore_test_rehearsal
```

The backup destination must be new. No script implicitly loads `.env.local`; the operator chooses the source environment. `BACKUP_ENCRYPTION_KEY` must be exactly 32 random bytes encoded as canonical base64. Recover this key **separately**, together with application DB credentials, Supabase server/publishable configuration, Auth identities/provider configuration, origin and rate-limit HMAC secret. The backup contains only application schema/data and published private photo bytes; it does not contain application secrets, encryption keys, the Supabase vendor database, Auth account passwords or provider configuration. Never put those values in argv, a ticket, public CI, Git or this runbook.

Backup holds the settings/content/photo tables against publication while exporting a PostgreSQL repeatable-read snapshot and copying its referenced immutable images. Lock acquisition times out after 10 seconds. The dump contains all `wedding` tables, policies, grants and data; migrations and their hashes record the source checkout version. No orphan photo is silently substituted for a missing published image. The destination is removed on failure, and success prints only an encrypted manifest path. Large photo collections may hold editorial writes for longer; test backup duration at expected production volume before launch.

Each dump/photo file and the manifest is encrypted with AES-256-GCM using a fresh random 12-byte nonce. Authenticated metadata binds file identity, byte count and SHA-256 checksum. Only the encrypted manifest records the entire inventory. Temporary plaintext dumps are in private 0700 temporary directories, files are 0600, and cleanup runs on normal success/failure. An abrupt process/host crash can leave a private temporary directory: inspect and securely remove abandoned `wedding-backup-*`/`wedding-restore-*` directories on the operator host after confirming no process is using them. Full-disk encryption and restricted operator host access remain required.

## Separate restore and rollback

1. Retrieve an encrypted set from the approved private offhost store, verify access policy and freshness, and retrieve keys/secrets independently. Work on a trusted host with the compatible app revision and PostgreSQL client.
2. Select a new loopback name matching `wedding_restore_test_<suffix>` (lowercase letters/digits/underscores, 1–32 characters). Its Storage bucket is derived as `wedding-photos-restore-test-<suffix>`, with underscores changed to hyphens. Never point the app at production during this rehearsal.
3. Run the restore command above. Manifest authentication, every file's authentication/checksum/inventory/path validation and archive validation occur **before** database or Storage changes. Wrong key, missing photo or corrupt file fails. An existing recovery DB or bucket is refused. Only an explicit `--overwrite` permits replacing that named recovery DB/bucket, after all preflight checks pass. This does not authorize replacing production.
4. A post-preflight infrastructure failure can leave a partial isolated recovery target. The command exits nonzero and never promotes it. Keep the live source unchanged; investigate, then explicitly overwrite this same isolated target or choose a fresh suffix. Never route guests to a failed target.
5. Start the app with a restricted `wedding_app` URL pointing to that target, its exact `PHOTO_BUCKET`, loopback origin and separately supplied secrets. The test harness uses port 3300 and a guarded `.next-restore-test-<suffix>` directory. No bypass of Auth, guest sessions, edit tokens or RLS exists.
6. Compare **individual** party records, content revision/text, all metrics, photo byte hashes, table owners and forced RLS. Verify real edit-token exchange, GET and PATCH on the restored HTTP app, plus authenticated photo bytes and denied anonymous/ordinary-authenticated database access. Confirm the source party/photo remain unchanged. The executable rehearsal is `pnpm test:integration tests/integration/restore.test.ts`.
7. Record actual dataset volume, elapsed recovery time, app/schema/client versions and failures. This tiny local synthetic rehearsal does not establish production-scale RTO. Destroy only the named rehearsal target after evidence is recorded.
8. Production promotion requires a separately reviewed provider-specific recovery plan: freeze writes, verify restored consistency and Auth identities, select approved DB/Storage configuration, deploy to protected staging, then authorize traffic switch and run smoke tests. Rollback points to the still-preserved previous source. Reconcile any writes after the selected snapshot explicitly; do not merge divergent records automatically.

The current local rehearsal creates a separate database and private bucket on the **same local services**, reusing the running local Auth/Storage server. It proves application recovery and edit links; it does not prove recovery from complete provider loss or a new Auth installation.

## Daily schedule, retention and private destination

`backup-policy.example.json` is a concrete proposed policy: 00:00 UTC daily, 30 daily / 12 weekly / 12 monthly encrypted copies, monthly restores, RPO ≤24 hours and RTO ≤4 hours. None is a production guarantee yet. Owner must select an existing approved private offhost object store (public access blocked, least-privilege write/read accounts, versioning and deletion protection where available), configure retention/lifecycle, verify an offhost download and restore, and test monitoring before invitations. Cost approval is needed only if the selected arrangement requires a purchase.

Proposed server scheduler (configuration only; **not installed on this computer**):

```ini
# wedding-backup.timer on the approved operations host
[Unit]
Description=Daily encrypted wedding backup
[Timer]
OnCalendar=*-*-* 00:00:00 UTC
Persistent=true
Unit=wedding-backup.service
[Install]
WantedBy=timers.target
```

```ini
# wedding-backup.service: implement/verify the host wrapper before enabling
[Unit]
Description=Create, copy offhost, and verify an encrypted wedding backup
[Service]
Type=oneshot
User=wedding-backup
UMask=0077
WorkingDirectory=/srv/wedding
EnvironmentFile=/etc/wedding/backup.env
ExecStart=/srv/wedding-ops/backup-copy-verify
NoNewPrivileges=true
PrivateTmp=true
```

The operator-owned `backup-copy-verify` wrapper must: allocate a unique 0700 destination; run `backup.mjs`; copy **all encrypted files** to the selected private store; compare remote object hashes/size or round-trip download; publish a secret-free success timestamp only after verification; retain the local set on upload failure; prune only verified expired sets per policy; exit nonzero and alert the assigned on-call contact on any failure. Monitor the latest *verified offhost* copy and alert before age exceeds 24 hours. Key rotation must retain old keys for retained backup sets. The provider-specific copy/lifecycle/alert wrapper, scheduler execution and retention are UNVERIFIED, so no recurring personal-machine task has been created. Never claim an RPO from merely writing a timer.

## Photo cleanup reconciliation

For `photo.cleanup_pending`, read its exact bucket/object paths and the **current** `wedding.content_photos.storage_path` references. Verify each path is in the intended private bucket. Delete only paths proven unreferenced at reconciliation time, while editorial writes are paused/serialized to prevent reference races. Re-read references immediately before deletion and record an operator audit note with outcome. Retain ambiguous or referenced objects. An uncertain upload commit may have published the new object even if the browser failed; do not delete it based on the client error. Inspect `photos/` inventory for other orphans only after the same current-reference reconciliation. There is no automatic sweeper. Backups contain published referenced photos, not abandoned/orphan bytes.

## Ordered launch gates

1. **Local release:** sequential lint, typecheck, full unit (private canonical fixture enabled locally), integration including restore, both browser projects and build. Record matrix and screenshots. CI uses synthetic data only; private canonical check is conditionally skipped there.
2. **Family/content approval:** record named reviewer/date for actual logo pixels (remove “February 2026 | Indore”), couple/venue photos and permission, exact 12–14 February 2027 schedule, full story, help contact, Hindi, ceremony explanations, sublocations and dress codes. A placeholder is not a passed logo review.
3. **Physical devices:** on actual iPhone and Android, record OS/browser/WhatsApp versions and invitation→RSVP→save→reload→edit in WhatsApp in-app browser and Safari/Chrome; keyboard/large text, slow network, map/tel/WhatsApp handoff, reduced motion and group restrictions. Emulation does not satisfy this gate.
4. **Hosting evidence:** selected plan's actual persistence, project pause/inactivity behavior, CPU/memory/body/storage/database/egress limits, cold-start measurements, connection/TLS settings, signup disabled, secrets/origin, backups, scheduler, retention, certificate and domain ownership/renewal. Record actual values and provider evidence; no guessed free-tier promises.
5. **Authorized protected staging:** only after authorized deployment, use synthetic records; real save/edit/reload, private photos, metrics, safe CSV, anonymous/direct route denial, restricted role, bad Origin and recovery rehearsal. Confirm no indexing/caching leaks and record URL/build/time.
6. **Authorized production:** require all prior gates, configure real approved content and separately provisioned organizer/access secrets, deploy only when authorized, smoke test actual HTTPS domain and revoke/remove synthetic records. Confirm persistence across restart and measure cold/warm requests. Record reviewer approval.
7. **Invitation sharing:** require an explicit approved-launch record and authorized sharing. No links are sent by these scripts or CI.

## Incident procedure

Stop invitation sharing; preserve logs without sensitive payloads; record incident time and last verified backup. Disable affected access or freeze writes using an approved maintenance procedure. Rotate compromised server/access secrets with an audit trail; retaining hashed edit tokens alone does not recover a leaked raw link. Reconcile DB/Storage state, rehearse recovery separately, obtain production restoration authorization and validate a protected target. Keep the previous live state available for rollback, monitor errors/metrics, and communicate through separately authorized channels. Record actual loss/recovery time against the proposed 24h/4h targets.
