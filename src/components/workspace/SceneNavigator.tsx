import * as React from 'react';
import { Button, Popconfirm, Empty, Select, Checkbox } from 'antd';
import { PlusOutlined, DeleteOutlined, DragOutlined } from '@ant-design/icons';
import { LazyImage, LazyVideoThumbnail } from '../common';
import { Scene } from '../../types';
import styles from './SceneNavigator.module.css';

interface SceneNavigatorProps {
  scenes: Scene[];
  activeSceneId: string | null;
  onSelectScene: (sceneId: string) => void;
  onAddScene: () => void;
  onDeleteScene: (sceneId: string) => void;
  onReorderScenes: (fromIndex: number, toIndex: number) => void;
}

const SceneNavigator: React.FC<SceneNavigatorProps> = ({
  scenes,
  activeSceneId,
  onSelectScene,
  onAddScene,
  onDeleteScene,
}) => {
  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h3>分镜列表</h3>
        <Button
          type="primary"
          size="small"
          icon={<PlusOutlined />}
          onClick={onAddScene}
        >
          添加
        </Button>
      </div>

      <div className={styles.sceneList}>
        {scenes.length === 0 ? (
          <Empty
            description="暂无分镜"
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            className={styles.empty}
          />
        ) : (
          scenes.map((scene, index) => (
            <div
              key={scene.id}
              className={`${styles.sceneItem} ${activeSceneId === scene.id ? styles.active : ''}`}
              onClick={() => onSelectScene(scene.id)}
            >
              {/* 顶部：标题 + 场景标签 */}
              <div className={styles.sceneHeader}>
                <div className={styles.sceneTitle}>
                  <DragOutlined className={styles.dragHandle} />
                  <span>分镜_{index + 1}</span>
                </div>
                <Button size="small" className={styles.sceneTag}>场景</Button>
              </div>

              {/* 参考选择行 */}
              <div className={styles.referenceRow}>
                <Checkbox className={styles.checkbox} onClick={(e) => e.stopPropagation()} />
                <span className={styles.refLabel}>参考</span>
                <Select
                  size="small"
                  placeholder="分镜_1"
                  className={styles.refSelect}
                  onClick={(e) => e.stopPropagation()}
                  options={scenes.map((s, i) => ({ label: `分镜_${i + 1}`, value: s.id }))}
                  value={scene.referenceSceneId}
                />
              </div>

              {/* 缩略图预览区 */}
              <div className={styles.thumbnailArea}>
                {scene.images.keyFrame ? (
                  <LazyImage 
                    src={scene.images.keyFrame} 
                    alt={`分镜 ${index + 1}`}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                ) : scene.videos.length > 0 ? (
                  <LazyVideoThumbnail
                    src={scene.videos[0]}
                    showPlayIcon={true}
                    style={{ width: '100%', height: '100%' }}
                  />
                ) : (
                  <div className={styles.placeholder}>
                    {scene.status === 'generating' ? '生成中...' : '待生成'}
                  </div>
                )}
              </div>

              {/* 底部信息 */}
              <div className={styles.sceneFooter}>
                <div className={styles.footerInfo}>
                  <span className={styles.refStatus}>参考图</span>
                  <span className={styles.genStatus}>
                    {scene.status === 'completed' ? '已生成' : scene.status === 'generating' ? '生成中' : '暂无生成记录'}
                  </span>
                </div>
                <Button size="small" type="primary" className={styles.genRefBtn}>
                  开始生成参考图
                </Button>
              </div>

              {/* 删除按钮 */}
              <Popconfirm
                title="确定删除此分镜？"
                onConfirm={(e) => {
                  e?.stopPropagation();
                  onDeleteScene(scene.id);
                }}
                onCancel={(e) => e?.stopPropagation()}
                okText="确定"
                cancelText="取消"
              >
                <Button
                  type="text"
                  danger
                  size="small"
                  icon={<DeleteOutlined />}
                  onClick={(e) => e.stopPropagation()}
                  className={styles.deleteBtn}
                />
              </Popconfirm>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default SceneNavigator;
