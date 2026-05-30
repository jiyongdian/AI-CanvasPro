import * as React from 'react';
import { useState, useEffect } from 'react';
import { Input, Button, message, Modal, Progress, Slider, Popover, Tag, Tooltip, Checkbox, Empty, Spin } from 'antd';
import {
  PlusOutlined, DeleteOutlined, ApiOutlined, FolderOpenOutlined,
  CloudDownloadOutlined, ReloadOutlined, QuestionCircleOutlined,
  EditOutlined, LinkOutlined, DownloadOutlined, CheckCircleOutlined,
  CloseCircleOutlined, EyeOutlined, EyeInvisibleOutlined, KeyOutlined,
  SearchOutlined, CheckOutlined, ThunderboltOutlined, SettingOutlined,
} from '@ant-design/icons';
import { aiService, fetchModelsFromApi, testApiConnection } from '../services/aiService';
import { saveDirHandle, getDirHandle, verifyPermission } from '../utils/downloadHelper';
import { saveApiProviders, loadApiProviders, saveApiConfig } from '../services/secureStorage';
import { checkForUpdate, downloadAndInstallUpdate, type UpdateStatus } from '../services/updateService';
import {
  ApiProvider, ProviderModel, ModelCategory, MODEL_CATEGORY_LABELS,
} from '../types';
import styles from './Settings.module.css';

const { Password } = Input;

const categoryIcons: Record<ModelCategory, React.ReactNode> = {
  text: '💬',
  image: '🖼️',
  video: '🎬',
  audio: '🎵',
  other: '📦',
};

const categoryColorMap: Record<ModelCategory, string> = {
  text: '#3b82f6',
  image: '#22c55e',
  video: '#f59e0b',
  audio: '#a855f7',
  other: '#6b7280',
};

const categoryBgMap: Record<ModelCategory, string> = {
  text: 'rgba(59, 130, 246, 0.12)',
  image: 'rgba(34, 197, 94, 0.12)',
  video: 'rgba(245, 158, 11, 0.12)',
  audio: 'rgba(168, 85, 247, 0.12)',
  other: 'rgba(107, 114, 128, 0.10)',
};

const categoryBorderMap: Record<ModelCategory, string> = {
  text: 'rgba(59, 130, 246, 0.30)',
  image: 'rgba(34, 197, 94, 0.30)',
  video: 'rgba(245, 158, 11, 0.30)',
  audio: 'rgba(168, 85, 247, 0.30)',
  other: 'rgba(107, 114, 128, 0.20)',
};

// ======================== 设置页面主组件 ========================

