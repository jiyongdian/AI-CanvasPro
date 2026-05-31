import * as React from 'react';
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Modal, message, Empty, Button, Input, Spin, Progress } from 'antd';
import { PlusOutlined, ThunderboltOutlined, PictureOutlined, UploadOutlined, CameraOutlined, DeleteOutlined, EyeOutlined } from '@ant-design/icons';
import { Scene, Style, SceneLocationData } from '../../types';
import { aiService } from '../../services/aiService';
import { preloadImage, blobToBase64 } from '../../utils/imageUtils';
import styles from './SceneManagerModal.module.css';

interface SceneLocation {
  sceneLabel: string;
  sceneDescription: string;
  prompt: string;
  sceneIds: string[];
  generatedImage?: string;
  isGenerating?: boolean;
  loadingProgress?: number;
}

interface SceneManagerModalProps {
  visible: boolean;
  scenes: Scene[];
  selectedStyle?: Style;
  selectedImageModel?: string;
  selectedTextModel?: string;
  imageModelProviderId?: string;
  textModelProviderId?: string;
  savedSceneLocations?: SceneLocationData[];
  onClose: () => void;
  onImportToScene: (sceneId: string, imageUrl: string) => void;
  onSaveSceneLocations?: (locations: SceneLocationData[]) => void;
  onApplyPromptToScenes?: (sceneIds: string[], prompt: string) => void;
}

// 6视角场景生成底层提示词
const MULTIVIEW_PROMPT_TEMPLATE = `【多视角场景参考图 — 6视图全景布局】

你需要在同一张画面中展示"一个固定场景"的6个不同视角，按照3列×2行网格排列，每格尺寸约1:1方形：

视角1【正面 FRONT】左上方格：从正前方面对该场景，展示场景的正面全貌和入口
视角2【右侧 RIGHT】中上方格：从右侧90度观看该场景  
视角3【3/4角度 THREE-QUARTER】右上方格：从右前45度角观看，展示场景的立体感
视角4【背面 BACK】左下方格：从正后方180度观看该场景
视角5【左侧 LEFT】中下方格：从左侧90度观看该场景
视角6【俯视 TOP】右下方格：从正上方鸟瞰，展示整体布局

【核心原则 — 必须严格遵守】
1. 所有6个视角必须是【同一个场景】，不能是不同的场景
2. 场景中的所有物体、建筑、道具、光线必须在6个视角中完全一致
3. 每个格子底部居中标注视角名称（英文大写，如 FRONT / RIGHT / THREE-QUARTER / BACK / LEFT / TOP）
4. 画面干净、专业，适合作为AI绘画参考图
5. 不要在任何格子中放置人物`;

