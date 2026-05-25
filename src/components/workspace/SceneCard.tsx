import * as React from 'react';
import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { Input, Button, Checkbox, message, Modal, Spin, Progress, Upload } from 'antd';
import { RedoOutlined, DeleteOutlined, DragOutlined, PlusOutlined, ThunderboltOutlined, DownloadOutlined, UploadOutlined, ClearOutlined, ExpandOutlined, VideoCameraOutlined } from '@ant-design/icons';
import { LazyImage, LazyVideoThumbnail, FullscreenPromptEditor } from '../common';
import PromptInput, { type PromptInputRef } from './PromptInput';
import { useRecoilValue } from 'recoil';
import { characterListState } from '../../store/projectStore';
import { aiService } from '../../services/aiService';
import { preloadImage, convertToBase64ForStorage, saveImageToLocalFile } from '../../utils/imageUtils';
import { downloadToDir } from '../../utils/downloadHelper';
import { saveUrlAsBlob } from '../../services/database';
import { Scene, Style, GenerationMode, Character, GenerationTask, PromptTemplate } from '../../types';
import styles from './SceneCard.module.css';

// 防抖 Hook
function useDebouncedCallback<T extends (...args: Parameters<T>) => void>(
  callback: T,
  delay: number
): T {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  return useCallback((...args: Parameters<T>) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = setTimeout(() => {
      callbackRef.current(...args);
    }, delay);
  }, [delay]) as T;
}

import type { GridMode } from '../../pages/Workspace';

interface SceneCardProps {
  scene: Scene;
  index: number;
  allScenes: Scene[];
  gridMode: GridMode;
  selectedStyle?: Style;
  generationMode: GenerationMode;
  imageTemplate?: PromptTemplate;
  videoTemplate?: PromptTemplate;
  directorTemplate?: PromptTemplate;
  onUpdateScene: (updates: Partial<Scene> | ((prevScene: Scene) => Partial<Scene>)) => void;
  onDeleteScene: () => void;
  onInsertScene: () => void;
}

