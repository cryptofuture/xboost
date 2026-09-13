# Performance and data migration

Version 1.21.1 replaces the whole-array AI queue with IndexedDB records and stable, 25-item queue views. The same repository and paging code is used by Firefox and Chrome. Browser-specific Codex WebSocket and lifecycle code remains separate.

## Reproduce

```sh
npm install
node benchmark/run-browser.js 1000 10000 50000
node benchmark/performance.js 1000
```

`run-browser.js` uses real browser IndexedDB in a clean temporary Chrome profile. `performance.js` is a deterministic Node/fake-IndexedDB regression tool; its IndexedDB timing is not representative of a browser. Fixtures mix five profiles, six statuses, long source posts and drafts, retry details, repeated authoritative contexts, reply history and three profile revisions.

## Measured result

Measured 2026-09-13 in headless Google Chrome 152.0.7977.64 on Linux x86_64, 12th Gen Intel Core i5-12500H (16 logical CPUs), 14 GiB RAM. Node driver: v24.20.0. Values are one reproducible run, not universal guarantees.

| Jobs | Fixture JSON | Old full clone/write preparation | Old in-memory full-sort page p95 | IndexedDB migration | Warm indexed startup | Indexed page p95 | One job update | 1,000 cached candidate screens | JS heap after GC |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1,000 | 0.74 MB | 11.6 ms | 1.6 ms | 89.5 ms | 10.0 ms | 3.5 ms | 0.5 ms | 6.8 ms | 1.2 MiB |
| 10,000 | 7.48 MB | 46.7 ms | 9.9 ms | 695.2 ms | 118.1 ms | 39.8 ms | 0.7 ms | 18.7 ms | 4.1 MiB |
| 50,000 | 37.53 MB | 228.7 ms | 42.7 ms | 3,670.9 ms | 542.0 ms | 221.0 ms | 1.0 ms | 24.2 ms | 34.6 MiB |

The old page-sort number starts after every historical body is already resident in memory, so it is not a complete old page-load measurement. The old clone number represents the expensive preparation formerly performed before a whole-history `browser.storage.local` write. The new update writes one IndexedDB record and writes zero bytes to `browser.storage.local`. Both paths still durably write data; the benchmark does not report IndexedDB's internal on-disk byte count.

At 10,000 jobs, warm indexed page changes meet the suggested p95 below 100 ms on this test machine. The 50,000-job random-page p95 does not; direct jumps into a large compound IndexedDB index remain the measured limitation. Sequentially revisited pages benefit from the three-page cache. No claim is made for Firefox timing because Firefox is not installed in this environment. Branded Google Chrome in this environment rejects unpacked-extension loading flags, so the browser run exercised the real storage repository from a controlled page rather than a loaded extension.

## Data behavior

- Migration runs in 500-record transactions and stores progress after every committed batch. Restart repeats safely from the last committed index.
- Source/profile identity and job IDs remain exact. No probabilistic deduplication is used.
- The legacy storage copy is removed only after the indexed record count validates. Existing IndexedDB records are updated idempotently during a repeated migration.
- Repeated authoritative context is stored once per profile revision. Historical error, retry, dismissed, draft and reply records are preserved.
- Queue status reads do not write storage. Local queue pages do not request Codex account or usage status.
- A queue view retains at most three pages. New jobs are counted outside the view until the reviewer chooses **Show new drafts**.
- Background memory keeps compact identity/status headers for exact discovery and reply checks, not historical source and draft bodies. This metadata still grows with retained history; 50,000 headers accounted for much of the measured 32.7 MiB heap.

## Verification boundaries

Deterministic tests cover resumable migration, idempotency, exact deduplication, stable snapshots, bounded page bodies/cache, equal timestamps, new arrivals, retry context, out-of-order queue requests, active edits, force-stop behavior, session cancellation and changed-article scanning. The benchmark runs a real Chromium IndexedDB implementation, but it is not a loaded-extension/X integration test and does not measure detached DOM nodes or X's production timeline. Live X, Firefox heap and long-task profiling remain manual release checks.
