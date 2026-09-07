'use client';

import { useEffect, useState } from 'react';
import { getSavedFolderId, saveFolderId } from '@/lib/folderStorage';

import FileNameSetting from '@/components/FileNameSetting';

declare const gapi: any;
declare const google: any;

const FOLDER_NAME_STORAGE_KEY = 'expense-tracker:folderName';

type FolderPickerProps = {
  accessToken: string;
  apiKey: string;
  onPicked: (folderId: string, folderName: string) => void;
};

export default function FolderPicker({ accessToken, apiKey, onPicked }: FolderPickerProps) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const loadPicker = () => gapi.load('picker', () => setReady(true));

    if ('gapi' in window) {
      loadPicker();
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://apis.google.com/js/api.js';
    script.async = true;
    script.onload = loadPicker;
    document.head.appendChild(script);

    return () => {
      script.onload = null;
    };
  }, []);

  const openPicker = () => {
    const view = new google.picker.DocsView(google.picker.ViewId.FOLDERS)
      .setIncludeFolders(true)
      .setMimeTypes('application/vnd.google-apps.folder')
      .setSelectFolderEnabled(true);

    const picker = new google.picker.PickerBuilder()
      .setTitle('저장 위치 선택')
      .setOAuthToken(accessToken)
      .setDeveloperKey(apiKey)
      .addView(view)
      .setCallback((data: any) => {
        if (data.action === google.picker.Action.PICKED) {
          const doc = data.docs[0];
          onPicked(doc.id, doc.name);
        }
      })
      .build();

    picker.setVisible(true);
  };

  return (
    <button
      type="button"
      disabled={!ready}
      onClick={openPicker}
      className="text-[13px] font-semibold text-indigo-600 disabled:text-gray-300"
    >
      변경
    </button>
  );
}

export function FolderPickerSection({ accessToken, apiKey }: Omit<FolderPickerProps, 'onPicked'>) {
  const [folderId, setFolderId] = useState<string | null>(null);
  const [folderName, setFolderName] = useState<string | null>(null);

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
          accessToken={accessToken}
          apiKey={apiKey}
          onPicked={(id, name) => {
            saveFolderId(id);
            window.localStorage.setItem(FOLDER_NAME_STORAGE_KEY, name);
            setFolderId(id);
            setFolderName(name);
          }}
        />
      </div>
      <FileNameSetting />
    </div>
  );
}
