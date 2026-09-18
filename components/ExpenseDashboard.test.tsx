import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ExpenseDashboard from './ExpenseDashboard';
import type { PendingRowWithNumber } from '@/lib/pending';

vi.mock('@/lib/folderStorage', () => ({
  getSavedFolderId: () => null,
}));
vi.mock('@/lib/fileNameStorage', () => ({
  DEFAULT_FILE_NAME: 'expense-tracker',
  getSavedFileName: () => 'expense-tracker',
}));

const fetchMock = vi.fn();
const extraction = {
  date: '2026-09-01',
  amount: 8500,
  merchant: '이전 영수증',
  categoryGuess: '카페',
};
const expensesResponse = {
  expenses: [{
    rowNumber: 2,
    date: '2026-09-02',
    amount: 3000,
    category: '교통',
    memo: '기존 지출',
    method: '현금',
  }],
  monthlyTotal: 3000,
  availableMonths: ['2026-09'],
  paymentMethods: ['현금', '체크카드'],
  selectedMonth: '2026-09',
};

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('대시보드 OCR 요청 무효화', () => {
  it.each(['편집 시작', '저장 성공'] as const)(
    '%s 후 늦게 도착한 OCR 결과를 무시하고 새 사진은 반영합니다',
    async (flow) => {
      let resolveOcr!: (response: Response) => void;
      const pendingOcr = new Promise<Response>((resolve) => {
        resolveOcr = resolve;
      });
      fetchMock.mockImplementation((url: string, options?: RequestInit) => {
        if (url === '/api/ocr') return pendingOcr;
        if (url.startsWith('/api/pending?')) return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
        if (options?.method === 'POST') return Promise.resolve({ ok: true });
        return Promise.resolve({ ok: true, json: async () => expensesResponse });
      });
      render(<ExpenseDashboard />);
      await waitFor(() => expect(screen.getByRole('button', { name: '수정' })).toBeEnabled());
      const upload = screen.getByLabelText('영수증 사진');
      const file = new File(['receipt'], 'receipt.jpg', { type: 'image/jpeg' });
      fireEvent.change(upload, { target: { files: [file] } });
      await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
        '/api/ocr', expect.objectContaining({ method: 'POST' }),
      ));

      if (flow === '편집 시작') {
        const section = screen.getByRole('heading', { name: '지출 입력' }).parentElement!;
        Object.defineProperty(section, 'scrollIntoView', { value: vi.fn(), configurable: true });
        fireEvent.click(screen.getByRole('button', { name: '수정' }));
        expect(screen.getByLabelText('메모')).toHaveValue('기존 지출');
      } else {
        fireEvent.change(screen.getByLabelText('금액'), { target: { value: '5000' } });
        fireEvent.change(screen.getByLabelText('카테고리'), { target: { value: '식비' } });
        fireEvent.change(screen.getByLabelText('메모'), { target: { value: '직접 입력' } });
        fireEvent.click(screen.getByRole('button', { name: '저장' }));
        await screen.findByText('저장했습니다');
        await waitFor(() => expect(screen.getByRole('button', { name: '저장' })).toBeEnabled());
      }

      await act(async () => {
        resolveOcr(new Response(JSON.stringify(extraction), { status: 200 }));
        await pendingOcr;
      });
      await waitFor(() => expect(upload).toBeEnabled());
      if (flow === '편집 시작') {
        expect(screen.getByLabelText('메모')).toHaveValue('기존 지출');
        fireEvent.click(screen.getByRole('button', { name: '취소' }));
        expect(screen.getByLabelText('메모')).toHaveValue('');
        expect(screen.getByLabelText('금액')).toHaveValue(null);
      } else {
        expect(screen.getByLabelText('메모')).toHaveValue('직접 입력');
        expect(screen.getByLabelText('금액')).toHaveValue(5000);
      }

      const newExtraction = { ...extraction, merchant: '새 영수증' };
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => newExtraction });
      fireEvent.change(upload, { target: { files: [file] } });
      await waitFor(() => expect(screen.getByLabelText('메모')).toHaveValue('새 영수증'));
      expect(screen.getByLabelText('금액')).toHaveValue(8500);
      const saves = fetchMock.mock.calls.filter(
        ([url, options]) => url === '/api/expenses' && options?.method === 'POST',
      );
      expect(saves).toHaveLength(flow === '저장 성공' ? 1 : 0);
      expect(screen.getByRole('button', { name: '저장' })).toBeEnabled();
    },
  );
});

