/**
 * 安全存储服务
 * 在 Tauri 环境下使用 Tauri Store（加密存储）
 * 在浏览器环境下使用带混淆的 localStorage（降低明文暴露风险）
 */

// API 配置的存储键
const STORE_FILE = 'api-config.json';

interface ApiConfig {
  apiUrl?: string;
  apiKey?: string;
  chatModel?: string;
  imageModel?: string;
  videoModel?: string;
  temperature?: string;
}

// 简单的混淆函数（非加密，仅防止直接 grep 和随意查看）
// Tauri 环境下由 Tauri Store 提供真正的加密保护
function obfuscate(text: string): string {
  return btoa(text.split('').map((c, i) =>
    String.fromCharCode(c.charCodeAt(0) ^ (i % 31 + 1))
  ).join(''));
}

function deobfuscate(encoded: string): string {
  try {
    const decoded = atob(encoded);
    return decoded.split('').map((c, i) =>
      String.fromCharCode(c.charCodeAt(0) ^ (i % 31 + 1))
    ).join('');
  } catch {
    return '';
  }
}

let tauriStore: any = null;

async function getTauriStore() {
  if (tauriStore) return tauriStore;
  try {
    // 动态导入 Tauri Store 模块
    const { load } = await import('@tauri-apps/plugin-store');
    tauriStore = await load(STORE_FILE, { autoSave: true, defaults: {} });
    return tauriStore;
  } catch {
    // 浏览器环境，无法加载 Tauri Store
    return null;
  }
}

/**
 * 检查是否在 Tauri 环境中
 */
export async function isTauriEnv(): Promise<boolean> {
  try {
    const store = await getTauriStore();
    return store !== null;
  } catch {
    return false;
  }
}

/**
 * 安全保存 API 配置
 */
export async function saveApiConfig(config: ApiConfig): Promise<void> {
  const store = await getTauriStore();

  if (store) {
    // Tauri 环境：使用加密 Store
    await store.set('apiUrl', config.apiUrl || '');
    await store.set('apiKey', config.apiKey || '');
    await store.set('chatModel', config.chatModel || '');
    await store.set('imageModel', config.imageModel || '');
    await store.set('videoModel', config.videoModel || '');
    await store.set('temperature', config.temperature || '');
    await store.save();
  } else {
    // 浏览器环境：使用混淆存储
    const encrypted = obfuscate(JSON.stringify(config));
    localStorage.setItem('api_config_secure', encrypted);
    // 清理旧的明文存储
    localStorage.removeItem('api_config');
  }
}

/**
 * 安全读取 API 配置
 */
export async function loadApiConfig(): Promise<ApiConfig> {
  const store = await getTauriStore();

  if (store) {
    return {
      apiUrl: (await store.get('apiUrl')) as string || '',
      apiKey: (await store.get('apiKey')) as string || '',
      chatModel: (await store.get('chatModel')) as string || '',
      imageModel: (await store.get('imageModel')) as string || '',
      videoModel: (await store.get('videoModel')) as string || '',
      temperature: (await store.get('temperature')) as string || '',
    };
  }

  // 浏览器环境：优先读混淆存储，回退到旧明文存储（迁移）
  const secure = localStorage.getItem('api_config_secure');
  if (secure) {
    try {
      return JSON.parse(deobfuscate(secure));
    } catch {
      // 解密失败，返回空配置
    }
  }

  // 从旧明文存储迁移
  const legacy = localStorage.getItem('api_config');
  if (legacy) {
    try {
      const config = JSON.parse(legacy);
      // 迁移到安全存储
      saveApiConfig(config);
      localStorage.removeItem('api_config');
      return config;
    } catch {
      // 解析失败
    }
  }

  return {};
}

/**
 * 清除所有 API 配置
 */
export async function clearApiConfig(): Promise<void> {
  const store = await getTauriStore();

  if (store) {
    await store.clear();
    await store.save();
  } else {
    localStorage.removeItem('api_config_secure');
    localStorage.removeItem('api_config');
  }
}
