/**
 * 图片工具函数集合
 * 包含预加载、压缩、转换、缩略图等功能
 */

// 缩略图缓存（key: 原图src的前64字符hash, value: 缩略图dataURL）
const thumbnailCache = new Map<string, string>();
const THUMBNAIL_CACHE_MAX = 100;

/**
 * 为大图生成缩略图（用于卡片网格等场景，避免在DOM中放置完整Base64）
 * @param src 原始图片源（Base64 或 URL）
 * @param maxWidth 缩略图最大宽度，默认 300px
 * @param quality JPEG 压缩质量，默认 0.7
 * @returns Promise<string> 缩略图 Base64（通常 10-50 KB）
 */
export const createThumbnail = (
  src: string,
  maxWidth: number = 300,
  quality: number = 0.7
): Promise<string> => {
  // 生成缓存 key（取前64个字符 + 长度作为简易 hash）
  const cacheKey = `${src.substring(0, 64)}_${src.length}`;
  const cached = thumbnailCache.get(cacheKey);
  if (cached) return Promise.resolve(cached);

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let w = img.naturalWidth;
      let h = img.naturalHeight;
      if (w > maxWidth) {
        h = Math.round(h * (maxWidth / w));
        w = maxWidth;
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) { resolve(src); return; }
      ctx.drawImage(img, 0, 0, w, h);
      const thumb = canvas.toDataURL('image/jpeg', quality);
      // 存入缓存
      if (thumbnailCache.size >= THUMBNAIL_CACHE_MAX) {
        const firstKey = thumbnailCache.keys().next().value;
        if (firstKey !== undefined) thumbnailCache.delete(firstKey);
      }
      thumbnailCache.set(cacheKey, thumb);
      resolve(thumb);
    };
    img.onerror = () => resolve(src); // 失败时回退到原图
    img.src = src;
  });
};

/**
 * 预加载单张图片（带进度回调）
 * @param url 图片URL
 * @param onProgress 可选的进度回调
 * @returns Promise<string> 返回原始URL（图片已缓存到浏览器）
 */
export const preloadImage = (url: string, onProgress?: (progress: number) => void): Promise<string> => {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.responseType = 'blob';
    
    xhr.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        const progress = Math.round((event.loaded / event.total) * 100);
        onProgress(progress);
      }
    };
    
    xhr.onload = () => {
      if (xhr.status === 200) {
        // 创建 blob URL 并预加载到 Image 对象
        const blob = xhr.response;
        const blobUrl = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
          URL.revokeObjectURL(blobUrl);
          resolve(url);
        };
        img.onerror = () => {
          URL.revokeObjectURL(blobUrl);
          reject(new Error(`Failed to decode image: ${url}`));
        };
        img.src = blobUrl;
      } else {
        reject(new Error(`Failed to preload image: ${xhr.status}`));
      }
    };
    
    xhr.onerror = () => reject(new Error(`Network error loading image: ${url}`));
    xhr.send();
  });
};

/**
 * 预加载多张图片
 * @param urls 图片URL数组
 * @returns Promise<string[]> 返回原始URL数组
 */
export const preloadImages = (urls: string[]): Promise<string[]> => {
  return Promise.all(urls.map(url => preloadImage(url)));
};

/**
 * 压缩图片
 * @param imageData 图片数据（Base64或Blob）
 * @param maxSize 最大尺寸（宽或高的最大值）
 * @param quality 压缩质量 0-1
 * @returns Promise<string> 压缩后的Base64
 */
export const compressImage = (
  imageData: string | Blob,
  maxSize: number = 1024,
  quality: number = 0.8
): Promise<string> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    
    img.onload = () => {
      let { width, height } = img;

      // 清理 Blob 创建的 Object URL
      if (typeof imageData !== 'string') {
        URL.revokeObjectURL(img.src);
      }

      // 计算缩放比例
      if (width > maxSize || height > maxSize) {
        const ratio = Math.min(maxSize / width, maxSize / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }

      // 使用 Canvas 压缩
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Failed to get canvas context'));
        return;
      }

      ctx.drawImage(img, 0, 0, width, height);

      // 转为 Base64
      const compressedBase64 = canvas.toDataURL('image/jpeg', quality);
      resolve(compressedBase64);
    };

    img.onerror = () => {
      // 清理 Blob 创建的 Object URL
      if (typeof imageData !== 'string') {
        URL.revokeObjectURL(img.src);
      }
      reject(new Error('Failed to load image for compression'));
    };
    
    // 设置图片源
    if (typeof imageData === 'string') {
      img.src = imageData;
    } else {
      img.src = URL.createObjectURL(imageData);
    }
  });
};

/**
 * Blob 转 Base64（优化版）
 * @param blob Blob对象
 * @returns Promise<string> Base64字符串
 */
export const blobToBase64 = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

/**
 * 批量并行处理 Blob 转 Base64
 * @param blobs Blob数组
 * @returns Promise<string[]> Base64字符串数组
 */
export const blobsToBase64Parallel = (blobs: Blob[]): Promise<string[]> => {
  return Promise.all(blobs.map(blobToBase64));
};

/**
 * 判断字符串是否为URL（而非Base64）
 * @param str 字符串
 * @returns boolean
 */
export const isUrl = (str: string): boolean => {
  return str.startsWith('http://') || str.startsWith('https://');
};

/**
 * 判断字符串是否为Base64
 * @param str 字符串
 * @returns boolean
 */
export const isBase64 = (str: string): boolean => {
  return str.startsWith('data:');
};

