# ADR-0008: `__shared__` Sentinel + `owned_by_me` Flag

Date: 2026-06-15

## Status
Accepted

## Context
Files shared with the user ("My External Items") appear in Google Drive API responses but shouldn't appear in "My Drive" listings. The previous approach filtered by `user_id` which broke workspace collaboration.

## Decision
Use `__shared__` as a sentinel value for `google_parent_id` to mark shared files. Add `owned_by_me` boolean column to `files` and `drive_folders` tables. "My Drive" queries exclude `__shared__` parents. The external items page (`/external`) shows only top-level entry points — folders and files whose immediate parent is the `__shared__` sentinel (computer-backup roots like "My Laptop", and top-level folders shared with the user). Deeper items are reached by navigating into them; the drill-in route uses the live Google API, which works at any depth.

## Consequences
- Positive: Clean separation between owned and shared items
- Positive: Workspace members can collaborate on owned files
- Negative: Sentinel value is a string convention, not enforced by schema
- Neutral: Sync engine computes `owned_by_me` from Google Drive `owners[].me` field
