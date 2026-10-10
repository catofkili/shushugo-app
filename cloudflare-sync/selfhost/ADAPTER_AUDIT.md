# Worker binding coverage audit

Audited 2026-10-10, offline, against the working tree on `claude/aliyun-cutover`.
`src/**` is unchanged. All four `src/*.ts` files were inspected; only `index.ts`
calls D1, KV, R2 or RateLimit. `wechat-pay.ts` also reads scalar configuration.
The shared frontend imports provide rules/content, not additional binding calls.

The table records distinct API/SQL usage patterns, rather than one row for each
repeated query. Source references are relative to `cloudflare-sync/`. D1 has 158
`prepare().bind()` call sites: 57 end in `first()`, 12 in `all()`, 51 in `run()`,
and 38 create statements consumed by 13 `batch()` calls. The call-site index
below includes every terminal D1 call. KV and R2 call sites are listed directly
in the table, including indirect limiter calls and the activity statement passed
into `teamSnapshot()`.

`OK` means the current Worker contract is implemented and checked. `FIXED`
identifies working-tree corrections to the checked-in adapter/runtime; existing
uncommitted corrections were preserved and verified. `NOT USED` means no such
call exists in `src/*.ts`; the last column says whether it is implemented or
deliberately absent. An unused API is not a compatibility promise.

Evidence: [selfhost.test.mjs](../scripts/selfhost.test.mjs) exercises the real
SQLite/file adapters, the dry-run Worker bundle and the scheduled CLI. Existing
route tests provide further business-rule checks. The locally installed
`@cloudflare/workers-types/index.d.ts` defines the return shapes; Miniflare's
`dist/src/workers/d1/database.worker.js:140-174` confirms `total_changes()` deltas
and connection `last_insert_rowid()` accounting. No remote Cloudflare service
was contacted. This is a used-contract audit, not a claim that Node/file storage
duplicates Cloudflare's distributed consistency or provider telemetry.