const SceneCardComponent: React.FC<SceneCardProps> = ({
  scene,
  index,
  allScenes,
  gridMode,
  selectedStyle,
  generationMode,
  imageTemplate,
  videoTemplate,
  directorTemplate,
  onUpdateScene,
  onDeleteScene,
  onInsertScene,
}) => {
  const characters = useRecoilValue(characterListState);
  // 修复问题#3: 使用独立的 imageStatus 判断图片生成状态，避免与视频生成混淆
  // 向后兼容：如果没有 imageStatus，则使用旧的 status 字段
  const generatingImage = scene.imageStatus === 'generating';
  // 图片下载进度使用本地状态 localImageLoadingProgress
  const [inferring, setInferring] = useState(false);
  const [directorOptimizing, setDirectorOptimizing] = useState(false);
  const [directorAnalysis, setDirectorAnalysis] = useState('');
  const [directorModalVisible, setDirectorModalVisible] = useState(false);
  // 修复问题#2: 从 scene.promptMode 读取，避免虚拟滚动导致状态丢失
  const promptMode = scene.promptMode === 'video' ? 'video' : 'image';
  const setPromptMode = useCallback((mode: 'image' | 'video') => {
    onUpdateScene({ promptMode: mode });
  }, [onUpdateScene]);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [imageTasksVisible, setImageTasksVisible] = useState(false);
  const [videoTasksVisible, setVideoTasksVisible] = useState(false);
  const [videoPreviewVisible, setVideoPreviewVisible] = useState(false);
  const [selectedVideoIndex, setSelectedVideoIndex] = useState<number | null>(null);
  const videoCheckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const videoCheckTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const videoPollCountRef = useRef<Map<string, number>>(new Map());
  const videoPollStartTimeRef = useRef<Map<string, number>>(new Map());
  const videoConsecutiveErrorsRef = useRef<Map<string, number>>(new Map());
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // 轮询配置常量
  const MAX_POLL_COUNT = 300;     // 最大轮询次数（300次 × 2秒 = 10分钟）
  const MAX_POLL_TIME = 600000;    // 最大轮询总时间 10分钟
  const MAX_CONSECUTIVE_ERRORS = 5; // 连续错误上限
  const POLL_INTERVAL = 2000;      // 轮询间隔 2秒
  
  // 本地进度状态：存储任务进度，避免频繁更新 project 导致页面刷新
  // key: taskId, value: progress (0-100)
  const [localProgress, setLocalProgress] = useState<Record<string, number>>({});
  
  // 本地图片下载进度状态
  const [localImageLoadingProgress, setLocalImageLoadingProgress] = useState(0);
  
  // 本地提示词状态：优先从 sessionStorage 恢复（虚拟滚动卸载再挂载后输入不丢失）
  const savedImage = sessionStorage.getItem(`input_${scene.id}_image`);
  const savedVideo = sessionStorage.getItem(`input_${scene.id}_video`);
  const [localImagePrompt, setLocalImagePrompt] = useState(savedImage || scene.imagePrompt || '');
  const [localVideoPrompt, setLocalVideoPrompt] = useState(savedVideo || scene.videoPrompt || '');
  const [fullscreenOpen, setFullscreenOpen] = useState(false);
  
  // 当 scene 的提示词从外部更新时（如 AI 生成），同步到本地状态
  useEffect(() => {
    if (scene.imagePrompt !== undefined && scene.imagePrompt !== localImagePrompt) {
      setLocalImagePrompt(scene.imagePrompt);
      if (promptMode === 'image') {
        latestPromptRef.current = scene.imagePrompt || '';
      }
    }
  }, [scene.imagePrompt]);
  
  useEffect(() => {
    if (scene.videoPrompt !== undefined && scene.videoPrompt !== localVideoPrompt) {
      setLocalVideoPrompt(scene.videoPrompt);
      if (promptMode === 'video') {
        latestPromptRef.current = scene.videoPrompt || '';
      }
    }
  }, [scene.videoPrompt]);

  // 当 promptMode 切换时，同步 ref 到当前模式的提示词内容
  useEffect(() => {
    if (promptMode === 'image') {
      latestPromptRef.current = localImagePrompt || scene.imagePrompt || '';
    } else {
      latestPromptRef.current = localVideoPrompt || scene.videoPrompt || '';
    }
  }, [promptMode]);

  // 使用 ref 存储最新的 scene 状态和 onUpdateScene，避免闭包问题
  const sceneRef = useRef(scene);
  sceneRef.current = scene;
  const onUpdateSceneRef = useRef(onUpdateScene);
  onUpdateSceneRef.current = onUpdateScene;

  // 标记是否正在进行 AI 推理/优化，防止防抖保存覆盖 AI 生成的内容
  const processingRef = useRef(false);

  // PromptInput 的 ref，用于推理时直接读取当前输入框的最新文本
  const promptInputRef = useRef<PromptInputRef>(null);

  // 使用 ref 存储最新的 prompt 输入文本（优先 sessionStorage，虚拟滚动卸载再挂载后不会丢失）
  const savedSessionPrompt = scene.promptMode === 'video'
    ? sessionStorage.getItem(`input_${scene.id}_video`)
    : sessionStorage.getItem(`input_${scene.id}_image`);
  const latestPromptRef = useRef(
    savedSessionPrompt
    || (scene.promptMode === 'video' ? scene.videoPrompt || '' : scene.imagePrompt || '')
  );

  // 使用 ref 存储最新的 characters 状态，确保 handleGenerateImage 使用最新数据
  const charactersRef = useRef(characters);
  charactersRef.current = characters;


  // 获取当前分镜可用的所有角色（从弹窗选择应用的，按 availableCharacterIds 顺序）
  const availableCharacters = useMemo(() => 
    (scene.availableCharacterIds || [])
      .map(id => characters.find(c => c.id === id))
      .filter((c): c is Character => c !== undefined),
    [scene.availableCharacterIds, characters]
  );
  // 获取当前分镜出场的角色（按界面显示顺序，确保与提示词中的 Character N 编号一致）
  const selectedCharacters = useMemo(() => 
    availableCharacters.filter(c => scene.selectedCharacterIds?.includes(c.id)),
    [availableCharacters, scene.selectedCharacterIds]
  );

  // 切换角色出场状态（使用函数式更新避免闭包问题）
  const toggleCharacterActive = useCallback((characterId: string) => {
    // 直接从 scene prop 读取最新状态，避免闭包陈旧问题
    const currentIds = scene.selectedCharacterIds || [];
    const newIds = currentIds.includes(characterId)
      ? currentIds.filter(id => id !== characterId)
      : [...currentIds, characterId];
    onUpdateScene({ selectedCharacterIds: newIds });
  }, [scene, onUpdateScene]);

  const handleGenerateImage = useCallback(async () => {
    const prompt = scene.imagePrompt || scene.prompt;
    if (!prompt.trim()) {
      message.warning('请先生成图片提示词或输入分镜描述');
      return;
    }

    try {
      console.log('[SceneCard] 开始生成图片，设置imageStatus=generating');
      onUpdateScene({ imageStatus: 'generating' });

      // 使用 ref 获取最新的角色数据，确保角色库更新后能获取最新的参考图
      const latestCharacters = charactersRef.current;
      const latestAvailableCharacters = (sceneRef.current.availableCharacterIds || [])
        .map(id => latestCharacters.find(c => c.id === id))
        .filter((c): c is Character => c !== undefined);
      const latestSelectedCharacters = latestAvailableCharacters.filter(c => 
        sceneRef.current.selectedCharacterIds?.includes(c.id)
      );

      // 将模板内容与分镜内容暗中组合为最终 prompt
      let combinedPrompt = scene.imagePrompt || scene.prompt;
      if (imageTemplate?.positive_prompt) {
        combinedPrompt = [imageTemplate.positive_prompt, combinedPrompt].filter(Boolean).join('\n');
      }
      const sceneWithPrompt = { ...scene, prompt: combinedPrompt };
      const imageUrl = await aiService.generateImage(sceneWithPrompt, latestSelectedCharacters.length > 0 ? latestSelectedCharacters : undefined, {
        style: selectedStyle,
        generationMode,
        gridMode
      });
      
      // 预加载图片到浏览器缓存，带进度回调（使用本地状态避免页面刷新）
      console.log('[SceneCard] 开始预加载图片');
      setLocalImageLoadingProgress(0);
      await preloadImage(imageUrl, (progress) => {
        console.log('[SceneCard] 下载进度:', progress);
        setLocalImageLoadingProgress(progress);
      });
      console.log('[SceneCard] 图片预加载完成');
      setLocalImageLoadingProgress(0); // 重置
      
      // 注意：为避免内存溢出，保存远程 URL 而不是 Base64
      // 用户可以通过"保存到本地"按钮手动下载图片
      const finalImageUrl = imageUrl;
      
      // 创建新的图片任务记录
      const newImageTask: GenerationTask = {
        id: crypto.randomUUID(),
        type: 'image',
        status: 'completed',
        progress: 100,
        createdAt: new Date(),
        completedAt: new Date(),
        resultUrl: finalImageUrl
      };
      
      // 将新图片添加到历史记录（使用函数式更新，确保并发安全）
      onUpdateScene(prevScene => ({
        images: { ...prevScene.images, keyFrame: finalImageUrl },
        imageTasks: [...(prevScene.imageTasks || []), newImageTask],
        imageStatus: 'completed'
      }));
      
      message.success('图像生成成功');
    } catch (error) {
      message.error('图像生成失败，请检查API配置');
      console.error(error);
      onUpdateScene({ imageStatus: 'pending' });
    }
  }, [scene, selectedStyle, generationMode, gridMode, onUpdateScene]); // 移除 selectedCharacters 依赖，使用 ref 获取最新数据

  // 创建新的视频生成任务
  const createVideoTask = useCallback((): GenerationTask => ({
    id: crypto.randomUUID(),
    type: 'video',
    status: 'pending',
    progress: 0,
    createdAt: new Date(),
  }), []);

  // 更新视频任务状态（使用函数式更新，确保基于最新状态）
  const updateVideoTask = useCallback((taskId: string, updates: Partial<GenerationTask>) => {
    onUpdateScene(prevScene => {
      const currentTasks = prevScene.videoTasks || [];
      const updatedTasks = currentTasks.map(task => 
        task.id === taskId ? { ...task, ...updates } : task
      );
      return { videoTasks: updatedTasks };
    });
  }, [onUpdateScene]);

  // 获取正在进行的视频任务数量（使用 useMemo 避免每次渲染重新计算）
  const processingVideoTasks = useMemo(() => 
    (scene.videoTasks || []).filter(t => t.status === 'processing'),
    [scene.videoTasks]
  );

  // 清空所有视频任务
  const clearAllVideoTasks = useCallback(() => {
    // 清除所有定时器
    videoCheckTimersRef.current.forEach(timer => clearTimeout(timer));
    videoCheckTimersRef.current.clear();
    // 清除轮询状态
    videoPollCountRef.current.clear();
    videoPollStartTimeRef.current.clear();
    videoConsecutiveErrorsRef.current.clear();
    // 清空任务列表和视频列表
    onUpdateScene({ videoTasks: [], videos: [], videoStatus: 'pending' });
    message.success('已清空所有视频任务');
  }, [onUpdateScene]);

  // 清空所有图片任务（使用函数式更新，确保并发安全）
  const clearAllImageTasks = useCallback(() => {
    onUpdateScene(prevScene => ({ 
      imageTasks: [], 
      images: { ...prevScene.images, keyFrame: undefined } 
    }));
    message.success('已清空所有图片任务');
  }, [onUpdateScene]);

  // 清空当前显示的图片（不清空历史任务）
  const clearCurrentImage = useCallback(() => {
    onUpdateScene(prevScene => ({ 
      images: { ...prevScene.images, keyFrame: undefined } 
    }));
    message.success('已清空当前图片');
  }, [onUpdateScene]);

  // 自定义上传图片
  const handleUploadImage = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const base64 = e.target?.result as string;
      // 创建新的图片任务记录
      const newImageTask: GenerationTask = {
        id: crypto.randomUUID(),
        type: 'image',
        status: 'completed',
        progress: 100,
        createdAt: new Date(),
        completedAt: new Date(),
        resultUrl: base64
      };
      // 更新场景图片（同时设置 keyFrame 显示和 storyboard 作为 AI 生成参考）
      onUpdateScene(prevScene => ({
        images: { ...prevScene.images, keyFrame: base64, storyboard: base64 },
        imageTasks: [...(prevScene.imageTasks || []), newImageTask]
      }));
      message.success('图片上传成功');
    };
    reader.readAsDataURL(file);
    return false; // 阻止默认上传行为
  }, [onUpdateScene]);

  // 处理文件输入变化（用于点击空预览框上传）
  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleUploadImage(file);
    }
    // 重置 input 以便可以再次选择同一文件
    e.target.value = '';
  }, [handleUploadImage]);

  // 点击图片预览框
  const handleImagePreviewClick = useCallback(() => {
    if (scene.images.keyFrame) {
      // 有图片时打开预览弹窗
      setPreviewVisible(true);
    } else if (!generatingImage) {
      // 无图片且未在生成中时，触发上传
      fileInputRef.current?.click();
    }
  }, [scene.images.keyFrame, generatingImage]);

  // 删除单个图片任务（使用函数式更新，确保并发安全）
  const deleteImageTask = useCallback((taskId: string) => {
    onUpdateScene(prevScene => {
      const latestTasks = prevScene.imageTasks || [];
      const taskToDelete = latestTasks.find(t => t.id === taskId);
      const updatedTasks = latestTasks.filter(t => t.id !== taskId);
      
      // 如果删除的是当前显示的图片，切换到上一张或清空
      let newKeyFrame = prevScene.images.keyFrame;
      if (taskToDelete?.resultUrl === newKeyFrame) {
        const remainingCompleted = updatedTasks.filter(t => t.status === 'completed' && t.resultUrl);
        newKeyFrame = remainingCompleted.length > 0 ? remainingCompleted[remainingCompleted.length - 1].resultUrl : undefined;
      }
      
      return { 
        imageTasks: updatedTasks,
        images: { ...prevScene.images, keyFrame: newKeyFrame }
      };
    });
    message.success('已删除图片');
  }, [onUpdateScene]);

  // 删除单个视频任务
  const deleteVideoTask = useCallback((taskId: string) => {
    const latestTasks = sceneRef.current.videoTasks || [];
    const taskToDelete = latestTasks.find(t => t.id === taskId);
    
    // 如果任务正在进行中，清除其定时器
    if (taskToDelete?.status === 'processing') {
      const timer = videoCheckTimersRef.current.get(taskId);
      if (timer) {
        clearTimeout(timer);
        videoCheckTimersRef.current.delete(taskId);
      }
      // 清理轮询状态
      videoPollCountRef.current.delete(taskId);
      videoPollStartTimeRef.current.delete(taskId);
      videoConsecutiveErrorsRef.current.delete(taskId);
    }
    
    // 从任务列表中移除
    const updatedTasks = latestTasks.filter(t => t.id !== taskId);
    
    // 如果任务有结果URL，也从videos列表中移除
    let updatedVideos = sceneRef.current.videos || [];
    if (taskToDelete?.resultUrl) {
      updatedVideos = updatedVideos.filter(v => v !== taskToDelete.resultUrl);
    }
    
    const remainingProcessing = updatedTasks.filter(t => t.status === 'processing').length;
    onUpdateScene({ 
      videoTasks: updatedTasks, 
      videos: updatedVideos,
      videoStatus: remainingProcessing > 0 ? 'generating' : (updatedVideos.length > 0 ? 'completed' : 'pending')
    });
    message.success('已删除任务');
  }, [onUpdateScene]);

  // 手动刷新所有未完成的视频任务状态
  const [refreshing, setRefreshing] = useState(false);
  const refreshProcessingTasks = useCallback(async () => {
    const latestTasks = sceneRef.current.videoTasks || [];
    // 刷新所有有taskId且未完成的任务（pending、processing状态，或进度未达100%）
    const pendingTasks = latestTasks.filter(t => 
      t.taskId && (t.status === 'processing' || t.status === 'pending' || (t.progress !== undefined && t.progress < 100))
    );
    
    if (pendingTasks.length === 0) {
      message.info('没有需要刷新的任务');
      return;
    }
    
    setRefreshing(true);
    message.loading({ content: '正在刷新任务状态...', key: 'refresh' });
    
    try {
      // 使用 Promise.all 并行请求所有任务状态
      const statusResults = await Promise.all(
        pendingTasks.map(async (task) => {
          if (!task.taskId) return { task, status: null, error: null };
          try {
            const status = await aiService.checkVideoStatus(task.taskId, task.isVeoTask);
            return { task, status, error: null };
          } catch (err) {
            console.error(`刷新任务 ${task.id} 状态失败:`, err);
            return { task, status: null, error: err };
          }
        })
      );
      
      let updatedTasks = [...latestTasks];
      let updatedVideos = [...(sceneRef.current.videos || [])];
      let hasUpdate = false;
      
      for (const { task, status } of statusResults) {
        if (!status) continue;
        
        if (status.status === 'completed' && status.videoUrl) {
          // 任务已完成
          updatedTasks = updatedTasks.map(t => 
            t.id === task.id ? { 
              ...t, 
              status: 'completed' as const, 
              progress: 100,
              resultUrl: status.videoUrl,
              completedAt: new Date()
            } : t
          );
          if (!updatedVideos.includes(status.videoUrl)) {
            updatedVideos.push(status.videoUrl);
          }
          // 清除该任务的轮询定时器和轮询状态
          const timer = videoCheckTimersRef.current.get(task.id);
          if (timer) {
            clearTimeout(timer);
            videoCheckTimersRef.current.delete(task.id);
          }
          videoPollCountRef.current.delete(task.id);
          videoPollStartTimeRef.current.delete(task.id);
          videoConsecutiveErrorsRef.current.delete(task.id);
          hasUpdate = true;
        } else if (status.status === 'failed') {
          // 任务失败
          updatedTasks = updatedTasks.map(t =>
            t.id === task.id ? {
              ...t,
              status: 'failed' as const,
              error: status.failReason || '视频生成失败',
              completedAt: new Date()
            } : t
          );
          // 清除该任务的轮询定时器和轮询状态
          const timer = videoCheckTimersRef.current.get(task.id);
          if (timer) {
            clearTimeout(timer);
            videoCheckTimersRef.current.delete(task.id);
          }
          videoPollCountRef.current.delete(task.id);
          videoPollStartTimeRef.current.delete(task.id);
          videoConsecutiveErrorsRef.current.delete(task.id);
          hasUpdate = true;
        } else if (status.progress !== undefined && status.progress !== null) {
          // 更新进度，支持数字和字符串格式
          let newProgress = 0;
          if (typeof status.progress === 'number') {
            newProgress = status.progress;
          } else if (typeof status.progress === 'string') {
            const progressMatch = status.progress.match(/(\d+)/);
            if (progressMatch) {
              newProgress = parseInt(progressMatch[1], 10);
            }
          }
          if (newProgress >= 0) {
            updatedTasks = updatedTasks.map(t => 
              t.id === task.id ? { ...t, progress: newProgress } : t
            );
            hasUpdate = true;
          }
        }
      }
      
      if (hasUpdate) {
        const remainingProcessing = updatedTasks.filter(t => t.status === 'processing').length;
        onUpdateScene({
          videoTasks: updatedTasks,
          videos: updatedVideos,
          videoStatus: remainingProcessing > 0 ? 'generating' : (updatedVideos.length > 0 ? 'completed' : 'pending')
        });
        message.success({ content: '任务状态已刷新', key: 'refresh' });
      } else {
        message.info({ content: '任务状态无变化', key: 'refresh' });
      }
    } catch (error) {
      console.error('刷新任务状态失败:', error);
      message.error({ content: '刷新失败，请重试', key: 'refresh' });
    } finally {
      setRefreshing(false);
    }
  }, [onUpdateScene]);

  const handleGenerateVideo = useCallback(async () => {
    const videoPrompt = scene.videoPrompt || scene.prompt;

    if (!videoPrompt.trim()) {
      message.warning('请先生成视频提示词或输入分镜描述');
      return;
    }

    // 创建新任务（使用函数式更新，确保基于最新状态添加任务）
    const newTask = createVideoTask();
    onUpdateScene(prevScene => ({
      videoTasks: [...(prevScene.videoTasks || []), { ...newTask, status: 'processing' }],
      videoStatus: 'generating' 
    }));

    try {
      // 保留原始 prompt 用于风格格式化，videoPrompt 作为实际发送的提示词
      const sceneWithPrompt = { ...scene, prompt: videoPrompt, _originalPrompt: scene.prompt };
      // 传递出场角色，确保音色提示词被发送给视频模型
      const result = await aiService.generateVideo(sceneWithPrompt, selectedCharacters.length > 0 ? selectedCharacters : undefined, {
        style: selectedStyle,
        generationMode,
        duration: '10'
      });
      
      // 更新任务的API taskId，同时记录是否为 Veo 任务（决定查询端点）
      updateVideoTask(newTask.id, { taskId: result.taskId, isVeoTask: result.isVeoTask });

      // 记录轮询开始时间和初始化计数
      videoPollStartTimeRef.current.set(newTask.id, Date.now());
      videoPollCountRef.current.set(newTask.id, 0);
      videoConsecutiveErrorsRef.current.set(newTask.id, 0);

      const checkStatus = async () => {
        // 检查轮询上限
        const pollCount = videoPollCountRef.current.get(newTask.id) || 0;
        const startTime = videoPollStartTimeRef.current.get(newTask.id) || Date.now();
        const elapsed = Date.now() - startTime;
        const consecutiveErrors = videoConsecutiveErrorsRef.current.get(newTask.id) || 0;

        // 超过最大轮询次数 → 标记失败
        if (pollCount >= MAX_POLL_COUNT) {
          onUpdateScene(prevScene => {
            const latestTasks = prevScene.videoTasks || [];
            const updatedTasks = latestTasks.map(task =>
              task.id === newTask.id ? { ...task, status: 'failed' as const, error: '视频生成超时（超过最大轮询次数）', completedAt: new Date() } : task
            );
            const remainingProcessing = updatedTasks.filter(t => t.status === 'processing').length;
            return { videoTasks: updatedTasks, videoStatus: remainingProcessing === 0 ? 'pending' : 'generating' };
          });
          message.error('视频生成超时，请重试');
          cleanPollState(newTask.id);
          return;
        }

        // 超过最大轮询时间 → 标记失败
        if (elapsed >= MAX_POLL_TIME) {
          onUpdateScene(prevScene => {
            const latestTasks = prevScene.videoTasks || [];
            const updatedTasks = latestTasks.map(task =>
              task.id === newTask.id ? { ...task, status: 'failed' as const, error: '视频生成超时（超过10分钟）', completedAt: new Date() } : task
            );
            const remainingProcessing = updatedTasks.filter(t => t.status === 'processing').length;
            return { videoTasks: updatedTasks, videoStatus: remainingProcessing === 0 ? 'pending' : 'generating' };
          });
          message.error('视频生成超时，请重试');
          cleanPollState(newTask.id);
          return;
        }

        // 连续网络错误过多 → 标记失败
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          onUpdateScene(prevScene => {
            const latestTasks = prevScene.videoTasks || [];
            const updatedTasks = latestTasks.map(task =>
              task.id === newTask.id ? { ...task, status: 'failed' as const, error: '网络连接失败，请检查网络', completedAt: new Date() } : task
            );
            const remainingProcessing = updatedTasks.filter(t => t.status === 'processing').length;
            return { videoTasks: updatedTasks, videoStatus: remainingProcessing === 0 ? 'pending' : 'generating' };
          });
          message.error('网络连接失败，视频状态检查中断');
          cleanPollState(newTask.id);
          return;
        }

        videoPollCountRef.current.set(newTask.id, pollCount + 1);

        try {
          const status = await aiService.checkVideoStatus(result.taskId, result.isVeoTask);
          // 重置连续错误计数（成功获取状态）
          videoConsecutiveErrorsRef.current.set(newTask.id, 0);

          if (status.status === 'completed' && status.videoUrl) {
            // 保存视频到本地存储
            const mediaKey = `video_${sceneRef.current.id}_${newTask.id}`;
            saveUrlAsBlob(status.videoUrl, mediaKey).catch(err => {
              console.warn('保存视频到本地失败:', err);
            });

            // 使用函数式更新，确保基于最新状态
            onUpdateScene(prevScene => {
              const latestTasks = prevScene.videoTasks || [];
              const latestVideos = prevScene.videos || [];
              const updatedTasks = latestTasks.map(task =>
                task.id === newTask.id ? {
                  ...task,
                  status: 'completed' as const,
                  progress: 100,
                  resultUrl: status.videoUrl,
                  completedAt: new Date()
                } : task
              );
              const remainingProcessing = updatedTasks.filter(t => t.status === 'processing').length;

              return {
                videoTasks: updatedTasks,
                videos: [...latestVideos, status.videoUrl as string],
                videoStatus: remainingProcessing === 0 ? 'completed' : 'generating'
              };
            });
            message.success('视频生成成功');
            cleanPollState(newTask.id);
          } else if (status.status === 'failed') {
            // 使用函数式更新，确保基于最新状态
            onUpdateScene(prevScene => {
              const latestTasks = prevScene.videoTasks || [];
              const updatedTasks = latestTasks.map(task =>
                task.id === newTask.id ? {
                  ...task,
                  status: 'failed' as const,
                  error: status.failReason || '视频生成失败',
                  completedAt: new Date()
                } : task
              );
              const remainingProcessing = updatedTasks.filter(t => t.status === 'processing').length;

              return {
                videoTasks: updatedTasks,
                videoStatus: remainingProcessing === 0 ? 'pending' : 'generating'
              };
            });
            message.error(status.failReason || '视频生成失败');
            cleanPollState(newTask.id);
          } else {
            // 解析API返回的进度，支持多种格式
            let newProgress = 0;
            if (status.progress !== undefined && status.progress !== null) {
              if (typeof status.progress === 'number') {
                newProgress = status.progress;
              } else if (typeof status.progress === 'string') {
                const progressMatch = status.progress.match(/(\d+)/);
                if (progressMatch) {
                  newProgress = parseInt(progressMatch[1], 10);
                }
              }
            }
            // 只在进度增加时更新本地状态（不更新 project，避免页面刷新）
            if (newProgress > 0) {
              setLocalProgress(prev => {
                if (newProgress <= (prev[newTask.id] || 0)) return prev;
                return { ...prev, [newTask.id]: newProgress };
              });
            }
            const timer = setTimeout(checkStatus, POLL_INTERVAL);
            videoCheckTimersRef.current.set(newTask.id, timer);
          }
        } catch (err) {
          console.error('检查视频状态失败:', err);
          // 累积连续错误计数
          videoConsecutiveErrorsRef.current.set(newTask.id, consecutiveErrors + 1);
          const timer = setTimeout(checkStatus, POLL_INTERVAL);
          videoCheckTimersRef.current.set(newTask.id, timer);
        }
      };

      // 清除轮询状态的辅助函数
      const cleanPollState = (taskId: string) => {
        videoCheckTimersRef.current.delete(taskId);
        videoPollCountRef.current.delete(taskId);
        videoPollStartTimeRef.current.delete(taskId);
        videoConsecutiveErrorsRef.current.delete(taskId);
      };
      
      checkStatus();
    } catch (error) {
      // 使用函数式更新，确保基于最新状态
      onUpdateScene(prevScene => {
        const latestTasks = prevScene.videoTasks || [];
        const updatedTasks = latestTasks.map(task => 
          task.id === newTask.id ? { 
            ...task, 
            status: 'failed' as const, 
            error: '视频生成失败，请检查API配置',
            completedAt: new Date()
          } : task
        );
        const remainingProcessing = updatedTasks.filter(t => t.status === 'processing').length;
        
        return { 
          videoTasks: updatedTasks,
          videoStatus: remainingProcessing > 0 ? 'generating' : 'pending'
        };
      });
      message.error('视频生成失败，请检查API配置');
      console.error(error);
    }
  }, [scene.videoPrompt, scene.prompt, scene.useImageAsReference, scene.images.keyFrame, selectedCharacters, selectedStyle, generationMode, onUpdateScene, createVideoTask]);

  // 获取前一个分镜的末尾提示词（用于镜头衔接）
  const getPreviousSceneLastPrompt = useCallback((): string | undefined => {
    if (index === 0) return undefined; // 第一个分镜没有前一个分镜
    
    const prevScene = allScenes[index - 1];
    if (!prevScene) return undefined;
    
    // 从前一个分镜的图片提示词中提取最后一个sc的内容
    const imagePrompt = prevScene.imagePrompt || '';
    // 匹配最后一个 scN: 开头的行
    const scMatches = imagePrompt.match(/sc\d+[：:].+/g);
    if (scMatches && scMatches.length > 0) {
      return scMatches[scMatches.length - 1]; // 返回最后一个sc
    }
    
    return undefined;
  }, [allScenes, index]);

  const handleInferPrompt = useCallback(async () => {
    try {
      setInferring(true);
      processingRef.current = true;
      const previousSceneLastPrompt = getPreviousSceneLastPrompt();

      // 流式回调：实时更新本地提示词状态 + ref
      const onChunk = (text: string) => {
        latestPromptRef.current = text;
        if (promptMode === 'image') {
          setLocalImagePrompt(text);
        } else {
          setLocalVideoPrompt(text);
        }
      };

      const activeTemplate = promptMode === 'image' ? imageTemplate : videoTemplate;

      // getValue() 为输入框实值（优先），sessionStorage 为备份（虚拟滚动恢复用）
      const currentInput = promptInputRef.current?.getValue()
        || sessionStorage.getItem(`input_${scene.id}_${promptMode}`)
        || latestPromptRef.current;
      const sceneWithLatestPrompt = {
        ...scene,
        imagePrompt: promptMode === 'image' && currentInput ? currentInput : scene.imagePrompt,
        videoPrompt: promptMode === 'video' && currentInput ? currentInput : scene.videoPrompt,
      };

      const prompt = await aiService.generatePrompt(
        sceneWithLatestPrompt,
        promptMode,
        gridMode,
        previousSceneLastPrompt,
        onChunk,
        undefined,
        undefined,
        activeTemplate
      );
      latestPromptRef.current = prompt;
      // 同步更新 sessionStorage，确保导演优化读到推理结果而非旧输入
      sessionStorage.setItem(`input_${scene.id}_${promptMode}`, prompt);
      if (promptMode === 'image') {
        onUpdateScene({ imagePrompt: prompt });
      } else {
        onUpdateScene({ videoPrompt: prompt });
      }
      const modeLabel = promptMode === 'image' ? '图片' : '视频';
      message.success(`${modeLabel}提示词生成成功`);
    } catch (error) {
      message.error('提示词生成失败，请检查API配置');
      console.error(error);
    } finally {
      setInferring(false);
      processingRef.current = false;
    }
  }, [scene, promptMode, gridMode, selectedStyle, allScenes, getPreviousSceneLastPrompt, onUpdateScene, imageTemplate, videoTemplate]);

  // AI 导演优化提示词（流式输出，双通道分流）
  const handleDirectorOptimize = useCallback(async () => {
    // getValue() 读取输入框实时值，sessionStorage 为备份（虚拟滚动恢复用）
    const currentPrompt = promptInputRef.current?.getValue()
      || (sessionStorage.getItem(`input_${scene.id}_${promptMode}`))
      || latestPromptRef.current
      || (promptMode === 'image' ? (scene.imagePrompt || '') : (scene.videoPrompt || ''));
    if (!currentPrompt.trim()) {
      message.warning('请先生成提示词，再进行AI导演优化');
      return;
    }
    try {
      setDirectorOptimizing(true);
      processingRef.current = true;
      setDirectorAnalysis('');
      setDirectorModalVisible(true);

      const result = await aiService.optimizePromptAsDirector(
        currentPrompt,
        promptMode,
        {
          sceneDescription: `分镜 ${index + 1}`,
        },
        // 分析通道 → 弹窗
        (analysisText) => setDirectorAnalysis(analysisText),
        // 优化后提示词通道 → 输入框
        (optimizedText) => {
          latestPromptRef.current = optimizedText;
          if (promptMode === 'image') {
            setLocalImagePrompt(optimizedText);
          } else {
            setLocalVideoPrompt(optimizedText);
          }
        },
        directorTemplate,
      );

      // 最终写入
      if (result.optimized) {
        latestPromptRef.current = result.optimized;
        if (promptMode === 'image') {
          setLocalImagePrompt(result.optimized);
          onUpdateScene({ imagePrompt: result.optimized });
        } else {
          setLocalVideoPrompt(result.optimized);
          onUpdateScene({ videoPrompt: result.optimized });
        }
      }
      message.success('AI导演优化完成');
    } catch {
      message.error('AI导演优化失败，请检查API配置');
      setDirectorModalVisible(false);
    } finally {
      setDirectorOptimizing(false);
      processingRef.current = false;
    }
  }, [promptMode, scene.imagePrompt, scene.videoPrompt, scene.actionDescription, scene.dialogue, scene.character, scene.description, index, onUpdateScene, directorTemplate]);

  // 判断输入框是否有任意内容（含用户输入，不限定推理结果）
  const hasPromptContent = !!(
    sessionStorage.getItem(`input_${scene.id}_${promptMode}`)
    || (promptMode === 'image' ? (localImagePrompt || scene.imagePrompt) : (localVideoPrompt || scene.videoPrompt))
  );

  // 提示词输入已移至独立的 PromptInput 组件，内置防抖和本地状态管理

  // 处理参考选择变更
  const handleReferenceChange = useCallback((e: { target: { checked: boolean } }) => {
    onUpdateScene({ useImageAsReference: e.target.checked });
  }, [onUpdateScene]);

  // 组件挂载时恢复未完成任务的轮询，组件卸载时清理定时器
  useEffect(() => {
    // 恢复正在进行中的任务的轮询
    const processingTasks = (sceneRef.current.videoTasks || []).filter(
      t => t.status === 'processing' && t.taskId && !videoCheckTimersRef.current.has(t.id)
    );
    
    processingTasks.forEach(task => {
      // 初始化轮询状态（恢复时从头计数）
      if (!videoPollStartTimeRef.current.has(task.id)) {
        videoPollStartTimeRef.current.set(task.id, Date.now());
      }
      if (!videoPollCountRef.current.has(task.id)) {
        videoPollCountRef.current.set(task.id, 0);
      }
      if (!videoConsecutiveErrorsRef.current.has(task.id)) {
        videoConsecutiveErrorsRef.current.set(task.id, 0);
      }

      const resumeCheckStatus = async () => {
        // 检查轮询上限
        const pollCount = videoPollCountRef.current.get(task.id) || 0;
        const startTime = videoPollStartTimeRef.current.get(task.id) || Date.now();
        const elapsed = Date.now() - startTime;
        const consecutiveErrors = videoConsecutiveErrorsRef.current.get(task.id) || 0;

        if (pollCount >= MAX_POLL_COUNT || elapsed >= MAX_POLL_TIME) {
          onUpdateSceneRef.current(prevScene => {
            const latestTasks = prevScene.videoTasks || [];
            const updatedTasks = latestTasks.map(t =>
              t.id === task.id ? { ...t, status: 'failed' as const, error: '视频生成超时', completedAt: new Date() } : t
            );
            const remainingProcessing = updatedTasks.filter(t => t.status === 'processing').length;
            return { videoTasks: updatedTasks, videoStatus: remainingProcessing === 0 ? 'pending' : 'generating' };
          });
          cleanResumePollState(task.id);
          return;
        }

        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          onUpdateSceneRef.current(prevScene => {
            const latestTasks = prevScene.videoTasks || [];
            const updatedTasks = latestTasks.map(t =>
              t.id === task.id ? { ...t, status: 'failed' as const, error: '网络连接失败', completedAt: new Date() } : t
            );
            const remainingProcessing = updatedTasks.filter(t => t.status === 'processing').length;
            return { videoTasks: updatedTasks, videoStatus: remainingProcessing === 0 ? 'pending' : 'generating' };
          });
          cleanResumePollState(task.id);
          return;
        }

        videoPollCountRef.current.set(task.id, pollCount + 1);

        try {
          const status = await aiService.checkVideoStatus(task.taskId!, task.isVeoTask);
          videoConsecutiveErrorsRef.current.set(task.id, 0);

          if (status.status === 'completed' && status.videoUrl) {
            const mediaKey = `video_${sceneRef.current.id}_${task.id}`;
            saveUrlAsBlob(status.videoUrl, mediaKey).catch(err => {
              console.warn('保存视频到本地失败:', err);
            });

            onUpdateSceneRef.current(prevScene => {
              const latestTasks = prevScene.videoTasks || [];
              const latestVideos = prevScene.videos || [];
              const updatedTasks = latestTasks.map(t =>
                t.id === task.id ? {
                  ...t,
                  status: 'completed' as const,
                  progress: 100,
                  resultUrl: status.videoUrl,
                  completedAt: new Date()
                } : t
              );
              const remainingProcessing = updatedTasks.filter(t => t.status === 'processing').length;
              return {
                videoTasks: updatedTasks,
                videos: [...latestVideos, status.videoUrl as string],
                videoStatus: remainingProcessing === 0 ? 'completed' : 'generating'
              };
            });
            message.success('视频生成成功');
            cleanResumePollState(task.id);
          } else if (status.status === 'failed') {
            onUpdateSceneRef.current(prevScene => {
              const latestTasks = prevScene.videoTasks || [];
              const updatedTasks = latestTasks.map(t =>
                t.id === task.id ? {
                  ...t,
                  status: 'failed' as const,
                  error: status.failReason || '视频生成失败',
                  completedAt: new Date()
                } : t
              );
              const remainingProcessing = updatedTasks.filter(t => t.status === 'processing').length;
              return {
                videoTasks: updatedTasks,
                videoStatus: remainingProcessing === 0 ? 'pending' : 'generating'
              };
            });
            message.error(status.failReason || '视频生成失败');
            cleanResumePollState(task.id);
          } else {
            let newProgress = 0;
            if (status.progress !== undefined && status.progress !== null) {
              if (typeof status.progress === 'number') {
                newProgress = status.progress;
              } else if (typeof status.progress === 'string') {
                const progressMatch = status.progress.match(/(\d+)/);
                if (progressMatch) {
                  newProgress = parseInt(progressMatch[1], 10);
                }
              }
            }
            if (newProgress > 0) {
              setLocalProgress(prev => {
                if (newProgress <= (prev[task.id] || 0)) return prev;
                return { ...prev, [task.id]: newProgress };
              });
            }
            const timer = setTimeout(resumeCheckStatus, POLL_INTERVAL);
            videoCheckTimersRef.current.set(task.id, timer);
          }
        } catch (err) {
          console.error('恢复轮询时检查视频状态失败:', err);
          videoConsecutiveErrorsRef.current.set(task.id, consecutiveErrors + 1);
          const timer = setTimeout(resumeCheckStatus, POLL_INTERVAL);
          videoCheckTimersRef.current.set(task.id, timer);
        }
      };

      const cleanResumePollState = (taskId: string) => {
        videoCheckTimersRef.current.delete(taskId);
        videoPollCountRef.current.delete(taskId);
        videoPollStartTimeRef.current.delete(taskId);
        videoConsecutiveErrorsRef.current.delete(taskId);
      };

      // 启动恢复轮询
      resumeCheckStatus();
    });
    
    return () => {
      if (videoCheckTimerRef.current) {
        clearTimeout(videoCheckTimerRef.current);
        videoCheckTimerRef.current = null;
      }
      // 清理所有并发任务的定时器
      videoCheckTimersRef.current.forEach(timer => clearTimeout(timer));
      videoCheckTimersRef.current.clear();
      // 清理轮询状态记录
      videoPollCountRef.current.clear();
      videoPollStartTimeRef.current.clear();
      videoConsecutiveErrorsRef.current.clear();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);  // 空依赖：只在组件挂载/卸载时执行，避免 onUpdateScene 变化导致定时器被清除

  // 点击视频预览框（只有有内容时才打开预览）
  const handleVideoPreviewClick = useCallback((idx: number, itemType: string) => {
    // 修复 #6: 空位置不触发预览弹窗
    if (itemType === 'empty') return;
    setSelectedVideoIndex(idx);
    setVideoPreviewVisible(true);
  }, []);
 
  // 下载视频到本地
  // videoIndex: 视频在当前分镜中的序号（0开始）
  const handleDownloadVideo = useCallback(async (videoUrl: string, videoIndex: number) => {
    try {
      message.loading({ content: '正在下载视频...', key: 'download' });
      
      // 下载视频
      const response = await fetch(videoUrl);
      const blob = await response.blob();
      // 修复 #11: 文件名添加时间戳，避免重复下载覆盖
      // 格式：分镜号.视频序号_YYYYMMDD_HHmmss.mp4（如 1.1_20260125_1640.mp4）
      const sceneNum = index + 1;
      const videoNum = videoIndex + 1;
      const now = new Date();
      const timestamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
      const fileName = `${sceneNum}.${videoNum}_${timestamp}.mp4`;
      
      // 使用下载助手（自动处理自定义目录和回退逻辑）
      await downloadToDir(
        blob,
        fileName,
        (path) => message.success({ content: `视频已保存: ${fileName}`, key: 'download' }),
        () => message.success({ content: `视频下载成功: ${fileName}`, key: 'download' })
      );
    } catch (err) {
      console.error('下载视频失败:', err);
      message.error({ content: '下载失败，请重试', key: 'download' });
    }
  }, [index]);

  // 准备4个预览框的数据，统一从 videoTasks 获取，确保与历史弹窗同步
  type PreviewItem = { type: 'video' | 'generating' | 'empty'; url: string; index: number; task?: GenerationTask };
  const previewItems = useMemo<PreviewItem[]>(() => {
    const items: PreviewItem[] = [];
    
    // 从 videoTasks 获取已完成的视频（按创建时间排序，最新的在前）
    const completedTasks = (scene.videoTasks || [])
      .filter(t => t.status === 'completed' && t.resultUrl)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    
    completedTasks.forEach((task, i) => {
      if (items.length < 4) {
        items.push({ type: 'video', url: task.resultUrl!, index: i, task });
      }
    });
    
    // 添加正在生成的任务
    processingVideoTasks.forEach((task) => {
      if (items.length < 4) {
        items.push({ type: 'generating', url: '', index: items.length, task });
      }
    });
    
    // 填充空位
    while (items.length < 4) {
      items.push({ type: 'empty', url: '', index: items.length });
    }
    
    return items;
  }, [scene.videoTasks, processingVideoTasks]);

  return (
    <div className={styles.sceneCard}>
        {/* 顶部标题栏 */}
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <DragOutlined className={styles.dragHandle} />
            <span className={styles.sceneTitle}>分镜_{index + 1}</span>
          </div>
          <div className={styles.headerRight}>
            <Button
              icon={<ThunderboltOutlined />}
              className={styles.inferBtn}
              onClick={handleInferPrompt}
              loading={inferring}
            >
              推理
            </Button>
            <Button
              icon={<VideoCameraOutlined />}
              className={styles.directorBtn}
              onClick={handleDirectorOptimize}
              loading={directorOptimizing}
              title="AI导演优化"
            >
              导演优化
            </Button>
            <Button
              icon={<ExpandOutlined />}
              className={styles.analysisBtn}
              onClick={() => setDirectorModalVisible(true)}
              title="查看AI导演分析报告"
            >
              分析报告
            </Button>
            <Button icon={<PlusOutlined />} className={styles.actionBtn} onClick={onInsertScene}>插入</Button>
            <Button icon={<DeleteOutlined />} className={styles.actionBtn} onClick={onDeleteScene}>删除</Button>
          </div>
        </div>

        {/* 参考选择行 + 角色卡片 */}
        <div className={styles.referenceRow}>
          <Checkbox 
            className={styles.checkbox}
            checked={scene.useImageAsReference || false}
            onChange={handleReferenceChange}
          />
          <span className={styles.refLabel}>参考</span>
          
          {/* 角色卡片列表 - 从左往右排列，点击切换出场状态 */}
          <div className={styles.characterCards}>
            {availableCharacters.map(char => {
              const isActive = scene.selectedCharacterIds?.includes(char.id);
              return (
                <div 
                  key={char.id} 
                  className={`${styles.characterMiniCard} ${isActive ? styles.characterActive : styles.characterInactive}`}
                  onClick={(e) => {
                    e.stopPropagation(); // 阻止事件冒泡
                    toggleCharacterActive(char.id);
                  }}
                  title={isActive ? '点击取消出场' : '点击设为出场'}
                >
                  {char.referenceImage ? (
                    <img src={char.referenceImage} alt={char.name} draggable={false} />
                  ) : (
                    <div className={styles.characterNoImage}>{char.name.charAt(0)}</div>
                  )}
                  <span className={styles.characterMiniName}>{char.name}</span>
                  {isActive && <span className={styles.activeTag}>出场</span>}
                </div>
              );
            })}
          </div>
        </div>

        {/* 主内容区：左图片 | 中输入 | 右4视频 */}
        <div className={styles.mainContent}>
          {/* 左侧：图片预览 */}
          <div className={styles.leftSection}>
            {/* 隐藏的文件输入框 */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={handleFileInputChange}
            />
            <div 
              className={`${styles.imagePreview} ${!scene.images.keyFrame && !generatingImage ? styles.imagePreviewClickable : ''}`}
              onClick={handleImagePreviewClick}
              style={{ cursor: generatingImage ? 'default' : 'pointer' }}
            >
              <Spin spinning={generatingImage} tip={localImageLoadingProgress > 0 ? `下载中 ${localImageLoadingProgress}%` : '生成图片中...'}>
                {scene.images.keyFrame ? (
                  <img 
                    key={scene.images.keyFrame} 
                    src={scene.images.keyFrame} 
                    alt={`分镜 ${index + 1}`} 
                  />
                ) : (
                  <div className={styles.placeholder}>
                    {generatingImage 
                      ? (localImageLoadingProgress > 0 ? `下载中 ${localImageLoadingProgress}%` : '生成中...') 
                      : (
                        <div className={styles.uploadHint}>
                          <PlusOutlined className={styles.uploadIcon} />
                          <span>点击上传图片</span>
                        </div>
                      )}
                  </div>
                )}
              </Spin>
            </div>
            <div className={styles.imageActions}>
              <Button
                type="primary"
                onClick={handleGenerateImage}
                loading={generatingImage}
                className={styles.generateBtn}
              >
                开始生成
              </Button>
              <Button className={styles.allTaskBtn} onClick={() => setImageTasksVisible(true)}>全部任务</Button>
            </div>
          </div>

          {/* 中间：输入区域 */}
          <div className={styles.centerSection}>
            <div className={styles.contentBlock}>
              <div className={styles.blockHeader}>
                <div className={styles.blockLabel}>分镜内容：</div>
                <div className={styles.promptModeCards}>
                  <div
                    className={`${styles.promptModeCard} ${promptMode === 'image' ? styles.promptModeCardActive : ''}`}
                    onClick={() => setPromptMode('image')}
                  >
                    图片提示词
                  </div>
                  <div
                    className={`${styles.promptModeCard} ${promptMode === 'video' ? styles.promptModeCardActive : ''}`}
                    onClick={() => setPromptMode('video')}
                  >
                    视频提示词
                  </div>
                </div>
            </div>
            <PromptInput
              ref={promptInputRef}
              key={`${promptMode}-default`}
              value={promptMode === 'image'
                ? (localImagePrompt || (scene.actionDescription || scene.dialogue ? `动作描述：${scene.actionDescription || ''}\n对话：\n${scene.dialogue || ''}` : ''))
                : (localVideoPrompt || (scene.actionDescription || scene.dialogue ? `动作描述：${scene.actionDescription || ''}\n对话：\n${scene.dialogue || ''}` : ''))}
              onSave={(text) => {
                // 推理/优化进行中时跳过，防止防抖保存覆盖 AI 生成内容
                if (processingRef.current) return;
                if (promptMode === 'image') {
                  setLocalImagePrompt(text);
                  onUpdateScene({ imagePrompt: text });
                } else {
                  setLocalVideoPrompt(text);
                  onUpdateScene({ videoPrompt: text });
                }
              }}
              onChange={(text) => {
                latestPromptRef.current = text;
                // 同步写入 sessionStorage，确保虚拟滚动卸载再挂载后输入不丢失
                sessionStorage.setItem(`input_${scene.id}_${promptMode}`, text);
              }}
              placeholder={promptMode === 'image'
                ? "图片提示词将在此显示，点击推理按钮生成..."
                : "视频提示词将在此显示，点击推理按钮生成..."}
              rows={6}
              className={styles.contentInput}
              debounceMs={800}
            />
            <Button
              type="text"
              size="small"
              icon={<ExpandOutlined />}
              onClick={() => setFullscreenOpen(true)}
              style={{ alignSelf: 'flex-end', marginTop: 4, color: 'var(--text-tertiary)', fontSize: 12 }}
            >
              放大编辑
            </Button>
          </div>
          </div>

          {/* 全屏放大编辑弹窗 */}
          <FullscreenPromptEditor
            open={fullscreenOpen}
            title={promptMode === 'image' ? '编辑图片提示词' : '编辑视频提示词'}
            value={promptMode === 'image'
              ? (localImagePrompt || (scene.actionDescription || scene.dialogue ? `动作描述：${scene.actionDescription || ''}\n对话：\n${scene.dialogue || ''}` : ''))
              : (localVideoPrompt || (scene.actionDescription || scene.dialogue ? `动作描述：${scene.actionDescription || ''}\n对话：\n${scene.dialogue || ''}` : ''))}
            placeholder={promptMode === 'image' ? '图片提示词将在此显示，点击推理按钮生成...' : '视频提示词将在此显示，点击推理按钮生成...'}
            onChange={(val) => {
              if (promptMode === 'image') {
                setLocalImagePrompt(val);
                onUpdateScene({ imagePrompt: val });
              } else {
                setLocalVideoPrompt(val);
                onUpdateScene({ videoPrompt: val });
              }
            }}
            onClose={() => setFullscreenOpen(false)}
          />

          {/* 右侧：4个视频预览 */}
          <div className={styles.rightSection}>
            <div className={styles.previewGrid}>
              {previewItems.map((item, idx) => (
                <div 
                  key={idx} 
                  className={styles.previewCard}
                  onClick={() => handleVideoPreviewClick(idx, item.type)}
                  style={{ cursor: item.type === 'empty' ? 'default' : 'pointer' }}
                >
                  {item.type === 'video' ? (
                    <LazyVideoThumbnail
                      src={item.url}
                      className={styles.previewMedia}
                      showPlayIcon={true}
                    />
                  ) : item.type === 'generating' ? (
                    <div className={styles.previewGenerating}>
                      <Spin size="small" />
                      <span>生成中 {(item.task?.id ? localProgress[item.task.id] : undefined) || item.task?.progress || 0}%</span>
                    </div>
                  ) : (
                    <div className={styles.previewEmpty}>待生成</div>
                  )}
                </div>
              ))}
            </div>

            <div className={styles.previewActions}>
              <Button
                type="primary"
                onClick={handleGenerateVideo}
                className={styles.generateBtn}
              >
                {processingVideoTasks.length > 0 ? `生成中(${processingVideoTasks.length})` : '开始生成'}
              </Button>
              <Button className={styles.allTaskBtn} onClick={() => setVideoTasksVisible(true)}>全部任务</Button>
            </div>
          </div>
        </div>

      {/* 图片任务历史弹窗 */}
      <Modal
        open={imageTasksVisible}
        title="图片生成历史"
        footer={null}
        onCancel={() => setImageTasksVisible(false)}
        width="70%"
        centered
        forceRender
        destroyOnClose={false}
        className={styles.tasksModal}
      >
        <div className={styles.tasksHeader}>
          <Button 
            danger 
            size="small" 
            onClick={() => {
              Modal.confirm({
                title: '确认清空',
                content: '确定要清空所有图片历史记录吗？此操作不可恢复。',
                okText: '确认清空',
                cancelText: '取消',
                okButtonProps: { danger: true },
                centered: true,
                className: styles.confirmModal,
                onOk: clearAllImageTasks
              });
            }}
            disabled={(scene.imageTasks || []).length === 0}
          >
            清空全部
          </Button>
        </div>
        <div className={styles.tasksContent}>
          {generatingImage && (
            <div className={styles.taskItem}>
              <Spin size="small" />
              <span className={styles.taskStatus}>正在生成图片...</span>
            </div>
          )}
          
          {/* 历史图片网格 */}
          {(scene.imageTasks && scene.imageTasks.length > 0) ? (
            <div className={styles.imageHistoryGrid}>
              {scene.imageTasks.filter(t => t.status === 'completed' && t.resultUrl).map((task, idx) => (
                <div 
                  key={task.id} 
                  className={`${styles.imageHistoryItem} ${scene.images.keyFrame === task.resultUrl ? styles.imageHistoryActive : ''}`}
                >
                  <div 
                    className={styles.imageHistoryContent}
                    onClick={() => {
                      // 点击切换当前显示的图片
                      onUpdateScene({ images: { ...scene.images, keyFrame: task.resultUrl } });
                      message.success(`已切换到图片 ${idx + 1}`);
                    }}
                  >
                    <LazyImage src={task.resultUrl!} alt={`历史图片 ${idx + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    <div className={styles.imageHistoryIndex}>{idx + 1}</div>
                    {scene.images.keyFrame === task.resultUrl && (
                      <div className={styles.imageHistoryCurrent}>当前</div>
                    )}
                  </div>
                  <Button 
                    type="text" 
                    danger 
                    size="small" 
                    className={styles.imageDeleteBtn}
                    onClick={(e) => {
                      e.stopPropagation();
                      Modal.confirm({
                        title: '确认删除',
                        content: '确定要删除这张图片吗？',
                        okText: '确认删除',
                        cancelText: '取消',
                        okButtonProps: { danger: true },
                        centered: true,
                        className: styles.confirmModal,
                        onOk: () => deleteImageTask(task.id)
                      });
                    }}
                  >
                    删除
                  </Button>
                </div>
              ))}
            </div>
          ) : !generatingImage && (
            <div className={styles.taskEmpty}>暂无图片生成历史</div>
          )}
          
          <div className={styles.imageHistoryHint}>
            点击图片可切换到预览框中显示，后续生成视频将使用预览框中的图片
          </div>
        </div>
      </Modal>

      {/* 视频任务进度弹窗（包含历史记录） */}
      <Modal
        open={videoTasksVisible}
        title="视频生成任务历史"
        footer={null}
        onCancel={() => setVideoTasksVisible(false)}
        width="55%"
        centered
        forceRender
        destroyOnClose={false}
        className={styles.tasksModal}
      >
        <div className={styles.tasksHeader}>
          <Button 
            danger 
            size="small" 
            onClick={() => {
              Modal.confirm({
                title: '确认清空',
                content: '确定要清空所有视频任务和历史记录吗？此操作不可恢复。',
                okText: '确认清空',
                cancelText: '取消',
                okButtonProps: { danger: true },
                centered: true,
                className: styles.confirmModal,
                onOk: clearAllVideoTasks
              });
            }}
            disabled={(scene.videoTasks || []).length === 0 && scene.videos.length === 0}
          >
            清空全部
          </Button>
        </div>
        <div className={styles.tasksContent}>
          {(scene.videoTasks || []).length > 0 ? (
            (scene.videoTasks || []).map((task, idx) => (
              <div key={task.id} className={styles.taskItem}>
                {task.status === 'processing' ? (
                  <>
                    <div className={styles.taskProgressWrapper}>
                      <Progress percent={localProgress[task.id] || task.progress || 0} size="small" status="active" />
                    </div>
                    <span className={styles.taskStatus}>生成中...</span>
                  </>
                ) : task.status === 'completed' && task.resultUrl ? (
                  <>
                    <LazyVideoThumbnail src={task.resultUrl} className={styles.taskThumb} showPlayIcon={false} />
                    <span className={styles.taskStatus}>生成完成</span>
                    <span className={styles.taskTime}>{new Date(task.completedAt || task.createdAt).toLocaleString()}</span>
                  </>
                ) : task.status === 'failed' ? (
                  <>
                    <div className={styles.taskFailed}>失败</div>
                    <span className={styles.taskStatus}>{task.error || '生成失败'}</span>
                    <span className={styles.taskTime}>{new Date(task.completedAt || task.createdAt).toLocaleString()}</span>
                  </>
                ) : (
                  <>
                    <Spin size="small" />
                    <span className={styles.taskStatus}>等待中...</span>
                  </>
                )}
                <Button 
                  type="text" 
                  danger 
                  size="small" 
                  className={styles.taskDeleteBtn}
                  onClick={() => {
                    Modal.confirm({
                      title: '确认删除',
                      content: '确定要删除这个视频任务吗？',
                      okText: '确认删除',
                      cancelText: '取消',
                      okButtonProps: { danger: true },
                      centered: true,
                      className: styles.confirmModal,
                      onOk: () => deleteVideoTask(task.id)
                    });
                  }}
                >
                  删除
                </Button>
              </div>
            ))
          ) : scene.videos.length > 0 ? (
            scene.videos.map((videoUrl, idx) => (
              <div key={idx} className={styles.taskItem}>
                <LazyVideoThumbnail src={videoUrl} className={styles.taskThumb} showPlayIcon={false} />
                <span className={styles.taskStatus}>生成完成</span>
              </div>
            ))
          ) : (
            <div className={styles.taskEmpty}>暂无视频生成任务</div>
          )}
        </div>
      </Modal>

      {/* 图片预览弹窗 - 优化美化版 */}
      <Modal
        open={previewVisible}
        footer={null}
        onCancel={() => setPreviewVisible(false)}
        width="80%"
        centered
        forceRender
        destroyOnClose={false}
        className={styles.previewModal}
        title={
          <div className={styles.previewModalHeader}>
            <span>分镜 {index + 1} - 图片预览</span>
            <div className={styles.previewModalActions}>
              <Upload
                accept="image/*"
                showUploadList={false}
                beforeUpload={handleUploadImage}
              >
                <Button 
                  icon={<UploadOutlined />} 
                  className={styles.previewUploadBtn}
                >
                  上传图片
                </Button>
              </Upload>
              <Button 
                type="primary"
                icon={<DownloadOutlined />}
                onClick={async () => {
                  if (scene.images.keyFrame) {
                    try {
                      await saveImageToLocalFile(scene.images.keyFrame, `分镜${index + 1}_${Date.now()}`);
                      message.success('图片已保存到本地');
                    } catch (err) {
                      message.error('保存失败');
                      console.error(err);
                    }
                  }
                }}
                disabled={!scene.images.keyFrame}
              >
                保存到本地
              </Button>
              <Button 
                icon={<ClearOutlined />} 
                className={styles.previewClearBtn}
                onClick={() => {
                  Modal.confirm({
                    title: '确认清空',
                    content: '确定要清空当前显示的图片吗？历史记录中的图片不会被删除。',
                    okText: '确定',
                    cancelText: '取消',
                    centered: true,
                    onOk: () => {
                      clearCurrentImage();
                      setPreviewVisible(false);
                    }
                  });
                }}
                disabled={!scene.images.keyFrame}
              >
                清空图片
              </Button>
            </div>
          </div>
        }
      >
        <div className={styles.previewContent}>
          {scene.images.keyFrame ? (
            <img 
              src={scene.images.keyFrame} 
              alt={`分镜 ${index + 1} 预览`}
              className={styles.previewImage}
            />
          ) : (
            <div className={styles.previewEmpty}>
              <div className={styles.previewEmptyIcon}>
                <PlusOutlined />
              </div>
              <p>暂无图片</p>
              <p className={styles.previewEmptyHint}>点击上方"上传图片"按钮添加自定义图片，或点击"开始生成"按钮生成图片</p>
            </div>
          )}
        </div>
      </Modal>

      {/* 视频预览弹窗 */}
      <Modal
        open={videoPreviewVisible}
        footer={null}
        onCancel={() => {
          // 关闭弹窗时暂停视频
          if (previewVideoRef.current) {
            previewVideoRef.current.pause();
          }
          setVideoPreviewVisible(false);
          setSelectedVideoIndex(null);
        }}
        width="75%"
        centered
        forceRender
        destroyOnClose={false}
        className={styles.previewModal}
      >
        {selectedVideoIndex !== null && previewItems[selectedVideoIndex] ? (
          previewItems[selectedVideoIndex].type === 'video' ? (
            <div className={styles.videoPreviewContainer}>
              <video 
                ref={previewVideoRef}
                src={previewItems[selectedVideoIndex].url} 
                controls
                autoPlay
                className={styles.previewVideo}
              />
              <div className={styles.videoPreviewActions}>
                <Button 
                  type="primary" 
                  icon={<DownloadOutlined />}
                  onClick={() => handleDownloadVideo(previewItems[selectedVideoIndex].url, previewItems[selectedVideoIndex].index)}
                >
                  下载视频 ({index + 1}.{previewItems[selectedVideoIndex].index + 1})
                </Button>
              </div>
            </div>
          ) : previewItems[selectedVideoIndex].type === 'generating' ? (
            <div className={styles.previewGeneratingLarge}>
              <Spin size="large" />
              <p>视频生成中... {(previewItems[selectedVideoIndex].task?.id ? localProgress[previewItems[selectedVideoIndex].task.id] : undefined) || previewItems[selectedVideoIndex].task?.progress || 0}%</p>
              <Progress percent={(previewItems[selectedVideoIndex].task?.id ? localProgress[previewItems[selectedVideoIndex].task.id] : undefined) || previewItems[selectedVideoIndex].task?.progress || 0} status="active" />
            </div>
          ) : (
            <div className={styles.previewEmptyLarge}>
              <p>暂无视频</p>
              <p>点击"开始生成"按钮生成视频</p>
            </div>
          )
        ) : (
          <div className={styles.previewEmptyLarge}>
            <p>暂无视频</p>
          </div>
        )}
      </Modal>

      {/* AI 导演分析弹窗 — 流式预览 */}
      <Modal
        title={`AI 导演分析 — 分镜 ${index + 1}`}
        open={directorModalVisible}
        onCancel={() => setDirectorModalVisible(false)}
        footer={
          <Button type="primary" onClick={() => setDirectorModalVisible(false)}>
            关闭
          </Button>
        }
        width={600}
        centered
        zIndex={1050}
        maskClosable={true}
      >
        <div
          style={{
            maxHeight: '60vh',
            overflowY: 'auto',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            fontSize: 14,
            lineHeight: 1.8,
            color: 'var(--body-color)',
            padding: '4px 0',
          }}
        >
          {directorAnalysis || (
            <div style={{
              textAlign: 'center',
              color: 'var(--text-tertiary)',
              padding: '60px 0',
            }}>
              暂无分析内容
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
};

// 浅比较字符串数组（避免 .join(',') 创建临时字符串）
const shallowEqualStringArray = (a?: string[], b?: string[]): boolean => {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
};

// 比较视频任务数组的关键字段（避免 .map().join() 创建大量临时对象）
const videoTasksEqual = (a?: GenerationTask[], b?: GenerationTask[]): boolean => {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id || a[i].status !== b[i].status || a[i].progress !== b[i].progress) return false;
  }
  return true;
};

const SceneCard = React.memo(SceneCardComponent, (prevProps, nextProps) => {
  // 修复 #1: 添加 allScenes 比较，确保镜头衔接功能获取最新数据
  const prevPrevScene = prevProps.index > 0 ? prevProps.allScenes[prevProps.index - 1] : null;
  const nextPrevScene = nextProps.index > 0 ? nextProps.allScenes[nextProps.index - 1] : null;
  if (prevPrevScene?.imagePrompt !== nextPrevScene?.imagePrompt) return false;
  
  return (
    prevProps.scene.id === nextProps.scene.id &&
    prevProps.scene.status === nextProps.scene.status &&
    prevProps.scene.imageStatus === nextProps.scene.imageStatus &&
    prevProps.scene.videoStatus === nextProps.scene.videoStatus &&
    prevProps.scene.promptMode === nextProps.scene.promptMode &&
    prevProps.scene.images.keyFrame === nextProps.scene.images.keyFrame &&
    prevProps.scene.imagePrompt === nextProps.scene.imagePrompt &&
    prevProps.scene.videoPrompt === nextProps.scene.videoPrompt &&
    prevProps.scene.videos.length === nextProps.scene.videos.length &&
    shallowEqualStringArray(prevProps.scene.selectedCharacterIds, nextProps.scene.selectedCharacterIds) &&
    shallowEqualStringArray(prevProps.scene.availableCharacterIds, nextProps.scene.availableCharacterIds) &&
    prevProps.scene.useImageAsReference === nextProps.scene.useImageAsReference &&
    videoTasksEqual(prevProps.scene.videoTasks, nextProps.scene.videoTasks) &&
    prevProps.scene.imageTasks?.length === nextProps.scene.imageTasks?.length &&
    prevProps.index === nextProps.index &&
    prevProps.gridMode === nextProps.gridMode &&
    prevProps.selectedStyle?.id === nextProps.selectedStyle?.id &&
    prevProps.generationMode === nextProps.generationMode &&
    prevProps.imageTemplate?.id === nextProps.imageTemplate?.id &&
    prevProps.videoTemplate?.id === nextProps.videoTemplate?.id &&
    prevProps.directorTemplate?.id === nextProps.directorTemplate?.id
  );
});

export default SceneCard;
