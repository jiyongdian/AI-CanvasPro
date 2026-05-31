import * as React from 'react';
import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { message, Spin, Empty, Button, Modal, Progress, Select, Input, Tag } from 'antd';
import {
  UserOutlined, PictureOutlined, ArrowLeftOutlined, PlayCircleOutlined,
  PlusOutlined, DeleteOutlined, ThunderboltOutlined, BulbOutlined, UploadOutlined,
  EyeOutlined, MenuFoldOutlined, MenuUnfoldOutlined, FileTextOutlined,
  ApiOutlined, VideoCameraOutlined, UpOutlined, DownOutlined, HistoryOutlined, DownloadOutlined,
} from '@ant-design/icons';
import { useParams, useNavigate } from 'react-router-dom';
import { useRecoilState, useSetRecoilState } from 'recoil';
import { currentProjectState, characterListState } from '../store/projectStore';
import { getProject, saveProject, getAllCharacters, getAllStyles, getAllPromptTemplates } from '../services/database';
import { migrateOldMediaData, preloadMedia } from '../services/mediaService';
import { saveImageToLocalFile } from '../utils/imageUtils';
import CharacterSelectCard from '../components/workspace/CharacterSelectCard';
import SceneManagerModal from '../components/workspace/SceneManagerModal';
import { Project, Scene, Style, GenerationMode, Character, PromptTemplate, ApiProvider, ProviderModel } from '../types';
import { aiService } from '../services/aiService';
import { loadApiProviders } from '../services/secureStorage';
import styles from './Workspace.module.css';

export type GridMode = 4 | 6 | 9;
type PreviewMode = 'image' | 'video';

interface TaskHistoryItem {
  id: string; type: 'image' | 'video'; url: string; sceneId: string;
  createdAt: string; prompt: string; model?: string; status?: 'generating' | 'completed' | 'failed';
}

const TEMPLATE_TYPE_LABELS: Record<string, string> = { image: '图片模板', video: '视频模板', director: '导演模板' };
const TEMPLATE_TYPE_ICONS: Record<string, React.ReactNode> = { image: <PictureOutlined />, video: <PlayCircleOutlined />, director: <BulbOutlined /> };
const IMAGE_RATIOS = ['1:1 方形', '3:2 标准', '4:3 经典', '16:9 宽屏', '9:16 竖屏', '2:3 肖像', '3:4', '21:9 超宽'];
const VIDEO_DURATIONS_ALL = [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,20,30,60];
const VIDEO_QUALITIES_ALL = ['480p 标清','540p','720p 高清','1080p 全高清'];
const VIDEO_MODEL_PRESETS: Record<string, { durations: number[]; qualities: string[] }> = {
  'doubao-seedance-2.0': { durations: [5,6,7,8,9,10,11,12,13,14,15], qualities: ['480p','720p','1080p'] },
  'viduq3': { durations: [5,8,10,16], qualities: ['540p','720p 高清','1080p 全高清'] },
  'veo-3': { durations: [5,8,10], qualities: ['720p 高清','1080p 全高清'] },
  'veo-2': { durations: [5,8], qualities: ['720p 高清','1080p 全高清'] },
  'sora-2': { durations: [5,10,15], qualities: ['480p 标清','720p 高清','1080p 全高清'] },
  'kling': { durations: [5,10], qualities: ['720p 高清','1080p 全高清'] },
  'grok-video-3': { durations: [5,8,10], qualities: ['720P','1080P'] },
};
const getVideoPreset = (modelId: string | undefined) => {
  if (!modelId) return { durations: [5,8,10], qualities: ['720p 高清','1080p 全高清'] };
  for (const [key, preset] of Object.entries(VIDEO_MODEL_PRESETS)) if (modelId.toLowerCase().includes(key)) return preset;
  return { durations: [5,8,10], qualities: ['720p 高清','1080p 全高清'] };
};

// 任务历史存储
const loadTaskHistory = (projectId: string): TaskHistoryItem[] => {
  try { const v = localStorage.getItem(`ws_tasks_${projectId}`); return v ? JSON.parse(v) : []; } catch { return []; }
};
const saveTaskHistory = (projectId: string, tasks: TaskHistoryItem[]) => {
  localStorage.setItem(`ws_tasks_${projectId}`, JSON.stringify(tasks));
};

