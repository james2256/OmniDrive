# ADR-0008: `__shared__` Sentinel + `owned_by_me` Flag

Date: 2026-06-15

## Status
Accepted

## Context
Files shared with the user ("My External Items") appear in Google Drive API responses but shouldn't appear in "My Drive" listings. The previous approach filtered by `user_id` which broke workspace collaboration.

## Decision
Use `__shared__` as a sentinel value for `google_parent_id` to mark shared files. Add `owned_by_me` boolean column to `files` and `drive_folders` tables. "My Drive" queries exclude `__shared__` parents. The external items page (`/external`) shows items the user owns (`owned_by_me = 1`) whose parent chain leads to shared territory — either a folder shared WITH the user (`owned_by_me = 0`) or a computer-backup root (`google_parent_id = '__shared__'`) — at any nesting depth, via a recursive CTE.

## Consequences
- Positive: Clean separation between owned and shared items
- Positive: Workspace members can collaborate on owned files
- Negative: Sentinel value is a string convention, not enforced by schema
- Neutral: Sync engine computes `owned_by_me` from Google Drive `owners[].me` field
