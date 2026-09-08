import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signOut } from 'next-auth/react';
import FileNameSetting from './FileNameSetting';
import { FolderPickerSection } from './FolderPicker';

const storage = vi.hoisted(() => ({
  getSavedFileName: vi.fn(() => 'expense-tracker'),
  saveFileName: vi.fn(),
  getSavedFolderId: vi.fn(() => null),
  saveFolderId: vi.fn(),
}));

vi.mock('@/lib/fileNameStorage', () => ({
  DEFAULT_FILE_NAME: 'expense-tracker',
  getSavedFileName: storage.getSavedFileName,
  saveFileName: storage.saveFileName,
}));
vi.mock('@/lib/folderStorage', () => ({
  getSavedFolderId: storage.getSavedFolderId,
  saveFolderId: storage.saveFolderId,
}));

vi.mock('next-auth/react', () => ({ signOut: vi.fn() }));
const fetchMock = vi.fn();
const dialogDescriptors = Object.getOwnPropertyDescriptors(HTMLDialogElement.prototype);

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ folders: [{ id: 'folder-1', name: '가계부' }] }) });
  vi.useFakeTimers();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('localStorage', {
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  } });
});

afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  for (const name of ['showModal', 'close']) {
    const descriptor = dialogDescriptors[name];
    if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, name, descriptor);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, name);
  }
});

async function rename(name: string) {
  fireEvent.click(screen.getByRole('button', { name: '변경' }));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: name } });
  await act(async () => {
    fireEvent.blur(screen.getByRole('textbox'));
  });
}

async function openFolders() {
  await act(async () => {
    fireEvent.click(screen.getAllByRole('button', { name: '변경' })[0]);
  });
}

async function clickFolderButton(name: string) {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }));
  });
}

