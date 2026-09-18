// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { google } from 'googleapis';
import { findServiceAccountSpreadsheetId, getServiceAccountAuth } from './serviceAccount';

const mocks = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('googleapis', () => ({
  google: {
    auth: { JWT: vi.fn(function JWT() { return {}; }) },
    drive: vi.fn(() => ({ files: { list: mocks.list } })),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.list.mockReset();
  vi.stubEnv('SHORTCUT_SERVICE_ACCOUNT_CREDENTIALS', JSON.stringify({
    client_email: 'shortcuts@example.iam.gserviceaccount.com',
    private_key: 'test-private-key',
  }));
});
afterEach(() => vi.unstubAllEnvs());

describe('서비스 계정 인증과 파일 조회', () => {
  it('전용 자격증명과 Drive/Sheets 스코프로 JWT를 생성합니다', () => {
    const auth = getServiceAccountAuth();
    expect(google.auth.JWT).toHaveBeenCalledWith({
      email: 'shortcuts@example.iam.gserviceaccount.com',
      key: 'test-private-key',
      scopes: [
        'https://www.googleapis.com/auth/drive',
        'https://www.googleapis.com/auth/spreadsheets',
      ],
    });
    expect(auth).toBe(vi.mocked(google.auth.JWT).mock.results[0].value);
  });

  it('기존 canonical 쿼리로 조회한 첫 파일 ID를 반환합니다', async () => {
    mocks.list.mockResolvedValue({ data: { files: [{ id: 'sheet-id' }, { id: 'other' }] } });
    const auth = getServiceAccountAuth();

    expect(await findServiceAccountSpreadsheetId(auth)).toBe('sheet-id');
    expect(google.drive).toHaveBeenCalledWith({ version: 'v3', auth });
    expect(mocks.list).toHaveBeenCalledExactlyOnceWith({
      q: "appProperties has { key='expenseTrackerCanonical' and value='true' } and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
      fields: 'files(id, name)',
      spaces: 'drive',
    });
  });

  it.each([{ files: [] }, {}, { files: [{}] }])(
    '공유 파일 ID가 없으면 새 파일을 만들지 않고 null을 반환합니다: %j',
    async (data) => {
      mocks.list.mockResolvedValue({ data });
      expect(await findServiceAccountSpreadsheetId(getServiceAccountAuth())).toBeNull();
      expect(mocks.list).toHaveBeenCalledTimes(1);
    }
  );

  it('Drive 조회 오류를 호출자에게 전달합니다', async () => {
    mocks.list.mockRejectedValue(new Error('drive failed'));
    await expect(findServiceAccountSpreadsheetId(getServiceAccountAuth()))
      .rejects.toThrow('drive failed');
  });

  it('잘못된 자격증명 JSON이면 인증 객체를 만들지 않습니다', () => {
    vi.stubEnv('SHORTCUT_SERVICE_ACCOUNT_CREDENTIALS', '{');
    expect(() => getServiceAccountAuth()).toThrow();
    expect(google.auth.JWT).not.toHaveBeenCalled();
  });
});
