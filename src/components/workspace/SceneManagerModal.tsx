import * as React from 'react';
import { useState, useEffect, useMemo, memo, useCallback, useRef } from 'react';
import { Modal, message, Empty, Button, Select } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import { Scene, Style, SceneLocationData } from '../../types';
import { aiService } from '../../services/aiService';
import { preloadImage, blobToBase64 } from '../../utils/imageUtils';
import { saveImageToLocalFile } from '../../utils/imageUtils';
import SceneLocationItem from './SceneLocationItem';
import styles from './SceneManagerModal.module.css';

// 场景生成模式
export type SceneMode = 'standard' | 'multiview';

interface SceneLocation {
  sceneLabel: string;  // 场景标识，如"场景A"
  sceneDescription: string;
  prompt: string;              // 标准模式提示词
  multiViewPrompt?: string;    // 多视角模式提示词
  sceneIds: string[];          // 使用该场景的分镜ID列表
  generatedImage?: string;     // 标准模式生成的图片
  multiViewImage?: string;     // 多视角模式生成的图片
  isGenerating?: boolean;
  isOptimizing?: boolean;
  loadingProgress?: number;    // 图片下载进度
}

interface SceneManagerModalProps {
  visible: boolean;
  scenes: Scene[];
  selectedStyle?: Style;
  savedSceneLocations?: SceneLocationData[];  // 从项目中加载的场景数据
  onClose: () => void;
  onImportToScene: (sceneId: string, imageUrl: string) => void;
  onSaveSceneLocations?: (locations: SceneLocationData[]) => void;  // 保存场景数据
  onApplyPromptToScenes?: (sceneIds: string[], prompt: string) => void;  // 将场景提示词应用到对应分镜
}

