import * as React from 'react';
import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { message, Spin, Empty, Button, Modal, Progress, Select } from 'antd';
import {
  UserOutlined, PictureOutlined, ArrowLeftOutlined, PlayCircleOutlined,
  PlusOutlined, DeleteOutlined, ThunderboltOutlined, BulbOutlined,
  EyeOutlined, MenuFoldOutlined, MenuUnfoldOutlined, SettingOutlined, FileTextOutlined,
} from '@ant-design/icons';
import { useParams, useNavigate } from 'react-router-dom';
import { useRecoilState, useSetRecoilState } from 'recoil';
import { currentProjectState, characterListState } from '../store/projectStore';
import { getProject, saveProject, getAllCharacters, getAllStyles, getAllPromptTemplates } from '../services/database';
import { migrateOldMediaData, preloadMedia } from '../services/mediaService';
import CharacterSelectCard from '../components/workspace/CharacterSelectCard';
import SceneManagerModal from '../components/workspace/SceneManagerModal';
import { Project, Scene, Style, GenerationMode, Character, PromptTemplate } from '../types';
import { aiService } from '../services/aiService';
import styles from './Workspace.module.css';

export type GridMode = 4 | 6 | 9;
type PreviewMode = 'image' | 'video';

const TEMPLATE_TYPE_LABELS: Record<string, string> = { image: '图片模板', video: '视频模板', director: '导演模板' };
const TEMPLATE_TYPE_ICONS: Record<string, React.ReactNode> = {
  image: <PictureOutlined />, video: <PlayCircleOutlined />, director: <BulbOutlined />,
};

