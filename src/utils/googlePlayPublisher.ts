import type { androidpublisher_v3 } from 'googleapis';

export type PlayServiceAccountCreds = {
  client_email: string;
  private_key: string;
  project_id?: string;
};

export function parsePlayServiceAccountJson(json: string): PlayServiceAccountCreds {
  const creds = JSON.parse(json) as Partial<PlayServiceAccountCreds>;
  if (!creds.client_email || !creds.private_key) {
    throw new Error('Service account JSON missing client_email or private_key');
  }
  return creds as PlayServiceAccountCreds;
}

/**
 * Create an Android Publisher client using JWT auth.
 * Some deployments see 401 with GoogleAuth + credentials object; JWT is more reliable.
 */
export async function createAndroidPublisherClient(
  serviceAccountJson: string,
): Promise<androidpublisher_v3.Androidpublisher> {
  const creds = parsePlayServiceAccountJson(serviceAccountJson);
  const { google } = await import('googleapis');
  const auth = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ['https://www.googleapis.com/auth/androidpublisher'],
  });
  await auth.authorize();
  return google.androidpublisher({ version: 'v3', auth });
}
