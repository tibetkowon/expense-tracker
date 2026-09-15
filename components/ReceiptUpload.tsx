'use client';

import { useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import type { ReceiptExtraction } from '@/lib/ocr';

type ReceiptUploadProps = {
  onExtracted: (data: ReceiptExtraction) => void;
};

function readImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('영수증 사진을 읽지 못했습니다.'));
      }
    };
    reader.onerror = () => reject(new Error('영수증 사진을 읽지 못했습니다.'));
    reader.onabort = () => reject(new Error('영수증 사진 읽기가 취소되었습니다.'));
    reader.readAsDataURL(file);
  });
}

export function ReceiptUpload({ onExtracted }: ReceiptUploadProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  async function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file || inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    setError(null);

    try {
      const imageBase64 = await readImage(file);
      const response = await fetch('/api/ocr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64 }),
      });
      if (!response.ok) throw new Error('영수증 인식에 실패했습니다.');
      const data = (await response.json()) as ReceiptExtraction;
      onExtracted(data);
    } catch {
      setError('영수증 인식에 실패했습니다. 사진을 확인하고 다시 시도해 주세요.');
    } finally {
      input.value = '';
      inFlight.current = false;
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 px-5 pt-5">
      <label htmlFor="receipt-input" className="text-[11px] text-gray-400">영수증 사진</label>
      <input
        id="receipt-input"
        type="file"
        accept="image/*"
        disabled={loading}
        onChange={handleChange}
        className="w-full text-[12px] text-gray-600 file:mr-3 file:rounded-full file:border-0 file:bg-indigo-50 file:px-4 file:py-2 file:text-[13px] file:font-semibold file:text-indigo-600 disabled:opacity-60"
      />
      {loading ? <p role="status" className="text-[12px] text-indigo-600">영수증 인식 중...</p> : null}
      {error ? <p role="alert" className="text-[12px] text-red-500">{error}</p> : null}
      <p className="text-[11px] text-gray-400">인식된 내용을 확인하고 저장 버튼을 눌러 주세요.</p>
    </div>
  );
}
