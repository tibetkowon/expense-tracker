import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ShortcutLinkButton from './ShortcutLinkButton';
import { saveFolderId } from '@/lib/folderStorage';
import { saveFileName } from '@/lib/fileNameStorage';

const fetchMock = vi.fn();
const showToast = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  const values = new Map<string, string>();
  // Node의 전역 저장소 대신 테스트마다 독립적인 브라우저 저장소를 사용합니다.
  vi.stubGlobal('localStorage', {
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe('단축어 연동 버튼', () => {
  it('클릭 시점의 저장 위치와 파일명을 전송하고 성공 토스트를 요청합니다', async () => {
    fetchMock.mockResolvedValue({ ok: true });
    render(<ShortcutLinkButton showToast={showToast} />);
    saveFolderId('new-folder');
    saveFileName('새 가계부');
    fireEvent.click(screen.getByRole('button', { name: '단축어 연동 켜기' }));

    await waitFor(() => expect(showToast).toHaveBeenCalledWith('단축어 연동이 켜졌습니다'));
    expect(fetchMock).toHaveBeenCalledWith('/api/shortcuts/link-sheet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderId: 'new-folder', fileName: '새 가계부' }),
    });
  });

  it('저장된 설정이 없으면 기본값을 전송합니다', async () => {
    fetchMock.mockResolvedValue({ ok: true });
    render(<ShortcutLinkButton showToast={showToast} />);
    fireEvent.click(screen.getByRole('button', { name: '단축어 연동 켜기' }));
    await waitFor(() => expect(showToast).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith('/api/shortcuts/link-sheet', expect.objectContaining({
      body: JSON.stringify({ folderId: null, fileName: 'expense-tracker' }),
    }));
  });

  it('요청 중에는 버튼을 비활성화하고 중복 요청을 막습니다', async () => {
    let resolve!: (response: { ok: boolean }) => void;
    fetchMock.mockReturnValue(new Promise((done) => { resolve = done; }));
    render(<ShortcutLinkButton showToast={showToast} />);
    const button = screen.getByRole('button', { name: '단축어 연동 켜기' });
    fireEvent.click(button);
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => { resolve({ ok: true }); });
    expect(button).toBeEnabled();
  });

  it('서버 오류 메시지를 토스트로 전달하고 재시도할 수 있습니다', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: '서비스 계정 이메일이 설정되지 않았습니다.' }),
    });
    render(<ShortcutLinkButton showToast={showToast} />);
    fireEvent.click(screen.getByRole('button', { name: '단축어 연동 켜기' }));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(
      '서비스 계정 이메일이 설정되지 않았습니다.'
    ));
    expect(showToast).not.toHaveBeenCalledWith('단축어 연동이 켜졌습니다');
    expect(screen.getByRole('button', { name: '단축어 연동 켜기' })).toBeEnabled();
  });

  it.each(['네트워크', 'JSON'] as const)('%s 오류에도 실패 토스트를 요청합니다', async (failure) => {
    if (failure === '네트워크') {
      fetchMock.mockRejectedValue(new Error('네트워크 연결 실패'));
    } else {
      fetchMock.mockResolvedValue({
        ok: false,
        json: async () => { throw new Error('JSON 오류'); },
      });
    }
    render(<ShortcutLinkButton showToast={showToast} />);
    fireEvent.click(screen.getByRole('button', { name: '단축어 연동 켜기' }));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(
      failure === '네트워크' ? '네트워크 연결 실패' : '단축어 연동에 실패했습니다.'
    ));
    expect(screen.getByRole('button', { name: '단축어 연동 켜기' })).toBeEnabled();
  });
});