describe('설정 변경 피드백', () => {
  it('모달을 열면 루트를 조회하고 폴더 이동 및 뒤로가기를 지원합니다', async () => {
    render(<FolderPickerSection />);
    expect(fetchMock).not.toHaveBeenCalled();
    await openFolders();
    expect(screen.getByRole('dialog', { name: '저장 위치 선택' })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenLastCalledWith('/api/drive/folders', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(screen.getByRole('button', { name: '가계부' })).toBeInTheDocument();
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ folders: [{ id: 'child', name: '영수증' }] }) });
    await clickFolderButton('가계부');
    expect(fetchMock).toHaveBeenLastCalledWith('/api/drive/folders?parentId=folder-1', expect.any(Object));
    expect(screen.getByRole('button', { name: '영수증' })).toBeInTheDocument();
    await clickFolderButton('뒤로');
    expect(fetchMock).toHaveBeenLastCalledWith('/api/drive/folders', expect.any(Object));
    expect(screen.getByRole('button', { name: '가계부' })).toBeInTheDocument();
  });

  it('폴더 선택을 저장하고 마지막 선택 후 1800ms에 토스트를 닫습니다', async () => {
    render(<FolderPickerSection />);
    await openFolders();
    await clickFolderButton('닫기');
    expect(storage.saveFolderId).not.toHaveBeenCalled();
    expect(screen.queryByText('저장 위치가 변경되었습니다')).not.toBeInTheDocument();
    await openFolders();
    await clickFolderButton('가계부');
    await clickFolderButton('이 폴더 선택');
    expect(storage.saveFolderId).toHaveBeenCalledWith('folder-1');
    expect(localStorage.setItem).toHaveBeenCalledWith('expense-tracker:folderName', '가계부');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('저장 위치가 변경되었습니다')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1000));
    await openFolders();
    await clickFolderButton('이 폴더 선택');
    expect(storage.saveFolderId).toHaveBeenLastCalledWith('root');
    expect(localStorage.setItem).toHaveBeenLastCalledWith('expense-tracker:folderName', '내 드라이브');
    expect(screen.getByText('내 드라이브')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1799));
    expect(screen.getByText('저장 위치가 변경되었습니다')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByText('저장 위치가 변경되었습니다')).not.toBeInTheDocument();
  });

  it('권한 부족 시 재로그인 안내와 로그아웃 버튼을 표시합니다', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({ error: 'REAUTH_REQUIRED' }) });
    render(<FolderPickerSection />);
    await openFolders();
    expect(screen.getByRole('alert')).toHaveTextContent('다시 로그인하면 사용할 수 있어요');
    expect(screen.getByRole('button', { name: '이 폴더 선택' })).toBeDisabled();
    await clickFolderButton('로그아웃');
    expect(signOut).toHaveBeenCalledOnce();
    expect(storage.saveFolderId).not.toHaveBeenCalled();
  });

  it.each([
    { ok: false, status: 500, json: async () => ({ error: '서버 오류입니다.' }) },
    { ok: false, status: 403, json: async () => ({ error: '접근할 수 없습니다.' }) },
  ])('일반 API 오류를 표시합니다: $status', async (response) => {
    fetchMock.mockResolvedValueOnce(response);
    render(<FolderPickerSection />);
    await openFolders();
    expect(screen.getByRole('alert')).toHaveTextContent((await response.json()).error);
    expect(screen.queryByRole('button', { name: '로그아웃' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '이 폴더 선택' })).toBeDisabled();
  });

  it('JSON이 아닌 실패 응답도 안내합니다', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => { throw new SyntaxError(); } });
    render(<FolderPickerSection />);
    await openFolders();
    expect(screen.getByRole('alert')).toHaveTextContent('폴더 목록을 불러오지 못했습니다.');
  });

  it('네트워크 오류를 표시합니다', async () => {
    fetchMock.mockRejectedValueOnce(new Error('네트워크 오류입니다.'));
    render(<FolderPickerSection />);
    await openFolders();
    expect(screen.getByRole('alert')).toHaveTextContent('네트워크 오류입니다.');
  });

  it('늦은 하위 폴더 응답이 뒤로 이동한 루트 목록을 덮어쓰지 않습니다', async () => {
    let resolve!: (value: unknown) => void;
    render(<FolderPickerSection />);
    await openFolders();
    fetchMock.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    await clickFolderButton('가계부');
    expect(screen.getByRole('button', { name: '이 폴더 선택' })).toBeDisabled();
    const signal = fetchMock.mock.calls[1][1].signal as AbortSignal;
    await clickFolderButton('뒤로');
    expect(signal.aborted).toBe(true);
    await act(async () => {
      resolve({ ok: true, json: async () => ({ folders: [{ id: 'stale', name: '오래된 폴더' }] }) });
    });
    expect(screen.getByRole('button', { name: '가계부' })).toBeInTheDocument();
    expect(screen.queryByText('오래된 폴더')).not.toBeInTheDocument();
  });

  it('빈 폴더도 선택할 수 있고 Escape 취소 시 저장하지 않습니다', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ folders: [] }) });
    render(<FolderPickerSection />);
    await openFolders();
    expect(screen.getByText('하위 폴더가 없습니다.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '이 폴더 선택' })).toBeEnabled();
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(storage.saveFolderId).not.toHaveBeenCalled();
  });

  it('파일명 저장 성공 시 토스트를 표시하고 1800ms 후 닫습니다', async () => {
    fetchMock.mockResolvedValue({ ok: true });
    render(<FileNameSetting />);
    expect(screen.queryByText('파일명이 변경되었습니다')).not.toBeInTheDocument();
    await rename('가계부');
    expect(storage.saveFileName).toHaveBeenCalledWith('가계부');
    expect(screen.getByText('가계부')).toBeInTheDocument();
    expect(screen.getByText('파일명이 변경되었습니다')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1799));
    expect(screen.getByText('파일명이 변경되었습니다')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByText('파일명이 변경되었습니다')).not.toBeInTheDocument();
  });

  it('파일명이 같으면 요청이나 성공 토스트를 만들지 않습니다', async () => {
    render(<FileNameSetting />);
    await rename('expense-tracker');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByText('파일명이 변경되었습니다')).not.toBeInTheDocument();
  });

  it('서버의 오류 이유를 표시하고 기존 파일명을 유지합니다', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: '파일을 변경할 권한이 없습니다.' }),
    });
    render(<FileNameSetting />);
    await rename('가계부');
    expect(screen.getByText('파일을 변경할 권한이 없습니다.')).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveValue('expense-tracker');
    expect(storage.saveFileName).not.toHaveBeenCalled();
    expect(screen.queryByText('파일명이 변경되었습니다')).not.toBeInTheDocument();
  });

  it('JSON이 아닌 실패 응답에도 사용자용 오류를 표시합니다', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => { throw new SyntaxError('Invalid JSON'); },
    });
    render(<FileNameSetting />);
    await rename('가계부');
    expect(screen.getByText('파일명 변경에 실패했습니다.')).toBeInTheDocument();
  });
});
