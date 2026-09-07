'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import type { ExpenseInput } from '@/lib/expense';
import { getSavedFolderId } from '@/lib/folderStorage';

import { getSavedFileName } from '@/lib/fileNameStorage';

type ExpenseFormProps = {
  onSubmitted: (month: string) => void | Promise<void>;
  editingRowNumber?: number;
  originalMonth?: string;
  editFolderId?: string | null;
  editFileName?: string;
  onCancelEdit?: () => void;
  onSubmittingChange?: (submitting: boolean) => void;
  onEditError?: () => Promise<void>;
  onSuccess?: (message: string) => void;
  initialValues?: Partial<ExpenseInput>;
};

const categories = [
  '식비', '카페', '교통', '쇼핑', '구독서비스', '의료', '선물', '문화생활', '기타',
];
const payments = ['체크카드', '신용카드', '현금', '계좌이체'];
const fieldClassName =
  'bg-transparent border-0 border-b border-gray-200 focus:border-indigo-500 outline-none text-[14px] py-1.5 text-gray-800';

export default function ExpenseForm({
  onSubmitted,
  onSuccess,
  initialValues = {},
  editingRowNumber,
  originalMonth,
  editFolderId,
  editFileName,
  onCancelEdit,
  onSubmittingChange,
  onEditError,
}: ExpenseFormProps) {
  const editing = editingRowNumber !== undefined;
  const submittingRef = useRef(false);
  const [date, setDate] = useState(initialValues.date ?? '');
  const [amount, setAmount] = useState(
    initialValues.amount === undefined ? '' : String(initialValues.amount)
  );
  const [category, setCategory] = useState(initialValues.category ?? '');
  const [memo, setMemo] = useState(initialValues.memo ?? '');
  const [method, setMethod] = useState(initialValues.method ?? '체크카드');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setDate(initialValues.date ?? '');
    setAmount(initialValues.amount === undefined ? '' : String(initialValues.amount));
    setCategory(initialValues.category ?? '');
    setMemo(initialValues.memo ?? '');
    setMethod(initialValues.method ?? '체크카드');
  }, [
    initialValues.date,
    initialValues.amount,
    initialValues.category,
    initialValues.memo,
    initialValues.method,
  ]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current) return;
    submittingRef.current = true;
    onSubmittingChange?.(true);
    setError(null);
    setSubmitting(true);

    try {
      // Editing targets the exact file the edited row was read from (passed down by
      // the dashboard), not whatever the storage-location picker currently says —
      // those can drift apart since that picker doesn't share state with this form.
      const folderId = editing ? (editFolderId ?? getSavedFolderId()) : getSavedFolderId();
      const fileName = editing ? (editFileName ?? getSavedFileName()) : getSavedFileName();
      const response = await fetch('/api/expenses', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date, amount: Number(amount), category, memo, method, folderId, fileName,
          ...(editing ? { month: originalMonth, rowNumber: editingRowNumber } : {}),
        }),
      });

      if (!response.ok) throw new Error('지출 저장에 실패했습니다.');

      await onSubmitted(date.slice(0, 7));
      onSuccess?.(editing ? '수정했습니다' : '저장했습니다');
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : '지출 저장에 실패했습니다.');
      if (editing) await onEditError?.();
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
      onSubmittingChange?.(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4">
        <label className="flex flex-col gap-1 text-[11px] text-gray-400">
          날짜
          <input className={fieldClassName} type="date" value={date} onChange={(event) => setDate(event.target.value)} required />
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-gray-400">
          금액
          <input className={fieldClassName} type="number" min="0.01" step="any" placeholder="0" value={amount} onChange={(event) => setAmount(event.target.value)} required />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-[11px] text-gray-400">
        카테고리
        <input className={fieldClassName} type="text" list="expense-category-options" placeholder="예: 식비" value={category} onChange={(event) => setCategory(event.target.value)} required />
        <datalist id="expense-category-options">
          {categories.map((item) => <option key={item} value={item} />)}
        </datalist>
      </label>
      <label className="flex flex-col gap-1 text-[11px] text-gray-400">
        메모
        <input className={fieldClassName} type="text" placeholder="예: 스타벅스 아메리카노" value={memo} onChange={(event) => setMemo(event.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-[11px] text-gray-400">
        결제수단
        <select className={`${fieldClassName} appearance-none leading-normal pr-8 bg-no-repeat bg-[length:16px_16px] bg-[position:right_0.375rem_center] bg-[url("data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2024%2024'%20fill='none'%20stroke='%239ca3af'%20stroke-width='2'%20stroke-linecap='round'%20stroke-linejoin='round'%3E%3Cpath%20d='m6%209%206%206%206-6'/%3E%3C/svg%3E")]`} value={method} onChange={(event) => setMethod(event.target.value)} required>
          {method && !payments.includes(method) ? <option value={method}>{method}</option> : null}
          {payments.map((payment) => <option key={payment} value={payment}>{payment}</option>)}
        </select>
      </label>
      {error ? <p role="alert" className="text-[12px] text-red-500">{error}</p> : null}
      <button type="submit" disabled={submitting} className="mt-1 w-full rounded-full bg-indigo-600 py-3 text-[14px] font-semibold text-white active:bg-indigo-700 disabled:opacity-60">
        {submitting ? '저장 중...' : editing ? '수정 완료' : '저장'}
      </button>
      {editing ? (
        <button type="button" disabled={submitting} onClick={onCancelEdit} className="text-[13px] font-semibold text-indigo-600 disabled:text-gray-300">
          취소
        </button>
      ) : null}
    </form>
  );
}
