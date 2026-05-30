import * as React from 'react';
import { useEffect, useState, useCallback, useMemo } from 'react';
import { message, Spin, Empty, Select, Button, Modal, Progress, Input } from 'antd';
import { UserOutlined, PictureOutlined, ArrowLeftOutlined, PlayCircleOutlined, SwapOutlined } from '@ant-design/icons';
import { useParams, useNavigate } from 'react-router-dom';
import { useRecoilState } from 'recoil';
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

const Workspace: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useRecoilState(currentProjectState);
  const [, setCharacters] = useRecoilState(characterListState);
  const [loading, setLoading] = useState(true);

  // 选择器状态
  const [gridMode, setGridMode] = useState<GridMode>(6);
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

  // 角色/场景弹窗
  const [characterModalVisible, setCharacterModalVisible] = useState(false);
  const [characters, setCharactersLocal] = useState<Character[]>([]);
  const [selectedCharacterIds, setSelectedCharacterIds] = useState<string[]>([]);
  const [sceneManagerVisible, setSceneManagerVisible] = useState(false);

  // 当前选中分镜
  const [activeSceneId, setActiveSceneId] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState<PreviewMode>('image');
  const [promptText, setPromptText] = useState('');
  const [generating, setGenerating] = useState(false);
  const [genProgress, setGenProgress] = useState(0);

  useEffect(() => { getAllPromptTemplates().then(d => setPromptTemplates(d)).catch(() => {}); }, []);

  const activeScene = useMemo(() => project?.script.find(s => s.id === activeSceneId) || null, [project, activeSceneId]);
  const selectedStyle = useMemo(() => styleList.find(s => s.id === selectedStyleId), [styleList, selectedStyleId]);

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
  const selectedCharacterIdSet = useMemo(() => new Set(selectedCharacterIds), [selectedCharacterIds]);
  const isCharSelected = useCallback((id: string) => selectedCharacterIdSet.has(id), [selectedCharacterIdSet]);

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
        if (lp.script.length > 0) { setActiveSceneId(lp.script[0].id); setPromptText(lp.script[0].prompt || ''); }
        const items: Array<{type:'character'|'style';ownerId:string}> = [...lc.map(x=>({type:'character' as const,ownerId:x.id})), ...ls.map(x=>({type:'style' as const,ownerId:x.id}))];
        if (items.length > 0) preloadMedia(items).catch(()=>{});
      } catch (e) { if (!c) { message.error('加载失败'); navigate('/projects'); } }
      finally { if (!c) setLoading(false); }
    })();
    return () => { c = true; };
  }, [projectId]);

  useEffect(() => { if (selectedStyleId) localStorage.setItem('workspace_selected_style', selectedStyleId); else localStorage.removeItem('workspace_selected_style'); }, [selectedStyleId]);
  useEffect(() => { localStorage.setItem('workspace_generation_mode', generationMode); }, [generationMode]);
  useEffect(() => { characters.forEach(c => { if (c.referenceImage) { const i = new Image(); i.src = c.referenceImage; } }); }, [characters]);

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

  const handleAddScene = async (afterIndex: number) => {
    if (!project) return;
    const ns: Scene = { id: crypto.randomUUID(), order: afterIndex + 1, description: '', prompt: '', generationMode: 'text-to-image', images: {}, videos: [], status: 'pending' };
    const script = [...project.script.slice(0, afterIndex + 1), ns, ...project.script.slice(afterIndex + 1)].map((s, i) => ({ ...s, order: i }));
    await handleUpdateProject({ ...project, script });
  };

  const handleDeleteScene = async (sid: string) => {
    if (!project) return;
    const script = project.script.filter(s => s.id !== sid).map((s, i) => ({ ...s, order: i }));
    await handleUpdateProject({ ...project, script });
    if (activeSceneId === sid) setActiveSceneId(script[0]?.id || null);
  };

  const selectScene = (sid: string) => {
    setActiveSceneId(sid);
    const s = project?.script.find(x => x.id === sid);
    setPromptText(s?.prompt || '');
    setPreviewMode('image');
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
        // 使用 aiService 生成图片
        const result = await aiService.generateImage(activeScene, undefined, { style: selectedStyle, generationMode, gridMode });
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
        setGenProgress(30);
        await aiService.generateVideo(activeScene);
        setGenProgress(100);
        handleUpdateScene(activeScene.id, {
          videoPrompt: promptText || undefined,
          videoStatus: 'generating',
        });
        message.success('视频生成任务已提交');
      }
    } catch (e: any) { message.error(e.message || '生成失败'); }
    finally { setGenerating(false); setGenProgress(0); }
  };

  // 同步 promptText 到场景
  const savePrompt = useCallback(() => {
    if (!activeScene) return;
    handleUpdateScene(activeScene.id, { prompt: promptText });
  }, [activeScene, promptText, handleUpdateScene]);

  // ==================== RENDER ====================
  if (loading) return <div className={styles.loadingContainer}><Spin size="large" /></div>;
  if (!project) return null;

  const previewImg = activeScene?.images?.keyFrame;
  const previewVid = activeScene?.videos?.[activeScene.videos.length - 1];

  return (
    <div className={styles.workspace}>
      {/* 顶部栏 */}
      <div className={styles.topBar}>
        <div className={styles.topBarLeft}>
          <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => navigate('/projects')} className={styles.backBtn}>返回</Button>
          <span className={styles.topBarTitle}>{project.name}</span>
          <span style={{fontSize:12,color:'var(--text-tertiary)'}}>{project.script.length} 个分镜</span>
        </div>
        <div>
          <Button type="primary" icon={<PlayCircleOutlined />} loading={generating} onClick={handleGenerate} size="small">
            {previewMode === 'image' ? '生成图片' : '生成视频'}
          </Button>
        </div>
      </div>

      {/* 三栏主体 */}
      <div className={styles.mainArea}>
        {/* 左栏：分镜列表 */}
        <div className={styles.leftCol}>
          <div className={styles.leftColHead}>分镜列表</div>
          <div className={styles.leftColList}>
            {project.script.map((s, i) => (
              <div key={s.id} className={`${styles.sceneThumb} ${s.id === activeSceneId ? styles.sceneThumbActive : ''}`}
                onClick={() => selectScene(s.id)}>
                <div className={styles.sceneThumbImg}>
                  {s.images?.keyFrame ? <img src={s.images.keyFrame} alt="" />
                    : <PictureOutlined className={styles.sceneThumbImgEmpty} />}
                </div>
                <div className={styles.sceneThumbInfo}>
                  <div className={styles.sceneThumbTitle}>分镜 {i + 1}</div>
                  <div className={styles.sceneThumbMeta}>{s.description?.slice(0, 20) || '无描述'}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 中栏：预览 + 提示词 */}
        <div className={styles.centerCol}>
          {/* 角色/场景卡片 + 切换 */}
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

          {/* 预览区域 */}
          <div className={styles.previewArea}>
            {generating ? (
              <div className={styles.previewLoading}>
                <Spin size="large" />
                <Progress percent={genProgress} size="small" style={{ width: 200 }} />
              </div>
            ) : previewMode === 'image' ? (
              previewImg ? <img src={previewImg} className={styles.previewImage} alt="" />
                : <div className={styles.previewEmpty}><PictureOutlined className={styles.previewEmptyIcon} /><span>选择分镜并生成图片</span></div>
            ) : (
              previewVid ? <video src={previewVid} className={styles.previewVideo} controls />
                : <div className={styles.previewEmpty}><PlayCircleOutlined className={styles.previewEmptyIcon} /><span>选择分镜并生成视频</span></div>
            )}
          </div>

          {/* 提示词输入区 */}
          <div className={styles.promptArea}>
            <div className={styles.promptAreaHead}>
              <span>提示词输入</span>
              <span style={{marginLeft:'auto',fontSize:11,color:'var(--text-tertiary)'}}>
                {activeScene ? `分镜 ${(project.script.findIndex(s=>s.id===activeSceneId)||0)+1}` : '未选择'}
              </span>
            </div>
            <textarea className={styles.promptInput}
              placeholder="输入提示词描述..."
              value={promptText}
              onChange={e => setPromptText(e.target.value)}
              onBlur={savePrompt}
            />
            <div className={styles.promptActions}>
              <Select size="small" value={gridMode} onChange={v => setGridMode(v)} style={{ width: 110 }}
                options={[{label:'2×2 (4格)',value:4},{label:'2×3 (6格)',value:6},{label:'3×3 (9格)',value:9}]} />
              <Select size="small" value={selectedStyleId} onChange={v => setSelectedStyleId(v)} style={{ width: 120 }} placeholder="风格" allowClear
                options={styleList.map(s => ({ label: s.name, value: s.id }))} />
              <Select size="small" value={generationMode} onChange={v => setGenerationMode(v)} style={{ width: 110 }}
                options={[{label:'文生视频',value:'text-to-video'},{label:'图生视频',value:'image-to-video'}]} />
            </div>
          </div>
        </div>

        {/* 右栏：选择器 */}
        <div className={styles.rightCol}>
          <div className={styles.selectorGroup}>
            <div className={styles.selectorLabel}>提示词模板</div>
            {promptTemplates.filter(t=>t.type==='image').length > 0 && (
              <Select size="small" value={selectedImageTemplateId} placeholder="图片模板" allowClear style={{width:'100%'}}
                onClear={()=>{setSelectedImageTemplateId(undefined);localStorage.removeItem('workspace_image_template')}}
                onChange={v=>{setSelectedImageTemplateId(v);if(v)localStorage.setItem('workspace_image_template',v);else localStorage.removeItem('workspace_image_template')}}
                options={promptTemplates.filter(t=>t.type==='image').map(t=>({label:t.name,value:t.id}))} />
            )}
            {promptTemplates.filter(t=>t.type==='video').length > 0 && (
              <Select size="small" value={selectedVideoTemplateId} placeholder="视频模板" allowClear style={{width:'100%',marginTop:4}}
                onClear={()=>{setSelectedVideoTemplateId(undefined);localStorage.removeItem('workspace_video_template_id')}}
                onChange={v=>{setSelectedVideoTemplateId(v);if(v)localStorage.setItem('workspace_video_template_id',v);else localStorage.removeItem('workspace_video_template_id')}}
                options={promptTemplates.filter(t=>t.type==='video').map(t=>({label:t.name,value:t.id}))} />
            )}
            {promptTemplates.filter(t=>t.type==='director').length > 0 && (
              <Select size="small" value={selectedDirectorTemplateId} placeholder="导演模板" allowClear style={{width:'100%',marginTop:4}}
                onClear={()=>{setSelectedDirectorTemplateId(undefined);localStorage.removeItem('workspace_director_template_id')}}
                onChange={v=>{setSelectedDirectorTemplateId(v);if(v)localStorage.setItem('workspace_director_template_id',v);else localStorage.removeItem('workspace_director_template_id')}}
                options={promptTemplates.filter(t=>t.type==='director').map(t=>({label:t.name,value:t.id}))} />
            )}
          </div>
        </div>
      </div>

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
          message.success(`已导入到 ${idList.length} 个分镜`);
        }}
        onSaveSceneLocations={locs => handleUpdateProject({ ...project, sceneLocations: locs })}
        onApplyPromptToScenes={(ids, prompt) => {
          const script = project.script.map(s => ids.includes(s.id) ? { ...s, jiMengPrompt: `【场景提示词】${prompt}${s.actionDescription?`\n【动作描述】${s.actionDescription}`:''}${s.dialogue?`\n【对话】\n${s.dialogue}`:''}` } : s);
          const np = { ...project, script, updatedAt: new Date() };
          setProject(np); saveProject(np).catch(()=>{});
        }} />
    </div>
  );
};

export default Workspace;
