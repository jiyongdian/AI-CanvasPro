/**
 * 媒体管理服务
 * 用于统一管理角色和风格的参考图，确保图片数据的持久化和一致性
 */

import { initDatabase, MediaRecord } from './database';

// 内存缓存，避免重复读取数据库
const mediaCache = new Map<string, { base64: string; mimeType: string }>();

/**
 * 生成媒体ID
 */
export type MediaType = 'character' | 'style';

export function generateMediaId(type: MediaType, ownerId: string): string {
  return `${type}_${ownerId}`;
}

/**
 * 从 Base64 字符串中提取 MIME 类型
 */
function extractMimeType(base64: string): string {
  const match = base64.match(/^data:([^;]+);base64,/);
  return match ? match[1] : 'image/png';
}

/**
 * 估算 Base64 字符串的原始大小（字节）
 */
function estimateBase64Size(base64: string): number {
  const base64Data = base64.split(',')[1] || base64;
  return Math.round(base64Data.length * 0.75);
}

/**
 * 将 Blob 转换为 Base64
 */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * 将 Base64 转换为 Blob
 */
export function base64ToBlob(base64: string): Blob {
  const parts = base64.split(',');
  const mimeMatch = parts[0].match(/:(.*?);/);
  const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';
  const byteString = atob(parts[1]);
  const arrayBuffer = new ArrayBuffer(byteString.length);
  const uint8Array = new Uint8Array(arrayBuffer);
  for (let i = 0; i < byteString.length; i++) {
    uint8Array[i] = byteString.charCodeAt(i);
  }
  return new Blob([uint8Array], { type: mimeType });
}

/**
 * 保存媒体到数据库
 * @param type 媒体类型（character 或 style）
 * @param ownerId 所属角色或风格的ID
 * @param imageData Base64 字符串或 Blob 对象
 */
export async function saveMedia(
  type: MediaType,
  ownerId: string,
  imageData: string | Blob
): Promise<string> {
  const database = await initDatabase();
  const mediaId = generateMediaId(type, ownerId);
  
  // 转换为 Base64
  let base64: string;
  if (typeof imageData === 'string') {
    // 如果是 blob: URL，需要先获取 Blob
    if (imageData.startsWith('blob:')) {
      try {
        const response = await fetch(imageData);
        const blob = await response.blob();
        base64 = await blobToBase64(blob);
      } catch (error) {
        console.error('[MediaService] 无法获取 blob: URL:', error);
        throw new Error('无法获取 blob: URL 的内容');
      }
    } else if (imageData.startsWith('http://') || imageData.startsWith('https://')) {
      // 如果是远程 URL，需要先下载
      try {
        const response = await fetch(imageData);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const blob = await response.blob();
        base64 = await blobToBase64(blob);
      } catch (error) {
        console.error('[MediaService] 无法下载远程图片:', error);
        throw new Error('无法下载远程图片');
      }
    } else {
      // 已经是 Base64
      base64 = imageData;
    }
  } else {
    // Blob 对象
    base64 = await blobToBase64(imageData);
  }
  
  const mimeType = extractMimeType(base64);
  const size = estimateBase64Size(base64);
  const now = new Date();
  
  const mediaRecord: MediaRecord = {
    id: mediaId,
    type,
    ownerId,
    base64,
    mimeType,
    size,
    createdAt: now,
    updatedAt: now
  };
  
  await database.put('media', mediaRecord);
  
  // 更新缓存
  mediaCache.set(mediaId, { base64, mimeType });
  
  console.log(`[MediaService] 保存媒体成功: ${mediaId}, 大小: ${Math.round(size / 1024)}KB`);
  
  return mediaId;
}

/**
 * 获取媒体数据
 * @param type 媒体类型
 * @param ownerId 所属角色或风格的ID
 * @returns Base64 字符串，如果不存在则返回 null
 */
export async function getMedia(
  type: MediaType,
  ownerId: string
): Promise<string | null> {
  const mediaId = generateMediaId(type, ownerId);
  
  // 优先从缓存获取
  if (mediaCache.has(mediaId)) {
    return mediaCache.get(mediaId)!.base64;
  }
  
  // 从数据库获取
  const database = await initDatabase();
  const mediaRecord = await database.get('media', mediaId);
  
  if (mediaRecord) {
    // 更新缓存
    mediaCache.set(mediaId, { base64: mediaRecord.base64, mimeType: mediaRecord.mimeType });
    return mediaRecord.base64;
  }
  
  return null;
}

