'use client';

import { FormEvent, useEffect, useState } from 'react';
import type { ExpenseInput } from '@/lib/expense';
import { getSavedFolderId } from '@/lib/folderStorage';

type ExpenseFormProps = {
  onSubmitted: () => void;
  initialValues?: Partial<ExpenseInput>;
};

export default function ExpenseForm({ onSubmitted, initialValues = {} }: ExpenseFormProps) {
  const [date, setDate] = useState(initialValues.date ?? '');
  const [amount, setAmount] = useState(
    initialValues.amount === undefined ? '' : String(initialValues.amount)
  );
  const [category, setCategory] = useState(initialValues.category ?? '');
  const [memo, setMemo] = useState(initialValues.memo ?? '');
  const [method, setMethod] = useState(initialValues.method ?? '');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setDate(initialValues.date ?? '');
    setAmount(initialValues.amount === undefined ? '' : String(initialValues.amount));
    setCategory(initialValues.category ?? '');
    setMemo(initialValues.memo ?? '');
    setMethod(initialValues.method ?? '');
  }, [
    initialValues.date,
    initialValues.amount,
    initialValues.category,
    initialValues.memo,
    initialValues.method,
  ]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const folderId = getSavedFolderId();
      const response = await fetch('/api/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date,
          amount: Number(amount),
          category,
          memo,
          method,
          folderId,
        }),
      });

      if (!response.ok) {
        throw new Error('지출 저장에 실패했습니다.');
      }

      onSubmitted();
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : '지출 저장에 실패했습니다.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex w-full max-w-md flex-col gap-3">
      <label className="flex flex-col gap-1">
        날짜
        <input type="date" value={date} onChange={(event) => setDate(event.target.value)} required />
      </label>
      <label className="flex flex-col gap-1">
        금액
        <input
          type="number"
          min="0.01"
          step="any"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          required
        />
      </label>
      <label className="flex flex-col gap-1">
        카테고리
        <input
          type="text"
          list="expense-category-options"
          value={category}
          onChange={(event) => setCategory(event.target.value)}
          required
        />
        <datalist id="expense-category-options">
          <option value="식비" />
          <option value="교통" />
          <option value="쇼핑" />
          <option value="주거" />
          <option value="기타" />
        </datalist>
      </label>
      <label className="flex flex-col gap-1">
        메모
        <input type="text" value={memo} onChange={(event) => setMemo(event.target.value)} />
      </label>
      <label className="flex flex-col gap-1">
        결제 수단
        <input
          type="text"
          value={method}
          onChange={(event) => setMethod(event.target.value)}
          required
        />
      </label>
      {error ? <p role="alert">{error}</p> : null}
      <button type="submit" disabled={submitting}>
        {submitting ? '저장 중...' : '지출 저장'}
      </button>
    </form>
  );
}
