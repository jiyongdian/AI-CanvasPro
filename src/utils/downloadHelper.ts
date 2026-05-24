/**
 * 下载助手工具
 * 使用 IndexedDB 持久化存储文件夹句柄
 */

const DB_NAME = 'DownloadHelperDB';
const STORE_NAME = 'dirHandles';
const HANDLE_KEY = 'downloadDir';

// 打开 IndexedDB
const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
  });
};

// 保存文件夹句柄到 IndexedDB
export const saveDirHandle = async (handle: FileSystemDirectoryHandle): Promise<void> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(handle, HANDLE_KEY);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
    
    transaction.oncomplete = () => db.close();
  });
};

// 从 IndexedDB 获取文件夹句柄
export const getDirHandle = async (): Promise<FileSystemDirectoryHandle | null> => {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(HANDLE_KEY);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result || null);
      
      transaction.oncomplete = () => db.close();
    });
  } catch {
    return null;
  }
};

// 清除保存的文件夹句柄
export const clearDirHandle = async (): Promise<void> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(HANDLE_KEY);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
    
    transaction.oncomplete = () => db.close();
  });
};

// 验证并请求权限
export const verifyPermission = async (handle: FileSystemDirectoryHandle): Promise<boolean> => {
  try {
    // @ts-ignore - queryPermission 是较新的 API
    const options = { mode: 'readwrite' };
    
    // 检查当前权限状态
    // @ts-ignore
    if ((await handle.queryPermission(options)) === 'granted') {
      return true;
    }
    
    // 请求权限
    // @ts-ignore
    if ((await handle.requestPermission(options)) === 'granted') {
      return true;
    }
    
    return false;
  } catch {
    return false;
  }
};

// 下载文件到指定目录或默认下载
export const downloadToDir = async (
  blob: Blob, 
  fileName: string,
  onSuccess?: (path: string) => void,
  onFallback?: () => void
): Promise<boolean> => {
  try {
    // 尝试获取保存的文件夹句柄
    const dirHandle = await getDirHandle();
    
    if (dirHandle) {
      // 验证权限
      const hasPermission = await verifyPermission(dirHandle);
      
      if (hasPermission) {
        // 使用用户选择的目录保存文件
        const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(blob);
        await writable.close();
        
        if (onSuccess) {
          onSuccess(`${dirHandle.name}/${fileName}`);
        }
        return true;
      }
    }
  } catch (err) {
    console.warn('使用自定义目录保存失败:', err);
  }
  
  // 回退到默认下载
  if (onFallback) {
    onFallback();
  }
  
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  
  return false;
};
