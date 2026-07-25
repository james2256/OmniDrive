import { describe, it, expect } from 'vitest';
import { roleLevel, hasPermission } from '../src/lib/rbac';

describe('rbac', () => {
  describe('roleLevel', () => {
    it('returns correct levels for each role', () => {
      expect(roleLevel('viewer')).toBe(1);
      expect(roleLevel('auditor')).toBe(1);
      expect(roleLevel('commenter')).toBe(2);
      expect(roleLevel('editor')).toBe(3);
      expect(roleLevel('manager')).toBe(4);
      expect(roleLevel('owner')).toBe(5);
    });
  });

  describe('hasPermission', () => {
    it('owner has all permissions', () => {
      expect(hasPermission('owner', 'viewer')).toBe(true);
      expect(hasPermission('owner', 'manager')).toBe(true);
      expect(hasPermission('owner', 'owner')).toBe(true);
    });

    it('viewer cannot access editor+ actions', () => {
      expect(hasPermission('viewer', 'editor')).toBe(false);
      expect(hasPermission('viewer', 'manager')).toBe(false);
      expect(hasPermission('viewer', 'owner')).toBe(false);
    });

    it('editor can access editor actions but not manager', () => {
      expect(hasPermission('editor', 'editor')).toBe(true);
      expect(hasPermission('editor', 'viewer')).toBe(true);
      expect(hasPermission('editor', 'manager')).toBe(false);
    });

    it('auditor has same level as viewer', () => {
      expect(hasPermission('auditor', 'viewer')).toBe(true);
      expect(hasPermission('viewer', 'auditor')).toBe(true); // same level
      expect(hasPermission('auditor', 'editor')).toBe(false);
    });
  });
});
