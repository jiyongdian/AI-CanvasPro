import * as React from 'react';
import { useState, useRef, useEffect, memo } from 'react';

interface LazyImageProps {
  src: string;
  alt?: string;
  className?: string;
  style?: React.CSSProperties;
  placeholder?: React.ReactNode;
  onClick?: () => void;
  rootMargin?: string;
}

/**
 * 懒加载图片组件
 * 使用 Intersection Observer 只在图片进入视口时才加载
 */
const LazyImage: React.FC<LazyImageProps> = memo(({
  src,
  alt = '',
  className,
  style,
  placeholder,
  onClick,
  rootMargin = '100px'
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);
  const imgRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = imgRef.current;
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

  const handleLoad = () => {
    setIsLoaded(true);
  };

  const handleError = () => {
    setHasError(true);
  };

  const defaultPlaceholder = (
    <div
      style={{
        width: '100%',
        height: '100%',
        backgroundColor: '#1a1a2e',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#666',
        fontSize: '12px'
      }}
    >
      {hasError ? '加载失败' : '加载中...'}
    </div>
  );

  return (
    <div ref={imgRef} className={className} style={style} onClick={onClick}>
      {isVisible && src ? (
        <>
          <img
            src={src}
            alt={alt}
            onLoad={handleLoad}
            onError={handleError}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              opacity: isLoaded ? 1 : 0,
              transition: 'opacity 0.3s ease'
            }}
          />
          {!isLoaded && !hasError && (placeholder || defaultPlaceholder)}
        </>
      ) : (
        placeholder || defaultPlaceholder
      )}
    </div>
  );
});

LazyImage.displayName = 'LazyImage';

export default LazyImage;