const Workspace: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useRecoilState(currentProjectState);
  const setCharacters = useSetRecoilState(characterListState);
  const [loading, setLoading] = useState(true);

  const [styleList, setStyleList] = useState<Style[]>([]);
  const [selectedStyleId, setSelectedStyleId] = useState<string | undefined>(
    () => localStorage.getItem('workspace_selected_style') || undefined
  );
  const [generationMode, setGenerationMode] = useState<GenerationMode>(
    () => (localStorage.getItem('workspace_generation_mode') as GenerationMode) || 'image-to-video'
  );
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

  const [characterModalVisible, setCharacterModalVisible] = useState(false);
  const [characters, setCharactersLocal] = useState<Character[]>([]);
  const [selectedCharacterIds, setSelectedCharacterIds] = useState<string[]>([]);
  const [sceneManagerVisible, setSceneManagerVisible] = useState(false);

  const [activeSceneId, setActiveSceneId] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState<PreviewMode>('image');
  const [promptText, setPromptText] = useState('');
  const [generating, setGenerating] = useState(false);
  const [genProgress, setGenProgress] = useState(0);

  const [rightCollapsed, setRightCollapsed] = useState(false);

  const [directorPreviewOpen, setDirectorPreviewOpen] = useState(false);
  const [directorResult, setDirectorResult] = useState('');
  const [directorLoading, setDirectorLoading] = useState(false);

  const [templateSelectOpen, setTemplateSelectOpen] = useState(false);

  // 添加/删除确认弹窗
  const [addConfirmOpen, setAddConfirmOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  // 左栏滚动位置记忆
  const leftListRef = useRef<HTMLDivElement>(null);

  useEffect(() => { getAllPromptTemplates().then(d => setPromptTemplates(d)).catch(() => {}); }, []);

  const activeScene = useMemo(() => project?.script.find(s => s.id === activeSceneId) || null, [project, activeSceneId]);
  const selectedStyle = useMemo(() => styleList.find(s => s.id === selectedStyleId), [styleList, selectedStyleId]);

  // 模板按类型分组
  const templatesByType = useMemo(() => ({
    image: promptTemplates.filter(t => t.type === 'image'),
    video: promptTemplates.filter(t => t.type === 'video'),
    director: promptTemplates.filter(t => t.type === 'director'),
  }), [promptTemplates]);

  const getSelectedTemplateId = (type: string) => {
    if (type === 'image') return selectedImageTemplateId;
    if (type === 'video') return selectedVideoTemplateId;
    return selectedDirectorTemplateId;
  };
  const setSelectedTemplateId = (type: string, id: string | undefined) => {
    if (type === 'image') setSelectedImageTemplateId(id);
    else if (type === 'video') setSelectedVideoTemplateId(id);
    else setSelectedDirectorTemplateId(id);
  };

  const handleBack = () => {
    setProject(null as any);
    navigate('/projects');
  };

  const openCharacterModal = () => {
    if (project && project.script.length > 0) {
      const ids = new Set<string>();
      project.script.forEach(s => (s.availableCharacterIds || []).forEach(id => ids.add(id)));
      setSelectedCharacterIds(Array.from(ids));
    }
    setCharacterModalVisible(true);
  };
  const toggleCharacterSelection = useCallback((id: string) => setSelectedCharacterIds(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]), []);
  const confirmCharacterSelection = async () => {
    if (!project) return;
    const script = project.script.map(s => ({ ...s, availableCharacterIds: selectedCharacterIds }));
    await handleUpdateProject({ ...project, script });
    setCharacterModalVisible(false);
    message.success('角色已应用到所有分镜');
  };
  const isCharSelected = useCallback((id: string) => selectedCharacterIds.includes(id), [selectedCharacterIds]);

  // ==================== 加载 ====================
  useEffect(() => {
    let c = false;
    (async () => {
      if (!projectId) { navigate('/projects'); return; }
      setLoading(true);
      try {
        if (!localStorage.getItem('media_migration_v1')) { try { await migrateOldMediaData(); localStorage.setItem('media_migration_v1', 'done'); } catch {} }
        const [lp, lc, ls] = await Promise.all([getProject(projectId), getAllCharacters(), getAllStyles()]);
        if (c) return;
        if (!lp) { message.error('项目不存在'); navigate('/projects'); return; }
        setProject(lp); setCharacters(lc); setCharactersLocal(lc); setStyleList(ls);

        // 恢复上次选中的分镜
        const savedSceneId = sessionStorage.getItem(`ws_active_${projectId}`);
        const initialScene = savedSceneId ? lp.script.find(s => s.id === savedSceneId) : lp.script[0];
        if (initialScene) {
          setActiveSceneId(initialScene.id);
          setPromptText(initialScene.prompt || '');
        } else if (lp.script.length > 0) {
          setActiveSceneId(lp.script[0].id);
          setPromptText(lp.script[0].prompt || '');
        }

        const items: Array<{type:'character'|'style';ownerId:string}> = [...lc.map(x=>({type:'character' as const,ownerId:x.id})), ...ls.map(x=>({type:'style' as const,ownerId:x.id}))];
        if (items.length > 0) preloadMedia(items).catch(()=>{});
      } catch (e) { if (!c) { message.error('加载失败'); navigate('/projects'); } }
      finally { if (!c) setLoading(false); }
    })();
    return () => { c = true; };
  }, [projectId]);

  // 恢复滚动位置
  useEffect(() => {
    if (!loading && leftListRef.current && projectId) {
      const saved = sessionStorage.getItem(`ws_scroll_${projectId}`);
      if (saved) leftListRef.current.scrollTop = parseInt(saved, 10);
    }
  }, [loading, projectId]);

  // 保存滚动位置
  const handleLeftScroll = useCallback(() => {
    if (leftListRef.current && projectId) {
      sessionStorage.setItem(`ws_scroll_${projectId}`, String(leftListRef.current.scrollTop));
    }
  }, [projectId]);

  useEffect(() => { if (selectedStyleId) localStorage.setItem('workspace_selected_style', selectedStyleId); else localStorage.removeItem('workspace_selected_style'); }, [selectedStyleId]);
  useEffect(() => { localStorage.setItem('workspace_generation_mode', generationMode); }, [generationMode]);

  // ==================== 项目操作 ====================
  const handleUpdateProject = useCallback(async (p: Project) => {
    const toSave = { ...p, updatedAt: new Date() };
    setProject(toSave);
    try { await saveProject(toSave); } catch { message.error('保存失败'); }
  }, [setProject]);

  const handleUpdateScene = useCallback((sid: string, updates: Partial<Scene>) => {
    setProject(prev => {
      if (!prev) return prev;
      const script = prev.script.map(s => s.id === sid ? { ...s, ...updates } : s);
      const np = { ...prev, script, updatedAt: new Date() };
      saveProject(np).catch(()=>{});
      return np;
    });
  }, [setProject]);

  const doAddScene = async () => {
    if (!project || !activeSceneId) return;
    const idx = project.script.findIndex(s => s.id === activeSceneId);
    const ns: Scene = { id: crypto.randomUUID(), order: idx + 1, description: '', prompt: '', generationMode: 'text-to-image', images: {}, videos: [], status: 'pending' };
    const script = [...project.script.slice(0, idx + 1), ns, ...project.script.slice(idx + 1)].map((s, i) => ({ ...s, order: i }));
    await handleUpdateProject({ ...project, script });
    setActiveSceneId(ns.id);
    setPromptText('');
    sessionStorage.setItem(`ws_active_${projectId}`, ns.id);
    setAddConfirmOpen(false);
  };

  const doDeleteScene = async () => {
    if (!project || !activeSceneId) return;
    if (project.script.length <= 1) { message.warning('至少保留一个分镜'); return; }
    const script = project.script.filter(s => s.id !== activeSceneId).map((s, i) => ({ ...s, order: i }));
    await handleUpdateProject({ ...project, script });
    const nextId = script[0]?.id || null;
    setActiveSceneId(nextId);
    setPromptText(script[0]?.prompt || '');
    if (nextId) sessionStorage.setItem(`ws_active_${projectId}`, nextId);
    setDeleteConfirmOpen(false);
  };

  const selectScene = (sid: string) => {
    setActiveSceneId(sid);
    const s = project?.script.find(x => x.id === sid);
    setPromptText(s?.prompt || '');
    setPreviewMode('image');
    sessionStorage.setItem(`ws_active_${projectId}`, sid);
  };

  // ==================== 推理 / AI导演 / 预览 ====================
  const handleInfer = async () => {
    if (!activeScene || !project) return;
    setGenerating(true); setGenProgress(0);
    try {
      const prompt = promptText || activeScene.prompt || activeScene.description;
      if (!prompt) { message.warning('请输入提示词'); setGenerating(false); return; }
      setGenProgress(30);
      const result = await aiService.generateImage(activeScene, undefined, { style: selectedStyle, generationMode });
      setGenProgress(100);
      handleUpdateScene(activeScene.id, {
        images: { ...activeScene.images, keyFrame: result },
        imagePrompt: promptText || undefined,
        status: 'completed', imageStatus: 'completed',
      });
      message.success('推理完成');
    } catch (e: any) { message.error(e.message || '推理失败'); }
    finally { setGenerating(false); setGenProgress(0); }
  };

  const handleDirector = async () => {
    if (!activeScene || !project) return;
    setDirectorLoading(true);
    try {
      const template = selectedDirectorTemplateId ? promptTemplates.find(t => t.id === selectedDirectorTemplateId) : undefined;
      const result = await aiService.generatePrompt(
        activeScene, 'image', undefined, undefined, undefined, selectedStyle,
        project.script.map(s => s.description),
        template ? { positive_prompt: template.positive_prompt, negative_prompt: template.negative_prompt } : undefined
      );
      setDirectorResult(result);
      setDirectorPreviewOpen(true);
      message.success('AI导演优化完成');
    } catch (e: any) { message.error(e.message || 'AI导演失败'); }
    finally { setDirectorLoading(false); }
  };

  const applyDirectorResult = () => {
    if (!activeScene) return;
    setPromptText(directorResult);
    handleUpdateScene(activeScene.id, { prompt: directorResult });
    setDirectorPreviewOpen(false);
    message.success('已应用优化提示词');
  };

  // ==================== 生成 ====================
  const handleGenerate = async () => {
    if (!activeScene || !project) return;
    setGenerating(true); setGenProgress(0);
    try {
      if (previewMode === 'image') {
        const prompt = promptText || activeScene.prompt || activeScene.description;
        if (!prompt) { message.warning('请输入提示词'); setGenerating(false); return; }
        setGenProgress(30);
        const result = await aiService.generateImage(activeScene, undefined, { style: selectedStyle, generationMode });
        setGenProgress(100);
        handleUpdateScene(activeScene.id, {
          images: { ...activeScene.images, keyFrame: result },
          imagePrompt: promptText || undefined,
          status: 'completed', imageStatus: 'completed',
        });
        message.success('图片生成完成');
      } else {
        const prompt = activeScene.videoPrompt || activeScene.jiMengPrompt || activeScene.prompt;
        if (!prompt) { message.warning('请输入视频提示词'); setGenerating(false); return; }
        await aiService.generateVideo(activeScene);
        handleUpdateScene(activeScene.id, { videoPrompt: promptText || undefined, videoStatus: 'generating' });
        message.success('视频生成任务已提交');
      }
    } catch (e: any) { message.error(e.message || '生成失败'); }
    finally { setGenerating(false); setGenProgress(0); }
  };

  const savePrompt = useCallback(() => {
    if (!activeScene) return;
    handleUpdateScene(activeScene.id, { prompt: promptText });
  }, [activeScene, promptText, handleUpdateScene]);

  // ==================== RENDER ====================
  if (loading) return <div className={styles.loadingContainer}><Spin size="large" /></div>;
  if (!project) return null;

  const previewImg = activeScene?.images?.keyFrame;
  const previewVid = activeScene?.videos?.[activeScene.videos.length - 1];
  const activeIdx = project.script.findIndex(s => s.id === activeSceneId);

  return (
    <div className={styles.workspace}>
      {/* 顶部栏 */}
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
          <Button type="text" size="small"
            icon={rightCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={() => setRightCollapsed(!rightCollapsed)} />
        </div>
      </div>

      <div className={styles.mainArea}>
        {/* 左栏 */}
        <div className={styles.leftCol}>
          <div className={styles.leftColHead}>
            <span>分镜列表</span>
            <div className={styles.leftColActions}>
              <Button type="text" size="small" icon={<PlusOutlined />}
                onClick={() => setAddConfirmOpen(true)} title="在当前分镜后添加" />
              <Button type="text" size="small" danger icon={<DeleteOutlined />}
                onClick={() => setDeleteConfirmOpen(true)} title="删除当前分镜"
                disabled={project.script.length <= 1} />
            </div>
          </div>
          <div className={styles.leftColList} ref={leftListRef} onScroll={handleLeftScroll}>
            {project.script.map((s, i) => (
              <div key={s.id} className={`${styles.sceneThumb} ${s.id === activeSceneId ? styles.sceneThumbActive : ''}`}
                onClick={() => selectScene(s.id)}>
                <div className={styles.sceneThumbImg}>
                  {s.images?.keyFrame ? <img src={s.images.keyFrame} alt="" />
                    : <PictureOutlined className={styles.sceneThumbImgEmpty} />}
                  <span className={styles.sceneThumbNum}>{String(i + 1).padStart(2, '0')}</span>
                </div>
                <div className={styles.sceneThumbInfo}>
                  <div className={styles.sceneThumbTitle}>分镜 {i + 1}</div>
                  <div className={styles.sceneThumbMeta}>{s.description?.slice(0, 20) || '无描述'}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 中栏 */}
        <div className={styles.centerCol}>
          <div className={styles.centerTopBar}>
            <div className={styles.triggerCard} onClick={openCharacterModal}>
              <UserOutlined className={styles.triggerCardIcon} />角色
            </div>
            <div className={styles.triggerCard} onClick={() => setSceneManagerVisible(true)}>
              <PictureOutlined className={styles.triggerCardIcon} />场景
            </div>
            <div className={styles.toggleMode}>
              <button className={`${styles.toggleBtn} ${previewMode === 'image' ? styles.toggleBtnActive : ''}`}
                onClick={() => setPreviewMode('image')}>图片</button>
              <button className={`${styles.toggleBtn} ${previewMode === 'video' ? styles.toggleBtnActive : ''}`}
                onClick={() => setPreviewMode('video')}>视频</button>
            </div>
          </div>

          {/* 预览区 */}
          <div className={`${styles.previewArea} ${activeScene ? styles.previewActive : ''}`}>
            {generating ? (
              <div className={styles.previewLoading}><Spin size="large" /><Progress percent={genProgress} size="small" style={{width:200}} /></div>
            ) : previewMode === 'image' ? (
              previewImg ? <img src={previewImg} className={styles.previewImage} alt="" />
                : <div className={styles.previewEmpty}><PictureOutlined className={styles.previewEmptyIcon} /><span>选择分镜并生成图片</span></div>
            ) : (
              previewVid ? <video src={previewVid} className={styles.previewVideo} controls />
                : <div className={styles.previewEmpty}><PlayCircleOutlined className={styles.previewEmptyIcon} /><span>选择分镜并生成视频</span></div>
            )}
          </div>

          {/* 提示词区 */}
          <div className={styles.promptArea}>
            <div className={styles.promptAreaHead}>
              <span>提示词输入</span>
              <span style={{marginLeft:'auto',fontSize:11,color:'var(--text-tertiary)'}}>
                {activeScene ? `分镜 ${activeIdx + 1}` : '未选择'}
              </span>
            </div>
            <textarea className={styles.promptInput} placeholder="输入提示词描述..." value={promptText}
              onChange={e => setPromptText(e.target.value)} onBlur={savePrompt} />
            <div className={styles.promptActions}>
              <Button size="small" icon={<ThunderboltOutlined />} onClick={handleInfer} loading={generating}>推理</Button>
              <Button size="small" icon={<BulbOutlined />} onClick={handleDirector} loading={directorLoading}>AI导演</Button>
              {directorResult && (
                <Button size="small" icon={<EyeOutlined />} onClick={() => setDirectorPreviewOpen(true)}>预览</Button>
              )}
            </div>
          </div>
        </div>

        {/* 右栏 */}
        {!rightCollapsed && (
          <div className={styles.rightCol}>
            <div className={styles.selectorGroup}>
              <div className={styles.selectorLabel}>风格</div>
              <Select size="small" value={selectedStyleId} onChange={setSelectedStyleId}
                placeholder="选择风格" allowClear style={{width:'100%'}}
                options={styleList.map(s => ({ label: s.name, value: s.id }))} />
            </div>
            <div className={styles.selectorGroup}>
              <div className={styles.selectorLabel}>生成模式</div>
              <Select size="small" value={generationMode} onChange={setGenerationMode}
                style={{width:'100%'}}
                options={[
                  { label: '文生视频', value: 'text-to-video' as GenerationMode },
                  { label: '图生视频', value: 'image-to-video' as GenerationMode },
                ]} />
            </div>
            <div className={styles.selectorGroup}>
              <div className={styles.selectorLabel}>提示词模板</div>
              <div className={styles.chipRow}>
                <div className={styles.chip} onClick={() => setTemplateSelectOpen(true)}>
                  <FileTextOutlined /> 选择模板
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 添加分镜确认弹窗 */}
      <Modal title="添加分镜" open={addConfirmOpen} onCancel={() => setAddConfirmOpen(false)}
        onOk={doAddScene} okText="确认添加" cancelText="取消" centered width={400}>
        <p style={{color:'var(--body-color)',fontSize:14}}>
          在当前分镜 <strong style={{color:'#6366f1'}}>分镜 {activeIdx + 1}</strong> 之后插入一个新分镜？
        </p>
      </Modal>

      {/* 删除分镜确认弹窗 */}
      <Modal title="删除分镜" open={deleteConfirmOpen} onCancel={() => setDeleteConfirmOpen(false)}
        onOk={doDeleteScene} okText="确认删除" cancelText="取消" okButtonProps={{danger:true}} centered width={400}>
        <p style={{color:'var(--body-color)',fontSize:14}}>
          确定要删除 <strong style={{color:'#ef4444'}}>分镜 {activeIdx + 1}</strong> 吗？此操作不可撤销。
        </p>
      </Modal>

      {/* 角色弹窗 */}
      <Modal title="选择角色" open={characterModalVisible} onCancel={()=>setCharacterModalVisible(false)} onOk={confirmCharacterSelection}
        okText="确认" cancelText="取消" width="45%" centered className={styles.charModal}>
        <div className={styles.charGrid}>
          {characters.length === 0 ? <Empty description="暂无角色" /> :
            characters.map(c => <CharacterSelectCard key={c.id} character={c} isSelected={isCharSelected(c.id)} onToggle={toggleCharacterSelection} />)}
        </div>
      </Modal>

      {/* 场景弹窗 */}
      <SceneManagerModal visible={sceneManagerVisible} scenes={project.script} selectedStyle={selectedStyle}
        savedSceneLocations={project.sceneLocations}
        onClose={() => setSceneManagerVisible(false)}
        onImportToScene={(ids, url) => {
          const idList = ids.split(',').filter(Boolean);
          const script = project.script.map(s => idList.includes(s.id) ? { ...s, images: { ...s.images, keyFrame: url, storyboard: url } } : s);
          const np = { ...project, script, updatedAt: new Date() };
          setProject(np); handleUpdateProject(np);
        }}
        onSaveSceneLocations={locs => handleUpdateProject({ ...project, sceneLocations: locs })}
        onApplyPromptToScenes={(ids, prompt) => {
          const script = project.script.map(s => ids.includes(s.id) ? { ...s, jiMengPrompt: `【场景提示词】${prompt}${s.actionDescription?`\n【动作描述】${s.actionDescription}`:''}${s.dialogue?`\n【对话】\n${s.dialogue}`:''}` } : s);
          const np = { ...project, script, updatedAt: new Date() };
          setProject(np); saveProject(np).catch(()=>{});
        }} />

      {/* AI导演预览弹窗 */}
      <Modal title="AI导演优化结果" open={directorPreviewOpen} onCancel={() => setDirectorPreviewOpen(false)}
        footer={[
          <Button key="cancel" onClick={() => setDirectorPreviewOpen(false)}>取消</Button>,
          <Button key="apply" type="primary" onClick={applyDirectorResult}>应用到提示词</Button>,
        ]} width={700} centered>
        <pre style={{whiteSpace:'pre-wrap',fontSize:13,lineHeight:1.7,color:'var(--body-color)',maxHeight:'50vh',overflow:'auto',padding:16,background:'var(--input-bg)',borderRadius:10}}>
          {directorResult}
        </pre>
      </Modal>

      {/* 模板选择弹窗 — 三分类 */}
      <Modal title={null} open={templateSelectOpen} onCancel={() => setTemplateSelectOpen(false)} footer={null}
        width={500} centered className={styles.tplModal}>
        <div className={styles.tplModalHead}>
          <FileTextOutlined style={{fontSize:16,color:'#8b5cf6'}} />
          <span>提示词模板</span>
        </div>
        <div className={styles.tplModalBody}>
          {(['image','video','director'] as const).map(type => {
            const templates = templatesByType[type];
            const selId = getSelectedTemplateId(type);
            return (
              <div key={type} className={styles.tplGroup}>
                <div className={styles.tplGroupTitle}>
                  <span className={styles.tplGroupIcon}>{TEMPLATE_TYPE_ICONS[type]}</span>
                  {TEMPLATE_TYPE_LABELS[type]}
                </div>
                {templates.length === 0 ? (
                  <div className={styles.tplEmpty}>暂无{type==='image'?'图片':type==='video'?'视频':'导演'}模板</div>
                ) : (
                  <Select
                    size="small"
                    value={selId}
                    onChange={(v) => setSelectedTemplateId(type, v)}
                    placeholder={`选择${TEMPLATE_TYPE_LABELS[type]}`}
                    allowClear
                    style={{ width: '100%' }}
                    options={templates.map(t => ({ label: t.name, value: t.id }))}
                  />
                )}
              </div>
            );
          })}
        </div>
        <div className={styles.tplModalFooter}>
          <Button onClick={() => setTemplateSelectOpen(false)}>完成</Button>
        </div>
      </Modal>
    </div>
  );
};

export default Workspace;
