import { describe, it, expect } from 'vitest';
import { computeStorageDelta, type FileStateForStats } from '../src/lib/storage-stats';

describe('computeStorageDelta', () => {
  const active: FileStateForStats = {
    size: 100,
    mimeType: 'image/jpeg',
    isTrashed: false,
    ownedByMe: true,
  };
  const trashed: FileStateForStats = {
    size: 100,
    mimeType: 'image/jpeg',
    isTrashed: true,
    ownedByMe: true,
  };
  const activeVideo: FileStateForStats = {
    size: 500,
    mimeType: 'video/mp4',
    isTrashed: false,
    ownedByMe: true,
  };

  // 1. Insert active (null → active)
  it('insert active → +size @ mime', () => {
    const deltas = computeStorageDelta(null, active);
    expect(deltas).toEqual([{ mimeType: 'image/jpeg', delta: 100 }]);
  });

  // 2. Insert trashed (null → trashed)
  it('insert trashed → [] (not in active set)', () => {
    const deltas = computeStorageDelta(null, trashed);
    expect(deltas).toEqual([]);
  });

  // 3. Delete active (active → null)
  it('delete active → -size @ mime', () => {
    const deltas = computeStorageDelta(active, null);
    expect(deltas).toEqual([{ mimeType: 'image/jpeg', delta: -100 }]);
  });

  // 4. Delete trashed (trashed → null)
  it('delete trashed → [] (not in active set)', () => {
    const deltas = computeStorageDelta(trashed, null);
    expect(deltas).toEqual([]);
  });

  // 5. active → active, same mime (size change)
  it('active→active same mime → (new-old) @ mime', () => {
    const bigger: FileStateForStats = {
      size: 200,
      mimeType: 'image/jpeg',
      isTrashed: false,
      ownedByMe: true,
    };
    const deltas = computeStorageDelta(active, bigger);
    expect(deltas).toEqual([{ mimeType: 'image/jpeg', delta: 100 }]);
  });

  // 5b. active → active, same mime, no size change
  it('active→active same mime same size → []', () => {
    const deltas = computeStorageDelta(active, { ...active });
    expect(deltas).toEqual([]);
  });

  // 6. active → active, different mime
  it('active→active diff mime → -old @ old, +new @ new', () => {
    const deltas = computeStorageDelta(active, activeVideo);
    expect(deltas).toEqual([
      { mimeType: 'image/jpeg', delta: -100 },
      { mimeType: 'video/mp4', delta: 500 },
    ]);
  });

  // 7. trashed → active (restore / UPSERT untrashes)
  it('trashed→active → +size @ mime', () => {
    const deltas = computeStorageDelta(trashed, active);
    expect(deltas).toEqual([{ mimeType: 'image/jpeg', delta: 100 }]);
  });

  // 8. active → trashed (trash)
  it('active→trashed → -size @ mime', () => {
    const deltas = computeStorageDelta(active, trashed);
    expect(deltas).toEqual([{ mimeType: 'image/jpeg', delta: -100 }]);
  });

  // 9. trashed → trashed
  it('trashed→trashed → []', () => {
    const deltas = computeStorageDelta(trashed, { ...trashed });
    expect(deltas).toEqual([]);
  });

  // Edge cases
  it('both null → []', () => {
    const deltas = computeStorageDelta(null, null);
    expect(deltas).toEqual([]);
  });

  it('null mime → uses empty string', () => {
    const state: FileStateForStats = { size: 50, mimeType: '', isTrashed: false, ownedByMe: true };
    const deltas = computeStorageDelta(null, state);
    expect(deltas).toEqual([{ mimeType: '', delta: 50 }]);
  });

  it('size=0 active → +0 @ mime (filtered by caller)', () => {
    const zero: FileStateForStats = {
      size: 0,
      mimeType: 'text/plain',
      isTrashed: false,
      ownedByMe: true,
    };
    const deltas = computeStorageDelta(null, zero);
    expect(deltas).toEqual([{ mimeType: 'text/plain', delta: 0 }]);
  });

  it('trashed→active with different mime → +new @ new.mime', () => {
    const deltas = computeStorageDelta(trashed, activeVideo);
    expect(deltas).toEqual([{ mimeType: 'video/mp4', delta: 500 }]);
  });

  it('active→trashed with different mime → -old @ old.mime', () => {
    const deltas = computeStorageDelta(activeVideo, trashed);
    expect(deltas).toEqual([{ mimeType: 'video/mp4', delta: -500 }]);
  });
});
