import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { Project, Character, Style, PromptTemplate } from '../types';

// 内部函数：直接从数据库获取媒体数据（避免循环依赖 mediaService）
async function getMediaFromDB(database: IDBPDatabase<ZhexianDB>, type: 'character' | 'style', ownerId: string): Promise<string | null> {
  const mediaId = `${type}_${ownerId}`;
  try {
    const mediaRecord = await database.get('media', mediaId);
    return mediaRecord?.base64 || null;
  } catch {
    return null;
  }
}

interface GeneratedCharacterRecord {
  id: string;
  prompt: string;
  imageUrl: string;
  status: 'generating' | 'completed' | 'failed';
  createdAt: Date;
  aspectRatio?: string;
  imageSize?: string;
}

// 媒体记录接口 - 用于持久化存储角色和风格的参考图
export interface MediaRecord {
  id: string;  // 格式: "{type}_{id}"，支持 character / style
  type: 'character' | 'style';
  ownerId: string;  // 关联的角色/风格/管线元素ID
  base64: string;  // Base64 格式的图片数据（持久化存储）
  mimeType: string;  // 图片MIME类型
  size: number;  // 原始文件大小（字节）
  createdAt: Date;
  updatedAt: Date;
}

interface ZhexianDB extends DBSchema {
  projects: {
    key: string;
    value: Project;
    indexes: { 'by-updated': Date };
  };
  characters: {
    key: string;
    value: Character;
    indexes: { 'by-name': string };
  };
  styles: {
    key: string;
    value: Style;
    indexes: { 'by-name': string };
  };
  ai_character_history: {
    key: string;
    value: GeneratedCharacterRecord;
    indexes: { 'by-created': Date };
  };
  // 独立的媒体存储，用于持久化角色和风格的参考图
  media: {
    key: string;
    value: MediaRecord;
    indexes: { 'by-type': string; 'by-owner': string };
  };
  // 版本6：提示词库
  prompt_templates: {
    key: string;
    value: PromptTemplate;
    indexes: { 'by-updated': Date };
  };
}

let db: IDBPDatabase<ZhexianDB> | null = null;
let dbPromise: Promise<IDBPDatabase<ZhexianDB>> | null = null;

export async function initDatabase(): Promise<IDBPDatabase<ZhexianDB>> {
  if (db) return db;
  
  if (dbPromise) return dbPromise;
  
  dbPromise = openDB<ZhexianDB>('zhexian-comic-studio', 6, {
    upgrade(database, oldVersion) {
      if (oldVersion < 1) {
        const projectStore = database.createObjectStore('projects', { keyPath: 'id' });
        projectStore.createIndex('by-updated', 'updatedAt');

        const characterStore = database.createObjectStore('characters', { keyPath: 'id' });
        characterStore.createIndex('by-name', 'name');
      }
      if (oldVersion < 2) {
        const styleStore = database.createObjectStore('styles', { keyPath: 'id' });
        styleStore.createIndex('by-name', 'name');
      }
      if (oldVersion < 3) {
        const aiCharacterStore = database.createObjectStore('ai_character_history', { keyPath: 'id' });
        aiCharacterStore.createIndex('by-created', 'createdAt');
      }
      // 版本4：添加独立的媒体存储
      if (oldVersion < 4) {
        const mediaStore = database.createObjectStore('media', { keyPath: 'id' });
        mediaStore.createIndex('by-type', 'type');
        mediaStore.createIndex('by-owner', 'ownerId');
      }
      // 版本6：添加提示词库
      if (oldVersion < 6) {
        const templateStore = database.createObjectStore('prompt_templates', { keyPath: 'id' });
        templateStore.createIndex('by-updated', 'updated_at');
      }
    },
  });
  
  db = await dbPromise;
  return db;
}

export function getDatabase(): IDBPDatabase<ZhexianDB> | null {
  return db;
}

// 获取数据库实例（别名，兼容旧代码）
export async function openDatabase(): Promise<IDBPDatabase<ZhexianDB>> {
  return initDatabase();
}

// 项目操作
export async function getAllProjects(): Promise<Project[]> {
  const database = await initDatabase();
  return database.getAllFromIndex('projects', 'by-updated');
}

export async function getProject(id: string): Promise<Project | undefined> {
  const database = await initDatabase();
  return database.get('projects', id);
}

export async function saveProject(project: Project): Promise<void> {
  const database = await initDatabase();
  await database.put('projects', project);
}

export async function deleteProject(id: string): Promise<void> {
  const database = await initDatabase();
  await database.delete('projects', id);
}

