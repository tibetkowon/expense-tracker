import { describe, it, expect, beforeEach } from 'vitest';
import { getSavedFolderId, saveFolderId } from './folderStorage';

const values = new Map<string, string>();
Object.defineProperty(window, 'localStorage', {
  configurable: true,
  value: {
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  },
});
const { localStorage } = window;

describe('folderStorage', () => {
  beforeEach(() => localStorage.clear());

  it('returns null when nothing has been saved', () => {
    expect(getSavedFolderId()).toBeNull();
  });

  it('returns what was saved', () => {
    saveFolderId('folder-123');
    expect(getSavedFolderId()).toBe('folder-123');
  });
});
