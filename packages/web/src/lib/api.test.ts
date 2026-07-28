import { describe, it, expect } from 'vitest';
import { filesApi } from './api/files';

describe('filesApi', () => {
  it('has trash related functions', () => {
    expect(typeof filesApi.getTrashFiles).toBe('function');
    expect(typeof filesApi.restoreFile).toBe('function');
    expect(typeof filesApi.deleteFilePermanent).toBe('function');
  });
});
