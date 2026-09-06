'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ExpenseRow } from '@/lib/sheets';
import { getSavedFolderId } from '@/lib/folderStorage';
import { getSavedFileName } from '@/lib/fileNameStorage';
import ExpenseForm from '@/components/ExpenseForm';
import ExpenseList from '@/components/ExpenseList';
import MonthlySummary from '@/components/MonthlySummary';
import MonthSelector from '@/components/MonthSelector';
import Toast from '@/components/Toast';

type ExpensesResponse = {
  expenses: ExpenseRow[];
  monthlyTotal: number;
  availableMonths: string[];
  selectedMonth: string;
};

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

export default function ExpenseDashboard() {
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [monthlyTotal, setMonthlyTotal] = useState(0);
  const [availableMonths, setAvailableMonths] = useState<string[]>([]);
  const [selectedMonth, setSelectedMonth] = useState(currentMonth());
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestRequestId = useRef(0);

  const fetchMonth = useCallback(async (month?: string) => {
    const requestId = ++latestRequestId.current;
    const folderId = getSavedFolderId();
    const fileName = getSavedFileName();
    const params = new URLSearchParams();
    if (folderId) params.set('folderId', folderId);
    params.set('fileName', fileName);
    if (month) params.set('month', month);

    const response = await fetch(`/api/expenses?${params.toString()}`);
    if (requestId !== latestRequestId.current || !response.ok) return;

    const data = (await response.json()) as ExpensesResponse;
    if (requestId !== latestRequestId.current) return;

    setExpenses(data.expenses);
    setMonthlyTotal(data.monthlyTotal);
    setAvailableMonths(data.availableMonths);
    setSelectedMonth(data.selectedMonth);
  }, []);

  const showToast = useCallback((message: string) => {
    setToastMessage(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMessage(null), 1800);
  }, []);

  useEffect(() => { void fetchMonth(); }, [fetchMonth]);
  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  return (
    <>
      <div className="flex items-center justify-between px-5 pt-4">
        <MonthSelector
          months={availableMonths}
          selected={selectedMonth}
          onChange={(month) => void fetchMonth(month)}
        />
      </div>
      <MonthlySummary total={monthlyTotal} month={selectedMonth} />
      <section className="border-b border-gray-100 px-5 py-6">
        <h2 className="mb-4 text-[13px] font-semibold text-gray-800">지출 입력</h2>
        <ExpenseForm onSubmitted={(month) => void fetchMonth(month)} onSuccess={showToast} />
      </section>
      <ExpenseList expenses={expenses} />
      <Toast message={toastMessage} />
    </>
  );
}
