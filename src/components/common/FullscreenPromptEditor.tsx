/**
 * 全屏放大编辑弹窗 — 极简设计
 * 可复用于 PromptTemplates 页面和 SceneCard 工作台
 */
import * as React from 'react';
import { Modal, Button, Input } from 'antd';

const { TextArea } = Input;

interface FullscreenPromptEditorProps {
  open: boolean;
  title: string;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
  onClose: () => void;
}

const FullscreenPromptEditor: React.FC<FullscreenPromptEditorProps> = ({
  open,
  title,
  value,
  placeholder,
  onChange,
  onClose,
}) => {
  return (
    <Modal
      title={null}
      open={open}
      onCancel={onClose}
      footer={null}
      closable={false}
      width="90vw"
      centered
      zIndex={1050}
      style={{ zIndex: 1050 }}
      maskStyle={{ zIndex: 1049 }}
      styles={{
        content: {
          background: 'var(--body-bg)',
          borderRadius: 12,
          padding: 0,
          overflow: 'hidden',
        },
        body: {
          height: '85vh',
          padding: 0,
          display: 'flex',
          flexDirection: 'column',
        },
      }}
      destroyOnClose={false}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '14px 20px',
          borderBottom: '1px solid var(--panel-border, rgba(255,255,255,0.06))',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: 'var(--text-secondary)',
            letterSpacing: 0.5,
          }}
        >
          {title}
        </span>
        <Button type="primary" size="small" onClick={onClose}>
          完成
        </Button>
      </div>
      <TextArea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoSize={false}
        style={{
          flex: 1,
          width: '100%',
          padding: '20px 24px',
          fontSize: 16,
          lineHeight: 1.85,
          background: 'transparent',
          border: 'none',
          color: 'var(--body-color)',
          resize: 'none',
          borderRadius: 0,
          outline: 'none',
          boxShadow: 'none',
        }}
      />
    </Modal>
  );
};

export default FullscreenPromptEditor;