| Usage pattern | `src` lines | Adapter/runtime lines | Status | Semantics and regression evidence |
| --- | --- | --- | --- | --- |
| D1 `prepare(sql).bind(...)` | `index.ts:336-344, 482-490, 3736-3741` | `adapters.mjs:22-33, 139` | OK | Positional parameters go to SQLite; `bind()` creates an independent statement. Rebinding regression retains the earlier values. |
| D1 bind strings, including JSON and ISO timestamps | `index.ts:482-490, 2266-2268, 3346-3377` | `adapters.mjs:24-32` | OK | Text is passed unchanged; real duel/feedback/review-login/sync routes persist it. |
| D1 bind finite numbers / explicit integer flags | `index.ts:344, 375, 2158, 2526, 3889` | `adapters.mjs:24-32` | OK | Counts, Unix times and `condition ? 1 : 0` stay numeric. Team activity and feedback quotas exercise them. |
| D1 bind nullable values | `index.ts:487-489, 2369, 2310-2311, 2687` | `adapters.mjs:27` | OK | `null` is SQL NULL; anonymous feedback/duel routes persist NULL without passing `undefined`. |
| D1 bind `undefined` / unsupported objects / bigint | None | `adapters.mjs:24-32` | NOT USED | Rejected at `bind()` with `D1_TYPE_ERROR`; regression covers undefined, object and bigint. Previously these reached Node's own errors. |
| D1 bind JavaScript booleans | None; Worker explicitly converts at `index.ts:2158, 2526` | `adapters.mjs:26` | NOT USED | Implemented as 1/0; round-trip regression covers both values. |
| D1 bind `ArrayBuffer` | None | `adapters.mjs:28` | NOT USED | Implemented as bytes; regression checks BLOB results. Previously Node could reject the unconverted buffer. |
| D1 bind `Uint8Array`, including sliced views | None | `adapters.mjs:29` | NOT USED | Preserves byte offset/length; regression excludes bytes outside the subarray. |
| D1 bind numeric byte arrays | None | `adapters.mjs:30` | NOT USED | Implemented for integer bytes 0-255; round-trip regression covers it. |
| D1 `first()` on SELECT returns a row object | `index.ts:749-755, 967-971, 1154-1156, 2213-2214` | `adapters.mjs:34-39, 42-54` | OK | Plain objects retain NULL, zero and empty strings; route session/duel reads use them. |
| D1 `first()` on empty SELECT returns null | `index.ts:1044, 1193-1197, 2440, 3271-3275` | `adapters.mjs:35-36` | OK | Does not return undefined or an empty object; missing-row regression and initial sync status cover it. |
| D1 `first()` executes UPSERT `RETURNING` | `index.ts:336-344, 367-375, 2994-3001` | `adapters.mjs:34-35, 42-54` | FIXED | Drains the statement before selecting its first result. Real feedback quota accepts ten requests then returns no row/429. |
| D1 `first()` drains multiple `RETURNING` rows | No multirow `first()` call; nearest usage `index.ts:336-344` | `adapters.mjs:35, 47-50` | NOT USED | Corrected and regression-tested: all matching updates complete, not only the first returned row. |
| D1 `first("column")` | None; all 57 source calls omit the argument | `adapters.mjs:34-39` | NOT USED | Implemented; regressions cover a column value, NULL, zero, and no matching row. |
| D1 `first("missing")` error | None | `adapters.mjs:37` | NOT USED | Corrected to throw `D1_COLUMN_NOTFOUND` when a row exists; an empty result still returns null. |
| D1 `all()` SELECT result envelope | `index.ts:638-642, 1264-1268, 2338-2340, 3896-3902` | `adapters.mjs:40, 42-54` | FIXED | Always `{ results: [...], success: true, meta }`; SELECT changes are zero and last row ID comes from SQLite. |
| D1 aggregates, joins, dynamic IN placeholders and CTE/window reads | `index.ts:1362-1370, 2007-2037, 2352-2390, 3736-3741` | `adapters.mjs:24-33, 43-50` | OK | Native SQLite executes the original SQL; there is no statement-type regex that could misclassify a CTE. Team routes exercise join/aggregate batches. |
| D1 `all()` on writes with `RETURNING` | None | `adapters.mjs:40, 42-54` | NOT USED | Corrected shared executor reports returned rows and actual changes; regression inserts through `all()`. |
| D1 `run()` INSERT / UPDATE / DELETE envelope | `index.ts:482-490, 1160-1177, 2266-2268, 2837-2840` | `adapters.mjs:41-54` | FIXED | Includes `results: []` as well as success/meta; no-row writes used to omit results. |
| D1 `run()` on a row-producing SELECT | None | `adapters.mjs:41-54` | NOT USED | Supported and tested: row results are preserved, changes are zero, connection last row ID is retained. |
| D1 `run()` with `RETURNING` | None; source `RETURNING` calls use `first()` | `adapters.mjs:41-54` | NOT USED | Supported and regression-tested with inserted rows, changes and last row ID. |
| D1 `raw()` row arrays | None | `adapters.mjs:55-60` | NOT USED | Implemented with SQLite array mode; regression checks column order and BLOB byte arrays. |
| D1 `raw({ columnNames: true })` | None | `adapters.mjs:55-60` | NOT USED | Implemented with a leading names row; scalar and binary regressions cover it. |
| D1 `meta.changes` decides conditional-write success | `index.ts:2180, 2312, 2331, 3384` | `adapters.mjs:44-54` | FIXED | Per-statement `total_changes()` delta avoids a prior write leaking into a SELECT. Matched/unmatched writes and real duel/sync routes are checked. |
| D1 `meta.changes` includes triggers/cascades | Implicit cascades on `index.ts:2585, 2840`; metadata is not read there | `adapters.mjs:44-54, 277` | FIXED | Uses total changes, rather than only top-level `changes()`; trigger and trigger-rollback regressions verify accounting/atomicity. |
| D1 `meta.last_row_id` | None: Worker never reads it | `adapters.mjs:44-54` | NOT USED | Corrected to connection `last_insert_rowid()`, including subsequent reads/updates; regressions cover INSERT, SELECT, batch and RETURNING. |
| D1 BLOB results as numeric byte arrays | None: Worker SQL binds/reads no BLOBs | `adapters.mjs:19-20, 49, 58` | NOT USED | Corrected from Node typed arrays to D1 byte arrays for first/all/raw; binary regressions verify values. |
| D1 `batch()` with SELECT statements | `index.ts:645-651, 2130-2135, 2188-2191` | `adapters.mjs:140-149` | OK | Returns an ordered array of complete result envelopes; review-login session payload and duel rewards use real adapters. |
| D1 `batch()` with optional leading activity write then reads | `index.ts:1995, 2004-2039, 2517-2537, 2548` | `adapters.mjs:42-54, 140-149` | FIXED | Mutation result includes an empty results array; later statements see its writes in the same transaction. Stale activity cannot lower MAX-based counters. |
| D1 `batch()` containing only writes | `index.ts:1052-1067, 1233-1248, 2285-2292, 2444-2453, 3873-3890` | `adapters.mjs:42-54, 140-149` | FIXED | Each result includes `{ results: [], success: true, meta }`; real duel decision/reward and scheduled cleanup cover it. |
| D1 dynamic statement arrays / mapped statements | `index.ts:1285-1288, 1301-1315, 2004-2039, 2588-2601` | `adapters.mjs:140-149` | OK | Original statement order is preserved without asynchronous transaction interleaving. |
| D1 batch write dependencies / conditional INSERT SELECT | `index.ts:2285-2292, 3345-3378` | `adapters.mjs:141-144` | OK | The dependent reward/version INSERT observes the preceding UPDATE; real duel reward and sync push verify it. |
| D1 batch statements with `RETURNING` | None | `adapters.mjs:143, 42-54` | NOT USED | Supported; regressions combine multirow UPDATE RETURNING with SELECT and roll back RETURNING before a later SQL failure. |
| D1 failed batch rolls back all statements | Potential errors at `index.ts:1052-1067, 2444-2453, 3345-3381` | `adapters.mjs:140-149` | OK | UNIQUE, missing-table and FK failures reject the batch; preceding rows and trigger writes are absent afterward. |
| D1 SQLite errors propagate as rejected operations | `index.ts:2470-2476, 3046-3056, 3379-3381, 3863-3867` | `adapters.mjs:34-54, 146-148` | OK | Errors are thrown, not converted to successful envelopes; rollback preserves the original error. Worker catches/handles the failure. |
| D1 INSERT OR IGNORE / guarded INSERT SELECT / multirow UNION ALL | `index.ts:2154-2158, 2177-2179, 2288-2291, 2926-2929, 3351-3377` | `adapters.mjs:43-54, 140-149` | OK | Native SQLite handles conflict/no-op writes and returns correct changes; no hand-written SQL rewriting. |
| D1 `exec()` | None | Not implemented on `DB`; raw SQLite `exec()` at `adapters.mjs:141` is internal | NOT USED | No Worker call exists. Internal migration/transaction calls do not imply D1 `env.DB.exec()` support. |
| D1 `withSession()` / `dump()` | None | Not implemented | NOT USED | No Worker session/bookmark/dump API use. |
| D1 other metadata / provider telemetry | None: only `meta.changes` is consumed | `adapters.mjs:8-17` | NOT USED | `duration`, scanned-row counts, database size and serving-region telemetry are not provider-identical; not used to make Worker decisions. |
| KV `get(key)` returns text or null | `index.ts:552, 557, 630, 1575, 1587, 1823, 3484, 3513` | `adapters.mjs:154-163` | OK | Live values stay strings, absent/expired values return null. Text/Unicode/missing/TTL regressions cover it. |
| KV JSON stored/read as ordinary text | `index.ts:1357-1360, 1483-1486, 1575-1582, 1587-1594` | `adapters.mjs:154-170` | OK | Worker performs its own JSON.stringify/JSON.parse; adapter must not parse these `get(key)` values. |
| KV `get(key, "text")` / `{ type: "text" }` | None | `adapters.mjs:154` ignores extra arguments | NOT USED | Default text reads are supported; no typed-get contract is relied on. |
| KV `get(key, "json")` / `{ type: "json" }` | None | Not implemented | NOT USED | Extra arguments are ignored, so this is explicitly not JSON-get support. |
| KV `get(key, "arrayBuffer")` / `{ type: "arrayBuffer" }` | None | Not implemented | NOT USED | Current Worker legacy snapshots are Base64 text, decoded by the Worker. |
| KV `put(key, string)` without expiration | `index.ts:1851` | `adapters.mjs:164-170` | OK | Persistent avatar text is stored unchanged; overwrite without TTL clears earlier expiry. Regression verifies Unicode, overwrite and delete. |
| KV `put(..., { expirationTtl })` | `index.ts:558, 631-633, 1357-1360, 1483-1486, 1594` | `adapters.mjs:165-170` | OK | All source TTLs are integral and at least 60 seconds. Expiry is Unix seconds; exact-boundary regression checks 59/60 seconds. |
| KV `put(..., { expiration })` | None | `adapters.mjs:165-170` | NOT USED | Absolute Unix-second expiration is supported and boundary-tested. |
| KV `put(..., { metadata })` / `getWithMetadata()` | None | Not implemented | NOT USED | Runtime schema stores only text and expiry. Importing entries does not promise metadata round trips. |
| KV `put()` binary/stream bodies | None | Not implemented | NOT USED | Source writes only strings; arbitrary body types are not emulated. |
| KV `delete(key)` | `index.ts:562, 1853, 2839, 3203` | `adapters.mjs:172-174` | OK | Resolves undefined whether a key exists or not; live/missing deletion regressions cover it. |
| KV `list({ prefix, cursor, limit })` | None | Not implemented | NOT USED | There is no KV list dependency or KV list return-shape promise. Worker listing uses R2. |
| R2 `put(key, Uint8Array)` including views | `index.ts:3337-3339, 3608-3612` | `adapters.mjs:178-184` | OK | The exact byte range is stored; binary sync round trip and sliced-view regression cover it. |
| R2 `put(key, ArrayBuffer)` | None: both source puts pass Uint8Array | `adapters.mjs:179` | NOT USED | Supported through Response body normalization; byte round-trip regression verifies it. |
| R2 `put(key, string)` | None | `adapters.mjs:179` | NOT USED | Supported and Unicode round-trip tested. |
| R2 `put(key, ReadableStream)` | None | `adapters.mjs:179` | NOT USED | Corrected body normalization now consumes a Web stream; stream-body regression verifies it. |
| R2 `put(..., { httpMetadata })` | `index.ts:3610` | `adapters.mjs:126-133, 181, 196-202` | OK | contentType/cacheControl persist in sidecar JSON and round-trip through get/head. |
| R2 `put(..., { customMetadata })` | `index.ts:3338, 3611` | `adapters.mjs:126-133, 181, 196-202` | OK | String metadata is preserved and tested, including imported object metadata. |
| R2 conditional create `onlyIf.etagDoesNotMatch = "*"` | `index.ts:3608-3619` | `adapters.mjs:117-124, 181-183` | OK | Atomic hard-link creation permits one winner, returns null for the loser and keeps the winner's bytes. Concurrent-create regression checks it. |
| R2 other `onlyIf` conditions / Headers form | None | Not implemented | NOT USED | Only the exact create-if-absent condition used by the Worker is emulated. Other conditions must not be assumed supported. |
| R2 successful put returns object metadata | `index.ts:3613` consumes only truthiness | `adapters.mjs:183, 196-202` | OK | Successful result has key, size, Date uploaded, etag and metadata; conditional failure returns null. |
| R2 `get(key)` / missing object | `index.ts:3481, 3506, 3582, 3601, 3614` | `adapters.mjs:185-202` | OK | Returns an object body or null. Imported object and missing-object regressions cover it. |
| R2 `get().arrayBuffer()` and single body consumption | `index.ts:3482, 3603, 3616` | `adapters.mjs:188-193` | FIXED | Uses the same response stream as body/text; subsequent consumption rejects rather than rereading the file. |
| R2 `get().body` as a ReadableStream | `index.ts:3508, 3584` | `adapters.mjs:188-193` | OK | Node file stream is exposed as a Web stream and can be consumed by Response. Real sync pull and stream-consumption regressions cover it. |
| R2 `get().text()` | None | `adapters.mjs:193` | NOT USED | Implemented/fixed to share body consumption; string/stream and second-read regressions cover it. |
| R2 object `httpMetadata` / `customMetadata` reads | None: source only writes these options | `adapters.mjs:189-193, 200-201` | NOT USED | Implemented and round-trip checked; raw Worker responses construct their own headers. |
| R2 object `etag` reads | None | `adapters.mjs:180, 201, 221` | NOT USED | Corrected single-part ETag from SHA-256 to unquoted MD5; regression verifies the digest. Imported ETags are preserved. |
| R2 object `size` / `uploaded` reads outside list | None | `adapters.mjs:201` | NOT USED | Implemented as byte length and Date; head/body type regressions verify them. |
| R2 `writeHttpMetadata(headers)` | None | Not implemented | NOT USED | Worker explicitly supplies response content-type/cache-control headers at `index.ts:3495-3504, 3584-3586`. |
| R2 `head(key)` / missing head | None | `adapters.mjs:196-202` | NOT USED | Implemented; tests check null for missing keys and metadata without body for existing keys. |
| R2 `delete(key)` | `index.ts:3202, 3380, 3386, 3629` | `adapters.mjs:203-209` | OK | Removes object plus metadata; deleting a missing object succeeds. Regressions verify removal and missing-key behavior. |
| R2 `delete(key[])` | `index.ts:183, 2828` | `adapters.mjs:203-209` | OK | Deletes all supplied keys; batch-delete regression and real scheduled weekly cleanup cover it. |
| R2 `list({ prefix, limit })` | `index.ts:179, 3560` | `adapters.mjs:210-237` | OK | Lexically sorted keys; source limits 500/1000; bucket metadata and temporary files are excluded. Prefix/page regression checks it. |
| R2 `list({ prefix, limit, cursor })` | `index.ts:3556-3564` | `adapters.mjs:228-237` | OK | Opaque continuation cursor advances after the last key; two-page regression returns each matching object once. |
| R2 list shape `objects`, `truncated`, optional `cursor` | `index.ts:180, 3561-3563` | `adapters.mjs:234-236` | OK | Array plus boolean; cursor is returned only when truncated. Complete-page regression checks no continuation cursor. |
| R2 listed object `key` | `index.ts:182, 2827, 3571` | `adapters.mjs:215-221` | OK | Full object key enables week extraction/deletion; regression checks ordered keys across pages. |
| R2 listed object `uploaded` Date | `index.ts:181, 3572` | `adapters.mjs:219-221` | OK | Date supports getTime/toISOString; imports preserve upload timestamps. Real scheduled cleanup distinguishes expired and recent objects. |
| R2 listed object `size` bytes | `index.ts:3573` | `adapters.mjs:219-221` | OK | Filesystem byte size, not string length; UTF-8 put and list regressions check numeric sizes. |
| R2 get/head range or conditional options / list include metadata | None | Not implemented | NOT USED | No Worker dependency on these extended forms. |
| RateLimit `limit({ key })`, account and IP keys | `index.ts:393-394` | `adapters.mjs:240-261` | OK | Separate hashed keys and atomic fixed-window increments; key independence and adapter recreation regressions cover it. |
| RateLimit `{ success: boolean }` result | `index.ts:396` | `adapters.mjs:255` | OK | Result is an object with success, not a boolean; exhaustion regression deep-compares both outcomes. |
| All three limiter bindings and configured limits | `index.ts:3216, 3425, 3453` | `adapters.mjs:267-269` | OK | Matches wrangler limits 2/4/20 per 60 seconds; tests exhaust each namespace separately. |
| RateLimit 60-second rollover | `index.ts:387-396` | `adapters.mjs:242-253` | OK | Fixed bucket transition resets the allowance; controlled-clock regression verifies it. Local limits are process-independent SQLite counts, not CF's geographically distributed approximate counters. |
| Worker `fetch(request, env, ctx)` invocation | `index.ts:3861-3868` declares request/env only | `server.mjs:44-55, 85` | OK | Third context argument is supplied and safely ignored by current source; new routes run through dispatch with the real env. |
| `ctx.waitUntil(promise)` registrations in Worker | None: source does not access ctx | `server.mjs:37-55, 119-124` | NOT USED | Implemented and hardened: returns undefined, observes rejection immediately, logs it, drains nested tasks and drains on handler failure. Regressions cover fetch and scheduled entry points. |
| `waitUntil` rejection before handler completion | No current source call | `server.mjs:37-41, 46, 121` | FIXED | Reproduced process exit from an unhandled rejection. HTTP and scheduled contexts now attach catch immediately and keep draining other tasks. |
| `scheduled(controller, env, ctx)` invocation | `index.ts:3869-3908` declares controller/env only | `server.mjs:116-133` | OK | CLI supplies `{ cron: "17 3 * * *", scheduledTime: Date.now() }`, actual env and context. CLI probe asserts the signature and task lifetime; real Worker cleanup is also invoked. |
| Scheduled D1 cleanup batch and stale-entitlement SELECT | `index.ts:3873-3905` | `adapters.mjs:40-54, 140-149`; `server.mjs:121` | OK | Real CLI deletes an expired feedback report while retaining current ones; no Apple network call is needed with non-App-Store fixtures. |
| Scheduled R2 prefix list / uploaded filter / batch delete | `index.ts:174-183, 3907` | `adapters.mjs:203-237`; `server.mjs:121` | OK | Real CLI retention test removes an imported old weekly object and retains the recent object. |
| Non-secret env vars loaded as strings | `index.ts:33-74, 3126`; `wechat-pay.ts:20-28, 68-90` | `server.mjs:17-25` | FIXED | Read wrangler JSONC vars at startup; only whole-line comments are stripped. Tests compare every var, especially the launch-gift deadline, and file overrides. |
| Hardening secret default and credential-file precedence | `index.ts:504, 3752` | `server.mjs:10, 19-21` | OK | Wrangler vars < hard-coded hardening default < credential file; default/override/private-key newline regressions cover it. |

