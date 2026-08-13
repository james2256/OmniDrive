import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { QueryClient } from '@tanstack/react-query';
import { invalidateAfterFileMutation } from './invalidate';
import { qk } from './queryKeys';

// `invalidateAfterFileMutation` is a query-invalidation dispatcher — it calls
// `queryClient.invalidateQueries` once per affected query key after a file/folder
// mutation. The test asserts (a) each expected key is invalidated and (b) the
// total call count matches the source's fan-out, so future edits adding/removing
// a key show up as a test diff rather than silent drift.

describe('invalidateAfterFileMutation', () => {
  let invalidateQueries: ReturnType<typeof vi.fn>;
  let qc: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    invalidateQueries = vi.fn();
    qc = { invalidateQueries } as unknown as QueryClient;
  });

  it('invalidates qk.driveFolder', () => {
    invalidateAfterFileMutation(qc);
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: qk.driveFolder });
  });

  it('invalidates qk.starred', () => {
    invalidateAfterFileMutation(qc);
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: qk.starred });
  });

  it('invalidates qk.trash', () => {
    invalidateAfterFileMutation(qc);
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: qk.trash });
  });

  it('invalidates qk.recent', () => {
    invalidateAfterFileMutation(qc);
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: qk.recent });
  });

  it('invalidates qk.sharedLinks', () => {
    invalidateAfterFileMutation(qc);
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: qk.sharedLinks });
  });

  it('invalidates qk.external', () => {
    invalidateAfterFileMutation(qc);
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: qk.external });
  });

  it('invalidates qk.category', () => {
    invalidateAfterFileMutation(qc);
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: qk.category });
  });

  it('prefix-matches all search queries via ["search"] literal key', () => {
    invalidateAfterFileMutation(qc);
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['search'] });
  });

  it('invalidates qk.workspaceTree', () => {
    invalidateAfterFileMutation(qc);
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: qk.workspaceTree });
  });

  it('prefix-matches all workspaceContents queries via literal key', () => {
    invalidateAfterFileMutation(qc);
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['workspaceContents'] });
  });

  it('issues exactly 11 invalidateQueries calls', () => {
    invalidateAfterFileMutation(qc);
    expect(invalidateQueries).toHaveBeenCalledTimes(11);
  });

  it('does not return a value', () => {
    expect(invalidateAfterFileMutation(qc)).toBeUndefined();
  });
});
