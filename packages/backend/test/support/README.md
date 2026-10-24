Public regression fixtures use handwritten synthetic Storage bodies and the
identities already declared in Migration 02. No production catalog export is
required. Catalog SQL in this directory runs only against disposable local test
databases; query results are not fixtures and must not be checked in.

`syntheticStorageFixture.js` substitutes seven source hashes in a copy of Migration
02 held in memory. This exercises the exact metadata, argument, source drift and
atomicity guards with synthetic bodies. It does not verify hosted Storage source
or approve a production migration. A separate test proves the unmodified
migration rejects these synthetic bodies. Migration files on disk are unchanged.
Other session, authorization and concurrency tests use the unmodified migrations.

If a production review needs exports, retain them outside this repository, or in
the ignored root `.local-production-evidence/` directory. Never force-add them.
Do not replace public fixtures with production output. The optional comparison
of local Migration 02 draft files skips when those private files are absent.

Run `npm run test --workspace=backend` and `npm run test --workspace=frontend`
from the repository root. Native concurrency tests also require
`UNGGUL_TEST_PG_BIN` pointing to a local PostgreSQL bin directory, then
`npm run test:native --workspace=backend`. They initialize their own temporary
cluster on loopback and never accept a production connection string.
