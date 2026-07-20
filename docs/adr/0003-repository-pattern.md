# ADR-0003: Repository Pattern

Date: 2026-07-19

## Status
Accepted

## Context
Route files contained 240 inline `db.prepare()` SQL calls. SQL was scattered across 10 files with no single source of truth. RBAC checks were inconsistent (18 operations lacked proper role checks).

## Decision
Introduce repository classes (`FileRepository`, `FolderRepository`, `DriveRepository`) that own all SQL. Services own business logic + RBAC. Routes become thin orchestrators.

## Consequences
- Positive: Single source of truth for SQL queries
- Positive: Consistent RBAC enforcement via service layer
- Positive: Independently testable data access layer
- Negative: Additional abstraction layer (route → service → repository → DB)
- Neutral: Migration is incremental — some routes still have inline SQL