describe('대시보드 확인 대기', () => {
  const pending: PendingRowWithNumber = {
    rowNumber: 3, date: '2026-09-18', amount: 4500, category: '카페',
    memo: '알림 커피', method: '신한카드', type: '결제', rawText: '신한카드 커피 4,500원 승인',
  };
  let items: PendingRowWithNumber[];

  beforeEach(() => {
    items = [pending];
    fetchMock.mockImplementation((url: string, options?: RequestInit) => {
      if (url.startsWith('/api/pending?')) {
        return Promise.resolve({ ok: true, json: async () => ({ items }) });
      }
      if (url === '/api/ocr') return Promise.resolve({ ok: true, json: async () => extraction });
      if (url === '/api/pending/confirm' || options?.method === 'DELETE') {
        items = [];
        return Promise.resolve({ ok: true });
      }
      if (options?.method === 'POST' || options?.method === 'PATCH') return Promise.resolve({ ok: true });
      return Promise.resolve({ ok: true, json: async () => expensesResponse });
    });
  });

  async function openPending() {
    render(<ExpenseDashboard />);
    await waitFor(() => expect(screen.getByRole('button', { name: '확인' })).toBeEnabled());
    const section = screen.getByRole('heading', { name: '지출 입력' }).parentElement!;
    Object.defineProperty(section, 'scrollIntoView', { value: vi.fn(), configurable: true });
    fireEvent.click(screen.getByRole('button', { name: '확인' }));
  }

  it('마운트 시 대기를 조회하고 확인한 값을 채운 뒤 저장 성공 시 다시 조회합니다', async () => {
    await openPending();
    expect(fetchMock).toHaveBeenCalledWith('/api/pending?fileName=expense-tracker');
    expect(screen.getByLabelText('날짜')).toHaveValue(pending.date);
    expect(screen.getByLabelText('금액')).toHaveValue(pending.amount);
    expect(screen.getByLabelText('카테고리')).toHaveValue(pending.category);
    expect(screen.getByLabelText('메모')).toHaveValue(pending.memo);
    expect(screen.getByLabelText('결제수단')).toHaveValue(pending.method);
    expect(fetchMock.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    await screen.findByText('저장했습니다');
    expect(fetchMock).toHaveBeenCalledWith('/api/pending/confirm', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        date: pending.date, amount: pending.amount, category: pending.category,
        memo: pending.memo, method: pending.method, folderId: null,
        fileName: 'expense-tracker', pendingRowNumber: pending.rowNumber,
      }),
    }));
    expect(fetchMock.mock.calls.filter(([url]) => url.startsWith('/api/pending?'))).toHaveLength(2);
    expect(screen.queryByRole('heading', { name: '확인 대기 (1)' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '취소' })).not.toBeInTheDocument();
  });

  it.each(['편집', '영수증'] as const)('%s 시작 시 확인 대기 모드를 해제합니다', async (flow) => {
    await openPending();
    if (flow === '편집') {
      fireEvent.click(screen.getByRole('button', { name: '수정' }));
      expect(screen.getByLabelText('메모')).toHaveValue('기존 지출');
      fireEvent.click(screen.getByRole('button', { name: '수정 완료' }));
    } else {
      const file = new File(['receipt'], 'receipt.jpg', { type: 'image/jpeg' });
      fireEvent.change(screen.getByLabelText('영수증 사진'), { target: { files: [file] } });
      await waitFor(() => expect(screen.getByLabelText('메모')).toHaveValue(extraction.merchant));
      expect(screen.queryByRole('button', { name: '취소' })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: '저장' }));
    }

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/expenses', expect.objectContaining({
      method: flow === '편집' ? 'PATCH' : 'POST',
    })));
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/pending/confirm')).toBe(false);
    await screen.findByText(flow === '편집' ? '수정했습니다' : '저장했습니다');
  });

  it('편집 중 대기 확인을 시작하면 수정 대신 대기 확인으로 저장합니다', async () => {
    await openPending();
    fireEvent.click(screen.getByRole('button', { name: '수정' }));
    fireEvent.click(screen.getByRole('button', { name: '확인' }));
    expect(screen.queryByRole('button', { name: '수정 완료' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('메모')).toHaveValue(pending.memo);
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    await screen.findByText('저장했습니다');
    expect(fetchMock).toHaveBeenCalledWith('/api/pending/confirm', expect.objectContaining({ method: 'POST' }));
  });

  it('무시하면 대기 행만 삭제하고 확인 중인 폼과 목록을 초기화합니다', async () => {
    await openPending();
    fireEvent.click(screen.getByRole('button', { name: '무시' }));

    await waitFor(() => expect(screen.queryByRole('button', { name: '무시' })).not.toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith('/api/pending', expect.objectContaining({
      method: 'DELETE',
      body: JSON.stringify({ folderId: null, fileName: 'expense-tracker', rowNumber: pending.rowNumber }),
    }));
    expect(screen.queryByRole('button', { name: '취소' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('메모')).toHaveValue('');
  });

  it('파싱되지 않은 금액과 텍스트를 빈 입력으로 표시합니다', async () => {
    items = [{ ...pending, amount: 0, category: '', memo: '' }];
    await openPending();
    expect(screen.getByLabelText('금액')).toHaveValue(null);
    expect(screen.getByLabelText('카테고리')).toHaveValue('');
    expect(screen.getByLabelText('메모')).toHaveValue('');
  });
});