const SceneManagerModal: React.FC<SceneManagerModalProps> = ({
  visible, scenes, selectedStyle, selectedImageModel, selectedTextModel,
  imageModelProviderId, textModelProviderId, savedSceneLocations,
  onClose, onImportToScene, onSaveSceneLocations, onApplyPromptToScenes,
}) => {
  const [sceneLocations, setSceneLocations] = useState<SceneLocation[]>([]);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const initializedRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 创建场景弹窗
  const [createOpen, setCreateOpen] = useState(false);
  const [createDesc, setCreateDesc] = useState('');
  const [createPrompt, setCreatePrompt] = useState('');
  const [createOptimizing, setCreateOptimizing] = useState(false);
  const [createGenerating, setCreateGenerating] = useState(false);
  const [createGenProgress, setCreateGenProgress] = useState(0);
  const [createImage, setCreateImage] = useState<string | null>(null);

  // ==================== 加载场景 ====================
  useEffect(() => {
    if (!visible) { initializedRef.current = false; return; }
    if (initializedRef.current && sceneLocations.length > 0) return;
    if (scenes.length === 0) return;

    const sceneMap = new Map<string, SceneLocation>();
    const savedMap = new Map<string, SceneLocationData>();
    if (savedSceneLocations) savedSceneLocations.forEach(s => savedMap.set(s.sceneLabel, s));

    const regex = /^场景([A-Z])[:：](.+)$/;
    scenes.forEach(scene => {
      const desc = scene.description?.trim() || '';
      const match = desc.match(regex);
      if (match) {
        const label = `场景${match[1]}`;
        const content = match[2].trim();
        const saved = savedMap.get(label);
        if (!sceneMap.has(label)) {
          sceneMap.set(label, {
            sceneLabel: label,
            sceneDescription: `${label}：${content}`,
            prompt: saved?.prompt || content,
            sceneIds: [scene.id],
            generatedImage: saved?.generatedImage || undefined,
          });
        } else {
          sceneMap.get(label)!.sceneIds.push(scene.id);
        }
      } else if (/^场景[A-Z]$/.test(desc)) {
        const existing = sceneMap.get(desc);
        if (existing && !existing.sceneIds.includes(scene.id)) {
          existing.sceneIds.push(scene.id);
        }
      }
    });

    // 补充保存的手动创建场景（无脚本关联）
    if (savedSceneLocations) {
      savedSceneLocations.forEach(saved => {
        if (!sceneMap.has(saved.sceneLabel)) {
          sceneMap.set(saved.sceneLabel, {
            sceneLabel: saved.sceneLabel,
            sceneDescription: saved.sceneDescription,
            prompt: saved.prompt,
            sceneIds: [],
            generatedImage: saved.generatedImage,
          });
        }
      });
    }

    setSceneLocations(Array.from(sceneMap.values()));
    initializedRef.current = true;
  }, [visible, scenes, savedSceneLocations]);

  const saveData = useCallback((locs: SceneLocation[]) => {
    if (!onSaveSceneLocations) return;
    onSaveSceneLocations(locs.map(l => ({
      sceneLabel: l.sceneLabel, sceneDescription: l.sceneDescription,
      prompt: l.prompt, generatedImage: l.generatedImage,
    })));
  }, [onSaveSceneLocations]);

  // ==================== 创建场景 ====================
  const handleOptimizeDesc = async () => {
    if (!createDesc.trim()) { message.warning('请输入场景描述'); return; }
    setCreateOptimizing(true);
    try {
      const result = await aiService.optimizeScenePrompt(createDesc.trim(), textModelProviderId, selectedTextModel);
      setCreatePrompt(result);
      message.success('场景描述已优化');
    } catch (e: any) { message.error(e.message || '优化失败'); }
    finally { setCreateOptimizing(false); }
  };

  const handleGenerateScene = async () => {
    const prompt = createPrompt || createDesc;
    if (!prompt.trim()) { message.warning('请先输入场景描述并优化'); return; }
    setCreateGenerating(true); setCreateGenProgress(0);
    try {
      const fullPrompt = `${MULTIVIEW_PROMPT_TEMPLATE}\n\n【场景内容】\n${prompt.trim()}`;
      const tempScene: Scene = { id: 'temp', order: 0, description: createDesc, prompt: fullPrompt, generationMode: 'text-to-image', images: {}, videos: [], status: 'pending' };
      setCreateGenProgress(20);
      const imageUrl = await aiService.generateImage(tempScene, undefined, { aspectRatio: '1:1', style: selectedStyle, model: selectedImageModel, providerId: imageModelProviderId });
      setCreateGenProgress(70);
      await preloadImage(imageUrl, (p) => setCreateGenProgress(20 + Math.round(p * 0.5)));
      // 转 Base64 永久存储
      try {
        const resp = await fetch(imageUrl);
        if (resp.ok) {
          const blob = await resp.blob();
          const b64 = await blobToBase64(blob);
          setCreateImage(b64);
        } else { setCreateImage(imageUrl); }
      } catch { setCreateImage(imageUrl); }
      setCreateGenProgress(100);
      message.success('6视角场景图生成完成');
    } catch (e: any) { message.error(e.message || '生成失败'); }
    finally { setCreateGenerating(false); }
  };

  const handleImportLocal = () => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const b64 = await blobToBase64(file);
        setCreateImage(b64);
        message.success('本地图片已导入');
      } catch { message.error('导入失败'); }
    };
    input.click();
  };

  const handleSaveScene = () => {
    if (!createImage) { message.warning('请先生成或导入场景图片'); return; }
    if (!createDesc.trim()) { message.warning('请输入场景名称/描述'); return; }
    const label = `场景${String.fromCharCode(65 + sceneLocations.length)}`;
    const newLoc: SceneLocation = {
      sceneLabel: label,
      sceneDescription: `${label}：${createDesc.trim()}`,
      prompt: createPrompt || createDesc.trim(),
      sceneIds: [],
      generatedImage: createImage,
    };
    const updated = [...sceneLocations, newLoc];
    setSceneLocations(updated);
    saveData(updated);
    setCreateOpen(false);
    setCreateDesc(''); setCreatePrompt(''); setCreateImage(null);
    message.success(`场景已保存: ${label}`);
  };

  // ==================== 生成/导入场景图片 ====================
  const handleGenerateImage = useCallback(async (index: number) => {
    const loc = sceneLocations[index];
    setSceneLocations(prev => { const u = [...prev]; u[index] = { ...u[index], isGenerating: true, loadingProgress: 0 }; return u; });
    try {
      const tempScene: Scene = { id: 'temp', order: 0, description: loc.sceneDescription, prompt: loc.prompt, generationMode: 'text-to-image', images: {}, videos: [], status: 'pending' };
      const imageUrl = await aiService.generateImage(tempScene, undefined, { aspectRatio: '16:9', style: selectedStyle, model: selectedImageModel, providerId: imageModelProviderId });
      await preloadImage(imageUrl, (p) => setSceneLocations(prev => { const u = [...prev]; u[index] = { ...u[index], loadingProgress: p }; return u; }));
      let final = imageUrl;
      try { const r = await fetch(imageUrl); if (r.ok) final = await blobToBase64(await r.blob()); } catch {}
      const updated = sceneLocations.map((l, i) => i === index ? { ...l, generatedImage: final, isGenerating: false, loadingProgress: undefined } : l);
      setSceneLocations(updated);
      saveData(updated);
      message.success('场景图生成完成');
    } catch (e: any) { message.error(e.message || '生成失败'); setSceneLocations(prev => { const u = [...prev]; u[index] = { ...u[index], isGenerating: false }; return u; }); }
  }, [sceneLocations, selectedStyle, saveData]);

  const handleImport = useCallback((index: number) => {
    const loc = sceneLocations[index];
    if (!loc.generatedImage) { message.warning('请先生成场景图片'); return; }
    // 如果有脚本关联则导入关联分镜，否则导入到当前激活分镜
    const ids = loc.sceneIds.length > 0 ? loc.sceneIds.join(',') : '__current__';
    onImportToScene(ids, loc.generatedImage);
    message.success(loc.sceneIds.length > 0 ? `已导入到 ${loc.sceneIds.length} 个分镜` : '已导入到当前分镜');
  }, [onImportToScene]);

  const handleApplyToScenes = useCallback((index: number) => {
    const loc = sceneLocations[index];
    if (!loc || !onApplyPromptToScenes) return;
    onApplyPromptToScenes(loc.sceneIds, loc.prompt);
    message.success(`已应用到 ${loc.sceneIds.length} 个分镜`);
  }, [onApplyPromptToScenes]);

  const handleDeleteScene = useCallback((index: number) => {
    const updated = sceneLocations.filter((_, i) => i !== index);
    setSceneLocations(updated);
    saveData(updated);
  }, [sceneLocations, saveData]);

  return (
    <>
      <Modal title="场景管理" open={visible} onCancel={onClose} footer={null}
        width="85vw" style={{ top: '5vh' }} bodyStyle={{ height: '72vh', overflow: 'auto' }}
        forceRender destroyOnClose={false} className={styles.modal}>
        <div className={styles.headerBar}>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>创建场景</Button>
          <span style={{fontSize:13,color:'var(--text-tertiary)',marginLeft:12}}>{sceneLocations.length} 个场景</span>
        </div>
        {sceneLocations.length === 0 ? (
          <Empty description="暂无场景，点击「创建场景」开始" style={{marginTop:60}} />
        ) : (
          <div className={styles.grid}>
            {sceneLocations.map((loc, i) => (
              <div key={i} className={styles.card}>
                <div className={styles.cardPreview}
                  onClick={() => { if (loc.generatedImage) setPreviewImage(loc.generatedImage); }}>
                  {loc.generatedImage ? <img src={loc.generatedImage} alt="" />
                    : <div className={styles.cardPlaceholder}><CameraOutlined style={{fontSize:32,opacity:0.2}} /></div>}
                  {loc.isGenerating && <div className={styles.cardLoading}><Spin /><Progress percent={loc.loadingProgress || 0} size="small" style={{width:100}} /></div>}
                </div>
                <div className={styles.cardBody}>
                  <div className={styles.cardLabel}>{loc.sceneLabel}</div>
                  <div className={styles.cardDesc}>{loc.sceneDescription.slice(loc.sceneLabel.length + 1).slice(0, 40)}</div>
                  <div className={styles.cardMeta}>{loc.sceneIds.length} 个分镜</div>
                </div>
                <div className={styles.cardActions}>
                  {!loc.generatedImage ? (
                    <Button size="small" type="primary" icon={<ThunderboltOutlined />} loading={loc.isGenerating}
                      onClick={() => handleGenerateImage(i)}>生成</Button>
                  ) : (
                    <>
                      <Button size="small" icon={<EyeOutlined />} onClick={() => { if (loc.generatedImage) setPreviewImage(loc.generatedImage); }} />
                      <Button size="small" icon={<PictureOutlined />} onClick={() => handleImport(i)}>导入</Button>
                      <Button size="small" icon={<DeleteOutlined />} danger onClick={() => handleDeleteScene(i)} />
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Modal>

      {/* 创建场景弹窗 */}
      <Modal title="创建场景" open={createOpen} onCancel={() => setCreateOpen(false)}
        footer={[
          <Button key="cancel" onClick={() => setCreateOpen(false)}>取消</Button>,
          <Button key="save" type="primary" onClick={handleSaveScene} disabled={!createImage}>保存场景</Button>,
        ]} width={680} centered forceRender destroyOnClose={false}>
        <div style={{display:'flex',flexDirection:'column',gap:16}}>
          <div>
            <label style={s.label}>场景描述</label>
            <Input.TextArea rows={2} placeholder="输入场景描述，如：古代宫殿大殿，金碧辉煌，龙柱林立..."
              value={createDesc} onChange={e => setCreateDesc(e.target.value)} />
          </div>
          <div style={{display:'flex',gap:8}}>
            <Button icon={<ThunderboltOutlined />} loading={createOptimizing} onClick={handleOptimizeDesc}>
              AI优化描述
            </Button>
            <Button icon={<CameraOutlined />} loading={createGenerating} onClick={handleGenerateScene}
              disabled={!(createPrompt || createDesc).trim()} type="primary">
              生成6视角场景
            </Button>
            <Button icon={<UploadOutlined />} onClick={handleImportLocal}>导入本地图片</Button>
          </div>
          {createPrompt && (
            <div style={s.promptBox}>
              <div style={s.miniLabel}>优化后的提示词</div>
              <pre style={s.pre}>{createPrompt}</pre>
            </div>
          )}
          {createGenerating && <Progress percent={createGenProgress} size="small" />}
          {createImage && (
            <div style={{textAlign:'center',background:'var(--input-bg)',borderRadius:12,padding:12}}>
              <img src={createImage} alt="" style={{maxWidth:'100%',maxHeight:300,borderRadius:8}} />
            </div>
          )}
        </div>
      </Modal>

      {/* 图片预览 */}
      <Modal open={!!previewImage} onCancel={() => setPreviewImage(null)} footer={null} width="auto" centered>
        {previewImage && <img src={previewImage} alt="" style={{maxWidth:'80vw',maxHeight:'80vh',borderRadius:8}} />}
      </Modal>
    </>
  );
};

const s: Record<string, React.CSSProperties> = {
  label: { display:'block',marginBottom:6,fontSize:12,fontWeight:600,color:'var(--text-label)',textTransform:'uppercase',letterSpacing:0.4 },
  miniLabel: { fontSize:11,fontWeight:600,color:'var(--text-label)',marginBottom:6 },
  pre: { margin:0,whiteSpace:'pre-wrap',fontSize:12,lineHeight:1.6,color:'var(--body-color)',maxHeight:120,overflow:'auto' },
  promptBox: { padding:12,background:'var(--input-bg)',border:'1px solid var(--panel-border)',borderRadius:10 },
};

export default SceneManagerModal;
