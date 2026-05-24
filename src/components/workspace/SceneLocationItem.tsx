import * as React from 'react';
import { memo, useCallback } from 'react';
import { Input, Button, Spin, Tag } from 'antd';
import { ThunderboltOutlined, PictureOutlined, ImportOutlined, EyeOutlined, SyncOutlined } from '@ant-design/icons';
import type { SceneMode } from './SceneManagerModal';
import styles from './SceneLocationItem.module.css';

const { TextArea } = Input;

interface SceneLocationItemProps {
  index: number;
  sceneLabel: string;  // 场景标识，如"场景A"
  sceneDescription: string;
  prompt: string;
  sceneCount: number;
  generatedImage?: string;
  isGenerating: boolean;
  isOptimizing: boolean;
  loadingProgress?: number;  // 图片下载进度
  sceneMode?: SceneMode;     // 当前场景模式
  onPromptChange: (index: number, newPrompt: string) => void;
  onOptimize: (index: number) => void;
  onGenerate: (index: number) => void;
  onImport: (index: number) => void;
  onPreview: (imageUrl: string) => void;
  onApplyToScenes: (index: number) => void;
}

const SceneLocationItem: React.FC<SceneLocationItemProps> = memo(({
  index,
  sceneLabel,
  sceneDescription,
  prompt,
  sceneCount,
  generatedImage,
  isGenerating,
  isOptimizing,
  loadingProgress,
  sceneMode,
  onPromptChange,
  onOptimize,
  onGenerate,
  onImport,
  onPreview,
  onApplyToScenes
}) => {
  const handlePromptChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onPromptChange(index, e.target.value);
  }, [index, onPromptChange]);

  const handleOptimize = useCallback(() => {
    onOptimize(index);
  }, [index, onOptimize]);

  const handleGenerate = useCallback(() => {
    onGenerate(index);
  }, [index, onGenerate]);

  const handleImport = useCallback(() => {
    onImport(index);
  }, [index, onImport]);

  const handleApplyToScenes = useCallback(() => {
    onApplyToScenes(index);
  }, [index, onApplyToScenes]);

  const handlePreview = useCallback(() => {
    if (generatedImage) {
      onPreview(generatedImage);
    }
  }, [generatedImage, onPreview]);

  return (
    <div className={styles.sceneItem}>
      <div className={styles.sceneContent}>
        <div className={styles.sceneLeft}>
          <div className={styles.sceneHeader}>
            <span className={styles.sceneTitle}>{sceneLabel}</span>
            {sceneMode === 'multiview' && (
              <Tag color="purple" style={{ margin: 0 }}>多视角全景</Tag>
            )}
            <span className={styles.sceneCount}>
              ({sceneCount} 个分镜使用)
            </span>
          </div>
          <TextArea
            value={prompt}
            onChange={handlePromptChange}
            placeholder="场景提示词..."
            autoSize={{ minRows: 3, maxRows: 6 }}
            className={styles.promptInput}
          />
          <div className={styles.sceneActions}>
            <Button
              icon={<ThunderboltOutlined />}
              onClick={handleOptimize}
              loading={isOptimizing}
              size="small"
            >
              AI优化
            </Button>
            <Button
              type="primary"
              icon={<PictureOutlined />}
              onClick={handleGenerate}
              loading={isGenerating}
              size="small"
            >
              生成图片
            </Button>
            <Button
              icon={<ImportOutlined />}
              onClick={handleImport}
              disabled={!generatedImage}
              size="small"
            >
              导入分镜
            </Button>
            <Button
              icon={<SyncOutlined />}
              onClick={handleApplyToScenes}
              size="small"
              type="dashed"
            >
              应用到全部分镜
            </Button>
          </div>
        </div>
        <div className={styles.sceneRight}>
          <div 
            className={styles.imagePreview}
            onClick={handlePreview}
          >
            {isGenerating ? (
              <Spin tip={loadingProgress !== undefined && loadingProgress > 0 ? `下载中 ${loadingProgress}%` : '生成中...'}>
                <div className={styles.spinContent} />
              </Spin>
            ) : generatedImage ? (
              <>
                <img src={generatedImage} alt="场景预览" />
                <div className={styles.previewOverlay}>
                  <EyeOutlined />
                </div>
              </>
            ) : (
              <div className={styles.placeholder}>
                <PictureOutlined />
                <span>待生成</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}, (prevProps, nextProps) => {
  return (
    prevProps.index === nextProps.index &&
    prevProps.prompt === nextProps.prompt &&
    prevProps.sceneCount === nextProps.sceneCount &&
    prevProps.generatedImage === nextProps.generatedImage &&
    prevProps.isGenerating === nextProps.isGenerating &&
    prevProps.isOptimizing === nextProps.isOptimizing &&
    prevProps.loadingProgress === nextProps.loadingProgress &&
    prevProps.sceneMode === nextProps.sceneMode
  );
});

SceneLocationItem.displayName = 'SceneLocationItem';

export default SceneLocationItem;
