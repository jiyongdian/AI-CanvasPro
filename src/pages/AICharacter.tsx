import * as React from 'react';
import { useState, useEffect, useMemo } from 'react';
import { Input, Button, Card, Spin, message, Popconfirm, Select, Space, Modal, Upload } from 'antd';
import { SendOutlined, LoadingOutlined, DeleteOutlined, ImportOutlined, ThunderboltOutlined, PlusOutlined, CloseOutlined, CopyOutlined, DownloadOutlined, UserOutlined, AppstoreOutlined } from '@ant-design/icons';
import { useRecoilState } from 'recoil';
import { v4 as uuidv4 } from 'uuid';
import { aiService, createTempScene } from '../services/aiService';
import { preloadImage, compressImage } from '../utils/imageUtils';
import { downloadToDir, saveDirHandle } from '../utils/downloadHelper';
import { saveCharacter, openDatabase, getAllStyles } from '../services/database';
import { saveMedia, getMedia } from '../services/mediaService';
import { loadApiProviders } from '../services/secureStorage';
import { characterListState } from '../store/projectStore';
import { Character, Style, ApiProvider, ProviderModel } from '../types';
import styles from './AICharacter.module.css';

interface GeneratedCharacter {
  id: string;
  prompt: string;
  imageUrl: string;
  status: 'generating' | 'completed' | 'failed';
  createdAt: Date;
  aspectRatio?: string;
  imageSize?: string;
  loadingProgress?: number; // 图片下载进度 0-100
}

const aspectRatioOptions = [
  { label: '16:9 横屏', value: '16:9' },
  { label: '3:4 竖版', value: '3:4' },
  { label: '4:3 横版', value: '4:3' },
  { label: '9:16 手机竖屏', value: '9:16' },
];

const imageSizeOptions = [
  { label: '1K 标准', value: '1K' },
  { label: '2K 高清', value: '2K' },
  { label: '4K 超清', value: '4K' },
];

const PROMPT_STORAGE_KEY = 'ai_character_prompt';
const ASPECT_RATIO_STORAGE_KEY = 'ai_character_aspect_ratio';
const IMAGE_SIZE_STORAGE_KEY = 'ai_character_image_size';
const STYLE_STORAGE_KEY = 'ai_character_style';