const Workspace: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useRecoilState(currentProjectState);
  const setCharacters = useSetRecoilState(characterListState);
  const [loading, setLoading] = useState(true);

  const [styleList, setStyleList] = useState<Style[]>([]);
  const [selectedStyleId, setSelectedStyleId] = useState<string | undefined>(() => localStorage.getItem('workspace_selected_style') || undefined);
  const [generationMode, setGenerationMode] = useState<GenerationMode>(() => (localStorage.getItem('workspace_generation_mode') as GenerationMode) || 'image-to-video');
  const [promptTemplates, setPromptTemplates] = useState<PromptTemplate[]>([]);
  const [selectedImageTemplateId, setSelectedImageTemplateId] = useState<string | undefined>(() => localStorage.getItem('workspace_image_template') || undefined);
  const [selectedVideoTemplateId, setSelectedVideoTemplateId] = useState<string | undefined>(() => localStorage.getItem('workspace_video_template_id') || undefined);
  const [selectedDirectorTemplateId, setSelectedDirectorTemplateId] = useState<string | undefined>(() => localStorage.getItem('workspace_director_template_id') || undefined);

  const [characterModalVisible, setCharacterModalVisible] = useState(false);
  const [characters, setCharactersLocal] = useState<Character[]>([]);
  const [selectedCharacterIds, setSelectedCharacterIds] = useState<string[]>([]);
  const [sceneManagerVisible, setSceneManagerVisible] = useState(false);

  const [activeSceneId, setActiveSceneId] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState<PreviewMode>('image');
  const [promptText, setPromptText] = useState('');
  const [promptExpanded, setPromptExpanded] = useState(() => sessionStorage.getItem('ws_prompt_expanded') === 'true');
  const [generating, setGenerating] = useState(false);
  const [genProgress, setGenProgress] = useState(0);
  const [inferLoading, setInferLoading] = useState(false);
  const [directorLoading, setDirectorLoading] = useState(false);
  const [directorPreviewOpen, setDirectorPreviewOpen] = useState(false);
  const [directorResult, setDirectorResult] = useState('');
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [templateSelectOpen, setTemplateSelectOpen] = useState(false);
  const [addConfirmOpen, setAddConfirmOpen] = useState(false);
  const [previewImportOpen, setPreviewImportOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const leftListRef = useRef<HTMLDivElement>(null);

  // 模型关联
  const [providers, setProviders] = useState<ApiProvider[]>([]);
  const [selPlatformId, setSelPlatformId] = useState<string | undefined>(() => localStorage.getItem('ws_platform_id') || undefined);
  const [modelSettingsOpen, setModelSettingsOpen] = useState(false);
  const [selImageModel, setSelImageModel] = useState<string | undefined>(() => localStorage.getItem('ws_image_model') || undefined);
  const [selVideoModel, setSelVideoModel] = useState<string | undefined>(() => localStorage.getItem('ws_video_model') || undefined);
  const [selTextModel, setSelTextModel] = useState<string | undefined>(() => localStorage.getItem('ws_text_model') || undefined);
  const [imageRatio, setImageRatio] = useState<string>(() => localStorage.getItem('ws_image_ratio') || '16:9 宽屏');
  const [videoDuration, setVideoDuration] = useState<number>(() => parseInt(localStorage.getItem('ws_video_duration') || '5'));
  const [videoQuality, setVideoQuality] = useState<string>(() => localStorage.getItem('ws_video_quality') || '1080p 全高清');

  const selPlatform = useMemo(() => providers.find(p => p.id === selPlatformId), [providers, selPlatformId]);
  // 所有模型统一列表（不限类别，视频/图片/文本/其它均可用）
  const allModels = useMemo(() => { const seen = new Set<string>(); const r: ProviderModel[] = []; const src = selPlatform ? [selPlatform] : providers; src.forEach(p => p.models.forEach(m => { if (!seen.has(m.id)) { seen.add(m.id); r.push(m); } })); return r; }, [providers, selPlatform]);

  const [taskHistory, setTaskHistory] = useState<TaskHistoryItem[]>(() => loadTaskHistory(projectId || ''));

  const getProviderForModel = useCallback((modelId: string) => providers.find(p => p.models.some(m => m.id === modelId)), [providers]);

  useEffect(() => { getAllPromptTemplates().then(d => setPromptTemplates(d)).catch(() => {}); }, []);

  const activeScene = useMemo(() => project?.script.find(s => s.id === activeSceneId) || null, [project, activeSceneId]);
  const selectedStyle = useMemo(() => styleList.find(s => s.id === selectedStyleId), [styleList, selectedStyleId]);
  const templatesByType = useMemo(() => ({ image: promptTemplates.filter(t => t.type === 'image'), video: promptTemplates.filter(t => t.type === 'video'), director: promptTemplates.filter(t => t.type === 'director') }), [promptTemplates]);
  const getSelectedTemplateId = (type: string) => type === 'image' ? selectedImageTemplateId : type === 'video' ? selectedVideoTemplateId : selectedDirectorTemplateId;
  const setSelectedTemplateId = (type: string, id: string | undefined) => { if (type === 'image') setSelectedImageTemplateId(id); else if (type === 'video') setSelectedVideoTemplateId(id); else setSelectedDirectorTemplateId(id); };

  const handleBack = () => { setProject(null as any); navigate('/projects'); };
  const buildScenePrompt = (s: Scene | undefined, preferMode?: PreviewMode): string => { if (!s) return ''; const existing = preferMode === 'image' ? s.imagePrompt : preferMode === 'video' ? s.videoPrompt : undefined; if (existing) return existing; const parts: string[] = []; if (s.description) parts.push(s.description); if (s.actionDescription) parts.push(`【动作】${s.actionDescription}`); if (s.character) parts.push(`【角色】${s.character}`); if (s.dialogue) parts.push(`【对话】${s.dialogue}`); if (s.narration) parts.push(`【旁白】${s.narration}`); return parts.join('\n'); };

  const addTaskToHistory = useCallback((item: TaskHistoryItem) => {
    setTaskHistory(prev => { const updated = [item, ...prev]; if (projectId) saveTaskHistory(projectId, updated); return updated; });
  }, [projectId]);

  // ==================== 加载 ====================
  useEffect(() => { let c = false; (async () => { if (!projectId) { navigate('/projects'); return; } setLoading(true); try { if (!localStorage.getItem('media_migration_v1')) { try { await migrateOldMediaData(); localStorage.setItem('media_migration_v1', 'done'); } catch {} } const [lp, lc, ls] = await Promise.all([getProject(projectId), getAllCharacters(), getAllStyles()]); if (c) return; if (!lp) { message.error('项目不存在'); navigate('/projects'); return; } setProject(lp); setCharacters(lc); setCharactersLocal(lc); setStyleList(ls); const savedSceneId = sessionStorage.getItem(`ws_active_${projectId}`); const initialScene = savedSceneId ? lp.script.find(s => s.id === savedSceneId) : lp.script[0]; if (initialScene) { setActiveSceneId(initialScene.id); setPromptText(buildScenePrompt(initialScene)); } else if (lp.script.length > 0) { setActiveSceneId(lp.script[0].id); setPromptText(buildScenePrompt(lp.script[0])); } try { const p = await loadApiProviders(); setProviders(p.filter(x => x.enabled !== false)); } catch {} const items: Array<{type:'character'|'style';ownerId:string}> = [...lc.map(x=>({type:'character' as const,ownerId:x.id})), ...ls.map(x=>({type:'style' as const,ownerId:x.id}))]; if (items.length > 0) preloadMedia(items).catch(()=>{}); setTaskHistory(loadTaskHistory(projectId)); } catch (e) { if (!c) { message.error('加载失败'); navigate('/projects'); } } finally { if (!c) setLoading(false); } })(); return () => { c = true; setProject(null as any); }; }, [projectId]);

  useEffect(() => { if (!loading && leftListRef.current && projectId) { const s = sessionStorage.getItem(`ws_scroll_${projectId}`); if (s) leftListRef.current.scrollTop = parseInt(s, 10); } }, [loading, projectId]);
  const handleLeftScroll = useCallback(() => { if (leftListRef.current && projectId) sessionStorage.setItem(`ws_scroll_${projectId}`, String(leftListRef.current.scrollTop)); }, [projectId]);

  // 模型选择持久化
  useEffect(() => { if (selPlatformId) localStorage.setItem('ws_platform_id', selPlatformId); else localStorage.removeItem('ws_platform_id'); }, [selPlatformId]);
  useEffect(() => { if (selImageModel) localStorage.setItem('ws_image_model', selImageModel); else localStorage.removeItem('ws_image_model'); }, [selImageModel]);
  useEffect(() => { if (selVideoModel) localStorage.setItem('ws_video_model', selVideoModel); else localStorage.removeItem('ws_video_model'); }, [selVideoModel]);
  useEffect(() => { if (selTextModel) localStorage.setItem('ws_text_model', selTextModel); else localStorage.removeItem('ws_text_model'); }, [selTextModel]);
  useEffect(() => { localStorage.setItem('ws_image_ratio', imageRatio); }, [imageRatio]);
  useEffect(() => { localStorage.setItem('ws_video_duration', String(videoDuration)); }, [videoDuration]);
  useEffect(() => { localStorage.setItem('ws_video_quality', videoQuality); }, [videoQuality]);

  const handleUpdateProject = useCallback(async (p: Project) => { const ts = { ...p, updatedAt: new Date() }; setProject(ts); try { await saveProject(ts); } catch {} }, [setProject]);
  const handleUpdateScene = useCallback((sid: string, updates: Partial<Scene>) => { setProject(prev => { if (!prev) return prev; const script = prev.script.map(s => s.id === sid ? { ...s, ...updates } : s); const np = { ...prev, script, updatedAt: new Date() }; saveProject(np).catch(()=>{}); return np; }); }, [setProject]);
  const doAddScene = async () => { if (!project || !activeSceneId) return; const idx = project.script.findIndex(s => s.id === activeSceneId); const ns: Scene = { id: crypto.randomUUID(), order: idx + 1, description: '', prompt: '', generationMode: 'text-to-image', images: {}, videos: [], status: 'pending' }; const script = [...project.script.slice(0, idx + 1), ns, ...project.script.slice(idx + 1)].map((s, i) => ({ ...s, order: i })); await handleUpdateProject({ ...project, script }); setActiveSceneId(ns.id); setPromptText(''); sessionStorage.setItem(`ws_active_${projectId}`, ns.id); setAddConfirmOpen(false); };
  const doDeleteScene = async () => { if (!project || !activeSceneId) return; if (project.script.length <= 1) { message.warning('至少保留一个分镜'); return; } const script = project.script.filter(s => s.id !== activeSceneId).map((s, i) => ({ ...s, order: i })); await handleUpdateProject({ ...project, script }); const nextId = script[0]?.id || null; setActiveSceneId(nextId); setPromptText(buildScenePrompt(script[0])); if (nextId) sessionStorage.setItem(`ws_active_${projectId}`, nextId); setDeleteConfirmOpen(false); };
  const selectScene = (sid: string) => { setActiveSceneId(sid); const s = project?.script.find(x => x.id === sid); const savedMode = sessionStorage.getItem(`ws_pmode_${sid}`) as PreviewMode | null; const mode = savedMode || 'image'; setPreviewMode(mode); setPromptText(mode === 'image' ? (s?.imagePrompt || buildScenePrompt(s)) : (s?.videoPrompt || buildScenePrompt(s))); sessionStorage.setItem(`ws_active_${projectId}`, sid); };

  const switchPreviewMode = (mode: PreviewMode) => {
    if (activeScene) handleUpdateScene(activeScene.id, { [previewMode === 'image' ? 'imagePrompt' : 'videoPrompt']: promptText } as any);
    setPreviewMode(mode); sessionStorage.setItem(`ws_pmode_${activeSceneId}`, mode);
    const s = project?.script.find(x => x.id === activeSceneId);
    setPromptText(mode === 'image' ? (s?.imagePrompt || buildScenePrompt(s)) : (s?.videoPrompt || buildScenePrompt(s)));
  };

  // ==================== 推理 (文本优化，绑定当前模式模板) ====================
  const handleInfer = async () => {
    if (!activeScene || !project) return;
    setInferLoading(true);
    try {
      const prompt = promptText || activeScene.prompt || activeScene.description;
      if (!prompt) { message.warning('请输入提示词'); return; }
      const templateId = previewMode === 'image' ? selectedImageTemplateId : selectedVideoTemplateId;
      const template = templateId ? promptTemplates.find(t => t.id === templateId) : undefined;
      const result = await aiService.generatePrompt(
        activeScene, previewMode, undefined, undefined, undefined,
        selectedStyle, project.script.map(s => s.description),
        template ? { positive_prompt: template.positive_prompt, negative_prompt: template.negative_prompt } : undefined
      );
      setPromptText(result);
      handleUpdateScene(activeScene.id, { [previewMode === 'image' ? 'imagePrompt' : 'videoPrompt']: result } as any);
      message.success('推理完成');
    } catch (e: any) { message.error(e.message || '推理失败'); }
    finally { setInferLoading(false); }
  };

  // ==================== AI导演 (流式+绑定导演模板) ====================
  const handleDirector = async () => {
    if (!activeScene || !project) return;
    setDirectorLoading(true); setDirectorResult('');
    try {
      const template = selectedDirectorTemplateId ? promptTemplates.find(t => t.id === selectedDirectorTemplateId) : undefined;
      let accumulated = '';
      await aiService.generatePrompt(
        activeScene, 'image', undefined, undefined,
        (text) => { accumulated = text; setDirectorResult(text); },
        selectedStyle, project.script.map(s => s.description),
        template ? { positive_prompt: template.positive_prompt, negative_prompt: template.negative_prompt } : undefined
      );
      setDirectorPreviewOpen(true);
      message.success('AI导演优化完成');
    } catch (e: any) { message.error(e.message || 'AI导演失败'); }
    finally { setDirectorLoading(false); }
  };
  const applyDirectorResult = () => { if (!activeScene) return; setPromptText(directorResult); handleUpdateScene(activeScene.id, { prompt: directorResult }); setDirectorPreviewOpen(false); };

  // ==================== 视频任务轮询 ====================
  const pollVideoTask = async (taskId: string, isVeo: boolean, sceneId: string, providerId?: string) => {
    const maxAttempts = 60;
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(r => setTimeout(r, 10000));
      try {
        const status = await aiService.checkVideoStatus(taskId, isVeo, providerId);
        if (status.status === 'completed' && status.videoUrl) {
          handleUpdateScene(sceneId, { videos: [status.videoUrl], videoStatus: 'completed', status: 'completed' });
          // 更新任务历史
          setTaskHistory(prev => { const u = prev.map(t => t.id === taskId ? { ...t, url: status.videoUrl!, status: 'completed' as const } : t); if (projectId) saveTaskHistory(projectId, u); return u; });
          message.success('视频生成完成！');
          return;
        } else if (status.status === 'failed') {
          handleUpdateScene(sceneId, { videoStatus: 'completed' } as any);
          setTaskHistory(prev => { const u = prev.map(t => t.id === taskId ? { ...t, status: 'failed' as const } : t); if (projectId) saveTaskHistory(projectId, u); return u; });
          message.error('视频生成失败: ' + (status.failReason || '未知错误'));
          return;
        }
      } catch { /* 继续轮询 */ }
    }
    message.warning('视频生成超时，请稍后手动刷新查看结果');
  };

  // ==================== 生成 ====================
  const handleGenerate = async () => {
    if (!activeScene || !project) return;
    setGenerating(true); setGenProgress(0);
    try {
      if (previewMode === 'image') {
        const prompt = promptText || activeScene.prompt || activeScene.description;
        if (!prompt) { message.warning('请输入提示词'); return; }
        setGenProgress(30);
        const imgTemplate = selectedImageTemplateId ? promptTemplates.find(t => t.id === selectedImageTemplateId) : undefined;
        const result = await aiService.generateImage(activeScene, undefined, { style: selectedStyle, generationMode, model: selImageModel, aspectRatio: imageRatio.split(' ')[0] });
        setGenProgress(100);
        handleUpdateScene(activeScene.id, { images: { ...activeScene.images, keyFrame: result }, imagePrompt: promptText || undefined, status: 'completed', imageStatus: 'completed' });
        addTaskToHistory({ id: crypto.randomUUID(), type: 'image', url: result, sceneId: activeScene.id, createdAt: new Date().toISOString(), prompt: promptText, model: selImageModel });
        message.success('图片生成完成');
      } else {
        const prompt = promptText || activeScene.videoPrompt || activeScene.jiMengPrompt || activeScene.prompt;
        if (!prompt) { message.warning('请输入视频提示词'); return; }
        const vidProvider = selVideoModel ? getProviderForModel(selVideoModel) : undefined;
        // 更新场景prompt为当前输入框内容
        handleUpdateScene(activeScene.id, { videoPrompt: promptText || undefined });
        const vidResult = await aiService.generateVideo(
          { ...activeScene, prompt: promptText || activeScene.videoPrompt || activeScene.prompt },
          undefined,
          { model: selVideoModel, providerId: vidProvider?.id || selPlatformId, duration: videoDuration, resolution: videoQuality, aspectRatio: imageRatio } as any
        );
        handleUpdateScene(activeScene.id, { videoPrompt: promptText || undefined, videoStatus: 'generating' });
        // 加入任务历史(生成中)
        addTaskToHistory({ id: vidResult.taskId, type: 'video', url: '', sceneId: activeScene.id, createdAt: new Date().toISOString(), prompt: promptText, model: selVideoModel, status: 'generating' as const });
        message.success('视频生成任务已提交，正在后台生成...');
        // 异步轮询
        pollVideoTask(vidResult.taskId, vidResult.isVeoTask, activeScene.id, vidProvider?.id || selPlatformId);
      }
    } catch (e: any) { message.error(e.message || '生成失败'); }
    finally { setGenerating(false); setGenProgress(0); }
  };
  const savePrompt = useCallback(() => { if (!activeScene) return; handleUpdateScene(activeScene.id, { [previewMode === 'image' ? 'imagePrompt' : 'videoPrompt']: promptText } as any); }, [activeScene, promptText, previewMode, handleUpdateScene]);

  // ==================== 提示词展开/收起 ====================
  const togglePromptExpand = () => {
    setPromptExpanded(prev => {
      const next = !prev;
      sessionStorage.setItem('ws_prompt_expanded', String(next));
      return next;
    });
  };

  // ==================== RENDER ====================
  if (loading) return <div className={styles.loadingContainer}><Spin size="large" /></div>;
  if (!project) return null;

  const previewImg = activeScene?.images?.keyFrame;
  const previewVid = activeScene?.videos?.[activeScene.videos.length - 1];
  const activeIdx = project.script.findIndex(s => s.id === activeSceneId);
  const currentHistory = taskHistory.filter(t => t.sceneId === activeSceneId);

  return (
    <div className={styles.workspace}>
      <div className={styles.topBar}>
        <div className={styles.topBarLeft}>
          <Button type="text" icon={<ArrowLeftOutlined />} onClick={handleBack} className={styles.backBtn}>返回</Button>
          <span className={styles.topBarTitle}>{project.name}</span>
          <span style={{fontSize:12,color:'var(--text-tertiary)'}}>{project.script.length} 个分镜</span>
        </div>
        <div style={{display:'flex',gap:8,alignItems:'center'}}>
          <Button type="primary" icon={<PlayCircleOutlined />} loading={generating} onClick={handleGenerate} size="small">
            {previewMode === 'image' ? '生成图片' : '生成视频'}
          </Button>
          <Button type="text" size="small" icon={rightCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />} onClick={() => setRightCollapsed(!rightCollapsed)} />
        </div>
      </div>

      <div className={styles.mainArea}>
        <div className={styles.leftCol}>
          <div className={styles.leftColHead}><span>分镜列表</span><div className={styles.leftColActions}><Button type="text" size="small" icon={<PlusOutlined />} onClick={() => setAddConfirmOpen(true)} /><Button type="text" size="small" danger icon={<DeleteOutlined />} onClick={() => setDeleteConfirmOpen(true)} disabled={project.script.length <= 1} /></div></div>
          <div className={styles.leftColList} ref={leftListRef} onScroll={handleLeftScroll}>
            {project.script.map((s, i) => (<div key={s.id} className={`${styles.sceneThumb} ${s.id === activeSceneId ? styles.sceneThumbActive : ''}`} onClick={() => selectScene(s.id)}><div className={styles.sceneThumbImg}>{s.images?.keyFrame ? <img src={s.images.keyFrame} alt="" /> : <PictureOutlined className={styles.sceneThumbImgEmpty} />}<span className={styles.sceneThumbNum}>{String(i + 1).padStart(2, '0')}</span></div><div className={styles.sceneThumbInfo}><div className={styles.sceneThumbTitle}>分镜 {i + 1}</div><div className={styles.sceneThumbMeta}>{s.description?.slice(0, 20) || '无描述'}</div></div></div>))}
          </div>
        </div>

        <div className={styles.centerCol}>
          <div className={styles.centerTopBar}>
            <div className={styles.triggerCard} onClick={() => { if (project && project.script.length > 0) { const ids = new Set<string>(); project.script.forEach(s => (s.availableCharacterIds || []).forEach(id => ids.add(id))); setSelectedCharacterIds(Array.from(ids)); } setCharacterModalVisible(true); }}><UserOutlined className={styles.triggerCardIcon} />角色</div>
            <div className={styles.triggerCard} onClick={() => setSceneManagerVisible(true)}><PictureOutlined className={styles.triggerCardIcon} />场景</div>
            <Select size="small" className={styles.inlineSelect} value={imageRatio} onChange={setImageRatio} style={{width:110}}
              options={IMAGE_RATIOS.map(r => ({ label: r, value: r }))} />
            {previewMode === 'video' && <>
              <Select size="small" className={styles.inlineSelect} value={videoDuration} onChange={setVideoDuration} style={{width:72}}
                options={getVideoPreset(selVideoModel).durations.map(d => ({ label: `${d}秒`, value: d }))} />
              <Select size="small" className={styles.inlineSelect} value={videoQuality} onChange={setVideoQuality} style={{width:96}}
                options={getVideoPreset(selVideoModel).qualities.map(q => ({ label: q, value: q }))} />
            </>}
            <div className={styles.toggleMode}><button className={`${styles.toggleBtn} ${previewMode === 'image' ? styles.toggleBtnActive : ''}`} onClick={() => switchPreviewMode('image')}>图片</button><button className={`${styles.toggleBtn} ${previewMode === 'video' ? styles.toggleBtnActive : ''}`} onClick={() => switchPreviewMode('video')}>视频</button></div>
          </div>

          <div className={`${styles.previewArea} ${activeScene ? styles.previewActive : ''}`} onClick={() => activeScene && setPreviewImportOpen(true)} style={{ flex: promptExpanded ? '0 0 0' : 1, overflow: 'hidden', transition: 'flex 0.35s cubic-bezier(0.22,1,0.36,1)' }}>
            {generating ? <div className={styles.previewLoading}><Spin size="large" /><Progress percent={genProgress} size="small" style={{width:200}} /></div>
            : previewMode === 'image' ? (previewImg ? <img src={previewImg} className={styles.previewImage} alt="" /> : <div className={styles.previewEmpty}><PictureOutlined className={styles.previewEmptyIcon} /><span>选择分镜并生成图片</span></div>)
            : (previewVid ? <video src={previewVid} className={styles.previewVideo} controls /> : <div className={styles.previewEmpty}><PlayCircleOutlined className={styles.previewEmptyIcon} /><span>选择分镜并生成视频</span></div>)}
            {/* 任务历史按钮 */}
            <Button type="text" size="small" icon={<HistoryOutlined />} className={styles.historyBtn} onClick={(e) => { e.stopPropagation(); setHistoryOpen(true); }} title="任务历史" />
          </div>

          <div className={`${styles.promptArea} ${promptExpanded ? styles.promptExpanded : ''}`}>
            <div className={styles.promptAreaHead}>
              <span>提示词输入</span>
              <button className={styles.expandBtn} onClick={togglePromptExpand} title={promptExpanded ? '收起' : '展开'}>
                {promptExpanded ? <DownOutlined /> : <UpOutlined />}
              </button>
              <span style={{marginLeft:'auto',fontSize:11,color:'var(--text-tertiary)'}}>{activeScene ? `分镜 ${activeIdx + 1}` : '未选择'}</span>
            </div>
            <textarea className={styles.promptInput} placeholder="输入提示词描述..." value={promptText} onChange={e => setPromptText(e.target.value)} onBlur={savePrompt} />
            <div className={styles.promptActions}>
              <Button size="small" icon={<ThunderboltOutlined />} onClick={handleInfer} loading={inferLoading}>推理</Button>
              <Button size="small" icon={<BulbOutlined />} onClick={handleDirector} loading={directorLoading}>AI导演</Button>
              {directorResult && <Button size="small" icon={<EyeOutlined />} onClick={() => setDirectorPreviewOpen(true)}>预览</Button>}
            </div>
          </div>
        </div>

        {!rightCollapsed && (<div className={styles.rightCol}>
          <div className={styles.selectorGroup}><div className={styles.selectorLabel}>风格</div><Select size="small" value={selectedStyleId} onChange={setSelectedStyleId} placeholder="选择风格" allowClear style={{width:'100%'}} options={styleList.map(s => ({ label: s.name, value: s.id }))} /></div>
          <div className={styles.selectorGroup}><div className={styles.selectorLabel}>生成模式</div><Select size="small" value={generationMode} onChange={setGenerationMode} style={{width:'100%'}} options={[{ label: '文生视频', value: 'text-to-video' as GenerationMode }, { label: '图生视频', value: 'image-to-video' as GenerationMode }]} /></div>
          <div className={styles.selectorGroup}><div className={styles.selectorLabel}>API模型</div><div className={styles.chipRow}><div className={styles.chip} onClick={() => setModelSettingsOpen(true)}><ApiOutlined /> 模型设置</div></div></div>
          <div className={styles.selectorGroup}><div className={styles.selectorLabel}>提示词模板</div><div className={styles.chipRow}><div className={styles.chip} onClick={() => setTemplateSelectOpen(true)}><FileTextOutlined /> 选择模板</div></div></div>
        </div>)}
      </div>

      {/* 预览导入弹窗 */}
      <Modal title="导入到预览框" open={previewImportOpen} onCancel={() => setPreviewImportOpen(false)} footer={null} width={480} centered>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
          <div className={styles.importCard} onClick={() => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.onchange = async () => { const f = inp.files?.[0]; if (!f) return; try { const b64 = await new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result as string); r.onerror = reject; r.readAsDataURL(f); }); if (activeScene) handleUpdateScene(activeScene.id, { images: { ...activeScene.images, keyFrame: b64 } }); setPreviewImportOpen(false); message.success('图片已导入'); } catch { message.error('导入失败'); } }; inp.click(); }}>
            <UploadOutlined style={{fontSize:28,color:'#8b5cf6'}} /><span>本地导入</span><small>从电脑选择图片</small>
          </div>
          <div className={styles.importCard} onClick={() => { setPreviewImportOpen(false); setTimeout(() => setSceneManagerVisible(true), 200); }}>
            <PictureOutlined style={{fontSize:28,color:'#22c55e'}} /><span>场景库</span><small>选择已生成场景图</small>
          </div>
        </div>
      </Modal>

      {/* 任务历史弹窗 */}
      <Modal title="任务历史" open={historyOpen} onCancel={() => setHistoryOpen(false)} footer={null} width={640} centered>
        {currentHistory.length === 0 ? <Empty description="暂无生成记录" /> : (
          <div className={styles.historyGrid}>
            {currentHistory.map(item => (
              <div key={item.id} className={styles.historyCard}>
                {item.status === 'generating' ? <div style={{height:100,display:'flex',alignItems:'center',justifyContent:'center',background:'var(--input-bg)'}}><Spin /><span style={{marginLeft:8,fontSize:12,color:'var(--text-tertiary)'}}>生成中...</span></div>
                : item.url ? <img src={item.url} alt="" /> : <div style={{height:100,display:'flex',alignItems:'center',justifyContent:'center',background:'var(--input-bg)',color:'var(--text-tertiary)'}}>无预览</div>}
                <div className={styles.historyCardMeta}>
                  <Tag color={item.type === 'image' ? 'blue' : 'orange'}>{item.type === 'image' ? '图片' : '视频'}</Tag>
                  {item.status === 'generating' && <Tag color="processing">生成中</Tag>}
                  {item.status === 'failed' && <Tag color="error">失败</Tag>}
                  <span style={{fontSize:11,color:'var(--text-tertiary)'}}>{new Date(item.createdAt).toLocaleString()}</span>
                </div>
                <div className={styles.historyCardActions}>
                  <Button size="small" icon={<EyeOutlined />} onClick={() => window.open(item.url)}>查看</Button>
                  <Button size="small" icon={<DownloadOutlined />} onClick={async () => { try { await saveImageToLocalFile(item.url, `生成_${item.type}_${Date.now()}`); message.success('已保存到本地'); } catch { message.error('保存失败'); } }}>保存</Button>
                  <Button size="small" danger icon={<DeleteOutlined />} onClick={() => { const updated = taskHistory.filter(t => t.id !== item.id); setTaskHistory(updated); if (projectId) saveTaskHistory(projectId, updated); }}>删除</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Modal>

      {/* 其余弹窗保持不变 */}
      <Modal title="添加分镜" open={addConfirmOpen} onCancel={() => setAddConfirmOpen(false)} onOk={doAddScene} okText="确认添加" cancelText="取消" centered width={400}><p style={{color:'var(--body-color)',fontSize:14}}>在当前分镜 <strong style={{color:'#6366f1'}}>分镜 {activeIdx + 1}</strong> 之后插入一个新分镜？</p></Modal>
      <Modal title="删除分镜" open={deleteConfirmOpen} onCancel={() => setDeleteConfirmOpen(false)} onOk={doDeleteScene} okText="确认删除" cancelText="取消" okButtonProps={{danger:true}} centered width={400}><p style={{color:'var(--body-color)',fontSize:14}}>确定要删除 <strong style={{color:'#ef4444'}}>分镜 {activeIdx + 1}</strong> 吗？</p></Modal>
      <Modal title="选择角色" open={characterModalVisible} onCancel={()=>setCharacterModalVisible(false)} onOk={async () => { if (!project) return; await handleUpdateProject({ ...project, script: project.script.map(s => ({ ...s, availableCharacterIds: selectedCharacterIds })) }); setCharacterModalVisible(false); }} okText="确认" cancelText="取消" width="45%" centered className={styles.charModal}><div className={styles.charGrid}>{characters.length === 0 ? <Empty description="暂无角色" /> : characters.map(c => <CharacterSelectCard key={c.id} character={c} isSelected={selectedCharacterIds.includes(c.id)} onToggle={(id) => setSelectedCharacterIds(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id])} />)}</div></Modal>
      <SceneManagerModal visible={sceneManagerVisible} scenes={project.script} selectedStyle={selectedStyle} selectedImageModel={selImageModel} savedSceneLocations={project.sceneLocations} onClose={() => setSceneManagerVisible(false)} onImportToScene={(ids, url) => { if (ids === '__current__' && activeSceneId) { handleUpdateScene(activeSceneId, { images: { ...(project.script.find(s=>s.id===activeSceneId)?.images || {}), keyFrame: url, storyboard: url } }); return; } const idList = ids.split(',').filter(Boolean); const script = project.script.map(s => idList.includes(s.id) ? { ...s, images: { ...s.images, keyFrame: url, storyboard: url } } : s); handleUpdateProject({ ...project, script }); }} onSaveSceneLocations={locs => handleUpdateProject({ ...project, sceneLocations: locs })} onApplyPromptToScenes={(ids, prompt) => { const script = project.script.map(s => ids.includes(s.id) ? { ...s, jiMengPrompt: `【场景提示词】${prompt}` } : s); handleUpdateProject({ ...project, script }); }} />
      <Modal title="AI导演优化结果" open={directorPreviewOpen} onCancel={() => setDirectorPreviewOpen(false)} footer={[<Button key="cancel" onClick={() => setDirectorPreviewOpen(false)}>取消</Button>,<Button key="apply" type="primary" onClick={applyDirectorResult}>应用到提示词</Button>]} width={700} centered><pre style={{whiteSpace:'pre-wrap',fontSize:13,lineHeight:1.7,color:'var(--body-color)',maxHeight:'50vh',overflow:'auto',padding:16,background:'var(--input-bg)',borderRadius:10}}>{directorResult}</pre></Modal>

      {/* 模型设置 + 自定义视频 + 模板弹窗 (保持原样) */}
      <Modal title={null} open={modelSettingsOpen} onCancel={() => setModelSettingsOpen(false)} footer={null} width={560} centered className={styles.tplModal}>
        <div className={styles.tplModalHead}><ApiOutlined style={{fontSize:16,color:'#8b5cf6'}} /><span>模型设置</span></div>
        <div className={styles.tplModalBody}>
          <div className={styles.tplGroup}><div className={styles.tplGroupTitle}><span className={styles.tplGroupIcon}><ApiOutlined /></span>API平台</div><Select size="small" value={selPlatformId} onChange={(v) => { setSelPlatformId(v); setSelImageModel(undefined); setSelVideoModel(undefined); setSelTextModel(undefined); }} placeholder="全部平台" allowClear style={{width:'100%'}} options={providers.filter(p => p.enabled !== false).map(p => ({ label: p.name, value: p.id }))} /></div>
          <div className={styles.tplGroup}><div className={styles.tplGroupTitle}><span className={styles.tplGroupIcon}><PictureOutlined /></span>图片模型</div><Select size="small" value={selImageModel} onChange={setSelImageModel} placeholder={allModels.length > 0 ? '选择图片模型' : '请先在设置页配置API'} allowClear style={{width:'100%'}} options={allModels.map(m => ({ label: m.id, value: m.id }))} /></div>
          <div className={styles.tplGroup}><div className={styles.tplGroupTitle}><span className={styles.tplGroupIcon}><VideoCameraOutlined /></span>视频模型</div><Select size="small" value={selVideoModel} onChange={(v) => { setSelVideoModel(v); const preset = getVideoPreset(v); if (!preset.durations.includes(videoDuration)) setVideoDuration(preset.durations[0]); if (!preset.qualities.includes(videoQuality)) setVideoQuality(preset.qualities[preset.qualities.length - 1]); }} placeholder={allModels.length > 0 ? '选择视频模型' : '请先在设置页配置API'} allowClear style={{width:'100%'}} options={allModels.map(m => ({ label: m.id, value: m.id }))} /></div>
          <div className={styles.tplGroup}><div className={styles.tplGroupTitle}><span className={styles.tplGroupIcon}><ThunderboltOutlined /></span>文本模型（推理·AI导演）</div><Select size="small" value={selTextModel} onChange={setSelTextModel} placeholder={allModels.length > 0 ? '选择文本模型' : '请先在设置页配置API'} allowClear style={{width:'100%'}} options={allModels.map(m => ({ label: m.id, value: m.id }))} /></div>
        </div>
        <div className={styles.tplModalFooter}><Button type="primary" onClick={() => setModelSettingsOpen(false)}>完成</Button></div>
      </Modal>

      <Modal title={null} open={templateSelectOpen} onCancel={() => setTemplateSelectOpen(false)} footer={null} width={500} centered className={styles.tplModal}><div className={styles.tplModalHead}><FileTextOutlined style={{fontSize:16,color:'#8b5cf6'}} /><span>提示词模板</span></div><div className={styles.tplModalBody}>{(['image','video','director'] as const).map(type => { const templates = templatesByType[type]; const selId = getSelectedTemplateId(type); return (<div key={type} className={styles.tplGroup}><div className={styles.tplGroupTitle}><span className={styles.tplGroupIcon}>{TEMPLATE_TYPE_ICONS[type]}</span>{TEMPLATE_TYPE_LABELS[type]}</div>{templates.length === 0 ? <div className={styles.tplEmpty}>暂无{type==='image'?'图片':type==='video'?'视频':'导演'}模板</div> : <Select size="small" value={selId} onChange={(v) => setSelectedTemplateId(type, v)} placeholder={`选择${TEMPLATE_TYPE_LABELS[type]}`} allowClear style={{width:'100%'}} options={templates.map(t => ({ label: t.name, value: t.id }))} />}</div>); })}</div><div className={styles.tplModalFooter}><Button onClick={() => setTemplateSelectOpen(false)}>完成</Button></div></Modal>
    </div>
  );
};

export default Workspace;