/**
 * 获取媒体的 Blob 对象
 */
export async function getMediaBlob(
  type: MediaType,
  ownerId: string
): Promise<Blob | null> {
  const base64 = await getMedia(type, ownerId);
  if (!base64) return null;
  return base64ToBlob(base64);
}

/**
 * 删除媒体
 */
export async function deleteMedia(
  type: MediaType,
  ownerId: string
): Promise<void> {
  const database = await initDatabase();
  const mediaId = generateMediaId(type, ownerId);
  
  await database.delete('media', mediaId);
  mediaCache.delete(mediaId);
  
  console.log(`[MediaService] 删除媒体: ${mediaId}`);
}

/**
 * 检查媒体是否存在
 */
export async function hasMedia(
  type: MediaType,
  ownerId: string
): Promise<boolean> {
  const mediaId = generateMediaId(type, ownerId);
  
  if (mediaCache.has(mediaId)) {
    return true;
  }
  
  const database = await initDatabase();
  const mediaRecord = await database.get('media', mediaId);
  return !!mediaRecord;
}

/**
 * 预加载多个媒体到缓存
 * @param items 要预加载的媒体列表
 */
export async function preloadMedia(
  items: Array<{ type: MediaType; ownerId: string }>
): Promise<void> {
  const database = await initDatabase();
  
  const loadPromises = items.map(async ({ type, ownerId }) => {
    const mediaId = generateMediaId(type, ownerId);
    
    // 跳过已缓存的
    if (mediaCache.has(mediaId)) {
      return;
    }
    
    const mediaRecord = await database.get('media', mediaId);
    if (mediaRecord) {
      mediaCache.set(mediaId, { base64: mediaRecord.base64, mimeType: mediaRecord.mimeType });
    }
  });
  
  await Promise.all(loadPromises);
  console.log(`[MediaService] 预加载完成: ${items.length} 个媒体`);
}

/**
 * 清除缓存
 */
export function clearMediaCache(): void {
  mediaCache.clear();
  console.log('[MediaService] 缓存已清除');
}

/**
 * 获取缓存统计信息
 */
export function getMediaCacheStats(): { count: number; estimatedSize: number } {
  let totalSize = 0;
  mediaCache.forEach(({ base64 }) => {
    totalSize += estimateBase64Size(base64);
  });
  return {
    count: mediaCache.size,
    estimatedSize: totalSize
  };
}

/**
 * 迁移旧数据：将角色和风格中的 referenceImage 迁移到独立的媒体存储
 * 这个函数应该在应用启动时调用一次
 */
export async function migrateOldMediaData(): Promise<{ characters: number; styles: number }> {
  const database = await initDatabase();
  let migratedCharacters = 0;
  let migratedStyles = 0;
  
  // 迁移角色参考图
  const characters = await database.getAllFromIndex('characters', 'by-name');
  for (const char of characters) {
    if (char.referenceImage && !char.referenceImage.startsWith('blob:')) {
      const mediaId = generateMediaId('character', char.id);
      const existingMedia = await database.get('media', mediaId);
      
      if (!existingMedia) {
        try {
          await saveMedia('character', char.id, char.referenceImage);
          migratedCharacters++;
        } catch (error) {
          console.warn(`[MediaService] 迁移角色 ${char.name} 的参考图失败:`, error);
        }
      }
    }
  }
  
  // 迁移风格参考图
  const styles = await database.getAllFromIndex('styles', 'by-name');
  for (const style of styles) {
    if (style.referenceImage && !style.referenceImage.startsWith('blob:')) {
      const mediaId = generateMediaId('style', style.id);
      const existingMedia = await database.get('media', mediaId);
      
      if (!existingMedia) {
        try {
          await saveMedia('style', style.id, style.referenceImage);
          migratedStyles++;
        } catch (error) {
          console.warn(`[MediaService] 迁移风格 ${style.name} 的参考图失败:`, error);
        }
      }
    }
  }
  
  console.log(`[MediaService] 数据迁移完成: ${migratedCharacters} 个角色, ${migratedStyles} 个风格`);
  return { characters: migratedCharacters, styles: migratedStyles };
}
