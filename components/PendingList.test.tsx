import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PendingRowWithNumber } from '@/lib/pending';
import PendingList from './PendingList';

const item: PendingRowWithNumber = {
  rowNumber: 2, date: '2026-09-18', amount: 4500, category: '카페',
  memo: '커피', method: '신한카드', type: '결제', rawText: '신한카드 커피 4,500원 승인',
};

afterEach(cleanup);

describe('확인 대기 목록', () => {
  it('빈 목록은 섹션을 렌더링하지 않습니다', () => {
    const { container } = render(<PendingList items={[]} onConfirmPayment={vi.fn()} onDismiss={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('결제 요약과 원문을 표시하고 확인 시 해당 항목을 전달합니다', () => {
    const onConfirmPayment = vi.fn();
    const onDismiss = vi.fn();
    render(<PendingList items={[item]} onConfirmPayment={onConfirmPayment} onDismiss={onDismiss} />);
    expect(screen.getByRole('heading', { name: '확인 대기 (1)' })).toBeInTheDocument();
    expect(screen.getByText('2026-09-18 · 카페 · 결제')).toBeInTheDocument();
    expect(screen.getByText('커피')).toBeInTheDocument();
    expect(screen.getByText('4,500원')).toBeInTheDocument();
    expect(screen.getByText(item.rawText)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '확인' }));

    expect(onConfirmPayment).toHaveBeenCalledWith(item);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('결제 무시 시 해당 항목을 삭제 콜백으로 전달합니다', () => {
    const onConfirmPayment = vi.fn();
    const onDismiss = vi.fn();
    render(<PendingList items={[item]} onConfirmPayment={onConfirmPayment} onDismiss={onDismiss} />);

    fireEvent.click(screen.getByRole('button', { name: '무시' }));

    expect(onDismiss).toHaveBeenCalledWith(item);
    expect(onConfirmPayment).not.toHaveBeenCalled();
  });

  it('취소 항목은 안내와 확인 버튼만 제공하고 폼을 열지 않습니다', () => {
    const cancellation: PendingRowWithNumber = { ...item, type: '취소' };
    const onConfirmPayment = vi.fn();
    const onDismiss = vi.fn();
    render(<PendingList items={[cancellation]} onConfirmPayment={onConfirmPayment} onDismiss={onDismiss} />);
    expect(screen.getByText('이 거래를 지출 목록에서 찾아 삭제해 주세요')).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: '확인' }));

    expect(onDismiss).toHaveBeenCalledWith(cancellation);
    expect(onConfirmPayment).not.toHaveBeenCalled();
  });
});