const Settings: React.FC = () => {
  // --- 提供商列表 ---
  const [providers, setProviders] = useState<ApiProvider[]>([]);
  const [providersLoading, setProvidersLoading] = useState(true);

  // --- 添加/编辑弹窗 ---
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editingProvider, setEditingProvider] = useState<ApiProvider | null>(null);
  const [editName, setEditName] = useState('');
  const [editApiUrl, setEditApiUrl] = useState('');
  const [editApiKey, setEditApiKey] = useState('');
  const [editModels, setEditModels] = useState<ProviderModel[]>([]);
  const [editShowKey, setEditShowKey] = useState(false);
  const [fetchLoading, setFetchLoading] = useState(false);
  const [testLoading, setTestLoading] = useState(false);
  const [testResult, setTestResult] = useState<{ visible: boolean; success: boolean; message: string }>({
    visible: false, success: false, message: '',
  });

  // --- 模型选择弹窗（顶层） ---
  const [modelSelectVisible, setModelSelectVisible] = useState(false);
  const [fetchedModels, setFetchedModels] = useState<ProviderModel[]>([]);
  const [selectedModelIds, setSelectedModelIds] = useState<Set<string>>(new Set());
  const [modelSelectSearch, setModelSelectSearch] = useState('');

  // --- 删除确认 ---
  const [deleteTarget, setDeleteTarget] = useState<ApiProvider | null>(null);

  // --- 温度控制 ---
  const [temperature, setTemperature] = useState(0.6);

  // --- 下载路径 ---
  const [downloadPath, setDownloadPath] = useState('');

  // --- 更新 ---
  const [isTauri, setIsTauri] = useState(false);
  const [appVersion, setAppVersion] = useState('0.1.0');
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ state: 'idle' });
  const [updateChecking, setUpdateChecking] = useState(false);

  // ==================== 初始化 ====================

  useEffect(() => {
    (async () => {
      try {
        const app = await import('@tauri-apps/api/app');
        setAppVersion(await app.getVersion());
        setIsTauri(true);
      } catch { /* browser */ }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      setProvidersLoading(true);
      try {
        const list = await loadApiProviders();
        setProviders(list);
        aiService.refreshProviders();
      } catch { /* ignore */ }
      setProvidersLoading(false);
    })();

    (async () => {
      try {
        const { loadApiConfig } = await import('../services/secureStorage');
        const cfg = await loadApiConfig();
        if (cfg.temperature) setTemperature(parseFloat(cfg.temperature));
      } catch { /* ignore */ }

      const savedPath = localStorage.getItem('download_path');
      if (savedPath) setDownloadPath(savedPath);
      try {
        const handle = await getDirHandle();
        if (handle) {
          const ok = await verifyPermission(handle);
          if (ok) setDownloadPath(handle.name);
          else { setDownloadPath(''); localStorage.removeItem('download_path'); }
        }
      } catch { /* ignore */ }
    })();
  }, []);

  // ==================== 提供商 CRUD ====================

  const persistProviders = async (list: ApiProvider[]) => {
    setProviders(list);
    await saveApiProviders(list);
    aiService.refreshProviders();
  };

  const openAddModal = () => {
    setEditingProvider(null);
    setEditName('');
    setEditApiUrl('');
    setEditApiKey('');
    setEditModels([]);
    setEditShowKey(false);
    setTestResult({ visible: false, success: false, message: '' });
    setEditModalVisible(true);
  };

  const openEditModal = (p: ApiProvider) => {
    setEditingProvider(p);
    setEditName(p.name);
    setEditApiUrl(p.apiUrl);
    setEditApiKey(p.apiKey);
    setEditModels([...p.models]);
    setEditShowKey(false);
    setTestResult({ visible: false, success: false, message: '' });
    setEditModalVisible(true);
  };

  const handleSaveProvider = async () => {
    if (!editName.trim()) { message.warning('请输入API网站名称'); return; }
    if (!editApiUrl.trim()) { message.warning('请输入API地址'); return; }
    if (!editApiKey.trim()) { message.warning('请输入密钥'); return; }

    const now = new Date();
    if (editingProvider) {
      const updated = providers.map(p =>
        p.id === editingProvider.id
          ? { ...p, name: editName.trim(), apiUrl: editApiUrl.trim(), apiKey: editApiKey.trim(), models: editModels, updatedAt: now }
          : p
      );
      await persistProviders(updated);
      message.success('API配置已更新');
    } else {
      const newProvider: ApiProvider = {
        id: `provider-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: editName.trim(),
        apiUrl: editApiUrl.trim(),
        apiKey: editApiKey.trim(),
        models: editModels,
        enabled: true,
        createdAt: now,
        updatedAt: now,
      };
      await persistProviders([...providers, newProvider]);
      message.success('API平台已添加');
    }
    setEditModalVisible(false);
  };

  const handleDeleteProvider = async () => {
    if (!deleteTarget) return;
    const updated = providers.filter(p => p.id !== deleteTarget.id);
    await persistProviders(updated);
    setDeleteTarget(null);
    message.success('已删除');
  };

  // ==================== 模型拉取 ====================

  const handleFetchModels = async () => {
    if (!editApiUrl.trim() || !editApiKey.trim()) {
      message.warning('请先填写API地址和密钥');
      return;
    }
    setFetchLoading(true);
    try {
      const models = await fetchModelsFromApi(editApiUrl.trim(), editApiKey.trim());
      setFetchedModels(models);
      // 初始化选中状态：当前已编辑模型 + 之前已保存的模型
      setSelectedModelIds(new Set(editModels.map(m => m.id)));
      setModelSelectSearch('');
      setModelSelectVisible(true);
    } catch (e: any) {
      message.error(e.message || '拉取模型失败');
    } finally {
      setFetchLoading(false);
    }
  };

  const handleConfirmModelSelection = () => {
    const selected = fetchedModels.filter(m => selectedModelIds.has(m.id));
    setEditModels(selected);
    setModelSelectVisible(false);
    message.success(`已选择 ${selected.length} 个模型`);
  };

  // 修复: 使用 Checkbox onChange 而非父级 div onClick，避免事件冲突导致多选失败
  const toggleModelSelect = (modelId: string, checked: boolean) => {
    setSelectedModelIds(prev => {
      const next = new Set(prev);
      if (checked) next.add(modelId);
      else next.delete(modelId);
      return next;
    });
  };

  const toggleCategoryAll = (category: ModelCategory, models: ProviderModel[]) => {
    setSelectedModelIds(prev => {
      const next = new Set(prev);
      const allSelected = models.every(m => next.has(m.id));
      if (allSelected) {
        models.forEach(m => next.delete(m.id));
      } else {
        models.forEach(m => next.add(m.id));
      }
      return next;
    });
  };

  // ==================== 测试连接 ====================

  const handleTestConnection = async () => {
    if (!editApiUrl.trim() || !editApiKey.trim()) {
      message.warning('请先填写API地址和密钥');
      return;
    }
    setTestLoading(true);
    try {
      const result = await testApiConnection(editApiUrl.trim(), editApiKey.trim());
      setTestResult({ visible: true, ...result });
    } catch {
      setTestResult({ visible: true, success: false, message: '测试失败' });
    } finally {
      setTestLoading(false);
    }
  };

  // ==================== 温度 & 下载 & 更新 ====================

  const handleTemperatureChange = (val: number) => {
    setTemperature(val);
    const config = { temperature: String(val) };
    saveApiConfig(config);
    aiService.refreshConfig();
  };

  const handleSelectDownloadFolder = async () => {
    try {
      // @ts-ignore
      const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite', startIn: 'downloads' });
      setDownloadPath(dirHandle.name);
      await saveDirHandle(dirHandle);
      localStorage.setItem('download_path', dirHandle.name);
      message.success(`已选择下载目录: ${dirHandle.name}`);
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        message.error('选择文件夹失败，请重试');
      }
    }
  };

  const handleCheckUpdate = async () => {
    setUpdateChecking(true);
    setUpdateStatus({ state: 'checking' });
    try {
      const update = await checkForUpdate();
      if (update) {
        setUpdateStatus({ state: 'available', version: update.version, body: update.body || undefined });
      } else {
        setUpdateStatus({ state: 'up-to-date' });
        message.success('当前已是最新版本');
      }
    } catch (e: any) {
      setUpdateStatus({ state: 'error', message: e.message || '检查失败' });
    } finally {
      setUpdateChecking(false);
    }
  };

  const handleDownloadUpdate = async () => {
    if (updateStatus.state !== 'available') return;
    try {
      const update = await checkForUpdate();
      if (!update) { message.info('未检测到可用更新'); return; }
      setUpdateStatus({ state: 'downloading', progress: 0 });
      await downloadAndInstallUpdate(update, (progress, total) => {
        setUpdateStatus({ state: 'downloading', progress, total });
      });
      setUpdateStatus({ state: 'ready', version: update.version });
      message.success('更新下载完成，即将重启应用');
    } catch (e: any) {
      setUpdateStatus({ state: 'error', message: e.message || '下载失败' });
    }
  };

  // ==================== 工具函数 ====================

  const maskApiUrl = (url: string): string => {
    try {
      const u = new URL(url);
      return `${u.protocol}//${u.hostname}${u.pathname}`;
    } catch {
      return url.length > 40 ? url.slice(0, 40) + '...' : url;
    }
  };

  const maskApiKey = (key: string): string => {
    if (key.length <= 8) return '••••••••';
    return key.slice(0, 4) + '••••••••' + key.slice(-4);
  };

  // ==================== 渲染 ====================

  // 分组模型用于模型选择弹窗
  const groupedFetchedModels: Record<ModelCategory, ProviderModel[]> = {
    text: [], image: [], video: [], audio: [], other: [],
  };
  const searchLower = modelSelectSearch.toLowerCase();
  fetchedModels.forEach(m => {
    if (searchLower && !m.id.toLowerCase().includes(searchLower)) return;
    groupedFetchedModels[m.category].push(m);
  });

  const totalFiltered = Object.values(groupedFetchedModels).reduce((s, arr) => s + arr.length, 0);

  return (
    <div className={styles.container}>
      {/* ========== API 平台卡片区域（主体） ========== */}
      <div className={styles.apiSection}>
        <div className={styles.sectionHeader}>
          <div className={styles.sectionHeaderLeft}>
            <ThunderboltOutlined className={styles.sectionHeaderIcon} />
            <h2 className={styles.sectionTitle}>第三方API平台</h2>
            {providers.length > 0 && (
              <span className={styles.providerCount}>{providers.length} 个平台</span>
            )}
          </div>
          <Button type="primary" icon={<PlusOutlined />} onClick={openAddModal} className={styles.addBtn}>
            添加API
          </Button>
        </div>

        {providersLoading ? (
          <div className={styles.loadingWrap}><Spin /></div>
        ) : providers.length === 0 ? (
          <div className={styles.emptyProviders}>
            <div className={styles.emptyIcon}>
              <ApiOutlined style={{ fontSize: 52 }} />
            </div>
            <Empty description="暂无API平台配置" />
            <Button type="primary" icon={<PlusOutlined />} onClick={openAddModal} style={{ marginTop: 16 }}>
              添加第一个API平台
            </Button>
          </div>
        ) : (
          <div className={styles.providersGrid}>
            {providers.map(p => (
              <div key={p.id} className={styles.providerCard}>
                {/* 卡片顶部渐变 Logo 区 */}
                <div className={styles.providerCardBanner}>
                  <div className={styles.providerLogoCircle}>
                    <ApiOutlined className={styles.providerLogoIcon} />
                  </div>
                  <div className={styles.providerNameBlock}>
                    <span className={styles.providerName}>{p.name}</span>
                    <span className={styles.providerModelCount}>
                      {p.models.length > 0 ? `${p.models.length} 个模型` : '无模型'}
                    </span>
                  </div>
                  <div className={styles.providerCardActions}>
                    <Tooltip title="编辑">
                      <Button type="text" size="small" icon={<EditOutlined />}
                        onClick={() => openEditModal(p)} className={styles.actionBtn} />
                    </Tooltip>
                    <Tooltip title="删除">
                      <Button type="text" size="small" danger icon={<DeleteOutlined />}
                        onClick={() => setDeleteTarget(p)} className={styles.actionBtn} />
                    </Tooltip>
                  </div>
                </div>
                {/* 卡片内容 */}
                <div className={styles.providerCardBody}>
                  <div className={styles.providerInfoRow}>
                    <LinkOutlined className={styles.providerInfoIcon} />
                    <span className={styles.providerInfoText} title={p.apiUrl}>{maskApiUrl(p.apiUrl)}</span>
                  </div>
                  <div className={styles.providerInfoRow}>
                    <KeyOutlined className={styles.providerInfoIcon} />
                    <span className={styles.providerInfoText}>{maskApiKey(p.apiKey)}</span>
                  </div>
                  <div className={styles.providerModelsArea}>
                    {p.models.length === 0 ? (
                      <span className={styles.noModels}>尚未选择模型 — 点击编辑并拉取</span>
                    ) : (
                      <div className={styles.modelTagsWrap}>
                        {p.models.slice(0, 6).map(m => (
                          <Tag key={m.id} color={categoryColorMap[m.category]}
                            className={styles.modelTag}>
                            {m.id}
                          </Tag>
                        ))}
                        {p.models.length > 6 && (
                          <Tag className={styles.modelTagMore}>+{p.models.length - 6}</Tag>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ========== 系统设置卡片区 ========== */}
      <div className={styles.systemSection}>
        <div className={styles.systemSectionHeader}>
          <SettingOutlined className={styles.sectionHeaderIcon} />
          <h2 className={styles.sectionTitle}>系统设置</h2>
        </div>

        <div className={styles.systemCards}>
          {/* 温度卡片 */}
          <div className={styles.systemCard}>
            <div className={styles.systemCardIconWrap}>
              <ThunderboltOutlined className={styles.systemCardIcon} />
            </div>
            <div className={styles.systemCardContent}>
              <div className={styles.systemCardTitle}>
                AI 稳定性
                <Popover
                  content={
                    <div style={{ maxWidth: 260, fontSize: 13, lineHeight: 1.7 }}>
                      <p>控制 AI 输出的随机性和创造性。</p>
                      <p><strong>0 = 高度确定</strong>：每次结果几乎一致</p>
                      <p><strong>1 = 平衡</strong>：有一定变化</p>
                      <p><strong>2 = 高度创造</strong>：输出多样</p>
                    </div>
                  }
                >
                  <QuestionCircleOutlined style={{ marginLeft: 6, color: 'var(--text-tertiary)', cursor: 'pointer', fontSize: 13 }} />
                </Popover>
              </div>
              <div className={styles.tempValue}>{temperature}</div>
              <Slider min={0.1} max={2.0} step={0.1} value={temperature}
                onChange={handleTemperatureChange} tooltip={{ formatter: (v) => `${v}` }}
                className={styles.tempSlider} />
            </div>
          </div>

          {/* 下载路径卡片 */}
          <div className={styles.systemCard}>
            <div className={styles.systemCardIconWrap}>
              <FolderOpenOutlined className={styles.systemCardIcon} />
            </div>
            <div className={styles.systemCardContent}>
              <div className={styles.systemCardTitle}>下载保存位置</div>
              <div className={styles.downloadPathRow}>
                <Input
                  value={downloadPath ? `📁 ${downloadPath}` : '未设置（使用浏览器默认下载目录）'}
                  readOnly size="middle"
                  className={`${styles.downloadPathInput} ${downloadPath ? styles.downloadPathSet : ''}`}
                />
                <Button icon={<FolderOpenOutlined />} onClick={handleSelectDownloadFolder} size="middle"
                  type={downloadPath ? 'default' : 'primary'}>
                  {downloadPath ? '更换' : '选择'}
                </Button>
              </div>
              <div className={styles.downloadHint}>
                {downloadPath
                  ? `✅ 视频将保存到「${downloadPath}」`
                  : '⚠️ 将下载到浏览器默认位置'}
              </div>
            </div>
          </div>

          {/* 软件更新卡片（仅 Tauri） */}
          {isTauri && (
            <div className={styles.systemCard}>
              <div className={styles.systemCardIconWrap}>
                <CloudDownloadOutlined className={styles.systemCardIcon} />
              </div>
              <div className={styles.systemCardContent}>
                <div className={styles.systemCardTitle}>软件更新</div>
                <div className={styles.updateRow}>
                  <span className={styles.versionLabel}>当前版本：v{appVersion}</span>
                  <Button icon={<ReloadOutlined />} onClick={handleCheckUpdate} loading={updateChecking} size="small">
                    检查更新
                  </Button>
                </div>
                {updateStatus.state === 'available' && (
                  <div className={styles.updateAvailable}>
                    <span className={styles.updateVersion}>新版本：v{updateStatus.version}</span>
                    {updateStatus.body && <div className={styles.updateBody}>{updateStatus.body.slice(0, 200)}</div>}
                    <Button type="primary" icon={<CloudDownloadOutlined />} onClick={handleDownloadUpdate} size="small" block>
                      下载并安装
                    </Button>
                  </div>
                )}
                {updateStatus.state === 'downloading' && (
                  <div className={styles.updateDownloading}>
                    <span>下载中...</span>
                    <Progress percent={updateStatus.progress} size="small" />
                  </div>
                )}
                {updateStatus.state === 'ready' && (
                  <div className={styles.updateReady}>下载完成，即将重启...</div>
                )}
                {updateStatus.state === 'up-to-date' && !updateChecking && (
                  <div className={styles.updateUpToDate}>✅ 已是最新版本</div>
                )}
                {updateStatus.state === 'error' && (
                  <div className={styles.updateError}>检查失败：{updateStatus.message}</div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ========== 添加/编辑 API 弹窗 ========== */}
      <Modal
        title={editingProvider ? '编辑API平台' : '添加API平台'}
        open={editModalVisible}
        onCancel={() => setEditModalVisible(false)}
        onOk={handleSaveProvider}
        okText="保存"
        cancelText="取消"
        width={600}
        centered
        forceRender
        destroyOnClose={false}
      >
        <div className={styles.editModalBody}>
          <div className={styles.editField}>
            <label className={styles.editLabel}>API网站名称</label>
            <Input placeholder="如：我的OpenAI、硅基流动"
              value={editName} onChange={e => setEditName(e.target.value)} />
          </div>
          <div className={styles.editField}>
            <label className={styles.editLabel}>API地址</label>
            <Input placeholder="https://api.openai.com/v1"
              value={editApiUrl} onChange={e => setEditApiUrl(e.target.value)} />
          </div>
          <div className={styles.editField}>
            <label className={styles.editLabel}>密钥</label>
            <Password placeholder="sk-..."
              value={editApiKey} onChange={e => setEditApiKey(e.target.value)}
              visibilityToggle={{
                visible: editShowKey,
                onVisibleChange: setEditShowKey,
              }}
              iconRender={visible => visible ? <EyeOutlined /> : <EyeInvisibleOutlined />}
            />
          </div>

          <div className={styles.editActions}>
            <Button icon={<DownloadOutlined />} onClick={handleFetchModels} loading={fetchLoading}
              className={styles.fetchBtn}>
              拉取模型
            </Button>
            <Button icon={<ApiOutlined />} onClick={handleTestConnection} loading={testLoading}
              className={styles.editTestBtn}>
              测试连接
            </Button>
          </div>

          <div className={styles.editModelsPreview}>
            <div className={styles.editModelsLabel}>
              📋 已选模型（{editModels.length}）
            </div>
            {editModels.length === 0 ? (
              <span className={styles.noModels}>点击「拉取模型」从API获取并选择模型</span>
            ) : (
              <div className={styles.modelTagsWrap}>
                {editModels.map(m => (
                  <Tag key={m.id} color={categoryColorMap[m.category]}
                    closable
                    onClose={() => setEditModels(prev => prev.filter(x => x.id !== m.id))}
                    className={styles.modelTag}>
                    {m.id}
                  </Tag>
                ))}
              </div>
            )}
          </div>

          {testResult.visible && (
            <div className={`${styles.testResultBanner} ${testResult.success ? styles.testSuccess : styles.testFail}`}>
              {testResult.success ? <CheckCircleOutlined /> : <CloseCircleOutlined />}
              <pre>{testResult.message}</pre>
            </div>
          )}
        </div>
      </Modal>

      {/* ========== 模型选择弹窗（顶层、美化版） ========== */}
      <Modal
        title={
          <div className={styles.modelSelectTitle}>
            <DownloadOutlined style={{ fontSize: 16 }} />
            <span>从 API 拉取模型</span>
            <span className={styles.modelSelectSubtitle}>
              共 {fetchedModels.length} 个模型 · 已选 {selectedModelIds.size}
            </span>
          </div>
        }
        open={modelSelectVisible}
        onCancel={() => setModelSelectVisible(false)}
        onOk={handleConfirmModelSelection}
        okText={`确认选择（${selectedModelIds.size}）`}
        cancelText="取消"
        width={800}
        centered
        zIndex={1050}
        forceRender
        destroyOnClose={false}
        className={styles.modelSelectModal}
        bodyStyle={{ maxHeight: '62vh', overflow: 'auto', padding: '20px 24px' }}
      >
        <div className={styles.modelSelectBody}>
          {/* 搜索栏 */}
          <div className={styles.modelSearchWrap}>
            <SearchOutlined className={styles.modelSearchIcon} />
            <input
              type="text"
              className={styles.modelSearchInput}
              placeholder="搜索模型名称..."
              value={modelSelectSearch}
              onChange={e => setModelSelectSearch(e.target.value)}
            />
            {modelSelectSearch && (
              <Button type="text" size="small" className={styles.modelSearchClear}
                onClick={() => setModelSelectSearch('')}>
                清除
              </Button>
            )}
          </div>

          {totalFiltered === 0 ? (
            <Empty description={modelSelectSearch ? '未找到匹配的模型' : '未能获取到模型'}
              style={{ marginTop: 32 }} />
          ) : (
            <div className={styles.modelCategoryList}>
              {(Object.entries(groupedFetchedModels) as [ModelCategory, ProviderModel[]][]).map(([category, models]) => {
                if (models.length === 0) return null;
                const allSelected = models.every(m => selectedModelIds.has(m.id));
                return (
                  <div key={category} className={styles.modelCategoryBlock}
                    style={{
                      background: categoryBgMap[category],
                      borderColor: categoryBorderMap[category],
                    }}>
                    <div className={styles.modelCategoryHeader}>
                      <span className={styles.modelCategoryEmoji}>{categoryIcons[category]}</span>
                      <span className={styles.modelCategoryName}>{MODEL_CATEGORY_LABELS[category]}</span>
                      <span className={styles.modelCategoryCount}>{models.length}</span>
                      <span className={styles.modelCategoryDot} style={{ background: categoryColorMap[category] }} />
                      <Button type="link" size="small"
                        onClick={() => toggleCategoryAll(category, models)}
                        className={styles.modelCategoryToggle}>
                        {allSelected ? '取消全选' : '全选'}
                      </Button>
                    </div>
                    <div className={styles.modelCheckList}>
                      {models.map(m => {
                        const isSelected = selectedModelIds.has(m.id);
                        return (
                          <label key={m.id}
                            className={`${styles.modelCheckItem} ${isSelected ? styles.modelCheckItemSelected : ''}`}>
                            <Checkbox
                              checked={isSelected}
                              onChange={(e) => toggleModelSelect(m.id, e.target.checked)}
                            />
                            <span className={styles.modelCheckName}>{m.id}</span>
                            {isSelected && <CheckOutlined className={styles.modelCheckMark} />}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Modal>

      {/* ========== 删除确认弹窗 ========== */}
      <Modal
        title="确认删除"
        open={!!deleteTarget}
        onCancel={() => setDeleteTarget(null)}
        onOk={handleDeleteProvider}
        okText="删除"
        cancelText="取消"
        okButtonProps={{ danger: true }}
        centered
        width={400}
        zIndex={1100}
      >
        <div className={styles.deleteConfirmBody}>
          确定要删除API平台 <strong>{deleteTarget?.name}</strong> 吗？<br />
          删除后，依赖该平台的生成任务将无法正常工作。
        </div>
      </Modal>
    </div>
  );
};

export default Settings;
