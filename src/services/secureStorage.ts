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

// ============================================================
// 多API提供商配置存储
// ============================================================

const PROVIDERS_STORE_FILE = 'api-providers.json';
const PROVIDERS_LOCAL_KEY = 'api_providers_secure';

let tauriProvidersStore: any = null;

async function getTauriProvidersStore() {
  if (tauriProvidersStore) return tauriProvidersStore;
  try {
    const { load } = await import('@tauri-apps/plugin-store');
    tauriProvidersStore = await load(PROVIDERS_STORE_FILE, { autoSave: true, defaults: {} });
    return tauriProvidersStore;
  } catch {
    return null;
  }
}

/**
 * 安全保存多个API提供商配置
 */
export async function saveApiProviders(providers: import('../types').ApiProvider[]): Promise<void> {
  const store = await getTauriProvidersStore();

  // 序列化时保留日期字段
  const serializable = providers.map(p => ({
    ...p,
    createdAt: p.createdAt instanceof Date ? p.createdAt.toISOString() : p.createdAt,
    updatedAt: p.updatedAt instanceof Date ? p.updatedAt.toISOString() : p.updatedAt,
  }));

  if (store) {
    await store.set('providers', serializable);
    await store.save();
  } else {
    try {
      const encrypted = obfuscate(JSON.stringify(serializable));
      localStorage.setItem(PROVIDERS_LOCAL_KEY, encrypted);
    } catch (e) {
      // localStorage 配额满或其他错误，尝试清理旧数据后重试
      console.warn('[secureStorage] 保存失败，尝试清理后重试:', e);
      try {
        localStorage.removeItem('api_config_secure');
        localStorage.removeItem('api_config');
        const encrypted = obfuscate(JSON.stringify(serializable));
        localStorage.setItem(PROVIDERS_LOCAL_KEY, encrypted);
      } catch (e2) {
        console.error('[secureStorage] 重试保存仍失败:', e2);
      }
    }
  }
}

/**
 * 安全读取多个API提供商配置
 */
export async function loadApiProviders(): Promise<import('../types').ApiProvider[]> {
  const store = await getTauriProvidersStore();

  const parseProviders = (raw: any[]): import('../types').ApiProvider[] => {
    return raw.map((p: any) => ({
      ...p,
      createdAt: p.createdAt ? new Date(p.createdAt) : new Date(),
      updatedAt: p.updatedAt ? new Date(p.updatedAt) : new Date(),
      models: Array.isArray(p.models) ? p.models : [],
      enabled: p.enabled !== false,
    }));
  };

  if (store) {
    const data = (await store.get('providers')) as any[];
    if (Array.isArray(data) && data.length > 0) {
      return parseProviders(data);
    }
    return [];
  }

  // 浏览器环境
  const secure = localStorage.getItem(PROVIDERS_LOCAL_KEY);
  if (secure) {
    try {
      const parsed = JSON.parse(deobfuscate(secure));
      if (Array.isArray(parsed)) return parseProviders(parsed);
    } catch { /* ignore */ }
  }

  // 迁移旧单配置为多provider格式（如果存在旧配置但没有providers）
  const legacyConfig = localStorage.getItem('api_config_secure') || localStorage.getItem('api_config');
  if (legacyConfig) {
    try {
      let config: any;
      if (legacyConfig === localStorage.getItem('api_config_secure')) {
        config = JSON.parse(deobfuscate(legacyConfig));
      } else {
        config = JSON.parse(legacyConfig);
      }
      if (config.apiUrl || config.apiKey) {
        const models: import('../types').ProviderModel[] = [];
        if (config.chatModel) models.push({ id: config.chatModel, name: config.chatModel, category: 'text' });
        if (config.imageModel) models.push({ id: config.imageModel, name: config.imageModel, category: 'image' });
        if (config.videoModel) models.push({ id: config.videoModel, name: config.videoModel, category: 'video' });
        
        const legacyProvider: import('../types').ApiProvider = {
          id: 'legacy-migration',
          name: '默认API',
          apiUrl: config.apiUrl || '',
          apiKey: config.apiKey || '',
          models,
          enabled: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        return [legacyProvider];
      }
    } catch { /* ignore */ }
  }

  return [];
}

/**
 * 清除所有API提供商配置
 */
export async function clearApiProviders(): Promise<void> {
  const store = await getTauriProvidersStore();
  if (store) {
    await store.clear();
    await store.save();
  } else {
    localStorage.removeItem(PROVIDERS_LOCAL_KEY);
  }
}
