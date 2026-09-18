'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ExpenseRowWithNumber } from '@/lib/sheets';
import type { ExpenseInput } from '@/lib/expense';
import type { PendingRowWithNumber } from '@/lib/pending';
import PendingList from '@/components/PendingList';
import type { ReceiptExtraction } from '@/lib/ocr';
import { ReceiptUpload } from '@/components/ReceiptUpload';
import { getSavedFolderId } from '@/lib/folderStorage';
import { DEFAULT_FILE_NAME, getSavedFileName } from '@/lib/fileNameStorage';
import ExpenseForm from '@/components/ExpenseForm';
import ExpenseList from '@/components/ExpenseList';
import MonthlySummary from '@/components/MonthlySummary';
import MonthSelector from '@/components/MonthSelector';
import Toast from '@/components/Toast';
import ShortcutLinkButton from '@/components/ShortcutLinkButton';

type ExpensesResponse = {
  expenses: ExpenseRowWithNumber[];
  monthlyTotal: number;
  availableMonths: string[];
  paymentMethods: string[];
  selectedMonth: string;
};

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

export default function ExpenseDashboard() {
  const [expenses, setExpenses] = useState<ExpenseRowWithNumber[]>([]);
  // The folderId/fileName that produced the currently-displayed `expenses`, captured
  // at fetch time. Edit/delete must target this, not a fresh localStorage read — the
  // storage-location picker is a sibling component with no shared state, so it can
  // change without this dashboard refetching, and a live read could silently mutate
  // the wrong file's row.
  const [dataSource, setDataSource] = useState<{ folderId: string | null; fileName: string }>({
    folderId: null,
    fileName: DEFAULT_FILE_NAME,
  });
  const [editingExpense, setEditingExpense] = useState<(ExpenseRowWithNumber & { month: string }) | null>(null);
  const [pendingItems, setPendingItems] = useState<PendingRowWithNumber[]>([]);
  const [confirmingPending, setConfirmingPending] = useState<PendingRowWithNumber | null>(null);
  const [draftValues, setDraftValues] = useState<ReceiptExtraction | null>(null);
  const [ocrGeneration, setOcrGeneration] = useState(0);
  const latestOcrGeneration = useRef(0);

  function clearReceiptDraft() {
    setOcrGeneration(++latestOcrGeneration.current);
    setDraftValues(null);
  }

  const confirmingPendingAsPartialExpenseInput: Partial<ExpenseInput> | null = confirmingPending
    ? {
        date: confirmingPending.date || undefined,
        amount: confirmingPending.amount || undefined,
        category: confirmingPending.category || undefined,
        memo: confirmingPending.memo || undefined,
        method: confirmingPending.method || undefined,
      }
    : null;
  const draftValuesAsPartialExpenseInput: Partial<ExpenseInput> | null = draftValues
    ? {
        ...(draftValues.date !== null ? { date: draftValues.date } : {}),
        ...(draftValues.amount !== null ? { amount: draftValues.amount } : {}),
        ...(draftValues.categoryGuess !== null ? { category: draftValues.categoryGuess } : {}),
        ...(draftValues.merchant !== null ? { memo: draftValues.merchant } : {}),
      }
    : null;
  const [mutating, setMutating] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const deleting = useRef(false);
  const formSection = useRef<HTMLElement>(null);
  const [monthlyTotal, setMonthlyTotal] = useState(0);
  const [availableMonths, setAvailableMonths] = useState<string[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<string[]>([
    '체크카드', '신용카드', '현금', '계좌이체',
  ]);
  const [selectedMonth, setSelectedMonth] = useState(currentMonth());
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestRequestId = useRef(0);
  const latestPendingRequestId = useRef(0);

  const fetchMonth = useCallback(async (month?: string) => {
    const requestId = ++latestRequestId.current;
    setLoading(true);
    setLoadError(null);
    setEditingExpense(null);
    // 재조회 실패 시에도 이전 행 번호로 수정하거나 삭제하지 않습니다.
    setExpenses([]);
    const folderId = getSavedFolderId();
    const fileName = getSavedFileName();
    const params = new URLSearchParams();
    if (folderId) params.set('folderId', folderId);
    params.set('fileName', fileName);
    if (month) params.set('month', month);

    try {
      const response = await fetch(`/api/expenses?${params.toString()}`);
      if (requestId !== latestRequestId.current) return;
      if (!response.ok) throw new Error('지출 내역을 불러오지 못했습니다.');

      const data = (await response.json()) as ExpensesResponse;
      if (requestId !== latestRequestId.current) return;

      setExpenses(data.expenses);
      setDataSource({ folderId, fileName });
      setMonthlyTotal(data.monthlyTotal);
      setAvailableMonths(data.availableMonths);
      setPaymentMethods(data.paymentMethods);
      setSelectedMonth(data.selectedMonth);
    } catch {
      if (requestId === latestRequestId.current) {
        setLoadError('지출 내역을 불러오지 못했습니다. 다시 시도해 주세요.');
      }
    } finally {
      if (requestId === latestRequestId.current) setLoading(false);
    }
  }, []);

  const fetchPending = useCallback(async () => {
    const requestId = ++latestPendingRequestId.current;
    // 대기 행 삭제 후에는 뒤쪽 행 번호도 바뀌므로 선택을 함께 초기화합니다.
    setConfirmingPending(null);
    setPendingItems([]);
    const folderId = getSavedFolderId();
    const fileName = getSavedFileName();
    const params = new URLSearchParams();
    if (folderId) params.set('folderId', folderId);
    params.set('fileName', fileName);

    try {
      const response = await fetch(`/api/pending?${params.toString()}`);
      if (!response.ok) return;
      const data = (await response.json()) as { items: PendingRowWithNumber[] };
      if (requestId !== latestPendingRequestId.current) return;
      setPendingItems(data.items);
    } catch {
      // 조회 실패 시 확인 대기 섹션을 비워 둡니다.
    }
  }, []);

  const showToast = useCallback((message: string) => {
    setToastMessage(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMessage(null), 1800);
  }, []);

  async function handleDelete(expense: ExpenseRowWithNumber) {
    if (deleting.current || mutating || loading) return;
    deleting.current = true;
    setMutating(true);
    setEditingExpense(null);
    try {
      const response = await fetch('/api/expenses', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folderId: dataSource.folderId,
          fileName: dataSource.fileName,
          month: selectedMonth,
          rowNumber: expense.rowNumber,
        }),
      });
      if (!response.ok) throw new Error('지출 삭제에 실패했습니다.');
      showToast('삭제했습니다');
    } catch {
      showToast('지출 삭제에 실패했습니다.');
    } finally {
      await fetchMonth(selectedMonth);
      deleting.current = false;
      setMutating(false);
    }
  }

  useEffect(() => { void fetchMonth(); void fetchPending(); }, [fetchMonth, fetchPending]);
  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  return (
    <>
      <ShortcutLinkButton showToast={showToast} />
      <fieldset disabled={mutating || loading} className="min-w-0">
        <div className="flex items-center justify-between px-5 pt-4">
          <MonthSelector
            months={availableMonths}
            selected={selectedMonth}
            onChange={(month) => void fetchMonth(month)}
          />
        </div>
        <MonthlySummary total={monthlyTotal} month={selectedMonth} />
        <PendingList
          items={pendingItems}
          onConfirmPayment={(item) => {
            if (item.type !== '결제') return;
            setEditingExpense(null);
            clearReceiptDraft();
            setConfirmingPending(item);
            formSection.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }}
          onDismiss={async (item) => {
            if (deleting.current || mutating || loading) return;
            deleting.current = true;
            setMutating(true);
            try {
              const response = await fetch('/api/pending', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  folderId: dataSource.folderId,
                  fileName: dataSource.fileName,
                  rowNumber: item.rowNumber,
                }),
              });
              if (!response.ok) throw new Error('대기 항목 삭제에 실패했습니다.');
              if (confirmingPending?.rowNumber === item.rowNumber) setConfirmingPending(null);
            } catch {
              showToast('대기 항목 삭제에 실패했습니다.');
            } finally {
              await fetchPending();
              deleting.current = false;
              setMutating(false);
            }
          }}
        />
        <ReceiptUpload onExtracted={(data) => {
          // 사진 선택 시 전달된 콜백의 세대를 확인해 초기화 이전 응답을 무시합니다.
          if (ocrGeneration !== latestOcrGeneration.current) return;
          setConfirmingPending(null);
          setDraftValues(data);
        }} />
        <section ref={formSection} className="border-b border-gray-100 px-5 py-6">
          <h2 className="mb-4 text-[13px] font-semibold text-gray-800">{editingExpense ? '지출 수정' : '지출 입력'}</h2>
          <ExpenseForm
            key={editingExpense ? `edit-${editingExpense.month}-${editingExpense.rowNumber}` : confirmingPending ? `confirm-${confirmingPending.rowNumber}` : 'new'}
            paymentMethods={paymentMethods}
            initialValues={editingExpense ?? confirmingPendingAsPartialExpenseInput ?? draftValuesAsPartialExpenseInput ?? undefined}
            editingRowNumber={editingExpense?.rowNumber}
            originalMonth={editingExpense?.month}
            editFolderId={dataSource.folderId}
            editFileName={dataSource.fileName}
            onCancelEdit={() => setEditingExpense(null)}
            confirmingPendingRowNumber={confirmingPending?.rowNumber}
            confirmFolderId={dataSource.folderId}
            confirmFileName={dataSource.fileName}
            onCancelConfirm={() => setConfirmingPending(null)}
            onSubmittingChange={setMutating}
            onSubmitted={async (month) => {
              clearReceiptDraft();
              setConfirmingPending(null);
              await fetchMonth(month);
              await fetchPending();
            }}
            onEditError={async () => {
              showToast('수정에 실패했습니다. 내역을 다시 확인해 주세요.');
              await fetchMonth(selectedMonth);
            }}
            onSuccess={showToast}
          />
        </section>
        <ExpenseList
          expenses={expenses}
          onEdit={(expense) => {
            clearReceiptDraft();
            setConfirmingPending(null);
            setEditingExpense({ ...expense, month: selectedMonth });
            formSection.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }}
          onDelete={handleDelete}
        />
      </fieldset>
      {loadError ? (
        <div className="px-5 pb-4">
          <p role="alert" className="text-[12px] text-red-500">{loadError}</p>
          <button type="button" disabled={mutating || loading} onClick={() => void fetchMonth(selectedMonth)} className="text-[13px] font-semibold text-indigo-600 disabled:text-gray-300">
            다시 시도
          </button>
        </div>
      ) : null}
      <Toast message={toastMessage} />
    </>
  );
}
