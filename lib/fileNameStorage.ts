const STORAGE_KEY = 'expense-tracker:fileName';

export const DEFAULT_FILE_NAME = 'expense-tracker';

export function getSavedFileName(): string {
  if (typeof window === 'undefined') return DEFAULT_FILE_NAME;
  return window.localStorage.getItem(STORAGE_KEY) ?? DEFAULT_FILE_NAME;
}

export function saveFileName(name: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, name);
}
