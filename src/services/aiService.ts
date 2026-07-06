import {
  Scene, Character, Style, GenerationMode, PromptTemplate,
  ApiProvider, ProviderModel, ModelCategory, MODEL_CATEGORY_KEYWORDS,
} from '../types';
import { blobToBase64, processReferenceImage, compressImage, isUrl } from '../utils/imageUtils';
import { getMedia } from './mediaService';
import { getPromptTemplate } from './database';
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
export type CharacterPromptTemplatePreset = 'four_view' | 'identity_board';

const CHARACTER_PROMPT_TEMPLATE_SYSTEM_PROMPTS: Record<CharacterPromptTemplatePreset, string> = {
  four_view: `你是一个专业的AI角色设计师。请根据用户输入的角色描述，生成一个用于生成角色四视图的优化提示词。

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
角色设计图，纯白色背景，四视图：正面近景（上半身，脸部清晰特征），正面全身（完整站姿），侧面全身（侧面轮廓），背面全身（背部细节）。[角色特征描述]`,
  identity_board: `你是一个专业的AI角色视觉开发总监。请根据用户输入的角色描述，生成一个用于角色身份板的优化提示词。

核心目标：
创建一张艺术性的16:9角色身份板。你只能根据用户给出的角色描述，构建同一个角色在整张身份板中的统一视觉呈现。

要求：
1. [主体]：基于用户输入的角色描述创建同一角色。
2. 背景为纯白色或柔和的米白色。
3. 无环境、无道具、无标志、无水印。
4. 不要创建标准角色参考表，要创建一张电影般的角色身份板，感觉像高端动画工作室的角色研究与艺术书布局结合。
5. 布局必须不对称、优雅且视觉上令人难忘，使用大片留白、多样化图像比例和有意的不平衡，体现推免网格、蓝图设计、目录布局和重复转场展示的艺术感。
6. 重要布局规则：不要重叠任何角色图像，每个视角必须清晰分离并保留呼吸空间。保持所有身体、肖像、轮廓和细节研究的视觉区分。无裁剪面部、无隐藏肢体、无堆叠人物、无合并姿势。
7. 主要构图：放置一个大型英雄全身视角，略微偏离中心作为视觉锚点。
8. 围绕主体，以干净间距排列较小的辅助研究：中性全身视角、背面视角、侧面视角、坐姿、倾斜姿势、蹲姿、俯视身体角度、仰视身体角度、富有表现力的肖像研究。
9. 每个视角都必须像独立的干净角色研究，不像场景分镜帧。
10. 身份锁定：所有视角中保持严格身份一致性，包括相同面部、相同面部比例、相同发型、相同服装、相同身体比例、相同姿势语言、相同视觉个性。
11. 有用参考细节：突出清晰的面部形状、清晰的发型轮廓、清晰的服装轮廓、清晰的身体形状、清晰的手部、清晰的姿势、清晰的表情范围，便于后续图像和视频生成继续识别。
12. 艺术性区域：包含一个小轮廓研究区域，带2-3个简化的黑色角色轮廓；包含一个小表情研究区域，展示细微情感变化；包含一个小细节研究区域，展示面部、头发和服装的关键视觉特征。
13. 文本设计：添加一个时尚的角色ID块，仅使用“名称、角色核心情绪、视觉标志”三类文本信息。只在必要处加入少量手写风格标签，可使用细微编辑箭头和标注标记，但整体保持简约优雅。
14. 风格必须简约、电影感、高端、艺术书感、干净、富有表现力，适合制作。
15. 最终图像必须让AI模型更容易理解角色的面部、轮廓、服装、姿势和情感范围。
16. 只输出优化后的提示词，不要输出解释、标题或额外说明。
17. 使用中文输出。

输出格式示例：
艺术性16:9角色身份板，纯白色或柔和米白色背景，无环境无道具无水印，电影感、高端动画工作室角色研究与艺术书布局，不对称排版，大量留白，一个偏离中心的英雄全身主视角，周围分离排列中性全身、背面、侧面、坐姿、倾斜姿势、蹲姿、俯视角、仰视角、肖像表情研究，附带轮廓研究、表情研究、面部头发服装细节研究，时尚角色ID块仅含名称/角色核心情绪/视觉标志，所有视角身份严格一致。[角色特征描述]`,
};

// 默认模型名称常量（统一管理，避免硬编码分散）
const DEFAULT_MODELS = {
  chat: 'gemini-3-flash-preview',
  image: 'nano-banana-2-4k',
  video: 'sora-2',
} as const;

// #region debug-point shared:stale-infer-prompt
const DEBUG_EVENT_URL = 'http://127.0.0.1:7777/event';
const DEBUG_SESSION_ID = 'stale-infer-prompt';
const postDebugEvent = (hypothesisId: string, location: string, msg: string, data: Record<string, unknown>, traceId?: string) => {
  fetch(DEBUG_EVENT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: DEBUG_SESSION_ID,
      runId: 'post-fix',
      hypothesisId,
      location,
      msg: `[DEBUG] ${msg}`,
      data,
      traceId,
      ts: Date.now(),
    }),
  }).catch(() => {});
};
// #endregion

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

interface ApiProbeFailure {
  url: string;
  status: number;
  statusText: string;
}

const normalizeApiBaseUrl = (apiUrl: string) => apiUrl.replace(/\/+$/, '');

