import { google } from 'googleapis';

export function getServiceAccountAuth(): InstanceType<typeof google.auth.JWT> {
  const credentials = JSON.parse(process.env.SHORTCUT_SERVICE_ACCOUNT_CREDENTIALS!);
  return new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: [
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/spreadsheets',
    ],
  });
}

export async function findServiceAccountSpreadsheetId(
  auth: InstanceType<typeof google.auth.JWT>
): Promise<string | null> {
  const drive = google.drive({ version: 'v3', auth });
  const canonical = await drive.files.list({
    q: "appProperties has { key='expenseTrackerCanonical' and value='true' } and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
    fields: 'files(id, name)',
    spaces: 'drive',
  });
  return canonical.data.files?.[0]?.id ?? null;
}