Every terminal D1 call is indexed here by the start of its full expression
(`first/all/run` may appear on a later line after multiline SQL):

| Terminal method | `src/index.ts` expression start lines |
| --- | --- |
| `first()` (57) | 336, 367, 749, 791, 967, 991, 1044, 1086, 1102, 1154, 1193, 1200, 1219, 1249, 1316, 1429, 1466, 1479, 1538, 1565, 1675, 1720, 1758, 1786, 1792, 1803, 1814, 1966, 1975, 2108, 2172, 2174, 2213, 2440, 2463, 2464, 2560, 2582, 2621, 2637, 2665, 2670, 2696, 2736, 2766, 2792, 2802, 2930, 2994, 3094, 3143, 3271, 3294, 3387, 3426, 3454, 3460 |
| `all()` (12) | 638, 1264, 1362, 1620, 2144, 2338, 2352, 2377, 2818, 3404, 3736, 3896 |
| `run()` (51) | 482, 671, 722, 728, 766, 772, 810, 842, 845, 1118, 1160, 1172, 1176, 1205, 1399, 1477, 1544, 1650, 1694, 1701, 1772, 1799, 1856, 1985, 2106, 2154, 2177, 2266, 2310, 2328, 2470, 2477, 2496, 2571, 2585, 2625, 2640, 2651, 2681, 2687, 2724, 2778, 2781, 2792, 2837, 2840, 2859, 2926, 3046, 3188, 3290, 3417 |
| `batch()` (13) | 645, 1052, 1233, 1285, 1301, 2039, 2130, 2188, 2285, 2444, 2601, 3345, 3873 |