// 角色操作
export async function getAllCharacters(): Promise<Character[]> {
  const database = await initDatabase();
  const characters = await database.getAllFromIndex('characters', 'by-name');
  
  // 从媒体服务恢复失效的参考图
  for (const char of characters) {
    // 如果参考图为空、是 blob: URL（刷新后失效）、或是远程 URL（可能过期）
    const needsRestore = !char.referenceImage || 
      char.referenceImage.startsWith('blob:') ||
      char.referenceImage.startsWith('http://') ||
      char.referenceImage.startsWith('https://');
    
    if (needsRestore) {
      try {
        const media = await getMediaFromDB(database, 'character', char.id);
        if (media) {
          char.referenceImage = media;
          // 更新数据库中的记录
          await database.put('characters', char);
          console.log(`[Database] 从媒体服务恢复角色参考图: ${char.name}`);
        }
      } catch (error) {
        console.warn(`[Database] 恢复角色 ${char.name} 的参考图失败:`, error);
      }
    }
  }
  
  return characters;
}

export async function getCharacter(id: string): Promise<Character | undefined> {
  const database = await initDatabase();
  return database.get('characters', id);
}

export async function saveCharacter(character: Character): Promise<void> {
  const database = await initDatabase();
  await database.put('characters', character);
}

export async function deleteCharacter(id: string): Promise<void> {
  const database = await initDatabase();
  await database.delete('characters', id);
}

// 风格操作
export async function getAllStyles(): Promise<Style[]> {
  const database = await initDatabase();
  const styles = await database.getAllFromIndex('styles', 'by-name');
  
  // 从媒体服务恢复失效的参考图
  for (const style of styles) {
    // 如果参考图为空、是 blob: URL（刷新后失效）、或是远程 URL（可能过期）
    const needsRestore = !style.referenceImage || 
      style.referenceImage.startsWith('blob:') ||
      style.referenceImage.startsWith('http://') ||
      style.referenceImage.startsWith('https://');
    
    if (needsRestore) {
      try {
        const media = await getMediaFromDB(database, 'style', style.id);
        if (media) {
          style.referenceImage = media;
          // 更新数据库中的记录
          await database.put('styles', style);
          console.log(`[Database] 从媒体服务恢复风格参考图: ${style.name}`);
        }
      } catch (error) {
        console.warn(`[Database] 恢复风格 ${style.name} 的参考图失败:`, error);
      }
    }
  }
  
  return styles;
}

export async function getStyle(id: string): Promise<Style | undefined> {
  const database = await initDatabase();
  return database.get('styles', id);
}

export async function saveStyle(style: Style): Promise<void> {
  const database = await initDatabase();
  await database.put('styles', style);
}

export async function deleteStyle(id: string): Promise<void> {
  const database = await initDatabase();
  await database.delete('styles', id);
}

// 媒体文件操作（图片/视频永久保存）
export async function saveMediaBlob(key: string, blob: Blob): Promise<void> {
  // 使用 localStorage 存储小文件，大文件使用 IndexedDB
  // 这里简化处理，直接存储到 IndexedDB 的 projects 中
  // 实际生产环境可能需要单独的 media store
  const reader = new FileReader();
  return new Promise((resolve, reject) => {
    reader.onloadend = () => {
      try {
        localStorage.setItem(`media_${key}`, reader.result as string);
        resolve();
      } catch (e) {
        // localStorage 满了，忽略错误
        console.warn('localStorage full, media not saved:', e);
        resolve();
      }
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export async function getMediaBlob(key: string): Promise<string | null> {
  return localStorage.getItem(`media_${key}`);
}

export async function deleteMediaBlob(key: string): Promise<void> {
  localStorage.removeItem(`media_${key}`);
}

// 下载媒体文件到本地
export async function downloadMedia(url: string, filename: string): Promise<void> {
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    const downloadUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(downloadUrl);
  } catch (error) {
    console.error('下载媒体文件失败:', error);
    throw error;
  }
}

// 将URL转换为Blob并保存
export async function saveUrlAsBlob(url: string, key: string): Promise<Blob | null> {
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    await saveMediaBlob(key, blob);
    return blob;
  } catch (error) {
    console.error('保存媒体文件失败:', error);
    return null;
  }
}

// ============================================================
// 提示词库 (Prompt Template) 操作 — v6 新增
// ============================================================

export async function getAllPromptTemplates(): Promise<PromptTemplate[]> {
  const database = await initDatabase();
  return database.getAllFromIndex('prompt_templates', 'by-updated');
}

export async function getPromptTemplate(id: string): Promise<PromptTemplate | undefined> {
  const database = await initDatabase();
  return database.get('prompt_templates', id);
}

export async function savePromptTemplate(template: PromptTemplate): Promise<void> {
  const database = await initDatabase();
  await database.put('prompt_templates', template);
}

export async function deletePromptTemplate(id: string): Promise<void> {
  const database = await initDatabase();
  await database.delete('prompt_templates', id);
}
