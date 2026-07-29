import { describe, it, expect } from 'vitest';
import { qk } from './queryKeys';

// `qk` is the central query key registry. React Query keys are arrays so they
// can be prefix-matched by `invalidateQueries({ queryKey: [...] })`. Verify
// every static key is an array, every factory function returns an array, and
// factory outputs include the prefix + params in the right order.

describe('qk', () => {
  describe('static keys (each is an array)', () => {
    it('drives = ["drives"]', () => {
      expect(qk.drives).toEqual(['drives']);
      expect(Array.isArray(qk.drives)).toBe(true);
    });

    it('driveFolder = ["driveFolder"]', () => {
      expect(qk.driveFolder).toEqual(['driveFolder']);
      expect(Array.isArray(qk.driveFolder)).toBe(true);
    });

    it('starred = ["starred"]', () => {
      expect(qk.starred).toEqual(['starred']);
      expect(Array.isArray(qk.starred)).toBe(true);
    });

    it('trash = ["trash"]', () => {
      expect(qk.trash).toEqual(['trash']);
      expect(Array.isArray(qk.trash)).toBe(true);
    });

    it('recent = ["recent"]', () => {
      expect(qk.recent).toEqual(['recent']);
      expect(Array.isArray(qk.recent)).toBe(true);
    });

    it('category = ["category"]', () => {
      expect(qk.category).toEqual(['category']);
      expect(Array.isArray(qk.category)).toBe(true);
    });

    it('sharedLinks = ["sharedLinks"]', () => {
      expect(qk.sharedLinks).toEqual(['sharedLinks']);
      expect(Array.isArray(qk.sharedLinks)).toBe(true);
    });

    it('external = ["external"]', () => {
      expect(qk.external).toEqual(['external']);
      expect(Array.isArray(qk.external)).toBe(true);
    });

    it('workspaceTree = ["workspaceTree"]', () => {
      expect(qk.workspaceTree).toEqual(['workspaceTree']);
      expect(Array.isArray(qk.workspaceTree)).toBe(true);
    });
  });

  describe('factory functions', () => {
    it('driveFolderContents(driveId, folderId) = ["driveFolder", driveId, folderId]', () => {
      const key = qk.driveFolderContents('d-1', 'f-1');
      expect(key).toEqual(['driveFolder', 'd-1', 'f-1']);
      expect(Array.isArray(key)).toBe(true);
      // Prefix-matchable by ["driveFolder"]
      expect(key.slice(0, 1)).toEqual(['driveFolder']);
    });

    it('driveFolderContents returns distinct keys per drive/folder pair', () => {
      expect(qk.driveFolderContents('d1', 'f1')).not.toEqual(qk.driveFolderContents('d2', 'f2'));
    });

    it('search(q) = ["search", q]', () => {
      const key = qk.search('alpha');
      expect(key).toEqual(['search', 'alpha']);
      expect(Array.isArray(key)).toBe(true);
      // Prefix-matchable by ["search"]
      expect(key.slice(0, 1)).toEqual(['search']);
    });

    it('externalFolder(driveId, folderId) = ["external", driveId, folderId]', () => {
      const key = qk.externalFolder('d-1', 'f-1');
      expect(key).toEqual(['external', 'd-1', 'f-1']);
      expect(Array.isArray(key)).toBe(true);
      // Prefix-matchable by ["external"]
      expect(key.slice(0, 1)).toEqual(['external']);
    });

    it('workspaceContents(folderId) = ["workspaceContents", folderId]', () => {
      const key = qk.workspaceContents('f-1');
      expect(key).toEqual(['workspaceContents', 'f-1']);
      expect(Array.isArray(key)).toBe(true);
      // Prefix-matchable by ["workspaceContents"]
      expect(key.slice(0, 1)).toEqual(['workspaceContents']);
    });

    it('factories return readonly arrays (as const)', () => {
      // `as const` makes the array readonly — Object.isFrozen is not required,
      // but TS marks it readonly. We at least confirm fresh calls return new
      // instances rather than a shared mutable array.
      const a = qk.search('x');
      const b = qk.search('x');
      expect(a).toEqual(b);
      expect(a).not.toBe(b);
    });
  });
});