Configuration and secret coverage is separate from storage emulation: every
scalar is copied through without renaming. `APP_STORE_PRIVATE_KEY` alone has
literal `\\n` converted to actual newlines in the runtime, matching the existing
single-line credentials-file workflow.

| Scalar env group | `src` reads | Runtime / secret prompt |
| --- | --- | --- |
| `APP_BUNDLE_ID`, `APPLE_SIGN_IN_CLIENT_ID` | `index.ts:591, 873, 2893, 3798-3799` | `wrangler.jsonc` vars via `server.mjs:18-20` |
| `WECHAT_OFFER_ID`, `WECHAT_PAY_ENV`, `WECHAT_PAY_PRICES` | `wechat-pay.ts:68-90`; `index.ts:1670` | `wrangler.jsonc` vars via `server.mjs:18-20` |
| `LAUNCH_GIFT_CLAIM_UNTIL` | `index.ts:3126` | `wrangler.jsonc` var; no runtime hard-coded copy |
| `APP_STORE_ISSUER_ID`, `APP_STORE_KEY_ID`, `APP_STORE_PRIVATE_KEY` | `index.ts:873-887, 3764` | `set-secrets.sh:14, 26`; file values override vars/defaults |
| `RESEND_API_KEY`, `EMAIL_FROM`, `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | `index.ts:294, 494-525, 688-699, 3696, 3754` | `set-secrets.sh:15, 25` |
| `WECHAT_APP_ID`, `WECHAT_APP_SECRET` | `index.ts:1323-1328, 1590, 1893, 3770` | `set-secrets.sh:16, 27` |
| `WECHAT_MOBILE_APP_ID`, `WECHAT_MOBILE_APP_SECRET` | `index.ts:1496-1501, 3767, 3800` | `set-secrets.sh:16, 28` |
| `WECHAT_MSG_TOKEN` | `index.ts:1739, 3769` | `set-secrets.sh:17, 29` |
| `WECHAT_PAY_APP_KEY`, `WECHAT_PAY_SANDBOX_APP_KEY`, `WECHAT_PAY_PRODUCTION_APP_KEY` | `wechat-pay.ts:74-78` | `set-secrets.sh:17, 30` |
| `REVIEW_LOGIN_PASSWORD`, `REVIEW_LOGIN_UNTIL` | `index.ts:1139-1149` | `set-secrets.sh:18, 31`; both prompted; real review-login regression checks deadline |
| `REQUIRE_AUTH_HARDENING` | `index.ts:504, 3752` | `server.mjs:10, 20`; `set-secrets.sh:18, 32` |
| `WEEKLY_REPORT_RETENTION_DAYS` | `index.ts:168` | `set-secrets.sh:19, 33`; optional, no cleanup when absent |
| `APP_STORE_ENVIRONMENT` | `index.ts:901, 3766` | `set-secrets.sh:19, 34`; optional Sandbox/Production |

The unsupported forms explicitly marked NOT USED (D1 exec/sessions/dump, typed
KV/binary/metadata/list APIs, R2 general preconditions/ranges/writeHttpMetadata)
remain outside the current contract. If source starts using one, implement it
and add a real-adapter regression before deploying. D1 provider telemetry is
approximate, and self-host dispatch waits for background work before returning
the response instead of Cloudflare's post-response lifetime extension; current
source registers no waitUntil work. R2 supports the safe ASCII keys generated
by this Worker, not every arbitrary Cloudflare object key. No production cutover,
deployment, external-service verification or Node 22 binary run was performed.
