'use client';

import { useEffect, useState } from 'react';
import { DEFAULT_FILE_NAME, getSavedFileName, saveFileName } from '@/lib/fileNameStorage';
import { getSavedFolderId } from '@/lib/folderStorage';

export default function FileNameSetting() {
  const [fileName, setFileName] = useState(DEFAULT_FILE_NAME);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(DEFAULT_FILE_NAME);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const saved = getSavedFileName();
    setFileName(saved);
    setDraft(saved);
  }, []);

  async function commit() {
    const next = draft.trim() || DEFAULT_FILE_NAME;

    if (next === fileName) {
      setEditing(false);
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const folderId = getSavedFolderId();
      const response = await fetch('/api/file-name', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderId, currentFileName: fileName, newFileName: next }),
      });

      if (!response.ok) throw new Error('파일명 변경에 실패했습니다.');

      saveFileName(next);
      setFileName(next);
      setDraft(next);
      setEditing(false);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : '파일명 변경에 실패했습니다.');
      setDraft(fileName);
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <div className="flex flex-col gap-1">
        <input
          autoFocus
          disabled={saving}
          className="border-b border-indigo-500 bg-transparent text-[14px] font-medium text-gray-800 outline-none disabled:opacity-60"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit();
          }}
        />
        {error ? <span className="text-[11px] text-red-500">{error}</span> : null}
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between">
      <div className="flex flex-col gap-0.5">
        <span className="text-[11px] text-gray-400">파일명</span>
        <span className="text-[14px] font-medium text-gray-800">{fileName}</span>
      </div>
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="text-[13px] font-semibold text-indigo-600"
      >
        변경
      </button>
    </div>
  );
}