const getModelEndpoints = (base: string): string[] => {
  const endpoints = [`${base}/models`];
  if (!/\/v1$/i.test(base)) endpoints.push(`${base}/v1/models`);
  return Array.from(new Set(endpoints));
};

const isCrossOriginRequest = (targetUrl: string): boolean => {
  if (typeof window === 'undefined') return false;
  try {
    return new URL(targetUrl, window.location.href).origin !== window.location.origin;
  } catch {
    return false;
  }
};

const isFetchNetworkFailure = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return error instanceof TypeError
    || message.includes('failed to fetch')
    || message.includes('networkerror')
    || message.includes('load failed')
    || message.includes('network request failed');
};

const formatNetworkProbeError = (error: unknown, targetUrl: string): string => {
  if (isFetchNetworkFailure(error) && isCrossOriginRequest(targetUrl)) {
    const origin = typeof window !== 'undefined' ? window.location.origin : '当前网站';
    return `浏览器已拦截跨域请求，网站版无法直接访问该 API。\n\n这通常不是 API 地址或密钥错误，而是 API 服务端没有允许 ${origin} 跨域访问。请在设置页手动添加模型，或改用支持 CORS 的 API、桌面版/可信后端代理。\n\n⚠️ 不建议使用公共 CORS 代理，以免泄露 API Key。`;
  }

  const errMsg = error instanceof Error ? error.message : '未知错误';
  return `网络错误: ${errMsg}\n\n💡 请检查 API 地址格式和网络连接。`;
};

// 安全解析 JSON：先读 text，避免 HTML 错误页导致 SyntaxError
const safeResponseJson = async (response: Response, label = 'API'): Promise<any> => {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    const preview = text.slice(0, 120).replace(/\s+/g, ' ');
    throw new Error(`${label} 返回了非 JSON 响应（可能是错误页面）：${preview}`);
  }
};

const extractModelItems = async (response: Response): Promise<any[]> => {
  try {
    const data = await response.json();
    if (data?.data && Array.isArray(data.data)) return data.data;
    if (Array.isArray(data)) return data;
    if (data?.models && Array.isArray(data.models)) return data.models;
  } catch {
    // 非 JSON 响应不是可识别的模型列表
  }
  return [];
};

const formatModelListFailure = (failures: ApiProbeFailure[]): string => {
  if (failures.some(f => f.status === 401)) {
    return '密钥无效（401 Unauthorized）\n请检查密钥是否正确。';
  }
  if (failures.some(f => f.status === 403)) {
    return '权限不足（403 Forbidden）\n该密钥可能没有列出模型的权限。可手动添加模型后继续保存配置。';
  }
  if (failures.some(f => f.status === 200)) {
    return '连接成功，但响应中没有可识别的模型列表。\n\n请手动添加需要使用的模型 ID。';
  }
  if (failures.some(f => f.status === 404 || f.status === 405)) {
    return '未能读取模型列表（404/405）。\n\n该 API 可能不支持 OpenAI 格式的模型列表端点，请手动添加需要使用的模型 ID。';
  }

  const last = failures[failures.length - 1];
  if (last) {
    return `未能读取模型列表。\n\n最后状态码: ${last.status}${last.statusText ? ` ${last.statusText}` : ''}\n请手动添加模型，或检查该 API 是否兼容 OpenAI 模型列表格式。`;
  }

  return '未能读取模型列表。\n\n请检查 API 地址和密钥，或手动添加模型。';
};

/**
 * 从 OpenAI 兼容 API 拉取模型列表并自动分类
 * 兼容绝大多数第三方API（OpenAI、DeepSeek、Qwen、Zhipu、Moonshot、SiliconFlow 等）
 */
