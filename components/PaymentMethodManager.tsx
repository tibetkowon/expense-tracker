'use client';

import { useState } from 'react';
import { getSavedFolderId } from '@/lib/folderStorage';
import { getSavedFileName } from '@/lib/fileNameStorage';
import { parseAliases, type PaymentMethodEntry } from '@/lib/paymentMethodAliases';

type Source = { folderId: string | null; fileName: string };
export default function PaymentMethodManager({ onChanged }: { onChanged: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<PaymentMethodEntry[]>([]);
  const [source, setSource] = useState<Source | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [originalName, setOriginalName] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [aliases, setAliases] = useState('');

  async function load(location: Source) {
    const params = new URLSearchParams({ fileName: location.fileName });
    if (location.folderId) params.set('folderId', location.folderId);
    const response = await fetch(`/api/payment-methods?${params}`);
    if (!response.ok) throw new Error('결제수단을 불러오지 못했습니다.');
    const data = await response.json();
    setEntries(data.entries);
    setSource(location);
  }
  async function toggle() {
    if (open) { setOpen(false); return; }
    setOpen(true); setBusy(true); setMessage(''); setSource(null); setEntries([]);
    setOriginalName(null); setName(''); setAliases('');
    try { await load({ folderId: getSavedFolderId(), fileName: getSavedFileName() }); }
    catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  }
  async function save(method: 'POST' | 'PATCH' | 'DELETE', target?: string) {
    if (!source || busy) return;
    if (method === 'DELETE' && !window.confirm('결제수단을 삭제할까요? 기존 지출 기록은 그대로 유지됩니다.')) return;
    setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/payment-methods', {
        method, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...source, name: target ?? name.trim(), ...(method === 'PATCH' ? { originalName } : {}), aliases: parseAliases(aliases) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? '저장에 실패했습니다.');
      setOriginalName(null); setName(''); setAliases('');
      setMessage(method === 'PATCH' ? `${data.replacedCount}건의 기록도 함께 수정했어요` : method === 'DELETE' ? '삭제했습니다' : '추가했습니다');
      await load(source);
      await onChanged();
    } catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  }
  return <section className="border-b border-gray-100 px-5 py-4">
    <button type="button" aria-expanded={open} onClick={() => void toggle()} disabled={busy} className="text-[13px] font-semibold">결제수단 관리 {open ? '▴' : '▾'}</button>
    {open && <div className="mt-3 text-sm">
      {busy && <p>불러오는 중…</p>}
      <fieldset disabled={busy || !source}>
        <ul>{entries.map((entry) => <li key={entry.name} className="mb-3 break-words">
          <span>{entry.name} · {entry.aliases.join(', ') || '알림 표기 없음'}</span>
          <button type="button" className="ml-3 text-indigo-600" aria-label={`${entry.name} 수정`} onClick={() => { setOriginalName(entry.name); setName(entry.name); setAliases(entry.aliases.join(', ')); }}>수정</button>
          <button type="button" className="ml-3 text-indigo-600" aria-label={`${entry.name} 삭제`} onClick={() => void save('DELETE', entry.name)}>삭제</button>
        </li>)}</ul>
        <form className="flex flex-col gap-2" onSubmit={(event) => { event.preventDefault(); void save(originalName === null ? 'POST' : 'PATCH'); }}>
          <label>결제수단 이름<input required value={name} onChange={(event) => setName(event.target.value)} className="ml-2 border-b" /></label>
          <label>알림 표기 (쉼표 구분)<input value={aliases} onChange={(event) => setAliases(event.target.value)} className="ml-2 border-b" /></label>
          <button type="submit" disabled={!name.trim()} className="text-indigo-600">{originalName === null ? '추가' : '수정 저장'}</button>
          {originalName !== null && <button type="button" onClick={() => { setOriginalName(null); setName(''); setAliases(''); }}>수정 취소</button>}
        </form>
      </fieldset>
      {message && <p role="status" className="mt-2">{message}</p>}
    </div>}
  </section>;
}
