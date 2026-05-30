// 核心数据接口

// 场景位置数据（用于场景管理弹窗）
export interface SceneLocationData {
  sceneLabel: string;  // 如"场景A"
  sceneDescription: string;  // 完整描述
  prompt: string;  // AI优化后的提示词
  generatedImage?: string;  // 生成的场景图
  multiViewPrompt?: string;  // 多视角模式的提示词
  multiViewImage?: string;   // 多视角模式生成的图片
}

export interface Project {
  id: string;
  name: string;
  cover?: string;
  novelContent?: string;
  script: Scene[];
  sceneLocations?: SceneLocationData[];  // 场景数据持久化
  createdAt: Date;
  updatedAt: Date;
}

export interface Scene {
  id: string;
  order: number;
  description: string;
  prompt: string;
  selectedCharacterIds?: string[];  // 当前分镜出场的角色ID列表
  availableCharacterIds?: string[];  // 可用角色ID列表（从弹窗选择应用到分镜）
  generationMode: 'text-to-image' | 'text-to-video';
  images: {
    storyboard?: string;
    keyFrame?: string;
  };
  videos: string[];
  status: 'pending' | 'generating' | 'completed';
  imageStatus?: 'pending' | 'generating' | 'completed';  // 图片生成状态（独立于视频）
  videoStatus?: 'pending' | 'generating' | 'completed';  // 视频生成状态（独立于图片）
  imageLoadingProgress?: number;  // 图片下载进度（0-100），保存在scene中避免虚拟滚动丢失状态
  imageTasks?: GenerationTask[];  // 图片生成任务历史
  videoTasks?: GenerationTask[];  // 视频生成任务历史
  dialogue?: string;
  character?: string;
  narration?: string;
  actionDescription?: string;
  imagePrompt?: string;
  videoPrompt?: string;
  jiMengPrompt?: string;  // 即梦视频AI提示词
  useImageAsReference?: boolean;  // 是否将生成的图片作为视频生成的参考
  promptMode?: 'image' | 'video' | 'jimeng';  // 当前编辑的提示词模式，持久化避免虚拟滚动丢失
  // 新增字段
  sceneName?: string;
  soundEffect?: string;
  duration?: number;
  gridInfo?: {
    lens?: string;
    shotType?: string;
    angle?: string;
    movement?: string;
  };
  filters?: {
    clarity?: boolean;
    nightTone?: boolean;
    vintage?: boolean;
  };
  referenceSceneId?: string;
}

export interface Character {
  id: string;
  name: string;
  description: string;
  voiceType: string;
  referenceImage: string;
  referenceImageBlob?: Blob;
  embedding?: number[];
  createdAt: Date;
}

export interface APIKeys {
  gemini: string;
  nanoBanana: string;
  sora2: string;
  clip: string;
}

export interface AppSettings {
  theme: 'dark' | 'light';
  language: 'zh-CN' | 'en-US';
  autoSave: boolean;
  autoSaveInterval: number;
}

export interface Style {
  id: string;
  name: string;
  description: string;
  referenceImage: string;
  referenceImageBlob?: Blob;  // 本地保存的Blob数据，确保图片永久有效
  createdAt: Date;
}

export type GenerationMode = 'text-to-video' | 'image-to-video';

// ============================================================
// 多API平台配置类型定义
// ============================================================

/** 模型分类 */
export type ModelCategory = 'text' | 'image' | 'video' | 'audio' | 'other';

/** 模型分类标签映射 */
export const MODEL_CATEGORY_LABELS: Record<ModelCategory, string> = {
  text: '文本/聊天',
  image: '图像',
  video: '视频',
  audio: '音频',
  other: '其它',
};

/** 单个模型信息 */
export interface ProviderModel {
  id: string;           // 模型ID，如 "gpt-4o"
  name: string;         // 显示名称（通常与id相同）
  category: ModelCategory;
  owned_by?: string;    // 模型所有者
}

/** API提供商配置 */
export interface ApiProvider {
  id: string;
  name: string;               // 用户自定义名称，如 "我的OpenAI"
  apiUrl: string;             // API基础地址
  apiKey: string;             // API密钥
  models: ProviderModel[];    // 用户选择的模型列表
  enabled: boolean;           // 是否启用
  createdAt: Date;
  updatedAt: Date;
}

/** 模型分类的关键词映射（用于自动分类拉取的模型） */
export const MODEL_CATEGORY_KEYWORDS: Record<ModelCategory, string[]> = {
  video: [
    'veo', 'sora', 'video', 'kling', 'runway', 'hailuo', 'pika',
    'gen', 'movie', 'film', 'animate', 'luma', 'mochi', 'cogvideo',
    'videocraft', 'vidu', 'pixverse', 'morph', 'dreamina',
  ],
  image: [
    'dall-e', 'dalle', 'midjourney', 'flux', 'stable-diffusion', 'sd-',
    'imagen', 'image', 'picture', 'photo', 'draw', 'paint', 'janus',
    'illust', 'vision', 'sdxl', 'playground', 'recraft', 'ideogram',
  ],
  audio: [
    'whisper', 'tts', 'audio', 'speech', 'voice', 'sound', 'music',
    'sonic', 'bark', 'eleven', 'melody', 'harmony',
  ],
  text: [
    'gpt', 'claude', 'gemini', 'llama', 'qwen', 'deepseek', 'chat',
    'mistral', 'mixtral', 'command', 'jurassic', 'cohere', 'yi-',
    'baichuan', 'chatglm', 'ernie', 'spark', 'hunyuan', 'minimax',
    'abab', 'moonshot', 'step', 'phi', 'falcon', 'dbrx', 'reka',
    'text', 'lang', 'instruct', 'complete',
  ],
  other: [
    'embedding', 'moderation', 'rerank', 'search',
  ],
};

// 生成任务类型
export interface GenerationTask {
  id: string;
  type: 'image' | 'video';
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number; // 0-100
  createdAt: Date;
  completedAt?: Date;
  resultUrl?: string;
  resultBlob?: Blob; // 本地保存的Blob数据
  error?: string;
  taskId?: string; // API返回的任务ID，用于轮询
  isVeoTask?: boolean; // 是否为 Veo 模型任务（决定查询使用哪个端点）
}



// ============================================================
// 提示词库 (Prompt Template) 类型定义
// ============================================================

export interface PromptTemplate {
  id: string;
  name: string;
  type: 'image' | 'video' | 'director' | 'script';
  positive_prompt: string;
  negative_prompt?: string;
  created_at: Date;
  updated_at: Date;
}
