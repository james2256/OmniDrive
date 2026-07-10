# Refactoring Guide

This document outlines planned refactors to improve code maintainability.
Each refactor is marked with risk level and prerequisites.

## Overview

OmniDrive has two main technical-debt areas:
1. **Large files** — `s3.ts` (860 lines), `files.ts` (789 lines), `google-drive.ts` (673 lines)
2. **Inline SQL** — 186+ `db.prepare()` calls in routes (no repository pattern)

These don't cause bugs, but they make the code harder to maintain and
extend. The refactors below address them incrementally.

## Risk levels

- 🟢 **Low risk**: Pure extraction, no behavior change, fully covered by tests
- 🟡 **Medium risk**: Changes import paths, requires updating multiple files
- 🔴 **High risk**: Touches auth-sensitive code (SigV4, RBAC), needs integration tests first

## Prerequisites

Before starting any refactor:
1. ✅ Phase 4 testing improvements are in place
2. ✅ `npm test` passes (185 tests green)
3. ✅ `npm run typecheck` passes
4. ✅ `npm run lint` passes (warnings OK, errors must be fixed)
5. ✅ Create a feature branch: `git checkout -b refactor/<name>`

## Refactor 1: Split `s3.ts` (860 lines) — 🔴 High risk

### Why
`s3.ts` contains SigV4 auth, ListObjects, GetObject, PutObject, DeleteObject,
and full multipart upload — all in one file. It's the largest and most complex
file in the codebase.

### Plan
```
packages/worker/src/routes/s3/
├── index.ts              # Router composition (~30 lines)
├── handlers/
│   ├── buckets.ts        # ListBuckets, HeadBucket, ListObjects
│   ├── objects.ts        # GetObject, HeadObject, PutObject, DeleteObject
│   └── multipart.ts      # Initiate/UploadPart/Complete/Abort
├── lib/
│   ├── xml.ts            # escapeXml, xmlError
│   ├── etag.ts           # MD5 helpers
│   └── folders.ts        # getWorkspaceFolder helpers
└── middleware.ts         # requireS3Role
```

### Prerequisites
- S3 integration tests (currently only smoke tests exist)
- `@cloudflare/vitest-pool-workers` migration (Phase 4 future work)

### Steps
1. Extract `lib/xml.ts` (escapeXml, xmlError) — pure functions, 🟢 low risk
2. Extract `lib/etag.ts` (getFileETag) — pure function, 🟢 low risk
3. Extract `lib/folders.ts` (getWorkspaceFolder, getOrCreateWorkspaceFolder) — 🟡 medium risk (DB queries)
4. Extract `handlers/buckets.ts` — 🟡 medium risk
5. Extract `handlers/objects.ts` — 🔴 high risk (PutObject has SigV4-sensitive body hashing)
6. Extract `handlers/multipart.ts` — 🔴 high risk (stream concatenation, part ordering)
7. Extract `middleware.ts` (requireS3Role) — 🟢 low risk

Each step is a separate PR. Run `tests/s3-api.test.ts` after each step.

## Refactor 2: Split `files.ts` (789 lines) — 🟡 Medium risk

### Why
`files.ts` has 20 endpoints: upload, download, star, trash, restore, move,
metadata, search, recent, category-overview — all in one file.

### Plan
```
packages/worker/src/routes/files/
├── index.ts              # Router composition
├── crud.ts               # GET /, GET /:id, PATCH /:id, DELETE /:id
├── upload.ts             # POST /upload/init, /upload/finalize, /upload/proxy
├── share.ts              # POST /:id/share, DELETE /:id/share, preview-token
├── search.ts             # GET /search, GET /recent, GET /category-overview
└── star.ts               # POST /:id/star, /:id/unstar
```

### Steps
1. Extract `star.ts` (2 endpoints, simplest) — 🟢 low risk
2. Extract `search.ts` (3 read-only endpoints) — 🟢 low risk
3. Extract `share.ts` (3 endpoints) — 🟡 medium risk
4. Extract `upload.ts` (3 endpoints, includes streaming proxy) — 🟡 medium risk
5. Keep `crud.ts` + `index.ts` in the original file — 🟢 low risk

## Refactor 3: Split `google-drive.ts` (673 lines) — 🟡 Medium risk

### Why
`GoogleDriveService` has 25+ methods: token management, file ops, folder ops,
sync operations, quota — violates Interface Segregation Principle.

### Plan
```
packages/worker/src/services/
├── google-drive/
│   ├── index.ts              # Re-exports for backward compat
│   ├── token-service.ts      # getValidToken, refreshToken, persistTokens
│   ├── file-service.ts       # getFile, downloadFile, deleteFile, renameFile
│   ├── folder-service.ts     # createFolder, getRootFolderId
│   ├── sync-service.ts       # listChanges, listAllFilesAndFolders, etc.
│   └── quota-service.ts      # getQuota
```

### Steps
1. Extract `token-service.ts` (5 methods, all token-related) — 🟡 medium risk
2. Extract `quota-service.ts` (1 method, simplest) — 🟢 low risk
3. Extract `folder-service.ts` (2 methods) — 🟢 low risk
4. Extract `file-service.ts` (8 methods) — 🟡 medium risk
5. Extract `sync-service.ts` (5 methods, includes async generator) — 🟡 medium risk
6. `index.ts` re-exports `GoogleDriveService` class that composes all services

## Refactor 4: Extract Repository Pattern — 🔴 High risk

### Why
186+ raw `db.prepare()` calls in routes. Schema changes touch 186 queries.
No single place to add caching, audit logging, or query optimization.

### Plan
```
packages/worker/src/repositories/
├── file-repository.ts        # File CRUD + queries
├── folder-repository.ts      # Workspace folder queries
├── workspace-repository.ts   # Workspace + member queries
├── user-repository.ts        # User queries
├── shared-link-repository.ts # Share link queries
└── audit-log-repository.ts   # Audit log queries
```

### Prerequisites
- All Phase 6 refactors 1-3 complete (smaller route files are easier to migrate)
- Integration tests for every route (Phase 4 future work)

### Steps (per repository)
1. Create `<name>-repository.ts` with methods for each query
2. Update ONE route file to use the repository
3. Run tests, verify no regressions
4. Repeat for next route file
5. Never do a "big bang" migration — one route at a time

## What NOT to refactor

- **`middleware/s3-auth.ts`** (317 lines) — SigV4 is correct and working. Don't touch without integration tests.
- **`polyfills/d1.ts`** — Working correctly (after PR 1 fix). Don't touch.
- **`lib/crypto.ts`** — Security-critical. Don't touch without a security review.
- **`lib/crypto-s3.ts`** — MD5 streaming is correct. Don't touch.

## Refactoring principles

1. **One change per PR** — don't mix refactoring with feature changes
2. **Test after each step** — `npm test && npm run typecheck && npm run lint`
3. **Small steps** — extract one function/file at a time
4. **Preserve behavior** — if tests fail, you changed behavior, not just structure
5. **Use `git rebase -i`** to squash WIP commits before merging

## Reference

- [Martin Fowler — Refactoring](https://refactoring.com/catalog/)
- "Take small steps… test after each step." — Refactoring, 2nd Edition
