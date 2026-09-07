import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

let pickerCallback: (data: unknown) => void;
const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('localStorage', {
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
  });
  vi.stubGlobal('gapi', {
    load: (_name: string, callback: () => void) => callback(),
  });
  vi.stubGlobal('google', {
    picker: {
      ViewId: { FOLDERS: 'folders' },
      Action: { PICKED: 'picked' },
      DocsView: class {
        setIncludeFolders() { return this; }
        setMimeTypes() { return this; }
        setSelectFolderEnabled() { return this; }
      },
      PickerBuilder: class {
        setTitle() { return this; }
        setOAuthToken() { return this; }
        setDeveloperKey() { return this; }
        addView() { return this; }
        setCallback(callback: typeof pickerCallback) {
          pickerCallback = callback;
          return this;
        }
        build() { return { setVisible: vi.fn() }; }
      },
    },
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function rename(name: string) {
  fireEvent.click(screen.getByRole('button', { name: '변경' }));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: name } });
  await act(async () => {
    fireEvent.blur(screen.getByRole('textbox'));
  });
}

describe('설정 변경 피드백', () => {
  it('폴더 선택 성공 시 토스트를 표시하고 마지막 선택 후 1800ms에 닫습니다', () => {
    render(<FolderPickerSection accessToken="token" apiKey="key" />);
    expect(screen.queryByText('저장 위치가 변경되었습니다')).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: '변경' })[0]);
    act(() => pickerCallback({ action: 'cancel' }));
    expect(screen.queryByText('저장 위치가 변경되었습니다')).not.toBeInTheDocument();
    act(() => pickerCallback({
      action: 'picked', docs: [{ id: 'folder-1', name: '가계부' }],
    }));
    expect(storage.saveFolderId).toHaveBeenCalledWith('folder-1');
    expect(screen.getByText('저장 위치가 변경되었습니다')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1000));
    act(() => pickerCallback({
      action: 'picked', docs: [{ id: 'folder-2', name: '지출' }],
    }));
    act(() => vi.advanceTimersByTime(1799));
    expect(screen.getByText('저장 위치가 변경되었습니다')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByText('저장 위치가 변경되었습니다')).not.toBeInTheDocument();
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
