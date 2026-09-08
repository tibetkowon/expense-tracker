'use client';

import { useEffect, useRef, useState } from 'react';
import { signOut } from 'next-auth/react';
import Toast from '@/components/Toast';
import { getSavedFolderId, saveFolderId } from '@/lib/folderStorage';

import FileNameSetting from '@/components/FileNameSetting';

const FOLDER_NAME_STORAGE_KEY = 'expense-tracker:folderName';
type Folder = { id: string; name: string };
const ROOT_FOLDER: Folder = { id: 'root', name: '내 드라이브' };

type FolderPickerProps = {
  onPicked: (folderId: string, folderName: string) => void;
};

function FolderBrowser({ onPicked, onClose }: FolderPickerProps & { onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [path, setPath] = useState<Folder[]>([ROOT_FOLDER]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reauthRequired, setReauthRequired] = useState(false);
  const current = path[path.length - 1];

  useEffect(() => {
    const dialog = dialogRef.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    async function loadFolders() {
      try {
        const url = current.id === 'root'
          ? '/api/drive/folders'
          : `/api/drive/folders?parentId=${encodeURIComponent(current.id)}`;
        const response = await fetch(url, { signal: controller.signal });
        const body = await response.json().catch(() => null);
        if (!active) return;
        if (!response.ok) {
          if (response.status === 403 && body?.error === 'REAUTH_REQUIRED') {
            setReauthRequired(true);
            setError('다시 로그인하면 사용할 수 있어요');
            return;
          }
          throw new Error(
            typeof body?.error === 'string' && body.error.trim()
              ? body.error
              : '폴더 목록을 불러오지 못했습니다.'
          );
        }
        if (!Array.isArray(body?.folders)) {
          throw new Error('폴더 목록을 불러오지 못했습니다.');
        }
        setFolders(body.folders);
      } catch (caughtError) {
        if (active) {
          setError(caughtError instanceof Error ? caughtError.message : '폴더 목록을 불러오지 못했습니다.');
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadFolders();
    return () => {
      active = false;
      controller.abort();
    };
  }, [current.id]);

  function navigate(nextPath: Folder[]) {
    setLoading(true);
    setError(null);
    setReauthRequired(false);
    setFolders([]);
    setPath(nextPath);
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="folder-browser-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      className="m-auto max-h-[80dvh] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-2xl bg-white p-5 text-gray-800 shadow-xl backdrop:bg-black/40"
    >
      <div className="mb-4 flex items-center justify-between">
        <h2 id="folder-browser-title" className="text-[16px] font-semibold">저장 위치 선택</h2>
        <button type="button" onClick={onClose} className="p-2 text-[13px] text-gray-500">닫기</button>
      </div>
      <nav aria-label="폴더 경로" className="mb-3 flex items-center gap-3">
        <button
          type="button"
          disabled={path.length === 1}
          onClick={() => navigate(path.slice(0, -1))}
          className="shrink-0 p-2 text-[13px] font-semibold text-indigo-600 disabled:text-gray-300"
        >
          뒤로
        </button>
        <span className="break-all text-[14px] font-medium">{current.name}</span>
      </nav>
      {loading ? <p role="status" className="py-4 text-[13px] text-gray-500">폴더를 불러오는 중입니다.</p> : null}
      {error ? <p role="alert" className="py-4 text-[13px] text-red-500">{error}</p> : null}
      {reauthRequired ? (
        <button type="button" onClick={() => void signOut()} className="py-3 text-[13px] font-semibold text-indigo-600">
          로그아웃
        </button>
      ) : null}
      {!loading && !error ? (
        folders.length ? (
          <ul className="divide-y divide-gray-100">
            {folders.map((folder) => (
              <li key={folder.id}>
                <button
                  type="button"
                  onClick={() => navigate([...path, folder])}
                  className="w-full break-all py-3 text-left text-[14px] active:bg-gray-50"
                >
                  {folder.name}
                </button>
              </li>
            ))}
          </ul>
        ) : <p className="py-4 text-[13px] text-gray-500">하위 폴더가 없습니다.</p>
      ) : null}
      <button
        type="button"
        disabled={loading || error !== null}
        onClick={() => onPicked(current.id, current.name)}
        className="mt-4 w-full rounded-full bg-indigo-600 px-4 py-3 text-[14px] font-semibold text-white disabled:opacity-40"
      >
        이 폴더 선택
      </button>
    </dialog>
  );
}

export default function FolderPicker({ onPicked }: FolderPickerProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-[13px] font-semibold text-indigo-600"
      >
        변경
      </button>
      {open ? (
        <FolderBrowser
          onClose={() => setOpen(false)}
          onPicked={(id, name) => {
            onPicked(id, name);
            setOpen(false);
          }}
        />
      ) : null}
    </>
  );
}

export function FolderPickerSection() {
  const [folderId, setFolderId] = useState<string | null>(null);
  const [folderName, setFolderName] = useState<string | null>(null);

  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (toastTimer.current !== null) clearTimeout(toastTimer.current);
  }, []);

  function showToast(message: string) {
    setToastMessage(message);
    if (toastTimer.current !== null) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMessage(null), 1800);
  }

  useEffect(() => {
    setFolderId(getSavedFolderId());
    setFolderName(window.localStorage.getItem(FOLDER_NAME_STORAGE_KEY));
  }, []);

  return (
    <div className="flex flex-col gap-3 border-b border-gray-100 px-5 py-4">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-0.5">
          <span className="text-[11px] text-gray-400">저장 위치</span>
          <span className="text-[14px] font-medium text-gray-800">
            {folderName ?? (folderId ? `저장된 Drive 폴더 (${folderId})` : 'Drive 루트')}
          </span>
        </div>
        <FolderPicker
          onPicked={(id, name) => {
            saveFolderId(id);
            window.localStorage.setItem(FOLDER_NAME_STORAGE_KEY, name);
            setFolderId(id);
            setFolderName(name);
            showToast('저장 위치가 변경되었습니다');
          }}
        />
      </div>
      <FileNameSetting />
      <Toast message={toastMessage} />
    </div>
  );
}
