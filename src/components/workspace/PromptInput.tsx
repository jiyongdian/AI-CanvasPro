import * as React from 'react';
import { useState, useCallback, useRef, useEffect, memo, forwardRef, useImperativeHandle } from 'react';
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

export interface PromptInputRef {
  getValue: () => string;
}

/**
 * 独立的提示词输入组件
 * 使用本地状态 + 防抖保存，避免父组件重渲染影响输入流畅度
 * 通过 forwardRef 暴露 getValue()，确保推理时能读到用户最新输入
 */
const PromptInput = memo(forwardRef<PromptInputRef, PromptInputProps>(({
  value,
  placeholder,
  rows = 6,
  className,
  onSave,
  onChange,
  debounceMs = 800
}, ref) => {
  const [localValue, setLocalValue] = useState(value);

  // 暴露 getValue() 给父组件：始终返回当前输入框中的实际文本
  useImperativeHandle(ref, () => ({
    getValue: () => localValue,
  }), [localValue]);

  // 当外部 value 变化时（如 AI 生成），同步到本地状态
  const prevValueRef = useRef(value);
  useEffect(() => {
    if (value !== prevValueRef.current) {
      setLocalValue(value);
      prevValueRef.current = value;
    }
  }, [value]);

  // 防抖保存
  const debouncedSave = useDebouncedCallback((text: string) => {
    onSave(text);
    prevValueRef.current = text;
  }, debounceMs);

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
}), (prevProps, nextProps) => {
  return (
    prevProps.value === nextProps.value &&
    prevProps.placeholder === nextProps.placeholder &&
    prevProps.rows === nextProps.rows &&
    prevProps.className === nextProps.className &&
    prevProps.debounceMs === nextProps.debounceMs
  );
}) as React.FC<PromptInputProps & { ref?: React.Ref<PromptInputRef> }>;

PromptInput.displayName = 'PromptInput';

export default PromptInput;
