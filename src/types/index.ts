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
  type: 'image' | 'video' | 'director';
  positive_prompt: string;
  negative_prompt?: string;
  created_at: Date;
  updated_at: Date;
}
