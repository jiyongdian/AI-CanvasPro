import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available'; version: string; body?: string }
  | { state: 'downloading'; progress: number; total?: number }
  | { state: 'ready'; version: string }
  | { state: 'up-to-date' }
  | { state: 'error'; message: string };

export async function checkForUpdate(): Promise<Update | null> {
  const update = await check();
  return update;
}

export async function downloadAndInstallUpdate(
  update: Update,
  onProgress?: (progress: number, total?: number) => void,
) {
  let contentLength: number | undefined;
  let downloaded = 0;

  await update.downloadAndInstall((event) => {
    switch (event.event) {
      case 'Started':
        contentLength = event.data.contentLength;
        break;
      case 'Progress':
        downloaded += event.data.chunkLength;
        if (contentLength) {
          const pct = Math.min(100, Math.round((downloaded / contentLength) * 100));
          onProgress?.(pct, contentLength);
        }
        break;
      case 'Finished':
        onProgress?.(100, contentLength);
        break;
    }
  });

  await relaunch();
}
