import {
  Scene, Character, Style, GenerationMode, PromptTemplate,
  ApiProvider, ProviderModel, ModelCategory, MODEL_CATEGORY_KEYWORDS,
} from '../types';
import { blobToBase64, processReferenceImage, compressImage, isUrl } from '../utils/imageUtils';
import { getMedia } from './mediaService';
import { loadApiConfig, loadApiProviders } from './secureStorage';

export interface ScriptScene {
  order: number;
  sceneDescription: string;
  actionDescription?: string;
  character: string;
  dialogue: string;
  narration?: string;
}

export type ScriptMode = 'dialogue' | 'narration';

// 默认模型名称常量（统一管理，避免硬编码分散）
const DEFAULT_MODELS = {
  chat: 'gemini-3-flash-preview',
  image: 'nano-banana-2-4k',
  video: 'sora-2',
} as const;

/**
 * 根据模型ID自动分类
 */
export function categorizeModel(modelId: string): ModelCategory {
  const lower = modelId.toLowerCase();
  for (const [category, keywords] of Object.entries(MODEL_CATEGORY_KEYWORDS)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) return category as ModelCategory;
    }
  }
  return 'other';
}

/**
 * 从 OpenAI 兼容 API 拉取模型列表并自动分类
 * 兼容绝大多数第三方API（OpenAI、DeepSeek、Qwen、Zhipu、Moonshot、SiliconFlow 等）
 */
export async function fetchModelsFromApi(
  apiUrl: string,
  apiKey: string,
): Promise<ProviderModel[]> {
  // 标准化 URL
  let base = apiUrl.replace(/\/+$/, '');
  
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };

  let response: Response;
  let modelsData: any[] = [];

  // 尝试标准 OpenAI 端点
  try {
    response = await fetch(`${base}/models`, { headers });
    if (response.ok) {
      const data = await response.json();
      if (data.data && Array.isArray(data.data)) {
        modelsData = data.data;
      } else if (Array.isArray(data)) {
        modelsData = data;
      }
    }
  } catch {
    // 继续尝试其他端点
  }

  // 如果 /models 失败，尝试 /v1/models
  if (modelsData.length === 0) {
    try {
      response = await fetch(`${base}/v1/models`, { headers });
      if (response.ok) {
        const data = await response.json();
        if (data.data && Array.isArray(data.data)) {
          modelsData = data.data;
        } else if (Array.isArray(data)) {
          modelsData = data;
        }
      }
    } catch {
      // 继续
    }
  }

  // 如果还是失败，尝试不带 Authorization header（某些API用其他方式验证）
  if (modelsData.length === 0) {
    try {
      const altHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      };
      response = await fetch(`${base}/models`, { headers: altHeaders });
      if (response.ok) {
        const data = await response.json();
        if (data.data && Array.isArray(data.data)) {
          modelsData = data.data;
        } else if (Array.isArray(data)) {
          modelsData = data;
        }
      }
    } catch {
      // 继续
    }
  }

  // 也尝试直接 chat/completions 端点探测（某些API不暴露 /models）
  if (modelsData.length === 0) {
    try {
      response = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: 'gpt-3.5-turbo',
          messages: [{ role: 'user', content: 'hi' }],
          max_tokens: 1,
        }),
      });
      // 即使返回错误，如果状态码不是404说明端点存在
      if (response.status !== 404 && response.status !== 405) {
        // 端点存在，但无法列出模型，返回一些常见模型供用户选择
        modelsData = [
          { id: 'gpt-4o', owned_by: 'openai' },
          { id: 'gpt-4o-mini', owned_by: 'openai' },
          { id: 'gpt-4-turbo', owned_by: 'openai' },
          { id: 'gpt-3.5-turbo', owned_by: 'openai' },
          { id: 'deepseek-chat', owned_by: 'deepseek' },
          { id: 'deepseek-reasoner', owned_by: 'deepseek' },
          { id: 'qwen-turbo', owned_by: 'qwen' },
          { id: 'qwen-plus', owned_by: 'qwen' },
          { id: 'glm-4', owned_by: 'zhipu' },
          { id: 'moonshot-v1-8k', owned_by: 'moonshot' },
        ];
      }
    } catch {
      // 完全无法连接
      throw new Error('无法连接到该API地址，请检查地址和密钥是否正确。\n\n💡 提示：API地址应包含基础路径，如 https://api.openai.com/v1');
    }
  }

  // 分类并去重
  const seen = new Set<string>();
  const result: ProviderModel[] = [];

  for (const item of modelsData) {
    const id = typeof item === 'string' ? item : (item.id || '');
    if (!id || seen.has(id)) continue;
    seen.add(id);

    result.push({
      id,
      name: id,
      category: categorizeModel(id),
      owned_by: typeof item === 'object' ? item.owned_by : undefined,
    });
  }

  if (result.length === 0) {
    throw new Error('未能获取到任何模型。\n\n💡 该API可能不兼容OpenAI格式，或密钥权限不足。');
  }

  return result;
}

/**
 * 测试API连接是否正常
 */
