import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ExpenseDashboard from './ExpenseDashboard';

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
