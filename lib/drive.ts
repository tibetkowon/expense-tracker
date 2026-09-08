import { google } from 'googleapis';

export class DriveScopeError extends Error {
  constructor() {
    super('Drive 폴더 조회 권한이 필요합니다. 다시 로그인해 주세요.');
    this.name = 'DriveScopeError';
  }
}

function authClient(accessToken: string) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return auth;
}

export async function listFolders(
  accessToken: string,
  parentId: string = 'root'
): Promise<{ id: string; name: string }[]> {
  const auth = authClient(accessToken);
  const drive = google.drive({ version: 'v3', auth });
  const escapedParentId = parentId.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

  try {
    const result = await drive.files.list({
      q: `mimeType='application/vnd.google-apps.folder' and '${escapedParentId}' in parents and trashed=false`,
      fields: 'files(id,name)',
      orderBy: 'name',
      pageSize: 100,
    });

    return (result.data.files ?? []).flatMap((file) =>
      typeof file.id === 'string' && typeof file.name === 'string'
        ? [{ id: file.id, name: file.name }]
        : []
    );
  } catch (error) {
    const apiError = error as {
      code?: number | string;
      response?: { status?: number };
    } | null;
    if (
      apiError?.response?.status === 403 ||
      apiError?.code === 403 ||
      apiError?.code === '403'
    ) {
      throw new DriveScopeError();
    }
    throw error;
  }
}
