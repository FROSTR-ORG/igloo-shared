import { profilePayloadFromRuntimeSnapshot } from '../browser-profile';

export async function runtimePayloadFromSnapshot(args: {
  label: string;
  relays: string[];
  runtimeSnapshotJson: string;
}) {
  return await profilePayloadFromRuntimeSnapshot(args);
}
