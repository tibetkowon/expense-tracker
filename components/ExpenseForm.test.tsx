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
