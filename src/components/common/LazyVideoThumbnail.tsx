import * as React from 'react';
import { useState, useRef, useEffect, useMemo, memo } from 'react';
import { PlayCircleOutlined } from '@ant-design/icons';

interface LazyVideoThumbnailProps {
  src: string;
  className?: string;
  style?: React.CSSProperties;
  onClick?: () => void;
  rootMargin?: string;
  showPlayIcon?: boolean;
}

const baseContainerStyle: React.CSSProperties = {
  position: 'relative',
  backgroundColor: '#1a1a2e',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  overflow: 'hidden',
};

const playIconStyleConst: React.CSSProperties = {
  position: 'absolute',
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  fontSize: '32px',
  color: 'rgba(255, 255, 255, 0.9)',
  textShadow: '0 2px 4px rgba(0, 0, 0, 0.5)',
  pointerEvents: 'none'
};

/**
 * 懒加载视频缩略图组件
 * 使用视频第一帧作为缩略图，只在点击时才加载完整视频
 * 使用 Intersection Observer 只在进入视口时才生成缩略图
 */
const LazyVideoThumbnail: React.FC<LazyVideoThumbnailProps> = memo(({
  src,
  className,
  style,
  onClick,
  rootMargin = '100px',
  showPlayIcon = true
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const [thumbnail, setThumbnail] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [hasError, setHasError] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Intersection Observer 检测是否进入视口
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin }
    );

    observer.observe(element);

    return () => observer.disconnect();
  }, [rootMargin]);

  // 当进入视口时，生成视频缩略图
  useEffect(() => {
    if (!isVisible || !src || thumbnail) return;

    setIsLoading(true);

    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.preload = 'metadata';

    const handleLoadedData = () => {
      // 跳转到第一帧
      video.currentTime = 0.1;
    };

    const handleSeeked = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth || 320;
        canvas.height = video.videoHeight || 180;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
          setThumbnail(dataUrl);
        }
      } catch (err) {
        console.warn('生成视频缩略图失败:', err);
        setHasError(true);
      } finally {
        setIsLoading(false);
        video.remove();
      }
    };

    const handleError = () => {
      setHasError(true);
      setIsLoading(false);
      video.remove();
    };

    video.addEventListener('loadeddata', handleLoadedData);
    video.addEventListener('seeked', handleSeeked);
    video.addEventListener('error', handleError);

    videoRef.current = video;
    video.src = src;

    return () => {
      video.removeEventListener('loadeddata', handleLoadedData);
      video.removeEventListener('seeked', handleSeeked);
      video.removeEventListener('error', handleError);
      video.remove();
    };
  }, [isVisible, src, thumbnail]);

  const containerStyle = useMemo<React.CSSProperties>(() => ({
    ...baseContainerStyle,
    cursor: onClick ? 'pointer' : 'default',
    ...style
  }), [onClick, style]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={containerStyle}
      onClick={onClick}
    >
      {thumbnail ? (
        <>
          <img
            src={thumbnail}
            alt="视频缩略图"
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover'
            }}
          />
          {showPlayIcon && <PlayCircleOutlined style={playIconStyleConst} />}
        </>
      ) : (
        <div style={{ color: '#666', fontSize: '12px' }}>
          {hasError ? '加载失败' : isLoading ? '生成缩略图...' : '视频'}
        </div>
      )}
    </div>
  );
});

LazyVideoThumbnail.displayName = 'LazyVideoThumbnail';

export default LazyVideoThumbnail;
