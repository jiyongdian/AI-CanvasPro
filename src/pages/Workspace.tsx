import * as React from 'react';
import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { FixedSizeList as List } from 'react-window';
import { AutoSizer } from 'react-virtualized-auto-sizer';
import { message, Spin, Empty, Select, Button, Modal } from 'antd';
import { UserOutlined, PictureOutlined } from '@ant-design/icons';
import { useParams, useNavigate } from 'react-router-dom';
import { useRecoilState } from 'recoil';
import { currentProjectState, characterListState } from '../store/projectStore';
import { getProject, saveProject, getAllCharacters, getAllStyles, getAllPromptTemplates } from '../services/database';
import { migrateOldMediaData, preloadMedia } from '../services/mediaService';
import { convertToBase64ForStorage, isBase64 } from '../utils/imageUtils';
import SceneCard from '../components/workspace/SceneCard';
import SceneManagerModal from '../components/workspace/SceneManagerModal';
import CharacterSelectCard from '../components/workspace/CharacterSelectCard';
import { Project, Scene, Style, GenerationMode, Character, PromptTemplate } from '../types';
import styles from './Workspace.module.css';

export type GridMode = 4 | 6 | 9;

const Workspace: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useRecoilState(currentProjectState);
  const [, setCharacters] = useRecoilState(characterListState);
  const [loading, setLoading] = useState(true);
  const [gridMode, setGridMode] = useState<GridMode>(6);
  const [styleList, setStyleList] = useState<Style[]>([]);
  const [selectedStyleId, setSelectedStyleId] = useState<string | undefined>(() => {
    const saved = localStorage.getItem('workspace_selected_style');
    return saved || undefined;
  });
  const [generationMode, setGenerationMode] = useState<GenerationMode>(() => {
    const saved = localStorage.getItem('workspace_generation_mode');
    return (saved as GenerationMode) || 'image-to-video';
  });
  const [characterModalVisible, setCharacterModalVisible] = useState(false);
  const [characters, setCharactersLocal] = useState<Character[]>([]);
  const [selectedCharacterIds, setSelectedCharacterIds] = useState<string[]>([]);
  const [sceneManagerVisible, setSceneManagerVisible] = useState(false);
  const [promptTemplates, setPromptTemplates] = useState<PromptTemplate[]>([]);
  const [selectedImageTemplateId, setSelectedImageTemplateId] = useState<string | undefined>(
    () => localStorage.getItem('workspace_image_template') || undefined
  );
  const [selectedVideoTemplateId, setSelectedVideoTemplateId] = useState<string | undefined>(
    () => localStorage.getItem('workspace_video_template_id') || undefined
  );
  const [selectedDirectorTemplateId, setSelectedDirectorTemplateId] = useState<string | undefined>(
    () => localStorage.getItem('workspace_director_template_id') || undefined
  );
  useEffect(() => {
    getAllPromptTemplates().then((data) => setPromptTemplates(data)).catch(() => {});
  }, []);

  // 打开角色选择弹窗，初始化已选中的角色
  const openCharacterModal = () => {
    // 修复 #5: 合并所有分镜的可用角色，而不是只读取第一个分镜
    if (project && project.script.length > 0) {
      const allAvailableIds = new Set<string>();
      project.script.forEach(scene => {
        (scene.availableCharacterIds || []).forEach(id => allAvailableIds.add(id));
      });
      setSelectedCharacterIds(Array.from(allAvailableIds));
    }
    setCharacterModalVisible(true);
  };

  // 切换角色在弹窗中的选中状态
  const toggleCharacterSelection = useCallback((characterId: string) => {
    setSelectedCharacterIds(prev => 
      prev.includes(characterId)
        ? prev.filter(id => id !== characterId)
        : [...prev, characterId]
    );
  }, []);

  // 确认选择，将所有选中的角色应用到所有分镜（角色卡片默认未出场）
  const confirmCharacterSelection = async () => {
    if (!project) return;
    
    // 将选中的角色ID应用到所有分镜，但角色默认未出场（selectedCharacterIds为空）
    const updatedScript = project.script.map(scene => ({
      ...scene,
      // 保存可用角色列表，但出场角色由用户在分镜中单独选择
      availableCharacterIds: selectedCharacterIds,
      // 不自动设置出场角色，保持用户手动选择
    }));
    
    await handleUpdateProject({ ...project, script: updatedScript });
    setCharacterModalVisible(false);
    message.success('角色已应用到所有分镜');
  };

  // 检查角色是否在弹窗中被选中（用 Set 实现 O(1) 查找）
  const selectedCharacterIdSet = useMemo(() => new Set(selectedCharacterIds), [selectedCharacterIds]);
  const isCharacterSelectedInModal = useCallback((characterId: string) => {
    return selectedCharacterIdSet.has(characterId);
  }, [selectedCharacterIdSet]);

  useEffect(() => {
    let cancelled = false;
    const loadProjectData = async () => {
      if (!projectId) {
        navigate('/projects');
        return;
      }

      try {
        setLoading(true);

        // 首次加载时迁移旧数据到媒体服务（只执行一次）
        const migrationKey = 'media_migration_v1';
        if (!localStorage.getItem(migrationKey)) {
          console.log('[Workspace] 开始迁移旧媒体数据...');
          try {
            const result = await migrateOldMediaData();
            if (cancelled) return;
            console.log('[Workspace] 媒体数据迁移完成:', result);
            localStorage.setItem(migrationKey, 'done');
          } catch (migrationError) {
            console.warn('[Workspace] 媒体数据迁移失败:', migrationError);
          }
        }

        const [loadedProject, loadedCharacters, loadedStyles] = await Promise.all([
          getProject(projectId),
          getAllCharacters(),
          getAllStyles()
        ]);

        if (cancelled) return;

        if (!loadedProject) {
          message.error('项目不存在');
          navigate('/projects');
          return;
        }

        console.log('[Workspace] 加载项目, sceneLocations:', loadedProject.sceneLocations);
        setProject(loadedProject);
        setCharacters(loadedCharacters);
        setCharactersLocal(loadedCharacters);
        setStyleList(loadedStyles);

        // 预加载所有角色和风格的媒体到缓存
        const mediaItems: Array<{ type: 'character' | 'style'; ownerId: string }> = [
          ...loadedCharacters.map(c => ({ type: 'character' as const, ownerId: c.id })),
          ...loadedStyles.map(s => ({ type: 'style' as const, ownerId: s.id }))
        ];
        if (mediaItems.length > 0) {
          preloadMedia(mediaItems).catch(err => {
            console.warn('[Workspace] 预加载媒体失败:', err);
          });
        }
      } catch (error) {
        if (cancelled) return;
        message.error('加载项目失败');
        console.error(error);
        navigate('/projects');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    loadProjectData();
    return () => { cancelled = true; };
  }, [projectId]);

  // 保存用户选择的风格和生成模式到 localStorage
  useEffect(() => {
    if (selectedStyleId) {
      localStorage.setItem('workspace_selected_style', selectedStyleId);
    } else {
      localStorage.removeItem('workspace_selected_style');
    }
  }, [selectedStyleId]);

  useEffect(() => {
    localStorage.setItem('workspace_generation_mode', generationMode);
  }, [generationMode]);

  // 预加载角色图片，避免弹窗打开时卡顿
  useEffect(() => {
    characters.forEach(char => {
      if (char.referenceImage) {
        const img = new Image();
        img.src = char.referenceImage;
      }
    });
  }, [characters]);

  const handleUpdateProject = useCallback(async (updatedProject: Project) => {
    const projectToSave = {
      ...updatedProject,
      updatedAt: new Date()
    };
    // 先更新 UI 状态，确保立即显示
    setProject(projectToSave);
    // 再异步保存到数据库
    try {
      await saveProject(projectToSave);
    } catch (error) {
      message.error('保存失败');
      console.error(error);
    }
  }, [setProject]);

  // 防抖保存：批量合并快速更新（如输入提示词时的高频 onUpdateScene 调用）
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingProjectRef = useRef<Project | null>(null);

  const debouncedSave = useCallback((project: Project) => {
    pendingProjectRef.current = project;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const toSave = pendingProjectRef.current;
      if (toSave) {
        saveProject(toSave).catch(error => {
          message.error('保存失败');
          console.error(error);
        });
        pendingProjectRef.current = null;
      }
    }, 500);
  }, []);

  // 组件卸载时立即保存未持久化的数据
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        const toSave = pendingProjectRef.current;
        if (toSave) {
          saveProject(toSave).catch(console.error);
        }
      }
    };
  }, []);

  const handleUpdateScene = useCallback((
    sceneId: string, 
    updates: Partial<Scene> | ((prevScene: Scene) => Partial<Scene>)
  ) => {
    setProject(prevProject => {
      if (!prevProject) return prevProject;
      
      const updatedScript = prevProject.script.map(scene => {
        if (scene.id !== sceneId) return scene;
        // 支持函数式更新：如果 updates 是函数，则调用它获取实际的更新对象
        const actualUpdates = typeof updates === 'function' ? updates(scene) : updates;
        return { ...scene, ...actualUpdates };
      });

      const updatedProject = {
        ...prevProject,
        script: updatedScript,
        updatedAt: new Date()
      };
      
      // 防抖保存到数据库（UI 立即更新，磁盘写入延迟合并）
      debouncedSave(updatedProject);
      
      return updatedProject;
    });
  }, [setProject, debouncedSave]);

  const handleAddScene = useCallback(async (insertIndex: number) => {
    if (!project) return;

    const newScene: Scene = {
      id: crypto.randomUUID(),
      order: insertIndex + 1,
      description: '',
      prompt: '',
      generationMode: 'text-to-image',
      images: {},
      videos: [],
      status: 'pending'
    };

    const updatedScript = [
      ...project.script.slice(0, insertIndex + 1),
      newScene,
      ...project.script.slice(insertIndex + 1)
    ].map((scene, index) => ({ ...scene, order: index }));

    const updatedProject = {
      ...project,
      script: updatedScript
    };

    await handleUpdateProject(updatedProject);
  }, [project, handleUpdateProject]);

  const handleDeleteScene = useCallback(async (sceneId: string) => {
    if (!project) return;

    const updatedScript = project.script
      .filter(scene => scene.id !== sceneId)
      .map((scene, index) => ({ ...scene, order: index }));

    const updatedProject = {
      ...project,
      script: updatedScript
    };

    await handleUpdateProject(updatedProject);
  }, [project, handleUpdateProject]);

  // 缓存选中的风格，避免每次渲染都查找
  const selectedStyle = useMemo(() => 
    styleList.find(s => s.id === selectedStyleId),
    [styleList, selectedStyleId]
  );

  // 使用 useMemo 缓存 itemData，避免每次渲染都创建新对象
  const selectedImageTemplate = useMemo(() =>
    selectedImageTemplateId ? promptTemplates.find((t) => t.id === selectedImageTemplateId) : undefined,
    [selectedImageTemplateId, promptTemplates]
  );
  const selectedVideoTemplate = useMemo(() =>
    selectedVideoTemplateId ? promptTemplates.find((t) => t.id === selectedVideoTemplateId) : undefined,
    [selectedVideoTemplateId, promptTemplates]
  );
  const selectedDirectorTemplate = useMemo(() =>
    selectedDirectorTemplateId ? promptTemplates.find((t) => t.id === selectedDirectorTemplateId) : undefined,
    [selectedDirectorTemplateId, promptTemplates]
  );

  const listItemData = useMemo(() => ({
    scenes: project?.script || [],
    gridMode,
    selectedStyle,
    generationMode,
    selectedImageTemplate,
    selectedVideoTemplate,
    selectedDirectorTemplate,
    handleUpdateScene,
    handleDeleteScene,
    handleAddScene
  }), [project?.script, gridMode, selectedStyle, generationMode, selectedImageTemplate, selectedVideoTemplate, selectedDirectorTemplate, handleUpdateScene, handleDeleteScene, handleAddScene]);

  // 分镜列表渲染函数，使用 data 从 itemData 获取，避免闭包依赖
  const renderSceneItem = useCallback(({ index, style, data }: { index: number; style: React.CSSProperties; data: typeof listItemData }) => {
    const scene = data.scenes[index];
    if (!scene) return null;
    return (
      <div style={{ ...style, paddingRight: 8 }}>
        <SceneCard
          key={scene.id}
          scene={scene}
          index={index}
          allScenes={data.scenes}
          gridMode={data.gridMode}
          selectedStyle={data.selectedStyle}
          generationMode={data.generationMode}
          imageTemplate={data.selectedImageTemplate}
          videoTemplate={data.selectedVideoTemplate}
          directorTemplate={data.selectedDirectorTemplate}
          onUpdateScene={(updates) => data.handleUpdateScene(scene.id, updates)}
          onDeleteScene={() => data.handleDeleteScene(scene.id)}
          onInsertScene={() => data.handleAddScene(index)}
        />
      </div>
    );
  }, []); // 空依赖，函数不会重新创建
  // 滚动位置持久化：离开页面再回来时恢复到之前的分镜位置
  const listRef = useRef<any>(null);
  useEffect(() => {
    if (loading || !projectId) return;
    const idx = sessionStorage.getItem(`workspace_scroll_item_${projectId}`);
    if (!idx) return;
    const go = () => { listRef.current?.scrollToItem(parseInt(idx, 10), 'start'); };
    const t1 = setTimeout(go, 200);
    const t2 = setTimeout(go, 500);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [loading, projectId]);

  if (loading) {
    return (
      <div className={styles.loadingContainer}>
        <Spin size="large" />
      </div>
    );
  }

  if (!project) {
    return null;
  }

  return (
    <div className={styles.workspace}>
      {/* 顶部操作栏 */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <h2 className={styles.projectTitle}>{project.name}</h2>
          <Select
            value={gridMode}
            onChange={(value) => setGridMode(value)}
            className={styles.gridModeSelect}
            options={[
              { label: '2×2 (4格)', value: 4 },
              { label: '2×3 (6格)', value: 6 },
              { label: '3×3 (9格)', value: 9 }
            ]}
          />
          <Select
            value={selectedStyleId}
            onChange={(value) => setSelectedStyleId(value)}
            className={styles.styleSelect}
            placeholder="选择风格"
            allowClear
            options={styleList.map(s => ({ label: s.name, value: s.id }))}
          />
          <Select
            value={generationMode}
            onChange={(value) => setGenerationMode(value)}
            className={styles.generationModeSelect}
            options={[
              { label: '文生视频', value: 'text-to-video' },
              { label: '图生视频', value: 'image-to-video' }
            ]}
          />
          <Button
            icon={<UserOutlined />}
            onClick={openCharacterModal}
            className={styles.characterBtn}
          >
            角色
          </Button>
          <Button
            icon={<PictureOutlined />}
            onClick={() => setSceneManagerVisible(true)}
            className={styles.sceneBtn}
          >
            场景
          </Button>
          {promptTemplates.length > 0 && (
            <Select
              value={selectedImageTemplateId}
              className={styles.templateSelect}
              placeholder="图片提示词模板"
              allowClear
              onClear={() => {
                setSelectedImageTemplateId(undefined);
                localStorage.removeItem('workspace_image_template');
              }}
              onChange={(value) => {
                setSelectedImageTemplateId(value);
                if (value) localStorage.setItem('workspace_image_template', value);
                else localStorage.removeItem('workspace_image_template');
              }}
              options={promptTemplates.filter((t) => t.type === 'image').map((t) => ({
                label: t.name,
                value: t.id,
              }))}
              filterOption={(input, option) =>
                (option?.label as string)?.toLowerCase().includes(input.toLowerCase())
              }
            />
          )}
          {promptTemplates.length > 0 && (
            <Select
              value={selectedVideoTemplateId}
              className={styles.templateSelect}
              placeholder="视频提示词模板"
              allowClear
              onClear={() => {
                setSelectedVideoTemplateId(undefined);
                localStorage.removeItem('workspace_video_template_id');
              }}
              onChange={(value) => {
                setSelectedVideoTemplateId(value);
                if (value) localStorage.setItem('workspace_video_template_id', value);
                else localStorage.removeItem('workspace_video_template_id');
              }}
              options={promptTemplates.filter((t) => t.type === 'video').map((t) => ({
                label: t.name,
                value: t.id,
              }))}
              filterOption={(input, option) =>
                (option?.label as string)?.toLowerCase().includes(input.toLowerCase())
              }
            />
          )}
          {promptTemplates.length > 0 && (
            <Select
              value={selectedDirectorTemplateId}
              className={styles.templateSelect}
              placeholder="导演提示词模板"
              allowClear
              onClear={() => {
                setSelectedDirectorTemplateId(undefined);
                localStorage.removeItem('workspace_director_template_id');
              }}
              onChange={(value) => {
                setSelectedDirectorTemplateId(value);
                if (value) localStorage.setItem('workspace_director_template_id', value);
                else localStorage.removeItem('workspace_director_template_id');
              }}
              options={promptTemplates.filter((t) => t.type === 'director').map((t) => ({
                label: t.name,
                value: t.id,
              }))}
              filterOption={(input, option) =>
                (option?.label as string)?.toLowerCase().includes(input.toLowerCase())
              }
            />
          )}
        </div>
      </div>

      {/* 角色选择弹窗 */}
      <Modal
        title="选择角色（应用到所有分镜）"
        open={characterModalVisible}
        onCancel={() => setCharacterModalVisible(false)}
        forceRender
        destroyOnClose={false}
        onOk={confirmCharacterSelection}
        okText="确认"
        cancelText="取消"
        width="45%"
        centered
        className={styles.characterModal}
      >
        <div className={styles.characterGrid}>
          {characters.length === 0 ? (
            <Empty description="暂无角色，请先在角色库中创建" />
          ) : (
            characters.map(char => (
              <CharacterSelectCard
                key={char.id}
                character={char}
                isSelected={isCharacterSelectedInModal(char.id)}
                onToggle={toggleCharacterSelection}
              />
            ))
          )}
        </div>
      </Modal>

      {/* 分镜列表 - 使用虚拟滚动 */}
      <div className={styles.sceneList}>
        {project.script.length === 0 ? (
          <Empty
            description="暂无分镜"
            className={styles.empty}
          />
        ) : (
          <AutoSizer
            renderProp={({ height, width }) => (
              <List
                ref={(li: any) => { if (li) listRef.current = li; }}
                height={height || 0}
                width={width || 0}
                itemCount={project.script.length}
                itemSize={450}
                overscanCount={2}
                itemKey={(index) => project.script[index]?.id || `scene-${index}`}
                itemData={listItemData}
                onScroll={({ scrollOffset }: { scrollOffset: number }) => {
                  // 保存当前可见的分镜序号
                  const visibleIndex = Math.floor(scrollOffset / 450);
                  sessionStorage.setItem(`workspace_scroll_item_${projectId}`, String(visibleIndex));
                }}
              >
                {renderSceneItem}
              </List>
            )}
          />
        )}
      </div>

      {/* 场景管理弹窗 */}
      <SceneManagerModal
        visible={sceneManagerVisible}
        scenes={project.script}
        selectedStyle={selectedStyle}
        savedSceneLocations={project.sceneLocations}
        onClose={() => setSceneManagerVisible(false)}
        onImportToScene={(sceneIds, imageUrl) => {
          // 将场景图片导入到对应分镜
          // sceneIds 是逗号分隔的ID字符串，支持批量导入
          const idsToUpdate = sceneIds.split(',').filter(Boolean);

          if (idsToUpdate.length === 0) {
            message.warning('没有可导入的分镜');
            return;
          }

          // 注意：为避免内存溢出，直接使用原始 URL/Base64
          // 场景弹窗中已经将图片转为 Base64（如果需要）
          const updatedScript = project.script.map(scene => {
            if (idsToUpdate.includes(scene.id)) {
              return {
                ...scene,
                images: {
                  ...scene.images,
                  keyFrame: imageUrl,    // 显示在左侧预览框
                  storyboard: imageUrl   // 作为AI生成时的场景参考图
                }
              };
            }
            return scene;
          });
          const updatedProject = { ...project, script: updatedScript, updatedAt: new Date() };
          setProject(updatedProject);
          handleUpdateProject(updatedProject);
          message.success(`已将场景图导入到 ${idsToUpdate.length} 个分镜`);
        }}
        onSaveSceneLocations={(locations) => {
          // 保存场景数据到项目
          console.log('[Workspace] 保存场景数据:', locations);
          handleUpdateProject({ ...project, sceneLocations: locations });
        }}
        onApplyPromptToScenes={(sceneIds, prompt) => {
          // 将场景提示词应用到对应分镜的即梦提示词
          const updatedScript = project.script.map(scene => {
            if (sceneIds.includes(scene.id)) {
              const parts: string[] = [];
              parts.push(`【场景提示词】${prompt}`);
              if (scene.actionDescription) parts.push(`【动作描述】${scene.actionDescription}`);
              if (scene.dialogue) parts.push(`【对话】\n${scene.dialogue}`);
              const jiMengPrompt = parts.join('\n');
              return { ...scene, jiMengPrompt };
            }
            return scene;
          });
          const updatedProject = { ...project, script: updatedScript, updatedAt: new Date() };
          setProject(updatedProject);
          saveProject(updatedProject).catch(err => console.error('保存失败:', err));
          message.success('场景提示词已应用到对应分镜');
        }}
      />
    </div>
  );
};

export default Workspace;