const AICharacter: React.FC = () => {
  // 从 localStorage 加载持久化的提示词和参数
  const [prompt, setPrompt] = useState(() => {
    return localStorage.getItem(PROMPT_STORAGE_KEY) || '';
  });
  const [aspectRatio, setAspectRatio] = useState(() => {
    return localStorage.getItem(ASPECT_RATIO_STORAGE_KEY) || '16:9';
  });
  const [imageSize, setImageSize] = useState(() => {
    return localStorage.getItem(IMAGE_SIZE_STORAGE_KEY) || '4K';
  });
  const [history, setHistory] = useState<GeneratedCharacter[]>([]);
  const [characters, setCharacters] = useRecoilState(characterListState);
  const [optimizing, setOptimizing] = useState(false);
  const [customImage, setCustomImage] = useState<string | null>(null);
  const [previewVisible, setPreviewVisible] = useState(false);
  
  // 角色卡片预览弹窗状态
  const [cardPreviewVisible, setCardPreviewVisible] = useState(false);
  const [previewCharacter, setPreviewCharacter] = useState<GeneratedCharacter | null>(null);
  const [activeTab, setActiveTab] = useState<'generate' | 'history'>(() => (localStorage.getItem('ac_tab') as any) || 'generate');
  
  // 风格选择状态
  const [styleList, setStyleList] = useState<Style[]>([]);
  const [selectedStyleId, setSelectedStyleId] = useState<string | undefined>(() => {
    return localStorage.getItem(STYLE_STORAGE_KEY) || undefined;
  });

  // 模型配置
  const [providers, setProviders] = useState<ApiProvider[]>([]);
  const [selPlatformId, setSelPlatformId] = useState<string | undefined>(() => localStorage.getItem('ac_platform') || undefined);
  const [selImageModel, setSelImageModel] = useState<string | undefined>(() => localStorage.getItem('ac_image_model') || undefined);
  const [selTextModel, setSelTextModel] = useState<string | undefined>(() => localStorage.getItem('ac_text_model') || undefined);

  const selPlatform = useMemo(() => providers.find(p => p.id === selPlatformId), [providers, selPlatformId]);
  // 分类模型列表（其它类别在所有选择器中出现）
  const imageModels = useMemo(() => {
    if (!selPlatform) return [];
    const seen = new Set<string>(); const r: ProviderModel[] = [];
    selPlatform.models.forEach(m => { if ((m.category === 'image' || m.category === 'other') && !seen.has(m.id)) { seen.add(m.id); r.push(m); } });
    return r;
  }, [selPlatform]);
  const textModels = useMemo(() => {
    if (!selPlatform) return [];
    const seen = new Set<string>(); const r: ProviderModel[] = [];
    selPlatform.models.forEach(m => { if ((m.category === 'text' || m.category === 'other') && !seen.has(m.id)) { seen.add(m.id); r.push(m); } });
    return r;
  }, [selPlatform]);

  const resolveModelConfig = (modelId?: string) => {
    if (!modelId) return { error: '请选择模型' };
    if (!selPlatform) return { error: '请先选择API平台' };
    if (selPlatform.models.some(m => m.id === modelId))
      return { providerId: selPlatform.id, model: modelId };
    return { error: `模型 "${modelId}" 不在当前平台` };
  };

  useEffect(() => {
    loadApiProviders().then(p => { setProviders(p.filter(x => x.enabled !== false)); }).catch(() => {});
  }, []);
  useEffect(() => { if (selPlatformId) localStorage.setItem('ac_platform', selPlatformId); else localStorage.removeItem('ac_platform'); }, [selPlatformId]);
  useEffect(() => { if (selImageModel) localStorage.setItem('ac_image_model', selImageModel); else localStorage.removeItem('ac_image_model'); }, [selImageModel]);
  useEffect(() => { if (selTextModel) localStorage.setItem('ac_text_model', selTextModel); else localStorage.removeItem('ac_text_model'); }, [selTextModel]);

  // 通过 canvas 将图片 URL 转为 Base64（绕过 CORS）
  const urlToBase64 = async (url: string): Promise<string> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) { reject(new Error('Canvas not supported')); return; }
        ctx.drawImage(img, 0, 0);
        try { resolve(canvas.toDataURL('image/png')); } catch { reject(new Error('Canvas tainted')); }
      };
      img.onerror = () => reject(new Error('Image load failed'));
      img.src = url;
    });
  };

  const supportsImageSize = () => {
    return (selImageModel || '').includes('nano-banana-2');
  };

  // 加载风格列表
  useEffect(() => {
    const loadStyles = async () => {
      try {
        const styles = await getAllStyles();
        setStyleList(styles);
      } catch (error) {
        console.error('加载风格列表失败:', error);
      }
    };
    loadStyles();
  }, []);

  // 风格选择持久化保存
  useEffect(() => {
    if (selectedStyleId) {
      localStorage.setItem(STYLE_STORAGE_KEY, selectedStyleId);
    } else {
      localStorage.removeItem(STYLE_STORAGE_KEY);
    }
  }, [selectedStyleId]);

  // 从IndexedDB加载历史记录，并处理中断的任务
  useEffect(() => {
    let cancelled = false;
    let retryTimers: ReturnType<typeof setTimeout>[] = [];

    const loadHistory = async () => {
      try {
        const db = await openDatabase();
        if (cancelled) return;
        const data = await db.getAll('ai_character_history');
        if (cancelled) return;
        // 按创建时间倒序排列
        data.sort((a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );

        // 处理中断的任务：保持 generating 状态，稍后自动重试
        const processedData = data.map((item) => ({
          ...item,
          createdAt: new Date(item.createdAt)
        }));

        // 找出需要自动重试的任务（generating 状态）
        const interruptedTasks = processedData.filter(item => item.status === 'generating');

        if (cancelled) return;
        setHistory(processedData as GeneratedCharacter[]);

        // 自动重试中断的任务（限制并发数量防止 API 限流）
        if (interruptedTasks.length > 0) {
          message.info(`正在恢复 ${interruptedTasks.length} 个中断的任务...`);
          const MAX_CONCURRENT_RETRIES = 2;
          // 分批执行，每次最多 MAX_CONCURRENT_RETRIES 个
          for (let i = 0; i < interruptedTasks.length; i += MAX_CONCURRENT_RETRIES) {
            if (cancelled) break;
            const batch = interruptedTasks.slice(i, i + MAX_CONCURRENT_RETRIES);
            const timer = setTimeout(() => {
              batch.forEach(task => {
                if (!cancelled) autoRetryTask(task as GeneratedCharacter);
              });
            }, 500 + i * 200); // 错开启动时间
            retryTimers.push(timer);
          }
        }
      } catch (error) {
        if (cancelled) return;
        console.error('加载历史记录失败:', error);
        // 降级到localStorage
        const saved = localStorage.getItem('ai_character_history');
        if (saved) {
          const parsed = JSON.parse(saved);
          setHistory(parsed.map((item: GeneratedCharacter) => ({
            ...item,
            createdAt: new Date(item.createdAt)
          })));
        }
      }
    };
    loadHistory();
    return () => {
      cancelled = true;
      retryTimers.forEach(clearTimeout);
    };
  }, []);

  // 提示词持久化保存
  useEffect(() => {
    localStorage.setItem(PROMPT_STORAGE_KEY, prompt);
  }, [prompt]);

  // 图片比例持久化保存
  useEffect(() => {
    localStorage.setItem(ASPECT_RATIO_STORAGE_KEY, aspectRatio);
  }, [aspectRatio]);

  // 图片质量持久化保存
  useEffect(() => {
    localStorage.setItem(IMAGE_SIZE_STORAGE_KEY, imageSize);
  }, [imageSize]);

  // 保存单个记录到IndexedDB
  const saveToIndexedDB = async (character: GeneratedCharacter) => {
    try {
      const db = await openDatabase();
      await db.put('ai_character_history', character as any);
    } catch (error) {
      console.error('保存到IndexedDB失败:', error);
    }
  };

  // 从IndexedDB删除记录
  const deleteFromIndexedDB = async (id: string) => {
    try {
      const db = await openDatabase();
      await db.delete('ai_character_history', id);
    } catch (error) {
      console.error('从IndexedDB删除失败:', error);
    }
  };

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      message.warning('请输入角色描述');
      return;
    }

    const currentPrompt = prompt.trim();
    console.log('[AICharacter] 开始生成角色图片，提示词:', currentPrompt);
    
    const newCharacter: GeneratedCharacter = {
      id: uuidv4(),
      prompt: currentPrompt,
      imageUrl: '',
      status: 'generating',
      createdAt: new Date(),
      aspectRatio,
      imageSize: supportsImageSize() ? imageSize : undefined
    };

    setHistory(prev => [newCharacter, ...prev]);
    saveToIndexedDB(newCharacter);
    // 不再清空提示词，支持多任务并发生成
    // setPrompt('');

    try {
      console.log('[AICharacter] 调用 aiService.generateImage...');
      // 获取选中的风格
      const selectedStyle = styleList.find(s => s.id === selectedStyleId);
      const mc = resolveModelConfig(selImageModel);
      if ((mc as any).error) { message.error((mc as any).error); setHistory(prev => prev.map(c => c.id === newCharacter.id ? { ...c, status: 'failed' as const } : c)); return; }
      const imageUrl = await aiService.generateImage(
        { id: newCharacter.id, order: 0, description: '', prompt: currentPrompt, generationMode: 'text-to-image', images: {}, videos: [], status: 'pending' },
        undefined,
        { aspectRatio, imageSize: supportsImageSize() ? imageSize : undefined, style: selectedStyle, model: selImageModel, providerId: (mc as any).providerId }
      );

      // 预加载图片到浏览器缓存，带进度回调
      await preloadImage(imageUrl, (progress) => {
        setHistory(prev => prev.map(c =>
          c.id === newCharacter.id ? { ...c, loadingProgress: progress } : c
        ));
      });

      // 转为Base64并永久保存(canvas绕过CORS)
      let permanentImage = imageUrl;
      try {
        const base64 = await urlToBase64(imageUrl);
        permanentImage = base64;
        await saveMedia('character', `ai_${newCharacter.id}`, base64);
        console.log('[AICharacter] 角色图片已永久保存到本地');
      } catch (mediaError) {
        console.warn('[AICharacter] 图片保存失败，使用远程URL:', mediaError);
      }

      const completedCharacter = { ...newCharacter, imageUrl: permanentImage, status: 'completed' as const };
      setHistory(prev => prev.map(c =>
        c.id === newCharacter.id ? completedCharacter : c
      ));
      saveToIndexedDB(completedCharacter);
      message.success('角色生成成功');
    } catch (error) {
      const failedCharacter = { ...newCharacter, status: 'failed' as const };
      setHistory(prev => prev.map(c =>
        c.id === newCharacter.id ? failedCharacter : c
      ));
      saveToIndexedDB(failedCharacter);
      message.error('生成失败，请检查API配置');
      console.error(error);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleGenerate();
    }
  };

  const handleDelete = (id: string) => {
    setHistory(prev => prev.filter(c => c.id !== id));
    deleteFromIndexedDB(id);
    message.success('已删除');
  };

  // 自动重试中断的任务（刷新后自动恢复）
  const autoRetryTask = async (character: GeneratedCharacter) => {
    console.log('[AICharacter] 自动恢复任务:', character.id, character.prompt);
    
    try {
      const selectedStyle = styleList.find(s => s.id === selectedStyleId);
      const mc = resolveModelConfig(selImageModel);
      if ((mc as any).error) return;
      const imageUrl = await aiService.generateImage(
        { id: character.id, order: 0, description: '', prompt: character.prompt, generationMode: 'text-to-image', images: {}, videos: [], status: 'pending' },
        undefined,
        { aspectRatio: character.aspectRatio || '16:9', imageSize: character.imageSize, style: selectedStyle, model: selImageModel, providerId: (mc as any).providerId }
      );

      // 预加载图片
      await preloadImage(imageUrl, (progress) => {
        setHistory(prev => prev.map(c =>
          c.id === character.id ? { ...c, loadingProgress: progress } : c
        ));
      });

      // Canvas转Base64永久保存
      let permanentImage = imageUrl;
      try { const b64 = await urlToBase64(imageUrl); permanentImage = b64; await saveMedia('character', `ai_${character.id}`, b64); } catch {}

      const completedCharacter = { ...character, imageUrl: permanentImage, status: 'completed' as const };
      setHistory(prev => prev.map(c =>
        c.id === character.id ? completedCharacter : c
      ));
      saveToIndexedDB(completedCharacter);
      message.success('任务恢复成功');
    } catch (error) {
      const failedCharacter = { ...character, status: 'failed' as const };
      setHistory(prev => prev.map(c =>
        c.id === character.id ? failedCharacter : c
      ));
      saveToIndexedDB(failedCharacter);
      console.error('[AICharacter] 自动恢复失败:', error);
    }
  };

  // 重试失败或中断的任务
  const handleRetry = async (character: GeneratedCharacter) => {
    console.log('[AICharacter] 重试任务:', character.id, character.prompt);
    
    const retryingCharacter = { ...character, status: 'generating' as const, loadingProgress: 0 };
    setHistory(prev => prev.map(c => c.id === character.id ? retryingCharacter : c));
    saveToIndexedDB(retryingCharacter);
    
    try {
      const selectedStyle = styleList.find(s => s.id === selectedStyleId);
      const mc = resolveModelConfig(selImageModel);
      if ((mc as any).error) { message.error((mc as any).error); return; }
      const imageUrl = await aiService.generateImage(
        { id: character.id, order: 0, description: '', prompt: character.prompt, generationMode: 'text-to-image', images: {}, videos: [], status: 'pending' },
        undefined,
        { aspectRatio: character.aspectRatio || '16:9', imageSize: character.imageSize, style: selectedStyle, model: selImageModel, providerId: (mc as any).providerId }
      );

      // 预加载图片
      await preloadImage(imageUrl, (progress) => {
        setHistory(prev => prev.map(c =>
          c.id === character.id ? { ...c, loadingProgress: progress } : c
        ));
      });

      // Canvas转Base64永久保存
      let permanentImage = imageUrl;
      try { const b64 = await urlToBase64(imageUrl); permanentImage = b64; await saveMedia('character', `ai_${character.id}`, b64); } catch {}

      const completedCharacter = { ...character, imageUrl: permanentImage, status: 'completed' as const };
      setHistory(prev => prev.map(c =>
        c.id === character.id ? completedCharacter : c
      ));
      saveToIndexedDB(completedCharacter);
      message.success('重试成功');
    } catch (error) {
      const failedCharacter = { ...character, status: 'failed' as const };
      setHistory(prev => prev.map(c =>
        c.id === character.id ? failedCharacter : c
      ));
      saveToIndexedDB(failedCharacter);
      message.error('重试失败');
      console.error(error);
    }
  };

  // AI优化提示词功能
  const handleOptimizePrompt = async () => {
    if (!prompt.trim()) {
      message.warning('请先输入角色描述');
      return;
    }
    const mc = resolveModelConfig(selTextModel);
    if ((mc as any).error) { message.error((mc as any).error); return; }

    setOptimizing(true);
    try {
      const optimizedPrompt = await aiService.optimizeCharacterPrompt(prompt.trim(), (mc as any).providerId, selTextModel);
      setPrompt(optimizedPrompt);
      message.success('提示词优化成功');
    } catch (error) {
      message.error('优化失败，请检查API配置');
      console.error(error);
    } finally {
      setOptimizing(false);
    }
  };

  // 处理自定义图片上传
  const handleCustomImageUpload = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      setCustomImage(e.target?.result as string);
    };
    reader.readAsDataURL(file);
    return false;
  };

  // 删除自定义图片
  const handleRemoveCustomImage = () => {
    setCustomImage(null);
  };

  // 打开角色卡片预览弹窗
  const handleOpenCardPreview = (character: GeneratedCharacter) => {
    if (character.status === 'completed' && character.imageUrl) {
      setPreviewCharacter(character);
      setCardPreviewVisible(true);
    }
  };

  // 复制提示词到剪贴板
  const handleCopyPrompt = () => {
    if (previewCharacter?.prompt) {
      navigator.clipboard.writeText(previewCharacter.prompt);
      message.success('提示词已复制到剪贴板');
    }
  };

  const handleImportToLibrary = async (character: GeneratedCharacter) => {
    if (character.status !== 'completed' || !character.imageUrl) {
      message.warning('只能导入生成成功的角色');
      return;
    }

    try {
      const characterId = uuidv4();
      
      // 获取图片：优先从本地 media store 读取，回退到远程 URL
      let referenceImage = '';
      let referenceImageBlob: Blob | undefined;
      let mediaSaved = false;

      try {
        // 尝试从本地 media store 读取已经永久保存的图片
        const localBase64 = await getMedia('character', `ai_${character.id}`);
        if (localBase64) {
          referenceImage = localBase64;
          mediaSaved = true;
          console.log('[AICharacter] 从本地 media store 读取角色图片');
        } else if (character.imageUrl.startsWith('data:')) {
          // imageUrl 已经是 Base64，直接使用
          referenceImage = character.imageUrl;
          await saveMedia('character', characterId, referenceImage);
          mediaSaved = true;
          console.log('[AICharacter] 直接使用 Base64 保存到角色库');
        } else {
          // 回退：从远程 URL 下载
          console.log('[AICharacter] 从远程URL获取图片:', character.imageUrl);
          const response = await fetch(character.imageUrl);
          if (response.ok) {
            const blob = await response.blob();
            referenceImageBlob = blob;

            referenceImage = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onloadend = () => resolve(reader.result as string);
              reader.onerror = reject;
              reader.readAsDataURL(blob);
            });

            await saveMedia('character', characterId, referenceImage);
            mediaSaved = true;
            console.log('[AICharacter] 角色参考图已保存到媒体服务');
          }
        }
      } catch (fetchError) {
        console.warn('[AICharacter] 获取图片失败:', fetchError);
        referenceImage = character.imageUrl;
      }

      const newCharacter: Character = {
        id: characterId,
        name: character.prompt.slice(0, 20),
        description: character.prompt,
        voiceType: '',
        referenceImage,
        referenceImageBlob,
        createdAt: new Date(),
      };

      await saveCharacter(newCharacter);
      setCharacters([...characters, newCharacter]);
      
      if (mediaSaved) {
        message.success('已导入到角色库');
      } else {
        message.warning('已导入到角色库，但参考图可能需要重新上传');
      }
    } catch (error) {
      message.error('导入失败');
      console.error(error);
    }
  };

  return (
    <div className={styles.container}>
      {/* 顶部导航 */}
      <div className={styles.tabBar}>
        <button className={`${styles.tabBtn} ${activeTab === 'generate' ? styles.tabBtnActive : ''}`} onClick={() => { setActiveTab('generate'); localStorage.setItem('ac_tab', 'generate'); }}>
          <UserOutlined /> AI角色生成
        </button>
        <button className={`${styles.tabBtn} ${activeTab === 'history' ? styles.tabBtnActive : ''}`} onClick={() => { setActiveTab('history'); localStorage.setItem('ac_tab', 'history'); }}>
          <AppstoreOutlined /> 生成任务列表 {history.length > 0 && <span className={styles.tabBadge}>{history.length}</span>}
        </button>
      </div>

      {/* Tab 1: 生成 */}
      {activeTab === 'generate' && (
      <div className={styles.generatePanel}>
        <div className={styles.inputWrapper}>
          <Input.TextArea
            className={styles.input}
            placeholder="描述你想要生成的角色，例如：一位身穿白色长裙的少女，有着银色长发和蓝色眼睛..."
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyPress={handleKeyPress}
            autoSize={{ minRows: 6, maxRows: 12 }}
          />
          <Button
            type="default"
            icon={optimizing ? <LoadingOutlined /> : <ThunderboltOutlined />}
            onClick={handleOptimizePrompt}
            disabled={optimizing || !prompt.trim()}
            className={styles.optimizeButton}
          >
            {optimizing ? '优化中...' : 'AI优化'}
          </Button>
        </div>
        <div className={styles.paramsGrid}>
          <div className={styles.paramItem}>
            <span className={styles.paramLabel}>API平台</span>
            <Select value={selPlatformId} onChange={setSelPlatformId} placeholder="全部平台" allowClear style={{width:'100%'}} options={providers.filter(p => p.enabled !== false).map(p => ({ label: p.name, value: p.id }))} />
          </div>
          <div className={styles.paramItem}>
            <span className={styles.paramLabel}>文本模型（AI优化）</span>
            <Select value={selTextModel} onChange={setSelTextModel} placeholder={!selPlatform ? '请先选择API平台' : textModels.length > 0 ? '选择文本模型' : '该平台无文本模型'} allowClear style={{width:'100%'}} options={textModels.map(m => ({ label: m.id, value: m.id }))} disabled={!selPlatform} />
          </div>
          <div className={styles.paramItem}>
            <span className={styles.paramLabel}>图片模型（生成）</span>
            <Select value={selImageModel} onChange={setSelImageModel} placeholder={!selPlatform ? '请先选择API平台' : imageModels.length > 0 ? '选择图片模型' : '该平台无图片模型'} allowClear style={{width:'100%'}} options={imageModels.map(m => ({ label: m.id, value: m.id }))} disabled={!selPlatform} />
          </div>
          <div className={styles.paramItem}>
            <span className={styles.paramLabel}>风格选择</span>
            <Select
              value={selectedStyleId}
              onChange={setSelectedStyleId}
              placeholder="选择风格（可选）"
              allowClear
              style={{ width: '100%' }}
              options={styleList.map(s => ({ label: s.name, value: s.id }))}
            />
          </div>
          <div className={styles.paramItem}>
            <span className={styles.paramLabel}>图片比例</span>
            <Select
              value={aspectRatio}
              onChange={setAspectRatio}
              options={aspectRatioOptions}
              style={{ width: '100%' }}
            />
          </div>
          {supportsImageSize() && (
            <div className={styles.paramItem}>
              <span className={styles.paramLabel}>图片质量</span>
              <Select
                value={imageSize}
                onChange={setImageSize}
                options={imageSizeOptions}
                style={{ width: '100%' }}
              />
            </div>
          )}
          <div className={styles.paramItem}>
            <span className={styles.paramLabel}>自定义参考图</span>
            {customImage ? (
              <div className={styles.customImageWrapper}>
                <div 
                  className={styles.customImageThumb}
                  onClick={() => setPreviewVisible(true)}
                >
                  <img src={customImage} alt="自定义图片" />
                </div>
                <Button
                  type="text"
                  danger
                  size="small"
                  icon={<CloseOutlined />}
                  onClick={handleRemoveCustomImage}
                  className={styles.removeImageBtn}
                />
              </div>
            ) : (
              <Upload
                accept="image/*"
                showUploadList={false}
                beforeUpload={handleCustomImageUpload}
              >
                <Button icon={<PlusOutlined />} className={styles.uploadButton}>
                  上传图片
                </Button>
              </Upload>
            )}
          </div>
        </div>
        <Button
          type="primary"
          icon={<SendOutlined />}
          onClick={handleGenerate}
          className={styles.generateButton}
          block
        >
          开始生成
        </Button>
      </div>
      )}

      {/* Tab 2: 任务列表 */}
      {activeTab === 'history' && (
      <div className={styles.historyPanel}>
        <div className={styles.cardGrid}>
          {history.length > 0 ? (
            history.map((character) => (
              <Card
                key={character.id}
                className={styles.characterCard}
                bodyStyle={{ padding: 0 }}
              >
                <div 
                  className={styles.cardImage}
                  onClick={() => handleOpenCardPreview(character)}
                  style={{ cursor: character.status === 'completed' ? 'pointer' : 'default' }}
                >
                  {character.status === 'generating' ? (
                    <div className={styles.loadingState}>
                      <Spin />
                      <span>
                        {character.loadingProgress !== undefined && character.loadingProgress > 0
                          ? `下载中 ${character.loadingProgress}%`
                          : '生成中...'}
                      </span>
                    </div>
                  ) : character.status === 'failed' ? (
                    <div className={styles.failedState}>
                      <span>生成失败</span>
                    </div>
                  ) : (
                    <img src={character.imageUrl} alt={character.prompt} />
                  )}
                </div>
                <div className={styles.cardInfo}>
                  <p className={styles.cardPrompt}>{character.prompt}</p>
                  <div className={styles.cardActions}>
                    {character.status === 'completed' && (
                      <Button
                        type="text"
                        size="small"
                        icon={<ImportOutlined />}
                        onClick={() => handleImportToLibrary(character)}
                      >
                        导入
                      </Button>
                    )}
                    {character.status === 'failed' && (
                      <Button
                        type="text"
                        size="small"
                        icon={<SendOutlined />}
                        onClick={() => handleRetry(character)}
                      >
                        重试
                      </Button>
                    )}
                    <Popconfirm
                      title="确定删除？"
                      onConfirm={() => handleDelete(character.id)}
                      okText="确定"
                      cancelText="取消"
                    >
                      <Button
                        type="text"
                        size="small"
                        danger
                        icon={<DeleteOutlined />}
                      />
                    </Popconfirm>
                  </div>
                </div>
              </Card>
            ))
          ) : (
            <div className={styles.emptyState}>
              <p>暂无生成任务</p>
              <p>在左侧输入角色描述开始生成</p>
            </div>
          )}
        </div>
      </div>
      )}

      {/* 自定义图片预览弹窗 */}
      <Modal
        open={previewVisible}
        footer={null}
        onCancel={() => setPreviewVisible(false)}
        centered
        forceRender
        destroyOnClose={false}
        className={styles.previewModal}
        width="auto"
      >
        {customImage && (
          <img 
            src={customImage} 
            alt="预览"
            className={styles.previewImage}
          />
        )}
      </Modal>

      {/* 角色卡片预览弹窗 */}
      <Modal
        open={cardPreviewVisible}
        footer={null}
        onCancel={() => {
          setCardPreviewVisible(false);
          setPreviewCharacter(null);
        }}
        centered
        forceRender
        destroyOnClose={false}
        className={styles.cardPreviewModal}
        width={800}
      >
        {previewCharacter && (
          <div className={styles.cardPreviewContent}>
            <div className={styles.cardPreviewImage}>
              <img 
                src={previewCharacter.imageUrl} 
                alt={previewCharacter.prompt}
              />
            </div>
            <div className={styles.cardPreviewInfo}>
              <div className={styles.cardPreviewPromptSection}>
                <div className={styles.cardPreviewPromptHeader}>
                  <span className={styles.cardPreviewPromptLabel}>提示词</span>
                  <Space>
                    <Button 
                      type="primary" 
                      size="small"
                      icon={<CopyOutlined />}
                      onClick={handleCopyPrompt}
                    >
                      复制提示词
                    </Button>
                    <Button 
                      size="small"
                      icon={<DownloadOutlined />}
                      onClick={async () => {
                        if (previewCharacter?.imageUrl) {
                          try {
                            // 获取图片Blob
                            const response = await fetch(previewCharacter.imageUrl);
                            const blob = await response.blob();
                            const fileName = `角色_${Date.now()}.png`;
                            
                            // 尝试使用文件保存对话框
                            if ('showSaveFilePicker' in window) {
                              try {
                                const handle = await (window as any).showSaveFilePicker({
                                  suggestedName: fileName,
                                  types: [{
                                    description: 'PNG图片',
                                    accept: { 'image/png': ['.png'] }
                                  }]
                                });
                                const writable = await handle.createWritable();
                                await writable.write(blob);
                                await writable.close();
                                
                                // 保存目录句柄供后续使用
                                const dirHandle = await handle.getParent?.();
                                if (dirHandle) {
                                  await saveDirHandle(dirHandle);
                                }
                                
                                message.success('图片已保存');
                                return;
                              } catch (err: any) {
                                if (err.name === 'AbortError') {
                                  return; // 用户取消
                                }
                                console.warn('文件保存对话框失败:', err);
                              }
                            }
                            
                            // 回退到默认下载
                            await downloadToDir(blob, fileName, 
                              (path) => message.success(`已保存到: ${path}`),
                              () => message.success('开始下载')
                            );
                          } catch (err) {
                            console.error('下载失败:', err);
                            message.error('下载失败');
                          }
                        }
                      }}
                    >
                      下载图片
                    </Button>
                  </Space>
                </div>
                <p className={styles.cardPreviewPromptText}>{previewCharacter.prompt}</p>
              </div>
              {previewCharacter.aspectRatio && (
                <p className={styles.cardPreviewMeta}>图片比例: {previewCharacter.aspectRatio}</p>
              )}
              {previewCharacter.imageSize && (
                <p className={styles.cardPreviewMeta}>图片质量: {previewCharacter.imageSize}</p>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default AICharacter;
