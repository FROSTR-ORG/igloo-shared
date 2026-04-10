import { publishEncryptedProfileBackup } from '../profile-backup-host';
import {
  createEncryptedProfileBackup,
  type BrowserProfilePackagePayload,
} from '../profile-package';

export async function publishBrowserProfileBackup(payload: BrowserProfilePackagePayload) {
  const backup = await createEncryptedProfileBackup(payload);
  await publishEncryptedProfileBackup({
    relays: payload.device.relays,
    shareSecret: payload.device.shareSecret,
    backup,
  });
}