/**
 * 处理参考图：如果是URL则直接返回，如果是大的Base64则压缩
 * @param imageData 图片数据
 * @param maxSize 最大尺寸
 * @returns Promise<string> 处理后的图片数据
 */
export const processReferenceImage = async (
  imageData: string,
  maxSize: number = 1024
): Promise<string> => {
  // 如果是URL，直接返回（API可能支持直接使用URL）
  if (isUrl(imageData)) {
    return imageData;
  }
  
  // 如果是Base64，检查是否需要压缩
  if (isBase64(imageData)) {
    // 估算Base64大小（去掉头部后的长度 * 0.75 约等于字节数）
    const base64Data = imageData.split(',')[1] || '';
    const estimatedSize = base64Data.length * 0.75;
    
    // 如果大于500KB，进行压缩
    if (estimatedSize > 500 * 1024) {
      console.log('[imageUtils] 压缩大图片，原始大小约:', Math.round(estimatedSize / 1024), 'KB');
      return compressImage(imageData, maxSize, 0.8);
    }
  }
  
  return imageData;
};

/**
 * 将远程 URL 图片转换为 Base64 永久保存
 * 统一的图片持久化函数，确保所有图片来源都能永久保存
 * 自动压缩大图片以防止内存溢出
 * @param imageSource 图片来源（URL 或 Base64）
 * @param onProgress 可选的进度回调
 * @param maxSize 最大尺寸（宽或高），默认 1920px
 * @param quality 压缩质量 0-1，默认 0.85
 * @returns Promise<string> Base64 字符串
 */
export const convertToBase64ForStorage = async (
  imageSource: string,
  onProgress?: (progress: number) => void,
  maxSize: number = 1920,
  quality: number = 0.85
): Promise<string> => {
  // 如果已经是 Base64，检查大小并可能压缩
  if (isBase64(imageSource)) {
    const base64Data = imageSource.split(',')[1] || '';
    const estimatedSize = base64Data.length * 0.75;
    // 如果大于 500KB，进行压缩
    if (estimatedSize > 500 * 1024) {
      console.log('[imageUtils] Base64 图片过大，进行压缩...');
      return compressImage(imageSource, maxSize, quality);
    }
    console.log('[imageUtils] 图片已是 Base64 格式，大小合适');
    return imageSource;
  }
  
  // 如果是 blob: URL，需要先获取 Blob
  if (imageSource.startsWith('blob:')) {
    try {
      const response = await fetch(imageSource);
      const blob = await response.blob();
      const base64 = await blobToBase64(blob);
      // 压缩后返回
      console.log('[imageUtils] blob: URL 已转换，进行压缩...');
      return compressImage(base64, maxSize, quality);
    } catch (error) {
      console.error('[imageUtils] 转换 blob: URL 失败:', error);
      throw new Error('无法转换 blob: URL');
    }
  }
  
  // 如果是远程 URL，下载并转换
  if (isUrl(imageSource)) {
    try {
      console.log('[imageUtils] 开始下载远程图片:', imageSource.substring(0, 50) + '...');
      
      const xhr = new XMLHttpRequest();
      xhr.open('GET', imageSource, true);
      xhr.responseType = 'blob';
      
      const blob = await new Promise<Blob>((resolve, reject) => {
        xhr.onprogress = (event) => {
          if (event.lengthComputable && onProgress) {
            const progress = Math.round((event.loaded / event.total) * 100);
            onProgress(progress);
          }
        };
        
        xhr.onload = () => {
          if (xhr.status === 200) {
            resolve(xhr.response);
          } else {
            reject(new Error(`下载失败: ${xhr.status}`));
          }
        };
        
        xhr.onerror = () => reject(new Error('网络错误'));
        xhr.send();
      });
      
      const base64 = await blobToBase64(blob);
      // 压缩后返回
      console.log('[imageUtils] 远程图片已下载，进行压缩...');
      const compressed = await compressImage(base64, maxSize, quality);
      console.log('[imageUtils] 压缩完成，最终大小:', Math.round(compressed.length / 1024), 'KB');
      return compressed;
    } catch (error) {
      console.error('[imageUtils] 下载远程图片失败:', error);
      throw error;
    }
  }
  
  // 其他情况，原样返回
  return imageSource;
};

/**
 * 保存图片到本地文件
 * @param imageSource 图片来源（URL 或 Base64）
 * @param filename 文件名（不含扩展名）
 */
export const saveImageToLocalFile = async (
  imageSource: string,
  filename: string = 'image'
): Promise<void> => {
  try {
    let blob: Blob;
    
    if (isBase64(imageSource)) {
      // Base64 转 Blob
      const parts = imageSource.split(',');
      const mimeMatch = parts[0].match(/:(.*?);/);
      const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';
      const byteString = atob(parts[1]);
      const arrayBuffer = new ArrayBuffer(byteString.length);
      const uint8Array = new Uint8Array(arrayBuffer);
      for (let i = 0; i < byteString.length; i++) {
        uint8Array[i] = byteString.charCodeAt(i);
      }
      blob = new Blob([uint8Array], { type: mimeType });
    } else if (isUrl(imageSource) || imageSource.startsWith('blob:')) {
      // 从 URL 获取 Blob
      const response = await fetch(imageSource);
      blob = await response.blob();
    } else {
      throw new Error('不支持的图片格式');
    }
    
    // 获取文件扩展名
    const mimeType = blob.type || 'image/png';
    const ext = mimeType.split('/')[1] || 'png';
    
    // 创建下载链接
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    console.log('[imageUtils] 图片已保存到本地:', `${filename}.${ext}`);
  } catch (error) {
    console.error('[imageUtils] 保存图片到本地失败:', error);
    throw error;
  }
};
