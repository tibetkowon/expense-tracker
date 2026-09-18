'use client';

import { useRef, useState } from 'react';
import { getSavedFolderId } from '@/lib/folderStorage';
import { getSavedFileName } from '@/lib/fileNameStorage';

type ShortcutLinkButtonProps = {
  showToast: (message: string) => void;
};

export default function ShortcutLinkButton({ showToast }: ShortcutLinkButtonProps) {
  const [loading, setLoading] = useState(false);
  const linking = useRef(false);

  async function linkSheet() {
    if (linking.current) return;
    linking.current = true;
    setLoading(true);

    try {
      const response = await fetch('/api/shortcuts/link-sheet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folderId: getSavedFolderId(),
          fileName: getSavedFileName(),
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(
          typeof body?.error === 'string' && body.error.trim()
            ? body.error
            : '단축어 연동에 실패했습니다.'
        );
      }
      showToast('단축어 연동이 켜졌습니다');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '단축어 연동에 실패했습니다.');
    } finally {
      linking.current = false;
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
      <div className="flex flex-col gap-0.5">
        <span className="text-[11px] text-gray-400">단축어</span>
        <span className="text-[14px] font-medium text-gray-800">결제 알림 연동</span>
      </div>
      <button
        type="button"
        disabled={loading}
        onClick={() => void linkSheet()}
        className="text-[13px] font-semibold text-indigo-600 disabled:text-gray-300"
      >
        {loading ? '연동 중...' : '단축어 연동 켜기'}
      </button>
    </div>
  );
}