export async function testApiConnection(
  apiUrl: string,
  apiKey: string,
): Promise<{ success: boolean; message: string }> {
  let base = apiUrl.replace(/\/+$/, '');
  
  try {
    // 仅验证密钥有效性，不调用任何模型
    // 尝试 GET /models（轻量级，不消耗 token）
    let response = await fetch(`${base}/models`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    // fallback: 尝试 /v1/models
    if (!response.ok) {
      response = await fetch(`${base}/v1/models`, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      });
    }

    if (response.ok) {
      // 尝试读取模型数量以提供更详细的反馈
      try {
        const data = await response.json();
        const count = data.data?.length || 0;
        return {
          success: true,
          message: count > 0
            ? `连接成功！可用模型数: ${count}`
            : '连接成功！密钥验证通过',
        };
      } catch {
        return { success: true, message: '连接成功！密钥验证通过' };
      }
    }

    // 401 = 密钥无效，403 = 权限不足
    if (response.status === 401) {
      return { success: false, message: '密钥无效（401 Unauthorized）\n请检查密钥是否正确' };
    }
    if (response.status === 403) {
      return { success: false, message: '权限不足（403 Forbidden）\n该密钥可能没有列出模型的权限，但可能仍可用于生成' };
    }

    return {
      success: false,
      message: `状态码: ${response.status}\n${response.statusText || '未知错误'}`,
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : '未知错误';
    return {
      success: false,
      message: `网络错误: ${errMsg}\n\n💡 请检查API地址格式是否正确`,
    };
  }
}

/**
 * 创建用于临时生成请求的 Scene 对象（避免整个应用中散落空 ID 的构造）
 */
export function createTempScene(prompt: string, options?: { aspectRatio?: string; description?: string }): Scene {
  const id = `temp-${crypto.randomUUID()}`;
  return {
    id,
    order: 0,
    description: options?.description || '',
    prompt,
    generationMode: 'text-to-image',
    images: {},
    videos: [],
    status: 'pending',
  };
}

class AIGenerationService {
  private config: {
    apiUrl: string;
    apiKey: string;
  } = {
    apiUrl: '',
    apiKey: ''
  };

  private cachedConfig: {
    apiUrl: string;
    apiKey: string;
    chatModel: string;
    imageModel: string;
    videoModel: string;
    temperature: string;
  } | null = null;

  // 多provider支持
  private providersCache: ApiProvider[] | null = null;
  private providersLoadPromise: Promise<ApiProvider[]> | null = null;

  setApiKeys(keys: Partial<typeof this.config>) {
    this.config = { ...this.config, ...keys };
  }

  getApiUrl(): string {
    return this.config.apiUrl;
  }

  getApiKey(): string {
    return this.config.apiKey;
  }

  /**
   * 加载所有API提供商
   */
  async getProviders(): Promise<ApiProvider[]> {
    if (this.providersCache) return this.providersCache;
    if (!this.providersLoadPromise) {
      this.providersLoadPromise = loadApiProviders();
    }
    this.providersCache = await this.providersLoadPromise;
    this.providersLoadPromise = null;
    return this.providersCache;
  }

  /**
   * 刷新provider缓存
   */
  refreshProviders() {
    this.providersCache = null;
    this.providersLoadPromise = null;
  }

  /**
   * 根据 providerId 获取配置，若未指定则使用第一个启用的provider或fallback
   */
  async getProviderConfig(providerId?: string): Promise<{
    apiUrl: string;
    apiKey: string;
    models: ProviderModel[];
  }> {
    // 如果指定了providerId，从providers中查找
    if (providerId) {
      const providers = await this.getProviders();
      const provider = providers.find(p => p.id === providerId);
      if (provider && provider.enabled !== false) {
        return {
          apiUrl: provider.apiUrl,
          apiKey: provider.apiKey,
          models: provider.models,
        };
      }
    }

    // 尝试从providers中获取第一个启用的
    const providers = await this.getProviders();
    const enabled = providers.filter(p => p.enabled !== false);
    if (enabled.length > 0) {
      return {
        apiUrl: enabled[0].apiUrl,
        apiKey: enabled[0].apiKey,
        models: enabled[0].models,
      };
    }

    // fallback到旧配置
    const config = this.getConfig();
    return {
      apiUrl: config.apiUrl || this.config.apiUrl,
      apiKey: config.apiKey || this.config.apiKey,
      models: [],
    };
  }

  /**
   * 异步加载配置（替代同步的 localStorage 读取）
   * 使用安全存储服务，Tauri 环境加密存储
   */
  private async getConfigAsync(): Promise<typeof this.cachedConfig> {
    if (this.cachedConfig) {
      return this.cachedConfig;
    }

    try {
      const secureConfig = await loadApiConfig();
      if (secureConfig.apiUrl || secureConfig.apiKey) {
        this.cachedConfig = {
          apiUrl: secureConfig.apiUrl || this.config.apiUrl,
          apiKey: secureConfig.apiKey || this.config.apiKey,
          chatModel: secureConfig.chatModel || DEFAULT_MODELS.chat,
          imageModel: secureConfig.imageModel || DEFAULT_MODELS.image,
          videoModel: secureConfig.videoModel || DEFAULT_MODELS.video,
          temperature: secureConfig.temperature || '0.6',
        };
        return this.cachedConfig;
      }
    } catch {
      // 安全存储不可用，回退到旧方案（迁移期间）
    }

    // 回退：优先读安全存储的混淆版本（api_config_secure），再读旧版 api_config
    const secureSaved = localStorage.getItem('api_config_secure');
    if (secureSaved) {
      try {
        const { loadApiConfig: loadSync } = await import('./secureStorage');
        // 无法等待异步，用 deobfuscate 简化同步读取
        const decoded = atob(secureSaved);
        const jsonStr = decoded.split('').map((c, i) =>
          String.fromCharCode(c.charCodeAt(0) ^ (i % 31 + 1))
        ).join('');
        const parsed = JSON.parse(jsonStr);
        this.cachedConfig = {
          apiUrl: parsed.apiUrl || this.config.apiUrl,
          apiKey: parsed.apiKey || this.config.apiKey,
          chatModel: parsed.chatModel || DEFAULT_MODELS.chat,
          imageModel: parsed.imageModel || '',
          videoModel: parsed.videoModel || DEFAULT_MODELS.video,
          temperature: parsed.temperature || '0.6',
        };
        return this.cachedConfig;
      } catch {
        // 解密/解析失败，继续尝试旧版
      }
    }

    const saved = localStorage.getItem('api_config');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // 迁移到安全存储
        import('./secureStorage').then(({ saveApiConfig }) => {
          saveApiConfig(parsed);
          localStorage.removeItem('api_config');
        }).catch(() => {});
        this.cachedConfig = {
          apiUrl: parsed.apiUrl || this.config.apiUrl,
          apiKey: parsed.apiKey || this.config.apiKey,
          chatModel: parsed.chatModel || DEFAULT_MODELS.chat,
          imageModel: parsed.imageModel || '',
          videoModel: parsed.videoModel || DEFAULT_MODELS.video,
          temperature: parsed.temperature || '0.6',
        };
        return this.cachedConfig;
      } catch {
        // 解析失败
      }
    }

    this.cachedConfig = {
      apiUrl: this.config.apiUrl,
      apiKey: this.config.apiKey,
      chatModel: DEFAULT_MODELS.chat,
      imageModel: '',
      videoModel: DEFAULT_MODELS.video,
      temperature: '0.6',
    };
    return this.cachedConfig;
  }

  // 同步版本（兼容旧代码，在配置已加载的情况下使用）
  private getConfig() {
    if (this.cachedConfig) {
      return this.cachedConfig;
    }
    // 尝试从安全存储同步读取（api_config_secure）
    const secureSaved = localStorage.getItem('api_config_secure');
    if (secureSaved) {
      try {
        const decoded = atob(secureSaved);
        const jsonStr = decoded.split('').map((c: string, i: number) =>
          String.fromCharCode(c.charCodeAt(0) ^ (i % 31 + 1))
        ).join('');
        const parsed = JSON.parse(jsonStr);
        this.cachedConfig = {
          apiUrl: parsed.apiUrl || this.config.apiUrl,
          apiKey: parsed.apiKey || this.config.apiKey,
          chatModel: parsed.chatModel || DEFAULT_MODELS.chat,
          imageModel: parsed.imageModel || '',
          videoModel: parsed.videoModel || DEFAULT_MODELS.video,
          temperature: parsed.temperature || '0.6',
        };
        return this.cachedConfig;
      } catch { /* 继续尝试旧版 */ }
    }
    // 再尝试旧 localStorage
    const saved = localStorage.getItem('api_config');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        this.cachedConfig = {
          apiUrl: parsed.apiUrl || this.config.apiUrl,
          apiKey: parsed.apiKey || this.config.apiKey,
          chatModel: parsed.chatModel || DEFAULT_MODELS.chat,
          imageModel: parsed.imageModel || '',
          videoModel: parsed.videoModel || DEFAULT_MODELS.video,
          temperature: parsed.temperature || '0.6',
        };
        return this.cachedConfig;
      } catch { /* 解析失败 */ }
    }
    // 都找不到，回退默认值（imageModel 为空，让用户明确选择）
    this.cachedConfig = {
      apiUrl: this.config.apiUrl,
      apiKey: this.config.apiKey,
      chatModel: DEFAULT_MODELS.chat,
      imageModel: '',
      videoModel: DEFAULT_MODELS.video,
      temperature: '0.6',
    };
    return this.cachedConfig;
  }

  refreshConfig() {
    this.cachedConfig = null;
  }

  private getTemperature(): number {
    return parseFloat(this.getConfig().temperature) || 0.6;
  }

  private async throwApiError(response: Response): Promise<never> {
    const errData = await response.json().catch(() => ({}));
    const msg = (errData as any).error?.message || response.statusText || `HTTP ${response.status}`;
    throw new Error(`API 请求失败 (${response.status}): ${msg}`);
  }

  private getHeaders() {
    const config = this.getConfig();
    return {
      'Authorization': `Bearer ${config.apiKey || this.config.apiKey}`,
      'Content-Type': 'application/json'
    };
  }

  private getApiBaseUrl(): string {
    const config = this.getConfig();
    let url = config.apiUrl || this.config.apiUrl || 'https://api.openai.com/v1';
    // 移除末尾斜杠，确保 URL 格式一致
    return url.replace(/\/+$/, '');
  }

  // 获取视频 API 的基础 URL（兼容新 /v1 版本）
  private getVideoApiBaseUrl(): string {
    const baseUrl = this.getApiBaseUrl();
    // 确保返回以 /v1 结尾的基础路径（去掉多余的 /v1 再补回来，保证格式一致）
    return baseUrl.replace(/\/v1$/, '') + '/v1';
  }

  async generateScript(
    novelContent: string,
    mode: ScriptMode,
    userRequirement?: string,
    options?: { model?: string; providerId?: string; template?: { positive_prompt: string } },
  ): Promise<ScriptScene[]> {
    const providerConfig = await this.getProviderConfig(options?.providerId);
    const apiUrl = providerConfig.apiUrl || this.getApiBaseUrl();
    const apiKey = providerConfig.apiKey || this.config.apiKey;
    const model = options?.model || this.getConfig().chatModel || 'gemini-3-flash-preview';
    
    // 标准化 URL
    const baseUrl = apiUrl.replace(/\/+$/, '');
    
    // 如果用户提供了创作要求，注入到系统提示中
    const requirementBlock = userRequirement && userRequirement.trim()
      ? `\n【用户创作要求 - 必须严格遵守】\n${userRequirement.trim()}\n`
      : '';

    // 如果有脚本模板，使用模板作为系统提示
    const template = options?.template;
    if (template?.positive_prompt) {
      const systemPrompt = `你是一个专业的AI漫剧编剧。请严格按照下面的【脚本模板】要求，将小说内容转换为分镜脚本。

【脚本模板 — 最高优先级，必须严格遵循】
${template.positive_prompt}

【补充规则】
- 必须完整覆盖原文的所有剧情，不得省略任何场景、对话或情节
- 每个分镜必须包含：分镜序号(order)、场景描述(sceneDescription)、动作描述(actionDescription)、出现的角色标签(character)、台词/对话内容(dialogue)${mode === 'narration' ? '、解说词(narration)' : ''}
- 请直接输出JSON数组格式，不要添加任何额外文字
${requirementBlock}`;

      const userMessage = userRequirement && userRequirement.trim()
        ? `【创作要求】${userRequirement.trim()}\n\n请将以下小说内容完整转换为分镜脚本，不要省略任何剧情：\n\n${novelContent}`
        : `请将以下小说内容完整转换为分镜脚本，不要省略任何剧情：\n\n${novelContent}`;

      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage }
          ],
          temperature: this.getTemperature(),
          max_tokens: 80000
        })
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        const errMsg = (errData as any).error?.message || response.statusText || `HTTP ${response.status}`;
        throw new Error(`API 请求失败 (${response.status}): ${errMsg}`);
      }
      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || '[]';
      try { return JSON.parse(content); } catch {
        const firstBracket = content.indexOf('[');
        const lastBracket = content.lastIndexOf(']');
        if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
          return JSON.parse(content.slice(firstBracket, lastBracket + 1));
        }
        throw new Error('AI 返回的脚本格式无法解析，请重试');
      }
    }

    const systemPrompt = mode === 'dialogue' 
      ? `你是一个专业的AI漫剧编剧。请将以下小说内容转换为纯对话剧本格式的分镜脚本。

【最高优先级要求 - 完整性】
- 必须完整覆盖原文的所有剧情，不得省略任何场景、对话或情节
- 原文中的每一段对话都必须保留
- 原文中的每一个场景转换都必须体现
- 宁可分镜数量多，也不能遗漏剧情内容
${requirementBlock}
输出格式要求：
1. 每个分镜包含：分镜序号(order)、场景描述(sceneDescription)、动作描述(actionDescription)、出现的角色标签(character)、台词/对话内容(dialogue)
2. 场景描述使用"场景A"、"场景B"、"场景C"等标记来标识不同场景
3. 首次出现的场景需要完整描述，格式为："场景A：古代宫殿大殿，金碧辉煌"
4. 重复出现的场景直接使用标记，格式为："场景A"（无需重复描述）
5. 场景描述必须是纯场景/环境描述，只描述地点、环境、氛围、光线等，禁止包含任何人物动作
6. 动作描述描述人物的核心动作（人物相关内容只能放在这里）
7. 角色标签只写出现在该分镜中的角色名称，多个角色用逗号分隔
8. 台词要自然流畅，符合角色性格
9. 请直接输出JSON数组格式，不要添加任何额外文字`
      : `你是一个专业的AI漫剧编剧。请将以下小说内容转换为解说对话模式的分镜脚本。

【最高优先级要求 - 完整性】
- 必须完整覆盖原文的所有剧情，不得省略任何场景、对话或情节
- 原文中的每一段对话都必须保留
- 原文中的每一个场景转换都必须体现
- 原文中的叙事性内容要转换为解说词
- 宁可分镜数量多，也不能遗漏剧情内容
${requirementBlock}
输出格式要求：
1. 每个分镜包含：分镜序号(order)、场景描述(sceneDescription)、动作描述(actionDescription)、出现的角色标签(character)、台词/对话内容(dialogue)、解说词(narration)
2. 场景描述使用"场景A"、"场景B"、"场景C"等标记来标识不同场景
3. 首次出现的场景需要完整描述，格式为："场景A：古代宫殿大殿，金碧辉煌"
4. 重复出现的场景直接使用标记，格式为："场景A"（无需重复描述）
5. 场景描述必须是纯场景/环境描述，只描述地点、环境、氛围、光线等，禁止包含任何人物动作
6. 动作描述描述人物的核心动作（人物相关内容只能放在这里）
7. 角色标签只写出现在该分镜中的角色名称，多个角色用逗号分隔
8. 解说词用于旁白和场景过渡，保留原文的叙事内容
9. 台词要自然流畅，符合角色性格
10. 请直接输出JSON数组格式，不要添加任何额外文字`;

    const userMessage = userRequirement && userRequirement.trim()
      ? `【创作要求】${userRequirement.trim()}\n\n请将以下小说内容完整转换为分镜脚本，不要省略任何剧情：\n\n${novelContent}`
      : `请将以下小说内容完整转换为分镜脚本，不要省略任何剧情：\n\n${novelContent}`;

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage }
        ],
        temperature: this.getTemperature(),
        max_tokens: 80000
      })
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.statusText}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '[]';

    try {
      // 尝试直接解析
      return JSON.parse(content);
    } catch {
      try {
        // 尝试从内容中提取 JSON 数组：从第一个 [ 到最后一个 ]
        const firstBracket = content.indexOf('[');
        const lastBracket = content.lastIndexOf(']');
        if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
          const jsonStr = content.slice(firstBracket, lastBracket + 1);
          return JSON.parse(jsonStr);
        }
      } catch {
        // 都失败时记录错误并抛出
        console.error('Failed to parse script JSON:', content.substring(0, 500));
        throw new Error('AI 返回的脚本格式无法解析，请重试');
      }
      console.error('Failed to parse script JSON:', content.substring(0, 500));
      throw new Error('AI 返回的脚本格式无法解析，请重试');
    }
  }

  async generatePrompt(
    scene: Scene,
    mode: 'image' | 'video',
    gridMode?: 4 | 6 | 9,
    previousSceneLastPrompt?: string,
    onChunk?: (text: string) => void,
    selectedStyle?: { name: string; description: string },
    allSceneDescriptions?: string[],
    promptTemplate?: { positive_prompt: string; negative_prompt?: string },
    providerId?: string,
  ): Promise<string> {
    const providerConfig = await this.getProviderConfig(providerId);
    const apiUrl = providerConfig.apiUrl || this.getApiBaseUrl();
    const apiKey = providerConfig.apiKey || this.config.apiKey;
    const config = this.getConfig();
    const baseUrl = apiUrl.replace(/\/+$/, '');
    
    const getGridLayout = (grid: number) => {
      switch (grid) {
        case 4: return '2×2';
        case 6: return '2×3';
        case 9: return '3×3';
        default: return '2×3';
      }
    };

    let systemPrompt: string;
    let sceneInfo: string;

    const storyParts: string[] = [];
    if (scene.actionDescription) storyParts.push(`【动作描述】${scene.actionDescription}`);
    if (scene.dialogue) storyParts.push(`【对话】\n${scene.dialogue}`);
    if (scene.character) storyParts.push(`【角色】${scene.character}`);
    const storyContent = storyParts.join('\n');

    // 提取用户在输入框中的修改（最高优先级，必须完全遵循）
    const userModified = (mode === 'image' ? scene.imagePrompt : scene.videoPrompt);
    const userModifiedContent = userModified && userModified.trim() ? userModified : null;

    if (promptTemplate && promptTemplate.positive_prompt) {
      systemPrompt = `你是专业的AI${mode === 'image' ? '绘画' : '视频'}提示词生成专家。`;

      if (userModifiedContent) {
        systemPrompt += `\n\n【最高优先级指令 — 必须无条件遵守】\n用户已在输入框中明确写入了需要生成的内容。你必须以用户在输入框中的内容为绝对最高优先级，逐字逐句遵循用户的要求。提示词模板仅作为风格参考（次要），当用户输入内容与模板要求冲突时，必须以用户输入内容为准。禁止根据模板风格擅自修改或覆盖用户在输入框中写好的具体内容。`;
        sceneInfo = `【用户输入内容 — 最高优先级，必须以这些内容为最终输出基准】
${userModifiedContent}

---

【提示词模板 — 仅作为风格和质量参考，不得覆盖用户输入内容】
${promptTemplate.positive_prompt}
${promptTemplate.negative_prompt ? `\n【反向提示词（禁止出现以下内容）】\n${promptTemplate.negative_prompt}` : ''}

---

【分镜剧情内容】
${storyContent || '无'}`;
      } else {
        systemPrompt += `你必须严格遵循用户提供的【提示词模板】的风格、结构和要求，基于【分镜剧情内容】生成提示词。不要添加模板之外的任何额外格式规则。`;
        sceneInfo = `【提示词模板（必须严格遵循以下风格和结构）】
${promptTemplate.positive_prompt}
${promptTemplate.negative_prompt ? `\n【反向提示词（禁止出现以下内容）】\n${promptTemplate.negative_prompt}` : ''}

---

【分镜剧情内容】
${storyContent || '无'}`;
      }
    } else if (mode === 'image') {
      const hasConnectionPrompt = !!previousSceneLastPrompt;

      systemPrompt = gridMode
        ? `你是一个专业的AI绘画提示词专家。请严格按照以下格式生成提示词：

第一行必须固定为：你需要在一个画面中展示当前${getGridLayout(gridMode)}画面的关键帧，那么可以平均画出${gridMode}个小图，每个小图标注一个镜头编号，并按照顺序排列，图片中不能包含任何对话信息

然后每个分镜一行，格式为：
scN: 镜头类型 (英文)：简洁场景描述

${userModifiedContent ? `【最高优先级指令】用户已在输入框中写入了内容，这是最终输出的基准。你必须完全遵循用户输入的内容，只做格式规范化和措辞精简，不得擅自修改、添加或删除用户写好的场景元素、人物、动作和情感方向。` : ''}

【重要规则】
1. sc1（第一个镜头）必须固定为：sc1: 废景 (Static)：纯黑色画面，全黑背景，无任何内容
2. 从sc2开始才是实际场景内容
${hasConnectionPrompt ? `3. sc2必须承接【前一个分镜末尾镜头】的画面，确保镜头连贯衔接
4. 场景描述要简洁，只包含核心信息（人物、动作、表情）` : `3. 场景描述要简洁，只包含核心信息（人物、动作、表情）`}
5. 不要添加过多修饰词和无效描述
6. 镜头类型示例：中景 (Medium Shot)、特写 (Close-up)、过肩镜头 (Over-the-Shoulder Shot)、双人侧拍 (Two-Shot Side)`
        : `你是一个专业的AI绘画提示词专家。${userModifiedContent ? `【最高优先级指令】用户已在输入框中写入了内容，你必须以用户输入的内容为绝对基准，只做措辞优化和格式规范，不得擅自添加或删除用户写好的内容。` : '根据以下分镜信息，生成一段详细的图片生成提示词。'}
要求：
1. 提示词使用中文
2. 包含场景描述、人物动作、光影效果、画面构图等
3. 适合AI绘画模型使用
4. 直接输出提示词，不要添加任何额外说明`;

      sceneInfo = hasConnectionPrompt
        ? (userModifiedContent
          ? `【前一个分镜末尾镜头（sc2需要承接此画面）】\n${previousSceneLastPrompt}\n\n【用户输入内容 — 最高优先级，输出必须以此为准】\n${userModifiedContent}`
          : `【前一个分镜末尾镜头（sc2需要承接此画面）】\n${previousSceneLastPrompt}\n\n【当前分镜信息】\n${storyContent}`)
        : (userModifiedContent
          ? `【用户输入内容 — 最高优先级，输出必须以此为准】\n${userModifiedContent}`
          : storyContent);
    } else {
      const gridCount = gridMode || 6;
      const hasConnectionPrompt = !!previousSceneLastPrompt;
      const getGridTypes = (count: number): string[] => {
        const types = ['Anchor', 'Inheritance'];
        for (let i = 2; i < count - 1; i++) types.push('Variable');
        types.push('Action');
        return types;
      };
      const gridTypes = getGridTypes(gridCount);

      systemPrompt = `你是一个专业的AI视频提示词专家。请根据【图片提示词】和【原视频提示词】两者结合，生成【Grid分镜】格式的优化视频提示词。

${userModifiedContent ? `【最高优先级指令】用户已在输入框中写入了视频提示词内容，这是最终输出的基准。你必须以用户输入的内容为绝对最高优先级，只做格式规范化和措辞精简，保留用户指定的所有场景元素、镜头运动和视觉效果。不得擅自添加用户未提及的新内容，不得修改用户已写好的关键描述。` : ''}

【输出格式要求】必须严格按照以下格式输出，共${gridCount}个Grid：

【Grid分镜】
Grid 1 (Anchor) 废景 | Static | 全黑画面
Solid black screen. No audio. Silence. Static image.
Grid 2 (Inheritance) [景别] | [镜头运动类型] | [主体描述] | [Camera]镜头运动 | [Visuals]视觉内容 | [Physics]物理效果 | [动态细节]动态细节补充
...直至 Grid ${gridCount} ...

【重要规则】
1. Grid 1 固定为废景黑屏
2. 从Grid 2开始为实际场景
${hasConnectionPrompt ? '3. Grid 2必须承接前一个分镜末尾镜头确保连贯\n' : ''}4. 只使用分镜输入框中的对话，禁止自行添加
5. 直接输出提示词，不要添加任何额外说明`;

      const characterAnchor = scene.character
        ? `\n\n【角色面部特征锚定】\n${scene.character}的面部特征必须在所有镜头中保持一致`
        : '';

      sceneInfo = hasConnectionPrompt
        ? `【需要生成${gridCount}个Grid分镜】\nGrid类型：${gridTypes.join(' → ')}${userModifiedContent ? `\n\n【用户输入内容 — 最高优先级，输出必须以此为准】\n${userModifiedContent}` : ''}\n\n【前一个分镜末尾镜头（Grid 2承接）】\n${previousSceneLastPrompt}\n\n【图片提示词】\n${scene.imagePrompt || '无'}\n\n【分镜对话】\n${scene.dialogue || '无'}${characterAnchor}`
        : `【需要生成${gridCount}个Grid分镜】\nGrid类型：${gridTypes.join(' → ')}${userModifiedContent ? `\n\n【用户输入内容 — 最高优先级，输出必须以此为准】\n${userModifiedContent}` : ''}\n\n【图片提示词】\n${scene.imagePrompt || '无'}\n\n【分镜对话】\n${scene.dialogue || '无'}${characterAnchor}`;
    }

    if (systemPrompt === undefined || sceneInfo === undefined) {
      throw new Error('generatePrompt: systemPrompt or sceneInfo not set');
    }

    // 如果提供了 onChunk 回调，使用流式输出
    if (onChunk) {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: config.chatModel || 'gemini-3-flash-preview',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: sceneInfo }
          ],
          temperature: this.getTemperature(),
          stream: true
        })
      });

      if (!response.ok) {
        throw new Error(`Prompt generation error: ${response.statusText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let fullText = '';
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;
          const data = trimmed.slice(6);
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              fullText += delta;
              onChunk(fullText);
            }
          } catch {
            // 忽略解析错误
          }
        }
      }

      return fullText;
    }

    // 非流式：原有逻辑
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.chatModel || 'gemini-3-flash-preview',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: sceneInfo }
        ],
        temperature: this.getTemperature()
      })
    });

    if (!response.ok) {
      throw new Error(`Prompt generation error: ${response.statusText}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || '';
  }

  async generateImage(
    scene: Scene, 
    characters?: Character[],
    options?: { aspectRatio?: string; imageSize?: string; style?: Style; generationMode?: GenerationMode; gridMode?: number; model?: string; providerId?: string }
  ): Promise<string> {
    const providerConfig = await this.getProviderConfig(options?.providerId);
    const apiUrl = providerConfig.apiUrl || this.getApiBaseUrl();
    const apiKey = providerConfig.apiKey || this.config.apiKey;
    const config = this.getConfig();
    const baseUrl = apiUrl.replace(/\/+$/, '');
    const imageModel = options?.model || config.imageModel || DEFAULT_MODELS.image;
    console.log('[generateImage] model:', imageModel, 'providerId:', options?.providerId, 'apiUrl:', baseUrl);
    
    console.log('[AIService] generateImage 被调用');
    console.log('[AIService] scene.prompt:', scene.prompt);
    console.log('[AIService] 传入角色数量:', characters?.length || 0);
    
    // ========== 第一步：先收集所有参考图 ==========
    // 这样可以确保提示词中的编号与实际参考图数组索引一一对应
    
    const referenceImages: string[] = [];
    const successfulCharacters: Character[] = []; // 只保留成功获取参考图的角色
    
    // 1. 收集角色参考图（按顺序处理，保持顺序一致性）
    if (characters && characters.length > 0) {
      for (const char of characters) {
        try {
          let charImage: string | null = null;
          
          // 优先从媒体服务获取
          const mediaBase64 = await getMedia('character', char.id);
          if (mediaBase64) {
            console.log('[AIService] 从媒体服务获取角色参考图:', char.name);
            charImage = await compressImage(mediaBase64, 1024, 0.8);
          }
          // 回退：使用 Blob
          else if (char.referenceImageBlob) {
            console.log('[AIService] 使用角色Blob参考图:', char.name);
            const base64 = await blobToBase64(char.referenceImageBlob);
            charImage = await compressImage(base64, 1024, 0.8);
          }
          // 回退：使用 referenceImage 字段
          else if (char.referenceImage && !char.referenceImage.startsWith('blob:')) {
            if (isUrl(char.referenceImage)) {
              try {
                const response = await fetch(char.referenceImage);
                if (response.ok) {
                  const blob = await response.blob();
                  const base64 = await blobToBase64(blob);
                  charImage = await compressImage(base64, 1024, 0.8);
                  console.log('[AIService] 从远程URL获取角色参考图:', char.name);
                }
              } catch (error) {
                console.warn('[AIService] 获取远程角色参考图失败:', char.name, error);
              }
            } else {
              charImage = await processReferenceImage(char.referenceImage, 1024);
              console.log('[AIService] 使用角色Base64参考图:', char.name);
            }
          }
          
          // 只有成功获取参考图的角色才加入列表
          if (charImage) {
            referenceImages.push(charImage);
            successfulCharacters.push(char);
          } else {
            console.warn('[AIService] 角色参考图获取失败，跳过:', char.name);
          }
        } catch (error) {
          console.error('[AIService] 处理角色参考图时出错:', char.name, error);
        }
      }
    }
    
    const charRefCount = successfulCharacters.length;
    console.log('[AIService] 成功获取的角色参考图数量:', charRefCount);
    
    // 2. 收集风格参考图
    let hasStyleRef = false;
    if (options?.style) {
      let styleImage: string | null = null;
      
      if (options.style.id) {
        const styleMediaBase64 = await getMedia('style', options.style.id);
        if (styleMediaBase64) {
          styleImage = await compressImage(styleMediaBase64, 1024, 0.8);
          console.log('[AIService] 从媒体服务获取风格参考图');
        }
      }
      
      if (!styleImage && options.style.referenceImageBlob) {
        const base64 = await blobToBase64(options.style.referenceImageBlob);
        styleImage = await compressImage(base64, 1024, 0.8);
        console.log('[AIService] 使用风格Blob参考图');
      }
      
      if (!styleImage && options.style.referenceImage && !options.style.referenceImage.startsWith('blob:')) {
        styleImage = await processReferenceImage(options.style.referenceImage, 1024);
        console.log('[AIService] 使用风格URL/Base64参考图');
      }
      
      if (styleImage) {
        referenceImages.push(styleImage);
        hasStyleRef = true;
      }
    }
    
    // 3. 收集场景背景图
    let hasSceneBackground = false;
    if (scene.images?.storyboard && !scene.images.storyboard.startsWith('blob:')) {
      try {
        const processedStoryboard = await processReferenceImage(scene.images.storyboard, 1024);
        referenceImages.push(processedStoryboard);
        hasSceneBackground = true;
        console.log('[AIService] 添加场景背景图');
      } catch (error) {
        console.warn('[AIService] 处理场景背景图失败:', error);
      }
    }
    
    console.log('[AIService] 总参考图数量:', referenceImages.length);
    
    // ========== 第二步：基于实际成功的参考图生成提示词 ==========
    // 确保提示词中的编号与参考图数组索引完全匹配
    
    let finalPrompt = '';
    
    // 1. 角色身份映射（只包含成功获取参考图的角色）
    if (successfulCharacters.length > 0) {
      finalPrompt += `Generate an image featuring the following characters from the attached reference photos:\n`;
      successfulCharacters.forEach((char, index) => {
        // index + 1 对应 referenceImages[index]
        finalPrompt += `- Reference image ${index + 1} is "${char.name}"${char.description ? ` (${char.description})` : ''}\n`;
      });
      finalPrompt += `Maintain exact facial features and characteristics for each person.\n\n`;
    }
    
    // 2. 风格要求
    if (hasStyleRef) {
      const styleRefIndex = charRefCount + 1;
      finalPrompt += `【STYLE REFERENCE】\n`;
      finalPrompt += `Reference image ${styleRefIndex} defines the art style. Replicate the color palette, brush strokes, and artistic atmosphere.\n\n`;
      if (options?.style?.description) {
        finalPrompt += `Style notes: ${options.style.description}\n\n`;
      }
    }
    
    // 3. 场景背景参考图
    if (hasSceneBackground) {
      const sceneRefIndex = charRefCount + (hasStyleRef ? 1 : 0) + 1;
      finalPrompt += `Background: Use reference image ${sceneRefIndex} as the scene background.\n\n`;
    }
    
    // 4. 分镜格式
    if (options?.gridMode) {
      const gridFormatMap: Record<number, string> = {
        4: '2x2 comic panel layout with 4 frames',
        6: '2x3 comic panel layout with 6 frames', 
        9: '3x3 comic panel layout with 9 frames'
      };
      if (gridFormatMap[options.gridMode]) {
        finalPrompt += `Layout: ${gridFormatMap[options.gridMode]}.\n`;
      }
    }
    
    // 5. 场景内容
    if (finalPrompt.trim()) {
      finalPrompt += `\nScene: ${scene.prompt}`;
    } else {
      finalPrompt = scene.prompt;
    }
    
    // ========== 第三步：构建请求 ==========
    const payload: Record<string, unknown> = {
      prompt: finalPrompt,
      model: imageModel,
      response_format: 'url',
      aspect_ratio: options?.aspectRatio || '16:9'
    };

    if (imageModel.includes('nano-banana-2') && options?.imageSize) {
      payload.image_size = options.imageSize;
    }
    
    if (referenceImages.length > 0) {
      payload.image = referenceImages;
    }

    console.log('[AIService] 最终提示词:', finalPrompt);
    console.log('[AIService] 发送请求到:', `${baseUrl}/images/generations`);
    
    const response = await fetch(`${baseUrl}/images/generations`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    console.log('[AIService] 响应状态:', response.status, response.statusText);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[AIService] 请求失败:', errorText);
      throw new Error(`Image generation error: ${response.statusText}`);
    }

    const data = await response.json();
    console.log('[AIService] 响应数据:', JSON.stringify(data, null, 2));
    return data.data?.[0]?.url || '';
  }

  async optimizeCharacterPrompt(userPrompt: string): Promise<string> {
    const config = this.getConfig();
    const apiUrl = this.getApiBaseUrl();
    
    const systemPrompt = `你是一个专业的AI角色设计师。请根据用户输入的角色描述，生成一个用于生成角色四视图的优化提示词。

要求：
1. 四视图设计：
   - 正面近景（上半身近景，确保脸部清晰可辨）
   - 正面全身（全身站立，展示完整服装和体态）
   - 侧面全身（全身侧面，展示轮廓和侧面特征）
   - 背面全身（全身背面，展示背部服装和发型）
2. 背景统一为纯白色
3. 保留用户描述的角色风格、服装、发型、配饰等特征
4. 提示词要简洁专业，适合AI图像生成
5. 只输出优化后的提示词，不要输出其他内容
6. 使用中文输出

输出格式示例：
角色设计图，纯白色背景，四视图：正面近景（上半身，脸部清晰特征），正面全身（完整站姿），侧面全身（侧面轮廓），背面全身（背部细节）。[角色特征描述]`;

    const response = await fetch(`${apiUrl}/chat/completions`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        model: config.chatModel || 'gemini-3-flash-preview',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `请优化以下角色描述为四视图提示词：\n\n${userPrompt}` }
        ],
        temperature: this.getTemperature()
      })
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.statusText}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content?.trim() || userPrompt;
  }

  async optimizeScenePrompt(userPrompt: string, providerId?: string): Promise<string> {
    const providerConfig = await this.getProviderConfig(providerId);
    const apiUrl = providerConfig.apiUrl || this.getApiBaseUrl();
    const apiKey = providerConfig.apiKey || this.config.apiKey;
    const config = this.getConfig();
    const baseUrl = apiUrl.replace(/\/+$/, '');
    
    const systemPrompt = `你是一个专业的AI场景设计师。请根据用户输入的场景描述，生成一个用于生成场景图的优化提示词。

要求：
1. 这是一张纯场景图，禁止包含任何人物、角色或人形生物
2. 详细描述场景的环境、光线、氛围、色调
3. 包含场景的建筑、自然元素、道具等细节
4. 提示词要简洁专业，适合AI图像生成
5. 只输出优化后的提示词，不要输出其他内容
6. 【重要】必须使用中文输出

输出格式示例：
黄昏时分的古代中式庭院，传统木质建筑配有弯曲的屋顶，石板小径，盛开的樱花，温暖的金色夕阳光线穿透而过，朦胧的氛围，无人物，电影级构图，高度细节`;

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.chatModel || 'gemini-3-flash-preview',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `请优化以下场景描述为场景图提示词（禁止包含人物，使用中文）：\n\n${userPrompt}` }
        ],
        temperature: this.getTemperature()
      })
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.statusText}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content?.trim() || userPrompt;
  }

  /**
   * 多视角全景场景图提示词优化
   * 生成场景的前、后、左、右、俯视、仰视六个视角合并到一张图中的提示词
   * 用于让 AI 视频模型理解场景的完整空间结构，确保视频生成中的场景完全一致性
   */
  async optimizeSceneMultiViewPrompt(userPrompt: string): Promise<string> {
    const providerConfig = await this.getProviderConfig();
    const apiUrl = providerConfig.apiUrl || this.getApiBaseUrl();
    const apiKey = providerConfig.apiKey || this.config.apiKey;
    const config = this.getConfig();
    const baseUrl = apiUrl.replace(/\/+$/, '');

    const systemPrompt = `你是一个专业的影视场景设计总监和AI空间构图专家。请根据用户输入的场景描述，生成一个极其专业的"多视角全景场景参考图"优化提示词。这张图将作为AI视频模型的场景空间理解输入。

【核心目标】
将一个完整的场景空间，以专业的3×2网格六视图方式呈现在一张图中，让AI视频模型能够理解：
- 场景的完整空间拓扑结构
- 每个方向的具体视觉特征
- 物体在不同视角的空间对应关系
从而确保视频生成中场景视点切换时的完全一致性。

【画面布局专业要求】
采用3行×2列的网格布局，6个等大格子，每个格子之间用2px白色细线分隔，四角标注视角名称。

第1行第1格 — 【正面视角 FRONT VIEW】（底部居中标注"正面 FRONT"）：
场景正前方视角，展示场景的主要面貌。必须包含：入口/门的位置、主墙体结构、标志性装饰元素、前景与背景的纵深关系。
第1行第2格 — 【背面视角 BACK VIEW】（底部居中标注"背面 BACK"）：
从场景最深处向入口方向看。必须包含：背面墙壁结构、窗户位置、门的背面视角、与正面视角的空间对应关系。
第2行第1格 — 【左侧视角 LEFT VIEW】（底部居中标注"左侧 LEFT"）：
从场景左侧垂直观察。必须包含：左侧墙面的完整结构、墙上的装饰/开口、侧面的空间深度感、左侧与正面之间的转角和过渡。
第2行第2格 — 【右侧视角 RIGHT VIEW】（底部居中标注"右侧 RIGHT"）：
从场景右侧垂直观察。必须包含：右侧墙面的完整结构、与左侧视角的对称或差异、右侧特有的元素。
第3行第1格 — 【俯视视角 TOP VIEW】（底部居中标注"俯视 TOP"）：
从正上方向下垂直俯瞰，展示场景的完整平面布局。必须包含：地板材质和纹理、家具/道具的精确位置和朝向、空间的几何形状、行走路径和功能分区。使用平面图风格。
第3行第2格 — 【仰视视角 BOTTOM VIEW】（底部居中标注"仰视 BOTTOM"）：
从场景底部向上垂直看。必须包含：天花板结构（平顶/穹顶/梁架）、灯具的形状和位置、顶部装饰元素、屋顶的材质纹理。

【文字标注强制要求】
- 每个格子的底部居中位置，必须包含视角名称的中英文标注，使用白色或浅色文字
- 字体大小适中，清晰可读，不遮挡场景内容
- 图的上方中央标注场景的完整名称（如"古代宫殿大殿 — 六视图场景参考"），使用大号标题文字
- 图的右下角标注"AI视频场景一致性参考图"，小号灰色文字

【场景一致性强制要求】
- 所有6个视角必须是完全相同的场景空间，任何物体的形状、颜色、材质在所有视角中必须完全一致
- 同一物体在不同视角中的相对位置必须符合几何投影关系（俯视图中的位置 = 正面图中位置的垂直投影）
- 光照方向和强度在所有视角中统一：明确指定主光源方向（如"主光从正前方窗户射入"）并在6个视角中保持
- 色彩调性、色温、饱和度、对比度在所有视角中完全一致
- 时段和氛围统一：明确指定（白天/黄昏/夜晚/清晨）并在6个视角中一致表现

【画质与风格要求】
- 使用写实渲染风格（Photorealistic Rendering）
- 电影级画质（Cinematic Quality）
- 超高细节（Ultra-high Detail）、4K分辨率
- 专业建筑可视化风格（Architectural Visualization）
- 全局光照（Global Illumination）、环境光遮蔽（Ambient Occlusion）

【禁止事项】
- 严格禁止任何人物、角色、人形生物、动物、鸟类、昆虫
- 禁止视角之间出现风格跳跃或不一致
- 禁止遗漏任何一个视角的标注文字
- 禁止网格分隔线过粗（不超过2px）

【输出格式】
直接输出优化后的完整中文提示词，不要添加任何额外解释。提示词必须按以下结构组织：

"多视角场景场景全景参考图，3×2网格六视图布局，图上方标题文字'[场景名称] — 六视图场景参考'，每个格子底部居中标注视角名称。视角一【正面 FRONT】：[详细的空间描述]。视角二【背面 BACK】：[详细的空间描述]。视角三【左侧 LEFT】：[详细的空间描述]。视角四【右侧 RIGHT】：[详细的空间描述]。视角五【俯视 TOP】：[详细的空间描述]。视角六【仰视 BOTTOM】：[详细的空间描述]。六个视角为同一场景空间，[光照描述]，[氛围/时段描述]，[色调描述]。物体位置在六个视角中完全对应一致。右下角小字标注'AI视频场景一致性参考图'。纯场景无人物，写实渲染，建筑可视化风格，电影级画质，4K，全局光照，超高细节。"`;

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.chatModel || 'gemini-3-flash-preview',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `请根据以下场景描述，生成一个极其专业的多视角全景场景参考图提示词（3×2网格六视图 + 中英文文字标注 + 场景名称 + 建筑可视化风格）：\n\n${userPrompt}` }
        ],
        temperature: this.getTemperature()
      })
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.statusText}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content?.trim() || userPrompt;
  }

  async optimizeStylePrompt(userPrompt: string): Promise<string> {
    const config = this.getConfig();
    const apiUrl = this.getApiBaseUrl();
    
    const systemPrompt = `你是一个专业的AI绘画风格顾问。请根据用户输入的风格描述，优化为一段更专业、更详细、更适合AI图像生成的中文风格提示词。

要求：
1. 保留用户原始描述的核心风格方向
2. 补充专业的艺术术语和技法描述，如色调、光影、笔触、构图风格、画面氛围等
3. 添加适合AI绘画模型理解的关键词
4. 提示词要简洁专业，不要过于冗长（控制在150字以内）
5. 只输出优化后的风格提示词，不要输出其他内容
6. 必须使用中文输出

输出格式示例：
赛博朋克风格，霓虹灯光映射下的未来都市，高饱和度青紫色调，强对比度明暗光影，潮湿路面反射光效，精细线条勾勒建筑轮廓，电影级广角构图，细节丰富，氛围感极强`;

    const response = await fetch(`${apiUrl}/chat/completions`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        model: config.chatModel || 'gemini-3-flash-preview',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `请优化以下风格描述为更专业的风格提示词：\n\n${userPrompt}` }
        ],
        temperature: this.getTemperature()
      })
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.statusText}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content?.trim() || userPrompt;
  }

  async optimizeVoiceType(characterDescription: string, currentVoiceType: string): Promise<string> {
    const config = this.getConfig();
    const apiUrl = this.getApiBaseUrl();
    
    const systemPrompt = `你是一个专业的配音导演。请根据角色描述，生成适合该角色的音色描述提示词。

要求：
1. 根据角色的性别、年龄、性格、身份等特征，推荐合适的音色
2. 描述要具体，包括音色特点、语调风格、情感表达等
3. 只输出优化后的音色描述，不要输出其他内容
4. 使用中文输出
5. 描述要简洁专业，适合TTS语音合成

输出格式示例：
成熟稳重的男中音，语调沉稳有力，带有威严感，适合领导者或长辈角色`;

    const userMessage = currentVoiceType 
      ? `角色描述：${characterDescription}\n\n当前音色描述：${currentVoiceType}\n\n请优化音色描述。`
      : `角色描述：${characterDescription}\n\n请为该角色生成合适的音色描述。`;

    const response = await fetch(`${apiUrl}/chat/completions`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        model: config.chatModel || 'gemini-3-flash-preview',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage }
        ],
        temperature: this.getTemperature()
      })
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.statusText}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content?.trim() || currentVoiceType;
  }

  /**
   * AI 导演优化提示词（流式输出，双通道分流）
   * 返回 { analysis: 导演分析, optimized: 优化后提示词 }
   * analysis 供预览弹窗展示，optimized 写入分镜输入框
   */
  async optimizePromptAsDirector(
    currentPrompt: string,
    mode: 'image' | 'video',
    sceneContext?: {
      actionDescription?: string;
      dialogue?: string;
      character?: string;
      sceneDescription?: string;
    },
    onAnalysisChunk?: (text: string) => void,
    onOptimizedChunk?: (text: string) => void,
    directorTemplate?: PromptTemplate,
  ): Promise<{ analysis: string; optimized: string }> {
    const config = this.getConfig();
    const apiUrl = this.getApiBaseUrl();

    const typeLabel = mode === 'image' ? '图片' : '视频';

    // 系统提示词 = 正提示词 + 反提示词配对；用户消息 = 输入框提示词原文
    let systemPrompt = directorTemplate?.positive_prompt
      || `你是一位顶级影视导演。请优化以下${typeLabel}提示词。`;
    if (directorTemplate?.negative_prompt) {
      systemPrompt += `\n\n【禁止出现以下内容】\n${directorTemplate.negative_prompt}`;
    }

    const userMessage = currentPrompt;

    // 流式输出 + 双通道分流
    if (onAnalysisChunk && onOptimizedChunk) {
      const response = await fetch(`${apiUrl}/chat/completions`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          model: config.chatModel || 'gemini-3-flash-preview',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage }
          ],
          temperature: this.getTemperature(),
          stream: true
        })
      });

      if (!response.ok) {
        throw new Error(`Director optimization error: ${response.statusText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let rawText = '';
      let buffer = '';
      // 追踪分隔线是否已经出现
      let splitHappened = false;
      let afterSplit = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;
          const data = trimmed.slice(6);
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (!delta) continue;
            rawText += delta;

            if (!splitHappened) {
              const splitIdx = rawText.indexOf('\n---\n');
              if (splitIdx !== -1 || rawText.indexOf('\r\n---\r\n') !== -1) {
                splitHappened = true;
                const idx = splitIdx !== -1 ? splitIdx : rawText.indexOf('\r\n---\r\n');
                onAnalysisChunk(rawText.substring(0, idx));
                afterSplit = rawText.substring(idx + 4);
                onOptimizedChunk(this._extractOptimizedContent(afterSplit));
              } else {
                onAnalysisChunk(rawText);
              }
            } else {
              afterSplit += delta;
              onOptimizedChunk(this._extractOptimizedContent(afterSplit));
            }
          } catch {
            // 忽略解析错误
          }
        }
      }

      // 流式结束后，若始终未找到分隔符，将全文推送到优化通道
      if (!splitHappened && onOptimizedChunk) {
        onOptimizedChunk(rawText);
      }

      // 最终分离
      const finalResult = this._splitDirectorOutput(rawText);
      return finalResult;
    }

    // 非流式回退
    const response = await fetch(`${apiUrl}/chat/completions`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        model: config.chatModel || 'gemini-3-flash-preview',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage }
        ],
        temperature: this.getTemperature()
      })
    });

    if (!response.ok) {
      throw new Error(`Director optimization error: ${response.statusText}`);
    }

    const data = await response.json();
    const fullText = data.choices?.[0]?.message?.content?.trim() || '';
    return this._splitDirectorOutput(fullText);
  }

  // ── 辅助：分隔 AI 导演输出（私有方法） ──

  private _splitDirectorOutput(rawText: string): { analysis: string; optimized: string } {
    const separators = ['\n---\n', '\r\n---\r\n', '\n***\n', '\r\n***\r\n'];
    for (const sep of separators) {
      const idx = rawText.indexOf(sep);
      if (idx !== -1) {
        return {
          analysis: rawText.substring(0, idx).trim(),
          optimized: rawText.substring(idx + sep.length).trim(),
        };
      }
    }
    return { analysis: '', optimized: rawText };
  }

  private _extractOptimizedContent(text: string): string {
    return text.trim();
  }

  // ===== 视频模型配置（每个模型自带端点+参数映射，互不冲突） =====
  private static VIDEO_CONFIGS: Record<string, {
    createPath: string;
    queryPath: string;
    useSize: boolean;
    useCharacterVoices: boolean;
    qualityPrefix: string;
    aspectField: string;       // 宽高比字段名，如 'aspect_ratio' 或 'size'
    resolutionField: string;   // 分辨率字段名，如 'size' 或 'resolution'
    responseTaskId: string;
    responseVideoUrl: string;
  }> = {
    'sora-2': {
      createPath: '/videos/generations', queryPath: '/videos/generations/{id}',
      useSize: false, useCharacterVoices: true,
      qualityPrefix: '[Cinematic quality, sharp focus, high detail, crisp textures, 4K aesthetic] [Maintain consistent facial features throughout all shots, clear recognizable faces, no facial distortion] ',
      aspectField: 'aspect_ratio', resolutionField: 'size',
      responseTaskId: 'task_id', responseVideoUrl: 'data.output',
    },
    'veo-3': {
      createPath: '/video/create', queryPath: '/video/query?id={id}',
      useSize: true, useCharacterVoices: false,
      qualityPrefix: '',
      aspectField: 'aspect_ratio', resolutionField: 'size',
      responseTaskId: 'id', responseVideoUrl: 'video_url',
    },
    'grok-video-3': {
      createPath: '/video/create', queryPath: '/video/query?id={id}',
      useSize: true, useCharacterVoices: false,
      qualityPrefix: '',
      aspectField: 'aspect_ratio', resolutionField: 'size',
      responseTaskId: 'id', responseVideoUrl: 'video_url',
    },
    'doubao-seedance-2.0': {
      createPath: '/videos/generations', queryPath: '/tasks/{id}',
      useSize: false, useCharacterVoices: false,
      qualityPrefix: '',
      aspectField: 'size', resolutionField: 'resolution',
      responseTaskId: 'data[0].task_id', responseVideoUrl: 'video_url',
    },
    'viduq3': {
      createPath: '/video/create', queryPath: '/video/query?id={id}',
      useSize: true, useCharacterVoices: false,
      qualityPrefix: '',
      aspectField: 'aspect_ratio', resolutionField: 'size',
      responseTaskId: 'id', responseVideoUrl: 'video_url',
    },
    'kling': {
      createPath: '/video/create', queryPath: '/video/query?id={id}',
      useSize: true, useCharacterVoices: false,
      qualityPrefix: '',
      aspectField: 'aspect_ratio', resolutionField: 'size',
      responseTaskId: 'id', responseVideoUrl: 'video_url',
    },
  };

  private getVideoConfig(model: string) {
    // 先精确匹配，再前缀匹配
    if (AIGenerationService.VIDEO_CONFIGS[model]) return AIGenerationService.VIDEO_CONFIGS[model];
    for (const [key, cfg] of Object.entries(AIGenerationService.VIDEO_CONFIGS)) {
      if (model.startsWith(key) || model.includes(key)) return cfg;
    }
    // fallback: 默认Sora格式
    return AIGenerationService.VIDEO_CONFIGS['sora-2'];
  }

  async generateVideo(
    scene: Scene & { _originalPrompt?: string }, 
    characters?: Character[],
    options?: { style?: Style; generationMode?: GenerationMode; duration?: string; enhancePrompt?: boolean; enableUpsample?: boolean }
  ): Promise<{ taskId: string; isVeoTask: boolean }> {
    const providerConfig = await this.getProviderConfig((options as any)?.providerId);
    const apiUrl = providerConfig.apiUrl || this.getApiBaseUrl();
    const apiKey = providerConfig.apiKey || this.config.apiKey;
    const config = this.getConfig();
    const baseUrl = apiUrl.replace(/\/+$/, '');
    const videoModel = (options as any)?.model || config.videoModel || 'sora-2';
    console.log('[generateVideo] model:', videoModel, 'providerId:', (options as any)?.providerId, 'apiUrl:', baseUrl);
    const vcfg = this.getVideoConfig(videoModel);
    
    // 提示词处理
    let prompt = scene.prompt;
    if (options?.style && options?.generationMode === 'text-to-video') {
      prompt = `【风格要求】${options.style.description}。【画面内容】${scene._originalPrompt || scene.prompt}`;
    }
    // 角色音色（仅部分模型）
    if (vcfg.useCharacterVoices && characters && characters.length > 0) {
      const voices = characters.filter(c => c.voiceType?.trim()).map(c => `- ${c.name}: ${c.voiceType}`).join('\n');
      if (voices) prompt = `Character Voices:\n${voices}\n\n${prompt}`;
    }
    // 画质前缀（仅部分模型）
    if (vcfg.qualityPrefix) prompt = vcfg.qualityPrefix + prompt;
    
    // 构建 payload（字段名由配置决定）
    const payload: Record<string, unknown> = { prompt, model: videoModel };
    const ratio = ((options as any)?.aspectRatio || '16:9').split(' ')[0];
    payload[vcfg.aspectField] = ratio.includes(':') ? ratio : '16:9';
    if (vcfg.useSize) {
      const res = (options as any)?.resolution || (options?.enableUpsample ? '1080P' : '720P');
      payload[vcfg.resolutionField] = res;
      if (options?.enhancePrompt !== undefined) payload.enhance_prompt = options.enhancePrompt;
    } else {
      payload.duration = parseInt(options?.duration as string || '10');
      if (vcfg.resolutionField && vcfg.resolutionField !== 'size') {
        const res = (options as any)?.resolution || '720p';
        payload[vcfg.resolutionField] = res.replace(/[^0-9p]/gi, '').toLowerCase();
      }
    }

    // 视频生成只接收勾选"参考"的图片预览框图片
    // 禁止发送角色参考图和风格参考图给视频生成
    // 优化：将4K图片压缩到1080p再发送，减少传输时间和失败率
    if (scene.useImageAsReference && scene.images.keyFrame) {
      const keyFrame = scene.images.keyFrame;
      try {
        // 如果是外部URL，需要先下载再压缩（避免CORS问题）
        if (keyFrame.startsWith('http://') || keyFrame.startsWith('https://')) {
          // 下载图片为Blob
          const response = await fetch(keyFrame);
          const blob = await response.blob();
          const base64 = await blobToBase64(blob);
          // 压缩到1920px（1080p），质量85%
          const compressedImage = await compressImage(base64, 1920, 0.85);
          payload.images = [compressedImage];
          console.log('[AIService] 视频参考图已下载并压缩到1080p');
        } else {
          // 已经是Base64，直接压缩
          const compressedImage = await compressImage(keyFrame, 1920, 0.85);
          payload.images = [compressedImage];
          console.log('[AIService] 视频参考图已压缩到1080p');
        }
      } catch (err) {
        // 压缩失败时使用原图
        console.warn('[AIService] 图片压缩失败，使用原图:', err);
        payload.images = [keyFrame];
      }
    }

    const videoBase = baseUrl.replace(/\/v1$/, '') + '/v1';
    
    console.log(`[AIService] 视频模型: ${videoModel}, 配置: ${vcfg.createPath}`);
    
    // 重试机制
    const MAX_RETRIES = 3;
    let lastError: Error | null = null;
    
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        console.log(`[AIService] 视频生成请求，第 ${attempt} 次尝试`);
        
        const endpoint = `${videoBase}${vcfg.createPath}`;
        
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          const msg = (errData as any).error?.message || response.statusText || `HTTP ${response.status}`;
          if (response.status === 404) throw new Error(`该API平台不支持视频生成 (404)`);
          throw new Error(`视频生成失败 (${response.status}): ${msg}`);
        }

        const data = await response.json();
        console.log(`[AIService] 视频生成请求成功`, data);
        
        // 用配置的字段名解析任务ID（支持 data[0].task_id 数组路径）
        const getByPath = (obj: any, path: string): any => {
          const parts = path.match(/(\w+)|\[(\d+)\]/g) || [];
          let cur = obj;
          for (const p of parts) {
            if (p.startsWith('[')) { cur = cur?.[parseInt(p.slice(1,-1))]; }
            else { cur = cur?.[p]; }
            if (cur === undefined || cur === null) return undefined;
          }
          return cur;
        };
        const taskId = getByPath(data, vcfg.responseTaskId) || data.id || data.task_id;
        if (!taskId) throw new Error('视频任务创建失败：响应中缺少任务ID');
        return { taskId, isVeoTask: vcfg.useSize };
      } catch (err) {
        lastError = err as Error;
        console.warn(`[AIService] 视频生成请求失败 (第 ${attempt} 次):`, err);
        
        // 404/4xx不重试，直接抛出
        if ((err as Error).message.includes('404') || (err as Error).message.includes('不支持')) throw err;
        
        // 如果不是最后一次尝试，等待后重试（指数退避：2s, 4s, 8s）
        if (attempt < MAX_RETRIES) {
          const waitTime = Math.pow(2, attempt) * 1000;
          console.log(`[AIService] ${waitTime / 1000} 秒后重试...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
      }
    }
    
    // 所有重试都失败
    throw lastError || new Error('Video generation failed after retries');
  }

  async generateCharacterNames(userIdea: string): Promise<{ role: string; name: string; description: string }[]> {
    const config = this.getConfig();
    const apiUrl = this.getApiBaseUrl();
    
    const systemPrompt = `你是一个专业的小说角色起名专家。请根据用户的想法和需求，生成合适的角色名字。

要求：
1. 根据用户描述的故事背景、风格、时代等信息，生成符合情境的角色名字
2. 为每个角色提供：角色类型(role)、名字(name)、简短描述(description)
3. 角色类型包括但不限于：主角、女主、反派、配角、师傅、朋友等
4. 名字要有意境，符合角色性格和故事氛围
5. 直接输出JSON数组格式，不要添加任何额外文字

输出格式示例：
[
  {"role": "主角", "name": "林逸", "description": "性格坚毅，心怀正义"},
  {"role": "女主", "name": "苏婉儿", "description": "温婉聪慧，善解人意"},
  {"role": "反派", "name": "魔尊", "description": "野心勃勃，手段狠辣"}
]`;

    const response = await fetch(`${apiUrl}/chat/completions`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        model: config.chatModel || 'gemini-3-flash-preview',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `请根据以下想法生成角色名字：\n\n${userIdea}` }
        ],
        temperature: this.getTemperature()
      })
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.statusText}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '[]';
    
    try {
      const jsonMatch = content.match(/\[\s*\{[\s\S]*\}\s*\]/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      return JSON.parse(content);
    } catch {
      console.error('Failed to parse character names:', content);
      return [];
    }
  }

  async regenerateScript(currentScript: string, userRequirement: string): Promise<string> {
    const config = this.getConfig();
    const apiUrl = this.getApiBaseUrl();

    const systemPrompt = `你是一个专业的漫剧脚本编辑专家。用户会提供一份已经生成好的分镜脚本，以及他们的优化需求。
请根据用户的需求，对脚本进行修改和优化，生成符合用户要求的新脚本。

【重要规则】
1. 必须保持与原脚本相同的格式结构（【分镜 N】、角色：、场景：、对话：、旁白：、动作：）
2. 根据用户需求调整内容，可以增删分镜、修改对话、调整场景描述等
3. 保持故事的连贯性和逻辑性
4. 直接输出修改后的完整脚本，不要添加任何额外说明或解释
5. 如果用户要求增加分镜，请按顺序编号
6. 如果用户要求删减，请重新编号保持连续`;

    const userContent = `【当前脚本】\n${currentScript}\n\n【用户优化需求】\n${userRequirement}\n\n请根据以上需求，输出修改后的完整脚本：`;

    const response = await fetch(`${apiUrl}/chat/completions`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        model: config.chatModel || 'gemini-3-flash-preview',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent }
        ],
        temperature: this.getTemperature()
      })
    });

    if (!response.ok) { await this.throwApiError(response); }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || '';
  }

  async checkVideoStatus(taskId: string, isVeoTask?: boolean, providerId?: string): Promise<{ status: string; videoUrl?: string; progress?: string; failReason?: string }> {
    const providerConfig = await this.getProviderConfig(providerId);
    const apiUrl = providerConfig.apiUrl || this.getApiBaseUrl();
    const apiKey = providerConfig.apiKey || this.config.apiKey;
    const baseUrl = apiUrl.replace(/\/+$/, '');
    const videoApiUrl = baseUrl.replace(/\/v1$/, '') + '/v1';
    
    const model = this.getConfig()?.videoModel || 'sora-2';
    const vcfg = this.getVideoConfig(model);
    
    const queryUrl = `${videoApiUrl}${vcfg.queryPath.replace('{id}', encodeURIComponent(taskId))}`;
    console.log(`[checkVideoStatus] 查询URL: ${queryUrl}`);
    
    const response = await fetch(queryUrl, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
    });

    if (!response.ok) {
      // 404 说明任务ID不存在或已过期，直接标记失败，阻止无限重试
      if (response.status === 404) {
        return { status: 'failed', failReason: `任务不存在或已过期（${taskId}）` };
      }
      throw new Error(`Video status check error: ${response.statusText}`);
    }

    const data = await response.json();
    
    // 映射API状态到内部状态
    // 新 Veo API 状态码（来自 API 文档）：
    //   pending → 等待中
    //   image_downloading → 图片下载中（处理中）
    //   video_generating → 视频生成中（处理中）
    //   video_generation_completed → 视频生成完成，等待超分（处理中）
    //   video_upsampling → 超分处理中（处理中）
    //   video_upsampling_completed → 超分完成（处理中，等待 completed）
    //   video_upsampling_failed → 超分失败（视为失败）
    //   completed → 全部完成 ✅
    //   failed / error → 失败 ✅
    // 旧 API 状态码：NOT_START, IN_PROGRESS, SUCCESS, FAILURE, queued, in_progress
    let mappedStatus = 'processing';
    const rawStatus = data.status || '';
    const apiStatus = rawStatus.toUpperCase?.() || rawStatus;
    
    if (
      apiStatus === 'SUCCESS' ||
      apiStatus === 'COMPLETED' ||
      rawStatus === 'completed' ||
      rawStatus === 'succeeded'
    ) {
      mappedStatus = 'completed';
    } else if (
      apiStatus === 'FAILURE' ||
      apiStatus === 'FAILED' ||
      apiStatus === 'ERROR' ||
      rawStatus === 'failed' ||
      rawStatus === 'error' ||
      rawStatus === 'video_generation_failed' ||
      rawStatus === 'video_upsampling_failed'
    ) {
      mappedStatus = 'failed';
    } else {
      // 其余所有状态均视为处理中（含 Veo 的各中间状态和旧格式的 queued 等）
      mappedStatus = 'processing';
    }
    
    // 解析视频URL：用配置的字段名（支持数组路径）
    const getByPath = (obj: any, path: string): any => {
      const parts = path.match(/(\w+)|\[(\d+)\]/g) || [];
      let cur = obj;
      for (const p of parts) {
        if (p.startsWith('[')) { cur = cur?.[parseInt(p.slice(1,-1))]; }
        else { cur = cur?.[p]; }
        if (cur === undefined || cur === null) return undefined;
      }
      return cur;
    };
    const videoUrl = getByPath(data, vcfg.responseVideoUrl) || data.video_url || data.url;
    
    // 解析失败原因：兼容多种返回格式
    const failReason = data.fail_reason || data.error?.message || 
                       (typeof data.error === 'string' ? data.error : undefined);
    
    // 解析进度：兼容多种返回格式
    const progress = data.progress ?? data.data?.progress ?? data.percentage ?? data.data?.percentage;

    return {
      status: mappedStatus,
      videoUrl,
      progress,
      failReason
    };
  }


}

export const aiService = new AIGenerationService();
export default aiService;