const SceneManagerModal: React.FC<SceneManagerModalProps> = memo(({
  visible,
  scenes,
  selectedStyle,
  savedSceneLocations,
  onClose,
  onImportToScene,
  onSaveSceneLocations,
  onApplyPromptToScenes
}) => {
  const [sceneLocations, setSceneLocations] = useState<SceneLocation[]>([]);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [sceneMode, setSceneMode] = useState<SceneMode>('standard');
  
  // 修复 #10: 使用 ref 存储最新的 sceneLocations，避免 useCallback 依赖导致频繁重建
  const sceneLocationsRef = useRef(sceneLocations);
  sceneLocationsRef.current = sceneLocations;

  // 用于跟踪是否已初始化场景数据 - 使用字符串标记当前会话
  const initializedSessionRef = useRef<string | null>(null);
  // 跟踪上一次的 visible 状态
  const prevVisibleRef = useRef(visible);
  
  // 从分镜中提取并去重场景，同时恢复已保存的数据
  // 修复问题#1: 只在弹窗首次打开时初始化，避免导入后重新提取导致场景消失
  // 修复问题#2: 移除 sceneLocations 依赖，使用 ref 避免循环依赖
  useEffect(() => {
    // 生成当前会话ID（弹窗打开时生成）
    const sessionId = visible ? 'session-' + Date.now() : null;
    
    console.log('[SceneManagerModal] useEffect 触发, visible:', visible, 
      'prevVisible:', prevVisibleRef.current,
      'initializedSession:', initializedSessionRef.current,
      'sceneLocations.length:', sceneLocationsRef.current.length);
    
    // 检测弹窗从打开变为关闭
    if (!visible && prevVisibleRef.current) {
      // 弹窗关闭时重置初始化标记，下次打开时重新提取
      initializedSessionRef.current = null;
      prevVisibleRef.current = visible;
      return;
    }
    
    prevVisibleRef.current = visible;
    
    if (!visible) {
      return;
    }
    
    // 如果已经初始化过（当前会话有数据），不再重新提取
    // 关键修复：检查 sceneLocationsRef.current.length > 0 来判断是否已有数据
    if (initializedSessionRef.current && sceneLocationsRef.current.length > 0) {
      console.log('[SceneManagerModal] 已初始化且有数据，跳过重新提取');
      return;
    }
    
    if (scenes.length === 0) return;

    const sceneMap = new Map<string, SceneLocation>();
    // 正则匹配"场景X：描述"格式，只有带冒号和描述的才是完整场景定义
    const sceneDefRegex = /^场景([A-Z])[:：](.+)$/;

    // 创建已保存数据的查找映射
    const savedDataMap = new Map<string, SceneLocationData>();
    if (savedSceneLocations) {
      console.log('[SceneManagerModal] 从项目恢复场景数据:', savedSceneLocations);
      console.log('[SceneManagerModal] 场景图片URL:', savedSceneLocations.map(s => ({ label: s.sceneLabel, image: s.generatedImage?.substring(0, 50) })));
      savedSceneLocations.forEach(saved => {
        savedDataMap.set(saved.sceneLabel, saved);
      });
    } else {
      console.log('[SceneManagerModal] 没有已保存的场景数据');
    }
    
    // 使用 ref 获取当前 sceneLocations，避免将其作为依赖项
    const currentDataMap = new Map<string, SceneLocation>();
    sceneLocationsRef.current.forEach(loc => {
      currentDataMap.set(loc.sceneLabel, loc);
    });

    // 第一遍：先处理所有完整场景定义（场景X：描述）
    scenes.forEach(scene => {
      const desc = scene.description?.trim() || '';
      if (!desc) return;

      const match = desc.match(sceneDefRegex);
      if (match) {
        const sceneLabel = `场景${match[1]}`;  // 如"场景A"
        const sceneContent = match[2].trim();   // 场景描述内容
        
        if (sceneMap.has(sceneLabel)) {
          // 已存在，添加分镜ID
          const existing = sceneMap.get(sceneLabel)!;
          existing.sceneIds.push(scene.id);
        } else {
          // 新场景 - 优先从当前状态恢复，其次从已保存数据恢复
          const currentData = currentDataMap.get(sceneLabel);
          const savedData = savedDataMap.get(sceneLabel);
          sceneMap.set(sceneLabel, {
            sceneLabel,  // 场景标识，如"场景A"
            sceneDescription: `${sceneLabel}：${sceneContent}`,
            prompt: currentData?.prompt || savedData?.prompt || sceneContent,
            multiViewPrompt: currentData?.multiViewPrompt || savedData?.multiViewPrompt,
            sceneIds: [scene.id],
            generatedImage: currentData?.generatedImage || savedData?.generatedImage,
            multiViewImage: currentData?.multiViewImage || savedData?.multiViewImage,
            isGenerating: currentData?.isGenerating || false,
            isOptimizing: currentData?.isOptimizing || false,
            loadingProgress: currentData?.loadingProgress
          });
        }
      }
    });

    // 第二遍：处理重复引用（场景X）
    scenes.forEach(scene => {
      const desc = scene.description?.trim() || '';
      if (!desc) return;

      // 只处理重复引用格式
      if (/^场景[A-Z]$/.test(desc)) {
        const sceneLabel = desc;
        if (sceneMap.has(sceneLabel)) {
          const existing = sceneMap.get(sceneLabel)!;
          // 避免重复添加（如果已经在第一遍中添加过）
          if (!existing.sceneIds.includes(scene.id)) {
            existing.sceneIds.push(scene.id);
          }
        }
      }
    });

    const result = Array.from(sceneMap.values());
    console.log('[SceneManagerModal] 场景提取结果:', result);
    console.log('[SceneManagerModal] 分镜描述列表:', scenes.map(s => ({ id: s.id, description: s.description })));
    setSceneLocations(result);
    initializedSessionRef.current = 'initialized';
  }, [visible, scenes, savedSceneLocations]); // 移除 sceneLocations 依赖

    // 保存场景数据到项目（包含多视角数据）
  const saveSceneData = useCallback((locations: SceneLocation[]) => {
    if (!onSaveSceneLocations) return;

    const dataToSave: SceneLocationData[] = locations.map(loc => ({
      sceneLabel: loc.sceneLabel,
      sceneDescription: loc.sceneDescription,
      prompt: loc.prompt,
      multiViewPrompt: loc.multiViewPrompt,
      generatedImage: loc.generatedImage,
      multiViewImage: loc.multiViewImage,
    } as SceneLocationData));

    onSaveSceneLocations(dataToSave);
  }, [onSaveSceneLocations]);

  // 防抖保存 timer
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 更新场景提示词（根据当前模式写入对应字段）+ 防抖持久化
  const handlePromptChange = useCallback((index: number, newPrompt: string) => {
    setSceneLocations(prev => {
      const updated = [...prev];
      if (sceneMode === 'multiview') {
        updated[index] = { ...updated[index], multiViewPrompt: newPrompt };
      } else {
        updated[index] = { ...updated[index], prompt: newPrompt };
      }
      // 防抖保存（500ms 无输入后自动持久化）
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        saveSceneData(updated);
      }, 500);
      return updated;
    });
  }, [sceneMode, saveSceneData]);

  // 组件卸载时清除定时器
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  // 获取当前模式下的提示词
  const getCurrentPrompt = useCallback((location: SceneLocation): string => {
    if (sceneMode === 'multiview') {
      return location.multiViewPrompt || location.prompt;
    }
    return location.prompt;
  }, [sceneMode]);

  // 获取当前模式下的生成图片
  const getCurrentImage = useCallback((location: SceneLocation): string | undefined => {
    if (sceneMode === 'multiview') {
      return location.multiViewImage || location.generatedImage;
    }
    return location.generatedImage;
  }, [sceneMode]);

  // AI优化场景提示词（根据当前模式调用不同方法）
  const handleOptimizePrompt = async (index: number) => {
    const location = sceneLocationsRef.current[index];
    const currentPrompt = sceneMode === 'multiview'
      ? (location.multiViewPrompt || location.prompt)
      : location.prompt;

    setSceneLocations(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], isOptimizing: true };
      return updated;
    });

    try {
      const optimizedPrompt = sceneMode === 'multiview'
        ? await aiService.optimizeSceneMultiViewPrompt(currentPrompt)
        : await aiService.optimizeScenePrompt(currentPrompt);

      setSceneLocations(prev => {
        const updated = [...prev];
        if (sceneMode === 'multiview') {
          updated[index] = { ...updated[index], multiViewPrompt: optimizedPrompt, isOptimizing: false };
        } else {
          updated[index] = { ...updated[index], prompt: optimizedPrompt, isOptimizing: false };
        }
        saveSceneData(updated);
        return updated;
      });

      message.success(sceneMode === 'multiview' ? '多视角全景提示词优化成功' : '提示词优化成功');
    } catch (error) {
      console.error('优化提示词失败:', error);
      message.error('优化提示词失败');

      setSceneLocations(prev => {
        const updated = [...prev];
        updated[index] = { ...updated[index], isOptimizing: false };
        return updated;
      });
    }
  };

  // 生成场景图片 - 根据当前模式使用对应的提示词和图片字段
  const handleGenerateImage = useCallback(async (index: number) => {
    const location = sceneLocationsRef.current[index];
    const currentPrompt = sceneMode === 'multiview'
      ? (location.multiViewPrompt || location.prompt)
      : location.prompt;

    console.log('[SceneManagerModal] 生成场景图片，当前模式:', sceneMode);
    console.log('[SceneManagerModal] 当前风格:', selectedStyle);

    setSceneLocations(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], isGenerating: true, loadingProgress: 0 };
      return updated;
    });

    try {
      // 多视角模式使用 1:1 方形比例，标准模式使用 16:9
      const aspectRatio = sceneMode === 'multiview' ? '1:1' : '16:9';

      const tempScene: Scene = {
        id: 'temp-scene',
        order: 0,
        description: location.sceneDescription,
        prompt: currentPrompt,
        generationMode: 'text-to-image',
        images: {},
        videos: [],
        status: 'pending'
      };

      const imageUrl = await aiService.generateImage(
        tempScene,
        undefined,
        {
          aspectRatio,
          style: selectedStyle
        }
      );

      await preloadImage(imageUrl, (progress) => {
        setSceneLocations(prev => {
          const updated = [...prev];
          updated[index] = { ...updated[index], loadingProgress: progress };
          return updated;
        });
      });

      let finalImage = imageUrl;
      try {
        console.log('[SceneManagerModal] 开始转换图片为 Base64...');
        const response = await fetch(imageUrl);
        if (response.ok) {
          const blob = await response.blob();
          finalImage = await blobToBase64(blob);
          console.log('[SceneManagerModal] 图片已转换为 Base64，长度:', finalImage.length);
        }
      } catch (err) {
        console.warn('[SceneManagerModal] 转换图片为 Base64 失败，使用原始 URL:', err);
      }

      // 更新到对应模式的图片字段
      const updatedLocations = sceneLocationsRef.current.map((loc, i) =>
        i === index
          ? {
              ...loc,
              ...(sceneMode === 'multiview'
                ? { multiViewImage: finalImage }
                : { generatedImage: finalImage }),
              isGenerating: false,
              loadingProgress: undefined
            }
          : loc
      );

      setSceneLocations(updatedLocations);

      console.log('[SceneManagerModal] 保存场景数据到项目...');
      saveSceneData(updatedLocations);

      message.success(sceneMode === 'multiview' ? '多视角全景场景图生成成功' : '场景图片生成成功');
    } catch (error) {
      console.error('生成场景图片失败:', error);
      message.error('生成场景图片失败');

      setSceneLocations(prev => {
        const updated = [...prev];
        updated[index] = { ...updated[index], isGenerating: false, loadingProgress: undefined };
        return updated;
      });
    }
  }, [selectedStyle, saveSceneData, sceneMode]);

  // 导入场景图片到分镜 - 根据当前模式使用对应的图片
  const handleImport = useCallback((index: number) => {
    const location = sceneLocationsRef.current[index];
    const currentImage = sceneMode === 'multiview' ? location.multiViewImage : location.generatedImage;

    console.log('[SceneManagerModal] 导入场景:', location, '模式:', sceneMode);

    if (!currentImage) {
      message.warning(sceneMode === 'multiview' ? '请先生成多视角全景场景图' : '请先生成场景图片');
      return;
    }

    if (location.sceneIds.length === 0) {
      message.warning('该场景没有关联的分镜');
      return;
    }

    onImportToScene(location.sceneIds.join(','), currentImage);

    message.success(sceneMode === 'multiview'
      ? `已导入多视角全景图到 ${location.sceneIds.length} 个分镜`
      : `已导入到 ${location.sceneIds.length} 个分镜`);
  }, [onImportToScene, sceneMode]);

  // 将场景提示词应用到全部分镜 - 根据当前模式使用对应的 prompt
  const handleApplyToScenes = useCallback((index: number) => {
    const location = sceneLocationsRef.current[index];
    if (!location) return;

    const currentPrompt = sceneMode === 'multiview'
      ? (location.multiViewPrompt || location.prompt)
      : location.prompt;

    if (onApplyPromptToScenes) {
      onApplyPromptToScenes(location.sceneIds, currentPrompt);
      message.success(sceneMode === 'multiview'
        ? `已将多视角全景提示词应用到 ${location.sceneIds.length} 个分镜`
        : `已将场景提示词应用到 ${location.sceneIds.length} 个分镜`);
    }
  }, [onApplyPromptToScenes, sceneMode]);

  // 预览图片
  const handlePreview = useCallback((imageUrl: string) => {
    setPreviewImage(imageUrl);
  }, []);

  return (
    <>
      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span>场景管理</span>
            <Select
              value={sceneMode}
              onChange={(value: SceneMode) => setSceneMode(value)}
              style={{ width: 160 }}
              options={[
                { label: '📷 标准场景', value: 'standard' },
                { label: '🔮 多视角全景', value: 'multiview' },
              ]}
            />
          </div>
        }
        open={visible}
        onCancel={onClose}
        footer={null}
        width="80vw"
        style={{ top: '10vh' }}
        styles={{ body: { height: '70vh', overflow: 'auto' } }}
        forceRender
        destroyOnClose={false}
        className={styles.sceneManagerModal}
      >
        {sceneLocations.length === 0 ? (
          <Empty description="暂无场景数据" />
        ) : (
          <div className={styles.sceneList}>
            {sceneLocations.map((location, index) => (
              <SceneLocationItem
                key={index}
                index={index}
                sceneLabel={location.sceneLabel}
                sceneDescription={location.sceneDescription}
                prompt={getCurrentPrompt(location)}
                sceneCount={location.sceneIds.length}
                generatedImage={getCurrentImage(location)}
                isGenerating={location.isGenerating || false}
                isOptimizing={location.isOptimizing || false}
                loadingProgress={location.loadingProgress}
                sceneMode={sceneMode}
                onPromptChange={handlePromptChange}
                onOptimize={handleOptimizePrompt}
                onGenerate={handleGenerateImage}
                onImport={handleImport}
                onPreview={handlePreview}
                onApplyToScenes={handleApplyToScenes}
              />
            ))}
          </div>
        )}
      </Modal>

      {/* 图片预览弹窗 */}
      <Modal
        open={!!previewImage}
        onCancel={() => setPreviewImage(null)}
        footer={null}
        width="auto"
        centered
        forceRender
        destroyOnClose={false}
        className={styles.previewModal}
        title={
          previewImage ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>场景图片预览</span>
              <Button
                type="primary"
                icon={<DownloadOutlined />}
                onClick={async () => {
                  try {
                    await saveImageToLocalFile(previewImage, `场景图_${Date.now()}`);
                    message.success('图片已保存到本地');
                  } catch (err) {
                    message.error('保存失败');
                    console.error(err);
                  }
                }}
              >
                保存到本地
              </Button>
            </div>
          ) : undefined
        }
      >
        {previewImage && (
          <img src={previewImage} alt="场景预览" className={styles.previewFullImage} />
        )}
      </Modal>
    </>
  );
});

SceneManagerModal.displayName = 'SceneManagerModal';

export default SceneManagerModal;