export async function fetchModelsFromApi(
  apiUrl: string,
  apiKey: string,
): Promise<ProviderModel[]> {
  const base = normalizeApiBaseUrl(apiUrl);
  const endpoints = getModelEndpoints(base);
  const authHeaders: Record<string, string> = { Authorization: `Bearer ${apiKey}` };
  const apiKeyHeaders: Record<string, string> = { 'x-api-key': apiKey };
  const failures: ApiProbeFailure[] = [];
  let modelsData: any[] = [];

  for (const headers of [authHeaders, apiKeyHeaders]) {
    for (const endpoint of endpoints) {
      try {
        const response = await fetch(endpoint, { headers });
        if (!response.ok) {
          failures.push({ url: endpoint, status: response.status, statusText: response.statusText });
          continue;
        }

        modelsData = await extractModelItems(response);
        if (modelsData.length > 0) break;
        failures.push({ url: endpoint, status: response.status, statusText: response.statusText });
      } catch (error) {
        throw new Error(formatNetworkProbeError(error, endpoint));
      }
    }
    if (modelsData.length > 0) break;
  }

  // 分类并去重
  const seen = new Set<string>();
  const result: ProviderModel[] = [];

  for (const item of modelsData) {
    const id = typeof item === 'string' ? item : (item.id || item.name || '');
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
    throw new Error(formatModelListFailure(failures));
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
  const base = normalizeApiBaseUrl(apiUrl);
  const endpoints = getModelEndpoints(base);
  const headerVariants: Record<string, string>[] = [
    { Authorization: `Bearer ${apiKey}` },
    { 'x-api-key': apiKey },
  ];
  const failures: ApiProbeFailure[] = [];

  for (const headers of headerVariants) {
    for (const endpoint of endpoints) {
      try {
        // 仅验证密钥有效性，不调用任何模型；GET /models 不消耗 token。
        const response = await fetch(endpoint, { headers });

        if (response.ok) {
          const models = await extractModelItems(response);
          return {
            success: true,
            message: models.length > 0
              ? `连接成功！可用模型数: ${models.length}`
              : '连接成功！但响应中没有可识别的模型列表，可手动添加模型。',
          };
        }

        failures.push({ url: endpoint, status: response.status, statusText: response.statusText });
      } catch (error) {
        return { success: false, message: formatNetworkProbeError(error, endpoint) };
      }
    }
  }

  return {
    success: false,
    message: formatModelListFailure(failures),
  };
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
    maxTokens?: string;
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
          maxTokens: secureConfig.maxTokens || '4096',
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

  private async resolveLibraryTemplate(
    template: Pick<PromptTemplate, 'id' | 'type'> | undefined,
    allowedTypes: PromptTemplate['type'][],
    missingMessage: string,
  ): Promise<PromptTemplate> {
    if (!template?.id) {
      throw new Error(missingMessage);
    }

    const storedTemplate = await getPromptTemplate(template.id);
    if (!storedTemplate || !allowedTypes.includes(storedTemplate.type)) {
      throw new Error(missingMessage);
    }

    if (!storedTemplate.positive_prompt?.trim()) {
      throw new Error('所选提示词模板内容为空，请重新选择有效模板');
    }

    return storedTemplate;
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

  /** 严格 JSON 格式指令 — 解析失败重试时注入 */
  private static readonly STRICT_JSON_INSTRUCTION =
    '\n【严格 JSON 格式 — 最高优先级】你必须输出且仅输出一个合法的 JSON 数组，所有属性名和字符串值必须用双引号包裹，禁止使用单引号、禁止尾随逗号、禁止添加注释或任何额外文字。只输出 JSON，不要输出 markdown 代码块或任何其他内容。\n';

  async generateScript(
    novelContent: string,
    mode: ScriptMode,
    userRequirement?: string,
    options?: { model?: string; providerId?: string; template?: Pick<PromptTemplate, 'id' | 'type'>; onChunk?: (text: string) => void },
  ): Promise<ScriptScene[]> {
    const providerConfig = await this.getProviderConfig(options?.providerId);
    const apiUrl = providerConfig.apiUrl || this.getApiBaseUrl();
    const apiKey = providerConfig.apiKey || this.config.apiKey;
    const model = options?.model || this.getConfig().chatModel || 'gemini-3-flash-preview';
    const baseUrl = apiUrl.replace(/\/+$/, '');
    const requirementBlock = userRequirement && userRequirement.trim()
      ? `\n【用户创作要求 - 必须严格遵守】\n${userRequirement.trim()}\n`
      : '';
    const template = await this.resolveLibraryTemplate(
      options?.template,
      ['script'],
      '请先从提示词库选择有效的脚本模板，再开始生成脚本',
    );

    // 第一次尝试
    try {
      return await this._doGenerate(novelContent, mode, requirementBlock, { model, baseUrl, apiKey, template, options }, false);
    } catch (e: any) {
      // 仅对 JSON 解析失败进行自动重试（API 错误直接抛出）
      if (e?.message?.includes('脚本格式')) {
        console.warn('[generateScript] 首次解析失败，使用严格 JSON 格式指令自动重试...');
        return await this._doGenerate(novelContent, mode, requirementBlock, { model, baseUrl, apiKey, template, options }, true);
      }
      throw e;
    }
  }

  private async _doGenerate(
    novelContent: string,
    mode: ScriptMode,
    requirementBlock: string,
    ctx: { model: string; baseUrl: string; apiKey: string; template: PromptTemplate; options?: { onChunk?: (text: string) => void } },
    strictFormat: boolean,
  ): Promise<ScriptScene[]> {
    const strictInstruction = strictFormat ? AIGenerationService.STRICT_JSON_INSTRUCTION : '';
    const systemPrompt = `你是一个专业的AI漫剧编剧。你只能依据用户从提示词库中选择的【脚本模板】与用户提供的原文内容进行创作，禁止使用任何内置脚本模板、默认预设或隐含风格规则。

【脚本模板 - 唯一允许使用的创作模板】
${ctx.template.positive_prompt}
${ctx.template.negative_prompt ? `\n【禁止事项】\n${ctx.template.negative_prompt}` : ''}

【输出要求】
- 必须完整覆盖原文的剧情，不得省略关键场景、人物关系和情节推进
- 必须直接输出 JSON 数组，不要输出解释、标题或 markdown 代码块
- 每个分镜必须包含：分镜序号(order)、场景描述(sceneDescription)、动作描述(actionDescription)、出现的角色标签(character)、台词/对话内容(dialogue)${mode === 'narration' ? '、解说词(narration)' : ''}
${strictInstruction}${requirementBlock}`;

    const userMessage = `【脚本模式】${mode === 'dialogue' ? '纯对话剧本' : '解说对话模式'}

【小说原文】
${novelContent}`;

    const response = await fetch(`${ctx.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ctx.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: ctx.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage }
        ],
        temperature: this.getTemperature(),
        max_tokens: parseInt(this.getConfig()?.maxTokens || '4096'),
        ...(ctx.options?.onChunk ? { stream: true } : {}),
      })
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      const errMsg = (errData as any).error?.message || response.statusText || `HTTP ${response.status}`;
      throw new Error(`API 请求失败 (${response.status}): ${errMsg}`);
    }

    if (ctx.options?.onChunk && response.body) {
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let fc = '';
      while (true) { const { done, value } = await reader.read(); if (done) break;
        for (const line of decoder.decode(value, { stream: true }).split('\n')) {
          if (line.startsWith('data: ') && line !== 'data: [DONE]') {
            try { const j = JSON.parse(line.slice(6)); fc += j.choices?.[0]?.delta?.content || ''; ctx.options!.onChunk!(fc); } catch {}
          }
        }
      }
      return this.parseScriptContent(fc);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '[]';
    return this.parseScriptContent(content);
  }

  /**
   * 修复 AI 返回的常见 JSON 格式错误，使其能被 JSON.parse 正确解析。
   * 操作都是保守的——理论上不会破坏有效 JSON。
   */
  private repairJson(text: string): string {
    let result = text;

    // 1. 修复无引号的属性名：{order: → {"order":
    //    匹配 { 或 , 后面跟着的未加引号的标识符 + :
    result = result.replace(/([{,]\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)(\s*:)/g, '$1"$2"$3');

    // 2. 修复单引号属性名：{'key': → {"key":
    result = result.replace(/'([^']+)'(\s*:)/g, '"$1"$2');

    // 3. 修复单引号字符串值：: 'value' → : "value"
    result = result.replace(/:\s*'([^']*)'/g, ': "$1"');

    // 4. 删除尾随逗号（} 或 ] 前的逗号）
    result = result.replace(/,(\s*[}\]])/g, '$1');

    // 5. 修复相邻对象/数组之间缺失的逗号
    result = result.replace(/\}(\s*)\{/g, '},$1{');
    result = result.replace(/\](\s*)\[/g, '],$1[');
    result = result.replace(/\}(\s*)\[/g, '},$1[');
    result = result.replace(/\](\s*)\{/g, '],$1{');

    return result;
  }

  /**
   * 校验并修复解析后的分镜场景数组：
   * - 确保每个场景有必填字段，缺失的给默认值
   * - order 强制转为数字
   * - 过滤掉完全无法使用的空对象
   */
  private validateAndRepairScenes(raw: any[]): ScriptScene[] {
    if (!Array.isArray(raw)) {
      throw new Error('AI 返回的不是数组格式');
    }
    const scenes: ScriptScene[] = [];
    for (let i = 0; i < raw.length; i++) {
      const obj = raw[i];
      // 跳过非对象元素
      if (!obj || typeof obj !== 'object') continue;
      // 跳过明显是空对象的元素
      const keys = Object.keys(obj);
      if (keys.length === 0) continue;

      scenes.push({
        order: typeof obj.order === 'number' ? obj.order : (parseInt(String(obj.order), 10) || i + 1),
        sceneDescription: String(obj.sceneDescription ?? obj.scene_description ?? obj.scene ?? `场景${i + 1}`),
        actionDescription: obj.actionDescription != null ? String(obj.actionDescription) : (obj.action_description != null ? String(obj.action_description) : undefined),
        character: String(obj.character ?? obj.characters ?? ''),
        dialogue: String(obj.dialogue ?? ''),
        narration: obj.narration != null ? String(obj.narration) : undefined,
      });
    }
    if (scenes.length === 0) {
      throw new Error('AI 返回的脚本中没有有效分镜数据');
    }
    return scenes;
  }

  private parseScriptContent(content: string): ScriptScene[] {
    // Level 0: 直接解析
    try { return this.validateAndRepairScenes(JSON.parse(content)); } catch {}

    // Level 1: 修复常见 JSON 格式错误后解析
    const repaired = this.repairJson(content);
    try { return this.validateAndRepairScenes(JSON.parse(repaired)); } catch {}

    // 清洗: 移除markdown/HTML/多余文字
    let cleaned = repaired
      .replace(/```json\s*/gi, '').replace(/```\s*/g, '')
      .replace(/,\s*}/g, '}').replace(/,\s*]/g, ']')
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, ' '); // 控制字符

    // Level 2: 提取 JSON 数组（从第一个 [ 到最后一个 ]）后解析
    const lb = cleaned.indexOf('[');
    if (lb === -1) throw new Error('脚本格式无法解析：找不到JSON数组');
    const rb = cleaned.lastIndexOf(']');
    if (rb !== -1 && rb > lb) {
      const slice = cleaned.slice(lb, rb + 1);
      try { return this.validateAndRepairScenes(JSON.parse(slice)); } catch {}
      // 对切片再修复一次
      const repairedSlice = this.repairJson(slice);
      try { return this.validateAndRepairScenes(JSON.parse(repairedSlice)); } catch {}
    }

    // Level 3: 逐个提取完整对象（每个 {…} 单独解析）
    const results: ScriptScene[] = [];
    let i = lb + 1, objStart = -1, depth = 0, inStr = false, esc = false;
    while (i < cleaned.length) {
      const ch = cleaned[i];
      if (esc) { esc = false; i++; continue; }
      if (ch === '\\') { esc = true; i++; continue; }
      if (ch === '"') { inStr = !inStr; i++; continue; }
      if (inStr) { i++; continue; }
      if (ch === '{') { if (depth === 0) objStart = i; depth++; }
      else if (ch === '}') {
        depth--;
        if (depth === 0 && objStart >= 0) {
          const objStr = cleaned.slice(objStart, i + 1);
          try {
            results.push(JSON.parse(objStr));
          } catch {
            // 对单个对象也尝试修复
            try { results.push(JSON.parse(this.repairJson(objStr))); } catch {}
          }
          objStart = -1;
        }
      }
      i++;
    }
    if (results.length > 0) return this.validateAndRepairScenes(results);

    // Level 4: 最后手段 — 从尾部逐字节裁剪尝试解析
    for (let trim = cleaned.length - lb; trim > lb + 2; trim--) {
      try { return this.validateAndRepairScenes(JSON.parse(cleaned.slice(lb, trim) + ']')); } catch {}
      // 修复后再试
      try { return this.validateAndRepairScenes(JSON.parse(this.repairJson(cleaned.slice(lb, trim) + ']'))); } catch {}
    }

    console.error('[parseScriptContent] 解析失败, raw:', content.slice(0, 500), '... cleaned:', cleaned.slice(0, 500));
    throw new Error('AI 返回的脚本格式无法解析，请重试');
  }

  async generatePrompt(
    scene: Scene,
    mode: 'image' | 'video',
    gridMode?: 4 | 6 | 9,
    previousSceneLastPrompt?: string,
    onChunk?: (text: string) => void,
    selectedStyle?: { name: string; description: string },
    allSceneDescriptions?: string[],
    promptTemplate?: Pick<PromptTemplate, 'id' | 'type'>,
    providerId?: string,
    modelOverride?: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const providerConfig = await this.getProviderConfig(providerId);
    const apiUrl = providerConfig.apiUrl || this.getApiBaseUrl();
    const apiKey = providerConfig.apiKey || this.config.apiKey;
    const config = this.getConfig();
    const baseUrl = apiUrl.replace(/\/+$/, '');
    const chatModel = modelOverride || config.chatModel || 'gemini-3-flash-preview';
    const traceId = `generatePrompt-${scene.id}-${Date.now()}`;
    // #region debug-point D:generatePrompt-entry
    postDebugEvent('D', 'aiService.ts:generatePrompt:entry', 'generatePrompt entry', {
      sceneId: scene.id,
      mode,
      providerId,
      model: chatModel,
      scenePrompt: scene.prompt,
      sceneImagePrompt: scene.imagePrompt,
      sceneVideoPrompt: scene.videoPrompt,
      sceneDescription: scene.description,
      previousSceneLastPrompt,
      hasTemplate: !!promptTemplate?.id,
    }, traceId);
    // #endregion
    
    let systemPrompt: string;
    let sceneInfo: string;
    const resolvedTemplate = await this.resolveLibraryTemplate(
      promptTemplate,
      [mode, 'storyboard'],
      `请先从提示词库选择有效的${mode === 'image' ? '图片' : '视频'}提示词模板，再开始生成`,
    );
    const rawStylePrompt = selectedStyle?.description?.trim() || '';

    // 简化规则：结果提示词由“当前输入框内容 + 选中的提示词模板 + 风格库提示词”组成
    const userInput = (scene.prompt?.trim?.() || '')
      || ((mode === 'image' ? scene.imagePrompt?.trim?.() : scene.videoPrompt?.trim?.()) || '');
    console.log('[generatePrompt] userInput:', (userInput || '').slice(0, 120), 'templateId:', resolvedTemplate.id);
    // #region debug-point D:generatePrompt-userModified
    postDebugEvent('D', 'aiService.ts:generatePrompt:userModified', 'generatePrompt resolved userModified', {
      sceneId: scene.id,
      mode,
      userModified: userInput,
      userModifiedContent: userInput || null,
      scenePrompt: scene.prompt,
      sceneImagePrompt: scene.imagePrompt,
      sceneVideoPrompt: scene.videoPrompt,
      sceneDescription: scene.description,
    }, traceId);
    // #endregion

    systemPrompt = `你是专业的AI${mode === 'image' ? '图片' : '视频'}提示词生成助手。你只能依据用户从提示词库选择的模板、用户当前输入内容${rawStylePrompt ? '与用户从风格库选择的风格提示词' : ''}生成最终提示词。

【生成规则】
- 最终结果只能基于“用户输入内容 + 提示词模板${rawStylePrompt ? ' + 风格库提示词' : ''}”
- 不得引入额外剧情补充、上一分镜衔接、全局上下文、系统默认预设或未提供的风格描述
- 必须严格保留用户输入中的关键信息
- ${rawStylePrompt ? '如果提供了风格库提示词，必须将该段风格提示词原封不动写入最终提示词，不得改写、拆分、省略或同义替换' : '如未提供风格库提示词，不要自行补充风格描述'}
- 直接输出最终提示词内容，不要输出解释、标题或说明

【提示词模板】
${resolvedTemplate.positive_prompt}
${resolvedTemplate.negative_prompt ? `\n【禁止事项】\n${resolvedTemplate.negative_prompt}` : ''}${rawStylePrompt ? `\n\n【风格库提示词 - 必须原封不动写入】\n${rawStylePrompt}` : ''}`;

    sceneInfo = `【用户输入内容】\n${userInput || '无'}${rawStylePrompt ? `\n\n【风格库提示词】\n${rawStylePrompt}` : ''}`;

    if (systemPrompt === undefined || sceneInfo === undefined) {
      throw new Error('generatePrompt: systemPrompt or sceneInfo not set');
    }

    // 如果提供了 onChunk 回调，使用流式输出
    if (onChunk) {
      // #region debug-point E:generatePrompt-stream-request
      postDebugEvent('E', 'aiService.ts:generatePrompt:stream-request', 'generatePrompt stream request payload summary', {
        sceneId: scene.id,
        mode,
        model: chatModel,
        systemPromptPreview: systemPrompt.slice(0, 300),
        sceneInfoPreview: sceneInfo.slice(0, 300),
      }, traceId);
      // #endregion
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        signal,
        body: JSON.stringify({
          model: chatModel,
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

      // #region debug-point E:generatePrompt-stream-result
      postDebugEvent('E', 'aiService.ts:generatePrompt:stream-result', 'generatePrompt stream result summary', {
        sceneId: scene.id,
        mode,
        fullTextLength: fullText.length,
        fullTextPreview: fullText.slice(0, 300),
      }, traceId);
      // #endregion
      const mergedText = rawStylePrompt && !fullText.includes(rawStylePrompt)
        ? `${fullText.trim()}\n${rawStylePrompt}`.trim()
        : fullText;
      if (mergedText !== fullText) {
        onChunk(mergedText);
      }
      return mergedText;
    }

    // 非流式：原有逻辑
    // #region debug-point E:generatePrompt-request
    postDebugEvent('E', 'aiService.ts:generatePrompt:request', 'generatePrompt request payload summary', {
      sceneId: scene.id,
      mode,
      model: chatModel,
      systemPromptPreview: systemPrompt.slice(0, 300),
      sceneInfoPreview: sceneInfo.slice(0, 300),
    }, traceId);
    // #endregion
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        model: chatModel,
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
    // #region debug-point E:generatePrompt-result
    postDebugEvent('E', 'aiService.ts:generatePrompt:result', 'generatePrompt result summary', {
      sceneId: scene.id,
      mode,
      resultPreview: (data.choices?.[0]?.message?.content || '').slice(0, 300),
      resultLength: (data.choices?.[0]?.message?.content || '').length,
    }, traceId);
    // #endregion
    const resultText = data.choices?.[0]?.message?.content || '';
    return rawStylePrompt && !resultText.includes(rawStylePrompt)
      ? `${resultText.trim()}\n${rawStylePrompt}`.trim()
      : resultText;
  }

  async generateImage(
    scene: Scene, 
    characters?: Character[],
    options?: { aspectRatio?: string; imageSize?: string; quality?: string; style?: Style; generationMode?: GenerationMode; gridMode?: number; model?: string; providerId?: string; referenceImages?: string[] }
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

    // 4. 收集自定义参考图（从 options.referenceImages 直接传入）
    if (options?.referenceImages && options.referenceImages.length > 0) {
      for (const refImg of options.referenceImages) {
        try {
          if (!refImg || refImg.startsWith('blob:')) continue;
          const processed = await processReferenceImage(refImg, 1024);
          referenceImages.push(processed);
        } catch (error) {
          console.warn('[AIService] 处理自定义参考图失败:', error);
        }
      }
      console.log('[AIService] 添加自定义参考图数量:', options.referenceImages.length);
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
    const isGptImage2 = imageModel.includes('gpt-image-2');

    // gpt-image-2 尺寸：根据画质+宽高比动态选最优尺寸
    const resolveGptImage2Size = (quality: string | undefined, aspectRatio: string | undefined): string => {
      const ar = (aspectRatio || '1:1').split(' ')[0];
      const isLandscape = ar === '16:9' || ar === '3:2' || ar === '4:3';
      const isPortrait = ar === '9:16' || ar === '2:3' || ar === '3:4';
      const q = quality || '2K';
      if (q === '4K') {
        if (isLandscape) return '3840x2160';
        if (isPortrait) return '2160x3840';
        return '2880x2880';
      }
      if (q === '2K') {
        if (isLandscape) return '2048x1152';
        if (isPortrait) return '1152x2048';
        return '2048x2048';
      }
      // 1K
      return '1024x1024';
    };

    const resolvedSize = isGptImage2
      ? resolveGptImage2Size(options?.imageSize, options?.aspectRatio)
      : undefined;

    console.log('[AIService] 最终提示词:', finalPrompt);

    let response: Response;
    if (isGptImage2 && referenceImages.length > 0) {
      // 有参考图 → /v1/images/edits (multipart/form-data)
      const endpoint = `${baseUrl}/images/edits`;
      console.log('[AIService] 发送请求到 (edits):', endpoint);
      const form = new FormData();
      form.append('model', imageModel);
      form.append('prompt', finalPrompt);
      form.append('size', resolvedSize!);
      if (options?.quality) form.append('quality', options.quality);
      referenceImages.forEach((img, i) => {
        const byteStr = atob(img.split(',')[1] || img);
        const arr = new Uint8Array(byteStr.length);
        for (let i = 0; i < byteStr.length; i++) arr[i] = byteStr.charCodeAt(i);
        const blob = new Blob([arr], { type: 'image/png' });
        form.append('image', blob, `ref_${i}.png`);
      });
      try {
        response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${apiKey}` },
          body: form
        });
      } catch (error) {
        throw new Error(formatNetworkProbeError(error, endpoint));
      }
    } else if (isGptImage2) {
      // 无参考图 → /v1/images/generations (JSON)
      const endpoint = `${baseUrl}/images/generations`;
      console.log('[AIService] 发送请求到 (generations):', endpoint);
      const payload: Record<string, unknown> = {
        prompt: finalPrompt,
        model: imageModel,
        n: 1,
        size: resolvedSize,
        ...(options?.quality ? { quality: options.quality } : {})
      };
      try {
        response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      } catch (error) {
        throw new Error(formatNetworkProbeError(error, endpoint));
      }
    } else {
      // 非 gpt-image-2 → 原逻辑
      const endpoint = `${baseUrl}/images/generations`;
      console.log('[AIService] 发送请求到:', endpoint);
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
      try {
        response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      } catch (error) {
        throw new Error(formatNetworkProbeError(error, endpoint));
      }
    }

    console.log('[AIService] 响应状态:', response.status, response.statusText);
    if (!response.ok) {
      const errorText = await response.text();
      console.error('[AIService] 请求失败:', errorText);
      throw new Error(`Image generation error: ${response.statusText}`);
    }

    const data = await safeResponseJson(response, '图片生成');
    console.log('[AIService] 响应数据:', JSON.stringify(data, null, 2));

    // gpt-image-2：自动检测同步/异步响应
    if (isGptImage2) {
      // 同步响应：data 是数组，直接包含图片
      const syncItem = Array.isArray(data?.data) ? data.data[0] : null;
      if (syncItem?.url || syncItem?.b64_json) {
        console.log('[AIService] 同步响应，直接返回图片');
        return syncItem.url || `data:image/png;base64,${syncItem.b64_json}`;
      }
      // 异步响应：data 是 task_id 字符串
      const taskId: string = typeof data?.data === 'string' ? data.data : data?.task_id || data?.id || '';
      if (!taskId) throw new Error('Image generation error: unexpected response format');
      console.log('[AIService] 异步任务ID:', taskId);
      const pollUrl = `${baseUrl}/images/tasks/${taskId}`;
      const MAX_POLLS = 120;
      for (let i = 0; i < MAX_POLLS; i++) {
        await new Promise(r => setTimeout(r, 3000));
        let pollRes: Response;
        try {
          pollRes = await fetch(pollUrl, {
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
          });
        } catch (error) {
          throw new Error(formatNetworkProbeError(error, pollUrl));
        }
        if (!pollRes.ok) {
          const errText = await pollRes.text();
          throw new Error(`Image task poll error: ${errText}`);
        }
        const pollData = await safeResponseJson(pollRes, '任务轮询');
        const status: string = pollData?.data?.status || pollData?.status || '';
        console.log('[AIService] 任务状态:', status, '轮询次数:', i + 1);
        if (status === 'FAILURE') throw new Error('Image generation failed on server');
        if (status === 'SUCCESS') {
          const inner = pollData?.data?.data?.data?.[0] || pollData?.data?.data?.[0] || pollData?.data?.[0];
          return inner?.url || (inner?.b64_json ? `data:image/png;base64,${inner.b64_json}` : '') || '';
        }
      }
      throw new Error('Image generation timeout: task did not complete in time');
    }

    // 非 gpt-image-2 直接返回
    const item = data.data?.[0];
    return item?.url || (item?.b64_json ? `data:image/png;base64,${item.b64_json}` : '') || '';
  }

  async optimizeCharacterPrompt(
    userPrompt: string,
    providerId?: string,
    modelOverride?: string,
    templatePreset: CharacterPromptTemplatePreset = 'four_view',
  ): Promise<string> {
    const providerConfig = await this.getProviderConfig(providerId);
    const apiUrl = providerConfig.apiUrl || this.getApiBaseUrl();
    const apiKey = providerConfig.apiKey || this.config.apiKey;
    const config = this.getConfig();
    const baseUrl = apiUrl.replace(/\/+$/, '');
    const chatModel = modelOverride || config.chatModel || 'gemini-3-flash-preview';
    
    const systemPrompt = CHARACTER_PROMPT_TEMPLATE_SYSTEM_PROMPTS[templatePreset];
    const templateLabel = templatePreset === 'identity_board' ? '艺术性角色身份板提示词' : '四视图提示词';

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: chatModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `请优化以下角色描述为${templateLabel}：\n\n${userPrompt}` }
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

  async optimizeScenePrompt(userPrompt: string, providerId?: string, modelOverride?: string): Promise<string> {
    const providerConfig = await this.getProviderConfig(providerId);
    const apiUrl = providerConfig.apiUrl || this.getApiBaseUrl();
    const apiKey = providerConfig.apiKey || this.config.apiKey;
    const config = this.getConfig();
    const baseUrl = apiUrl.replace(/\/+$/, '');
    const chatModel = modelOverride || config.chatModel || 'gemini-3-flash-preview';
    
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
        model: chatModel,
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
    const chatModel = config.chatModel || 'gemini-3-flash-preview';

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
        model: chatModel,
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
    const chatModel = config.chatModel || 'gemini-3-flash-preview';
    
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
        model: chatModel,
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
    const chatModel = config.chatModel || 'gemini-3-flash-preview';
    
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
        model: chatModel,
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
    directorTemplate?: Pick<PromptTemplate, 'id' | 'type'>,
    providerId?: string,
    modelOverride?: string,
    signal?: AbortSignal,
  ): Promise<{ analysis: string; optimized: string }> {
    const providerConfig = await this.getProviderConfig(providerId);
    const apiUrl = providerConfig.apiUrl || this.getApiBaseUrl();
    const apiKey = providerConfig.apiKey || this.config.apiKey;
    const config = this.getConfig();
    const baseUrl = apiUrl.replace(/\/+$/, '');
    const chatModel = modelOverride || config.chatModel || 'gemini-3-flash-preview';
    const resolvedTemplate = await this.resolveLibraryTemplate(
      directorTemplate,
      ['director'],
      '请先从提示词库选择有效的导演模板，再开始AI导演优化',
    );

    const typeLabel = mode === 'image' ? '图片' : '视频';

    // 系统提示词 = 用户选择的导演模板；用户消息 = 输入框提示词原文
    let systemPrompt = `你是一位顶级影视导演。你只能依据用户从提示词库选择的导演模板完成优化，禁止使用任何内置导演脚本、默认风格或额外预设。

【导演模板】
${resolvedTemplate.positive_prompt}`;
    if (resolvedTemplate.negative_prompt) {
      systemPrompt += `\n\n【禁止出现以下内容】\n${resolvedTemplate.negative_prompt}`;
    }

    const userMessage = currentPrompt;

    // 流式输出 + 双通道分流
    if (onAnalysisChunk && onOptimizedChunk) {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        signal,
        body: JSON.stringify({
          model: chatModel,
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
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        model: chatModel,
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

    // 收集参考图：HTTP URL直接发送(原图), base64视API支持情况
    const refImages: string[] = [];
    // 场景预览图
    if (scene.useImageAsReference && scene.images.keyFrame) {
      refImages.push(scene.images.keyFrame);
      console.log('[AIService] 场景预览图(原图):', scene.images.keyFrame.slice(0,60)+'...');
    }
    // 出场角色参考图
    if (characters && characters.length > 0) {
      for (const c of characters) {
        const ref = c.referenceImage || '';
        if (ref && !ref.startsWith('blob:')) {
          refImages.push(ref);
        }
      }
      console.log(`[AIService] ${characters.length}个角色参考图(原图)`);
    }
    // HTTP URL直接放payload, base64仅保留给支持data URI的API
    const httpImages = refImages.filter(img => img.startsWith('http://') || img.startsWith('https://'));
    const base64Images = refImages.filter(img => img.startsWith('data:'));
    // 优先用HTTP URL, 如果全都有HTTP URL就直接发
    if (httpImages.length > 0) {
      payload.images = httpImages;
      if (base64Images.length > 0) console.log(`[AIService] ${base64Images.length}张base64跳过(API仅接受URL), ${httpImages.length}张HTTP已发送`);
    } else if (base64Images.length > 0) {
      // 没有HTTP URL, 尝试发送base64 (仅veo/grok等支持)
      payload.images = base64Images;
      console.log(`[AIService] 无HTTP URL, 发送${base64Images.length}张base64`);
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
        console.log(`[AIService] 视频生成请求 URL: ${endpoint}`);

        let response: Response;
        try {
          response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
        } catch (fetchError) {
          // 捕获CORS错误或网络错误
          throw new Error(formatNetworkProbeError(fetchError, endpoint));
        }

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          const msg = (errData as any).error?.message || response.statusText || `HTTP ${response.status}`;
          if (response.status === 404) throw new Error(`视频生成端点不存在 (404): ${endpoint}。请确认该API平台是否支持所选视频模型，或检查API地址配置。`);
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
        
        // 404/4xx 客户端错误不重试，直接抛出
        if ((err as Error).message.includes('(404)') || (err as Error).message.includes('(400)') || (err as Error).message.includes('(401)') || (err as Error).message.includes('(403)')) throw err;
        
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
    const chatModel = config.chatModel || 'gemini-3-flash-preview';
    
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
        model: chatModel,
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

  async regenerateScript(
    currentScript: string,
    userRequirement: string,
    options?: { providerId?: string; model?: string; template?: Pick<PromptTemplate, 'id' | 'type'> },
  ): Promise<string> {
    const providerConfig = await this.getProviderConfig(options?.providerId);
    const apiUrl = providerConfig.apiUrl || this.getApiBaseUrl();
    const apiKey = providerConfig.apiKey || this.config.apiKey;
    const config = this.getConfig();
    const chatModel = options?.model || config.chatModel || 'gemini-3-flash-preview';
    const template = await this.resolveLibraryTemplate(
      options?.template,
      ['script'],
      '请先从提示词库选择有效的脚本模板，再开始重新生成脚本',
    );

    const systemPrompt = `你是一个专业的漫剧脚本编辑专家。你只能依据用户从提示词库选择的【脚本模板】对现有脚本进行修改，禁止使用任何内置脚本模板、默认预设或额外风格规则。

【脚本模板 - 唯一允许使用的创作模板】
${template.positive_prompt}
${template.negative_prompt ? `\n【禁止事项】\n${template.negative_prompt}` : ''}

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
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: chatModel,
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

  async checkVideoStatus(taskId: string, isVeoTask?: boolean, providerId?: string, modelOverride?: string): Promise<{ status: string; videoUrl?: string; progress?: string; failReason?: string }> {
    const providerConfig = await this.getProviderConfig(providerId);
    const apiUrl = providerConfig.apiUrl || this.getApiBaseUrl();
    const apiKey = providerConfig.apiKey || this.config.apiKey;
    const baseUrl = apiUrl.replace(/\/+$/, '');
    const videoApiUrl = baseUrl.replace(/\/v1$/, '') + '/v1';
    
    const model = modelOverride || this.getConfig()?.videoModel || 'sora-2';
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

    let data = await response.json();
    // doubao等API响应包裹在{code:200, data:{...}}中
    if ((data as any).code !== undefined && (data as any).data) { data = (data as any).data; }
    
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
