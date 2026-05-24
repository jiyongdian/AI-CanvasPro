export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available'; version: string; body?: string }
  | { state: 'downloading'; progress: number; total?: number }
  | { state: 'ready'; version: string }
  | { state: 'up-to-date' }
  | { state: 'error'; message: string };

export interface UpdateInfo {
  version: string;
  body?: string;
  date?: string;
  downloadAndInstall(onEvent: (event: DownloadEvent) => void): Promise<void>;
}

type DownloadEvent =
  | { event: 'Started'; data: { contentLength?: number } }
  | { event: 'Progress'; data: { chunkLength: number } }
  | { event: 'Finished' };

let tauriUpdater: any = null;

async function getTauriUpdater() {
  if (tauriUpdater) return tauriUpdater;
  try {
    tauriUpdater = await import('@tauri-apps/plugin-updater');
    return tauriUpdater;
  } catch {
    return null;
  }
}

export async function checkForUpdate(): Promise<UpdateInfo | null> {
  const updater = await getTauriUpdater();
  if (!updater) return null;
  const update = await updater.check();
  return update;
}

export async function downloadAndInstallUpdate(
  update: UpdateInfo,
  onProgress?: (progress: number, total?: number) => void,
) {
  let contentLength: number | undefined;
  let downloaded = 0;

  await update.downloadAndInstall((event: DownloadEvent) => {
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

  try {
    const proc = await import('@tauri-apps/plugin-process');
    await proc.relaunch();
  } catch {
    // 浏览器环境或 Tauri 进程不可用
  }
}
