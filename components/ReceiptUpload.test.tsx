import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReceiptUpload } from './ReceiptUpload';

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ReceiptUpload', () => {
  it('사진을 base64로 전송하고 인식 결과를 전달합니다', async () => {
    const data = {
      date: '2026-09-01',
      amount: 8500,
      merchant: '스타벅스',
      categoryGuess: '카페',
    };
    const onExtracted = vi.fn();
    fetchMock.mockResolvedValue({ ok: true, json: async () => data });
    render(<ReceiptUpload onExtracted={onExtracted} />);

    const input = screen.getByLabelText('영수증 사진');
    fireEvent.change(input, {
      target: { files: [new File(['receipt'], 'receipt.jpg', { type: 'image/jpeg' })] },
    });

    expect(input).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('영수증 인식 중...');
    await waitFor(() => expect(onExtracted).toHaveBeenCalledWith(data));
    expect(onExtracted).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/ocr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64: 'data:image/jpeg;base64,cmVjZWlwdA==' }),
    });
    await waitFor(() => expect(input).toBeEnabled());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('요청 실패 시 오류를 표시하고 같은 사진으로 다시 시도할 수 있습니다', async () => {
    const onExtracted = vi.fn();
    fetchMock.mockResolvedValue({ ok: false });
    render(<ReceiptUpload onExtracted={onExtracted} />);
    const input = screen.getByLabelText('영수증 사진');
    const file = new File(['receipt'], 'receipt.jpg', { type: 'image/jpeg' });

    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByRole('alert')).toHaveTextContent('영수증 인식에 실패했습니다.');
    expect(onExtracted).not.toHaveBeenCalled();
    expect(input).toBeEnabled();
    expect(input).toHaveValue('');

    const data = { date: null, amount: null, merchant: null, categoryGuess: null };
    fetchMock.mockResolvedValue({ ok: true, json: async () => data });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(onExtracted).toHaveBeenCalledWith(data));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
