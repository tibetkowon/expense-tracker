import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ExpenseForm from './ExpenseForm';

vi.mock('@/lib/folderStorage', () => ({
  getSavedFolderId: () => null,
}));
vi.mock('@/lib/fileNameStorage', () => ({
  getSavedFileName: () => 'expense-tracker',
}));

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('날짜 기본값', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 2, 0, 30));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('새 지출의 날짜를 로컬 기준 오늘 날짜로 채웁니다', () => {
    render(<ExpenseForm paymentMethods={[]} onSubmitted={vi.fn()} />);

    expect(screen.getByLabelText('날짜')).toHaveValue('2026-01-02');
  });

  it('UTC 날짜와 다른 한국 자정 직후에도 로컬 날짜를 사용합니다', () => {
    vi.setSystemTime(new Date('2026-01-01T15:30:00Z'));
    // 실행 환경의 타임존과 무관하게 KST의 로컬 날짜 값을 재현합니다.
    vi.spyOn(Date.prototype, 'getFullYear').mockReturnValue(2026);
    vi.spyOn(Date.prototype, 'getMonth').mockReturnValue(0);
    vi.spyOn(Date.prototype, 'getDate').mockReturnValue(2);

    render(<ExpenseForm paymentMethods={[]} onSubmitted={vi.fn()} />);

    expect(screen.getByLabelText('날짜')).toHaveValue('2026-01-02');
  });

  it('수정 시 원래 날짜를 유지하고 새 입력으로 전환하면 오늘 날짜를 채웁니다', () => {
    const onSubmitted = vi.fn();
    const { rerender } = render(
      <ExpenseForm
        paymentMethods={[]}
        onSubmitted={onSubmitted}
        editingRowNumber={2}
        originalMonth="2025-12"
        initialValues={{ date: '2025-12-25' }}
      />
    );

    expect(screen.getByLabelText('날짜')).toHaveValue('2025-12-25');

    rerender(<ExpenseForm paymentMethods={[]} onSubmitted={onSubmitted} />);

    expect(screen.getByLabelText('날짜')).toHaveValue('2026-01-02');
  });
});

describe('결제수단 자동완성', () => {
  it('전달받은 결제수단을 순서대로 자동완성 옵션에 표시합니다', () => {
    const paymentMethods = ['삼성카드', '현금', '신한카드'];
    render(<ExpenseForm paymentMethods={paymentMethods} onSubmitted={vi.fn()} />);

    const input = screen.getByRole('combobox', { name: '결제수단' }) as HTMLInputElement;
    expect(input.tagName).toBe('INPUT');
    expect(input).toHaveAttribute('list', 'expense-payment-method-options');
    expect(input.list).not.toBeNull();
    expect(Array.from(input.list!.options, (option) => option.value)).toEqual(paymentMethods);
  });

  it('목록에 없는 결제수단을 직접 입력하여 저장할 수 있습니다', async () => {
    fetchMock.mockResolvedValue({ ok: true });
    const onSubmitted = vi.fn();
    render(
      <ExpenseForm
        paymentMethods={['현금']}
        onSubmitted={onSubmitted}
        initialValues={{ date: '2026-09-08', amount: 5000, category: '식비' }}
      />
    );

    const input = screen.getByRole('combobox', { name: '결제수단' }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '새로운카드' } });
    expect(input).toHaveValue('새로운카드');
    expect(input.checkValidity()).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() => expect(onSubmitted).toHaveBeenCalledWith('2026-09'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/expenses', expect.objectContaining({
      method: 'POST',
    }));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      date: '2026-09-08',
      amount: 5000,
      method: '새로운카드',
    });
  });
});
