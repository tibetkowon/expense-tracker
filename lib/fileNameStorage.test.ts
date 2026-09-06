import { describe, it, expect, beforeEach } from 'vitest';
import { DEFAULT_FILE_NAME, getSavedFileName, saveFileName } from './fileNameStorage';

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

describe('fileNameStorage', () => {
  beforeEach(() => localStorage.clear());

  it('returns the default file name when nothing is saved', () => {
    expect(getSavedFileName()).toBe(DEFAULT_FILE_NAME);
  });

  it('returns a previously saved file name', () => {
    saveFileName('가계부');
    expect(getSavedFileName()).toBe('가계부');
  });

  it('overwrites a previously saved file name', () => {
    saveFileName('가계부');
    saveFileName('2026 지출');
    expect(getSavedFileName()).toBe('2026 지출');
  });
});
