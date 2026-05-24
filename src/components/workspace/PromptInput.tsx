import * as React from 'react';
import { useState, useCallback, useRef, useEffect, memo } from 'react';
import { Input } from 'antd';

const { TextArea } = Input;

// 防抖 Hook
function useDebouncedCallback<T extends (...args: Parameters<T>) => void>(
  callback: T,
  delay: number
): T {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  return useCallback((...args: Parameters<T>) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = setTimeout(() => {
      callbackRef.current(...args);
    }, delay);
  }, [delay]) as T;
}

interface PromptInputProps {
  value: string;
  placeholder: string;
  rows?: number;
  className?: string;
  onSave: (text: string) => void;
  onChange?: (text: string) => void;
  debounceMs?: number;
}

/**
 * 独立的提示词输入组件
 * 使用本地状态 + 防抖保存，避免父组件重渲染影响输入流畅度
 */
const PromptInput: React.FC<PromptInputProps> = memo(({
  value,
  placeholder,
  rows = 6,
  className,
  onSave,
  onChange,
  debounceMs = 800
}) => {
  // 本地状态：用于即时响应输入
  const [localValue, setLocalValue] = useState(value);
  
  // 当外部 value 变化时（如 AI 生成），同步到本地状态
  const prevValueRef = useRef(value);
  useEffect(() => {
    // 只有当外部值真正变化时才更新（避免自己保存后触发的更新）
    if (value !== prevValueRef.current) {
      setLocalValue(value);
      prevValueRef.current = value;
    }
  }, [value]);
  
  // 防抖保存
  const debouncedSave = useDebouncedCallback((text: string) => {
    onSave(text);
    prevValueRef.current = text; // 记录已保存的值，避免重复同步
  }, debounceMs);
  
  // 处理输入变更
  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    setLocalValue(text);
    onChange?.(text);
    debouncedSave(text);
  }, [debouncedSave, onChange]);

  return (
    <TextArea
      value={localValue}
      onChange={handleChange}
      placeholder={placeholder}
      rows={rows}
      className={className}
    />
  );
}, (prevProps, nextProps) => {
  return (
    prevProps.value === nextProps.value &&
    prevProps.placeholder === nextProps.placeholder &&
    prevProps.rows === nextProps.rows &&
    prevProps.className === nextProps.className &&
    prevProps.debounceMs === nextProps.debounceMs
  );
});

PromptInput.displayName = 'PromptInput';

export default PromptInput;
