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

const CATEGORY_ICONS: Record<ModelCategory, string> = {
  text: '💬', image: '🖼️', video: '🎬', audio: '🎵', other: '📦',
};
const CATEGORY_COLORS: Record<ModelCategory, string> = {
  text: '#3b82f6', image: '#22c55e', video: '#f59e0b', audio: '#a855f7', other: '#6b7280',
};
const CATEGORY_BG: Record<ModelCategory, string> = {
  text: 'rgba(59,130,246,0.10)', image: 'rgba(34,197,94,0.10)', video: 'rgba(245,158,11,0.10)', audio: 'rgba(168,85,247,0.10)', other: 'rgba(107,114,128,0.08)',
};
const CATEGORY_BORDER: Record<ModelCategory, string> = {
  text: 'rgba(59,130,246,0.28)', image: 'rgba(34,197,94,0.28)', video: 'rgba(245,158,11,0.28)', audio: 'rgba(168,85,247,0.28)', other: 'rgba(107,114,128,0.18)',
};

// ========================

const Settings: React.FC = () => {
  const [providers, setProviders] = useState<ApiProvider[]>([]);
  const [providersLoading, setProvidersLoading] = useState(true);

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

  const [modelSelectVisible, setModelSelectVisible] = useState(false);
  const [fetchedModels, setFetchedModels] = useState<ProviderModel[]>([]);
  const [selectedModelIds, setSelectedModelIds] = useState<Set<string>>(new Set());
  const [modelSelectSearch, setModelSelectSearch] = useState('');

  const [deleteTarget, setDeleteTarget] = useState<ApiProvider | null>(null);

  const [temperature, setTemperature] = useState(0.6);
  const [downloadPath, setDownloadPath] = useState('');

  const [isTauri, setIsTauri] = useState(false);
  const [appVersion, setAppVersion] = useState('0.1.0');
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ state: 'idle' });
  const [updateChecking, setUpdateChecking] = useState(false);

  // 系统设置弹窗
  const [tempModalOpen, setTempModalOpen] = useState(false);
  const [downloadModalOpen, setDownloadModalOpen] = useState(false);
  const [updateModalOpen, setUpdateModalOpen] = useState(false);

  // ==================== init ====================

  useEffect(() => {
    (async () => {
      try { const a = await import('@tauri-apps/api/app'); setAppVersion(await a.getVersion()); setIsTauri(true); } catch {}
    })();
  }, []);

  useEffect(() => {
    (async () => {
      setProvidersLoading(true);
      try { const list = await loadApiProviders(); setProviders(list); aiService.refreshProviders(); } catch {}
      setProvidersLoading(false);
    })();
    (async () => {
      try { const { loadApiConfig } = await import('../services/secureStorage'); const c = await loadApiConfig(); if (c.temperature) setTemperature(parseFloat(c.temperature)); } catch {}
      const p = localStorage.getItem('download_path'); if (p) setDownloadPath(p);
      try { const h = await getDirHandle(); if (h) { if (await verifyPermission(h)) setDownloadPath(h.name); else { setDownloadPath(''); localStorage.removeItem('download_path'); } } } catch {}
    })();
  }, []);

  // ==================== provider CRUD ====================

  const persist = async (list: ApiProvider[]) => { setProviders(list); await saveApiProviders(list); aiService.refreshProviders(); };

  const openAdd = () => {
    setEditingProvider(null); setEditName(''); setEditApiUrl(''); setEditApiKey('');
    setEditModels([]); setEditShowKey(false); setTestResult({ visible: false, success: false, message: '' });
    setEditModalVisible(true);
  };

  const openEdit = (p: ApiProvider) => {
    setEditingProvider(p); setEditName(p.name); setEditApiUrl(p.apiUrl); setEditApiKey(p.apiKey);
    setEditModels([...p.models]); setEditShowKey(false); setTestResult({ visible: false, success: false, message: '' });
    setEditModalVisible(true);
  };

  const saveProvider = async () => {
    if (!editName.trim()) { message.warning('请输入API网站名称'); return; }
    if (!editApiUrl.trim()) { message.warning('请输入API地址'); return; }
    if (!editApiKey.trim()) { message.warning('请输入密钥'); return; }
    const now = new Date();
    if (editingProvider) {
      await persist(providers.map(p => p.id === editingProvider.id ? { ...p, name: editName.trim(), apiUrl: editApiUrl.trim(), apiKey: editApiKey.trim(), models: editModels, updatedAt: now } : p));
    } else {
      await persist([...providers, { id: `p-${Date.now()}-${Math.random().toString(36).slice(2,6)}`, name: editName.trim(), apiUrl: editApiUrl.trim(), apiKey: editApiKey.trim(), models: editModels, enabled: true, createdAt: now, updatedAt: now }]);
    }
    setEditModalVisible(false);
  };

  const delProvider = async () => { if (!deleteTarget) return; await persist(providers.filter(p => p.id !== deleteTarget.id)); setDeleteTarget(null); };

  // ==================== fetch models ====================

  const handleFetch = async () => {
    if (!editApiUrl.trim() || !editApiKey.trim()) { message.warning('请先填写API地址和密钥'); return; }
    setFetchLoading(true);
    try {
      const models = await fetchModelsFromApi(editApiUrl.trim(), editApiKey.trim());
      setFetchedModels(models); setSelectedModelIds(new Set(editModels.map(m => m.id))); setModelSelectSearch('');
      setModelSelectVisible(true);
    } catch (e: any) { message.error(e.message || '拉取失败'); }
    finally { setFetchLoading(false); }
  };

  const confirmModels = () => {
    setEditModels(fetchedModels.filter(m => selectedModelIds.has(m.id)));
    setModelSelectVisible(false);
    message.success(`已选择 ${selectedModelIds.size} 个模型`);
  };

  const toggleModel = (id: string, checked: boolean) => setSelectedModelIds(prev => { const n = new Set(prev); checked ? n.add(id) : n.delete(id); return n; });
  const toggleCatAll = (cat: ModelCategory, models: ProviderModel[]) => setSelectedModelIds(prev => { const n = new Set(prev); const all = models.every(m => n.has(m.id)); models.forEach(m => all ? n.delete(m.id) : n.add(m.id)); return n; });

  // ==================== test ====================

  const handleTest = async () => {
    if (!editApiUrl.trim() || !editApiKey.trim()) { message.warning('请先填写API地址和密钥'); return; }
    setTestLoading(true);
    try { const r = await testApiConnection(editApiUrl.trim(), editApiKey.trim()); setTestResult({ visible: true, ...r }); }
    catch { setTestResult({ visible: true, success: false, message: '测试失败' }); }
    finally { setTestLoading(false); }
  };

  // ==================== system ====================

  const handleTemp = (v: number) => { setTemperature(v); saveApiConfig({ temperature: String(v) }); aiService.refreshConfig(); };
  const handleDownload = async () => {
    try { const h = await (window as any).showDirectoryPicker({ mode: 'readwrite', startIn: 'downloads' }); setDownloadPath(h.name); await saveDirHandle(h); localStorage.setItem('download_path', h.name); message.success(`已选择: ${h.name}`); } catch (e: any) { if (e.name !== 'AbortError') message.error('选择失败'); }
  };
  const handleCheck = async () => { setUpdateChecking(true); setUpdateStatus({ state: 'checking' }); try { const u = await checkForUpdate(); if (u) setUpdateStatus({ state: 'available', version: u.version, body: u.body || undefined }); else { setUpdateStatus({ state: 'up-to-date' }); message.success('已是最新版本'); } } catch (e: any) { setUpdateStatus({ state: 'error', message: e.message || '检查失败' }); } finally { setUpdateChecking(false); } };
  const handleDownloadUpd = async () => { if (updateStatus.state !== 'available') return; try { const u = await checkForUpdate(); if (!u) { message.info('无可用更新'); return; } setUpdateStatus({ state: 'downloading', progress: 0 }); await downloadAndInstallUpdate(u, (p: number) => setUpdateStatus({ state: 'downloading', progress: p })); setUpdateStatus({ state: 'ready', version: u.version }); } catch (e: any) { setUpdateStatus({ state: 'error', message: e.message || '下载失败' }); } };

  // ==================== utils ====================

  const maskUrl = (u: string) => { try { const p = new URL(u); return `${p.protocol}//${p.hostname}${p.pathname}`; } catch { return u.length > 40 ? u.slice(0,40)+'...' : u; } };
  const maskKey = (k: string) => k.length <= 8 ? '••••••••' : k.slice(0,4)+'••••••••'+k.slice(-4);

  // ==================== model grouping ====================

  const grouped: Record<ModelCategory, ProviderModel[]> = { text:[], image:[], video:[], audio:[], other:[] };
  const sl = modelSelectSearch.toLowerCase();
  fetchedModels.forEach(m => { if (sl && !m.id.toLowerCase().includes(sl)) return; grouped[m.category].push(m); });
  const totalFiltered = Object.values(grouped).reduce((s,a) => s+a.length, 0);

  // ==================== RENDER ====================

  return (
    <div className={styles.container}>

      {/* ======== API 平台 ======== */}
      <div className={styles.apiSection}>
        <div className={styles.sectionHead}>
          <div className={styles.sectionHeadL}>
            <ThunderboltOutlined className={styles.sectionHeadIcon} />
            <h2 className={styles.sectionTitle}>第三方API平台</h2>
            {providers.length > 0 && <span className={styles.countBadge}>{providers.length} 个平台</span>}
          </div>
          <Button type="primary" icon={<PlusOutlined />} onClick={openAdd} className={styles.addBtn}>添加API</Button>
        </div>

        {providersLoading ? <div className={styles.loadingWrap}><Spin /></div>
        : providers.length === 0 ? (
          <div className={styles.emptyBox}>
            <div className={styles.emptyIcon}><ApiOutlined style={{ fontSize: 52 }} /></div>
            <Empty description="暂无API平台配置" />
            <Button type="primary" icon={<PlusOutlined />} onClick={openAdd} style={{ marginTop: 16 }}>添加第一个API平台</Button>
          </div>
        ) : (
          <div className={styles.cardList}>
            {providers.map(p => (
              <div key={p.id} className={styles.apiCard}>
                <div className={styles.apiCardTop}>
                  <div className={styles.apiLogo}><ApiOutlined className={styles.apiLogoIcon} /></div>
                  <div className={styles.apiNameBlock}>
                    <span className={styles.apiName}>{p.name}</span>
                    <span className={styles.apiCount}>{p.models.length > 0 ? `${p.models.length} 个模型` : '无模型'}</span>
                  </div>
                  <div className={styles.apiActions}>
                    <Tooltip title="编辑"><Button type="text" size="small" icon={<EditOutlined />} onClick={() => openEdit(p)} className={styles.actBtn} /></Tooltip>
                    <Tooltip title="删除"><Button type="text" size="small" danger icon={<DeleteOutlined />} onClick={() => setDeleteTarget(p)} className={styles.actBtn} /></Tooltip>
                  </div>
                </div>
                <div className={styles.apiCardBody}>
                  <div className={styles.apiRow}><LinkOutlined className={styles.apiRowIcon} /><span className={styles.apiRowText} title={p.apiUrl}>{maskUrl(p.apiUrl)}</span></div>
                  <div className={styles.apiRow}><KeyOutlined className={styles.apiRowIcon} /><span className={styles.apiRowText}>{maskKey(p.apiKey)}</span></div>
                  <div className={styles.apiModels}>
                    {p.models.length === 0 ? <span className={styles.noModels}>尚未选择模型 — 点击编辑并拉取</span>
                    : <div className={styles.tagWrap}>{p.models.slice(0,8).map(m => <Tag key={m.id} color={CATEGORY_COLORS[m.category]} className={styles.modelTag}>{m.id}</Tag>)}{p.models.length > 8 && <Tag className={styles.tagMore}>+{p.models.length-8}</Tag>}</div>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ======== 系统设置（芯片触发） ======== */}
      <div className={styles.sysSection}>
        <div className={styles.sectionHead}>
          <div className={styles.sectionHeadL}>
            <SettingOutlined className={styles.sectionHeadIcon} />
            <h2 className={styles.sectionTitle}>系统设置</h2>
          </div>
        </div>
        <div className={styles.sysChips}>
          <div className={styles.sysChip} onClick={() => setTempModalOpen(true)}>
            <ThunderboltOutlined className={styles.sysChipIcon} />
            <div className={styles.sysChipInfo}>
              <span className={styles.sysChipLabel}>AI 稳定性</span>
              <span className={styles.sysChipVal}>{temperature}</span>
            </div>
            <span className={styles.sysChipArrow}>→</span>
          </div>
          <div className={styles.sysChip} onClick={() => setDownloadModalOpen(true)}>
            <FolderOpenOutlined className={styles.sysChipIcon} />
            <div className={styles.sysChipInfo}>
              <span className={styles.sysChipLabel}>下载保存位置</span>
              <span className={styles.sysChipVal}>{downloadPath ? `📁 ${downloadPath}` : '未设置'}</span>
            </div>
            <span className={styles.sysChipArrow}>→</span>
          </div>
          {isTauri && (
            <div className={styles.sysChip} onClick={() => setUpdateModalOpen(true)}>
              <CloudDownloadOutlined className={styles.sysChipIcon} />
              <div className={styles.sysChipInfo}>
                <span className={styles.sysChipLabel}>软件更新</span>
                <span className={styles.sysChipVal}>v{appVersion}</span>
              </div>
              <span className={styles.sysChipArrow}>→</span>
            </div>
          )}
        </div>
      </div>

      {/* ======== 弹出层: 温度 ======== */}
      <Modal title="AI 稳定性" open={tempModalOpen} onCancel={() => setTempModalOpen(false)} footer={null} width={420} centered className={styles.sysModal}>
        <div className={styles.sysModalBody}>
          <div className={styles.tempBig}>{temperature}</div>
          <Slider min={0.1} max={2.0} step={0.1} value={temperature} onChange={handleTemp} tooltip={{ formatter: (v: any) => `${v}` }} className={styles.tempSlider} />
          <p className={styles.tempHint}>0 = 高度确定 · 1 = 平衡 · 2 = 高度创造</p>
        </div>
      </Modal>

      {/* ======== 弹出层: 下载 ======== */}
      <Modal title="下载保存位置" open={downloadModalOpen} onCancel={() => setDownloadModalOpen(false)} footer={null} width={460} centered className={styles.sysModal}>
        <div className={styles.sysModalBody}>
          <div className={styles.dlRow}><Input value={downloadPath || '未设置'} readOnly className={styles.dlInput} /><Button icon={<FolderOpenOutlined />} onClick={handleDownload} type="primary">{downloadPath ? '更换' : '选择文件夹'}</Button></div>
          <p className={styles.tempHint}>{downloadPath ? `✅ 视频保存到「${downloadPath}」` : '⚠️ 使用浏览器默认下载目录'}</p>
        </div>
      </Modal>

      {/* ======== 弹出层: 更新 ======== */}
      <Modal title="软件更新" open={updateModalOpen} onCancel={() => setUpdateModalOpen(false)} footer={null} width={440} centered className={styles.sysModal}>
        <div className={styles.sysModalBody}>
          <div className={styles.updRow}><span className={styles.updVer}>当前版本：v{appVersion}</span><Button icon={<ReloadOutlined />} onClick={handleCheck} loading={updateChecking} size="small">检查更新</Button></div>
          {updateStatus.state === 'available' && <div className={styles.updAvail}><span className={styles.updNew}>v{updateStatus.version}</span>{updateStatus.body && <div className={styles.updBody}>{updateStatus.body.slice(0,200)}</div>}<Button type="primary" icon={<CloudDownloadOutlined />} onClick={handleDownloadUpd} size="small" block>下载并安装</Button></div>}
          {updateStatus.state === 'downloading' && <div className={styles.updDl}><span>下载中...</span><Progress percent={updateStatus.progress} size="small" /></div>}
          {updateStatus.state === 'ready' && <div className={styles.updReady}>下载完成，即将重启...</div>}
          {updateStatus.state === 'up-to-date' && !updateChecking && <div className={styles.updOk}>✅ 已是最新版本</div>}
          {updateStatus.state === 'error' && <div className={styles.updErr}>{updateStatus.message}</div>}
        </div>
      </Modal>

      {/* ======== 弹出层: 添加/编辑 API ======== */}
      <Modal
        title={null}
        open={editModalVisible}
        onCancel={() => setEditModalVisible(false)}
        footer={null}
        width={560}
        centered
        className={styles.editModal}
        forceRender destroyOnClose={false}
      >
        <div className={styles.editModalWrap}>
          <div className={styles.editModalBar}>
            <div className={styles.editModalBarIcon}><ApiOutlined /></div>
            <span className={styles.editModalBarTitle}>{editingProvider ? '编辑API平台' : '添加API平台'}</span>
          </div>
          <div className={styles.editModalContent}>
            <div className={styles.editF}>
              <label className={styles.editL}>API网站名称</label>
              <Input placeholder="如：我的OpenAI、硅基流动" value={editName} onChange={e => setEditName(e.target.value)} />
            </div>
            <div className={styles.editF}>
              <label className={styles.editL}>API地址</label>
              <Input placeholder="https://api.openai.com/v1" value={editApiUrl} onChange={e => setEditApiUrl(e.target.value)} />
            </div>
            <div className={styles.editF}>
              <label className={styles.editL}>密钥</label>
              <Password placeholder="sk-..." value={editApiKey} onChange={e => setEditApiKey(e.target.value)}
                visibilityToggle={{ visible: editShowKey, onVisibleChange: setEditShowKey }}
                iconRender={(v: boolean) => v ? <EyeOutlined /> : <EyeInvisibleOutlined />} />
            </div>
            <div className={styles.editF}>
              <label className={styles.editL}>模型</label>
              <div className={styles.editModelZone}>
                {editModels.length === 0 ? <span className={styles.noModels}>暂无模型，点击下方按钮拉取</span>
                : <div className={styles.tagWrap}>{editModels.map(m => <Tag key={m.id} color={CATEGORY_COLORS[m.category]} closable onClose={() => setEditModels(prev => prev.filter(x => x.id !== m.id))} className={styles.modelTag}>{m.id}</Tag>)}</div>}
              </div>
            </div>
            <div className={styles.editBtnRow}>
              <Button icon={<DownloadOutlined />} onClick={handleFetch} loading={fetchLoading} className={styles.fetchBtn}>拉取模型</Button>
              <Button icon={<ApiOutlined />} onClick={handleTest} loading={testLoading} className={styles.testBtn2}>测试连接</Button>
            </div>
            {testResult.visible && (
              <div className={`${styles.testBanner} ${testResult.success ? styles.testOk : styles.testBad}`}>
                {testResult.success ? <CheckCircleOutlined /> : <CloseCircleOutlined />}<pre>{testResult.message}</pre>
              </div>
            )}
          </div>
          <div className={styles.editModalFooter}>
            <Button onClick={() => setEditModalVisible(false)}>取消</Button>
            <Button type="primary" onClick={saveProvider}>保存</Button>
          </div>
        </div>
      </Modal>

      {/* ======== 弹出层: 模型选择 ======== */}
      <Modal
        title={null}
        open={modelSelectVisible}
        onCancel={() => setModelSelectVisible(false)}
        footer={null}
        width={780}
        centered
        zIndex={1050}
        className={styles.modelModal}
        forceRender destroyOnClose={false}
      >
        <div className={styles.modelModalWrap}>
          <div className={styles.modelModalBar}>
            <div className={styles.modelModalBarIcon}><DownloadOutlined /></div>
            <span className={styles.modelModalBarTitle}>选择模型</span>
            <span className={styles.modelModalBarStat}>共 {fetchedModels.length} 个 · 已选 {selectedModelIds.size}</span>
          </div>
          <div className={styles.modelModalContent}>
            <div className={styles.modelSearchWrap}>
              <SearchOutlined className={styles.modelSearchIcon} />
              <input type="text" className={styles.modelSearchInput} placeholder="搜索模型名称..." value={modelSelectSearch} onChange={e => setModelSelectSearch(e.target.value)} />
              {modelSelectSearch && <Button type="text" size="small" className={styles.modelSearchClear} onClick={() => setModelSelectSearch('')}>清除</Button>}
            </div>
            {totalFiltered === 0 ? <Empty description={modelSelectSearch ? '未找到匹配的模型' : '未能获取到模型'} style={{ marginTop: 32 }} />
            : <div className={styles.modelCatList}>
              {(Object.entries(grouped) as [ModelCategory, ProviderModel[]][]).map(([cat, models]) => {
                if (models.length === 0) return null;
                const allSel = models.every(m => selectedModelIds.has(m.id));
                return (
                  <div key={cat} className={styles.modelCat} style={{ background: CATEGORY_BG[cat], borderColor: CATEGORY_BORDER[cat] }}>
                    <div className={styles.modelCatHead}>
                      <span className={styles.modelCatEmoji}>{CATEGORY_ICONS[cat]}</span>
                      <span className={styles.modelCatName}>{MODEL_CATEGORY_LABELS[cat]}</span>
                      <span className={styles.modelCatCount}>{models.length}</span>
                      <span className={styles.modelCatDot} style={{ background: CATEGORY_COLORS[cat] }} />
                      <Button type="link" size="small" onClick={() => toggleCatAll(cat, models)} className={styles.modelCatToggle}>{allSel ? '取消全选' : '全选'}</Button>
                    </div>
                    <div className={styles.modelCheckGrid}>
                      {models.map(m => { const sel = selectedModelIds.has(m.id); return (
                        <label key={m.id} className={`${styles.modelCheck} ${sel ? styles.modelCheckOn : ''}`}>
                          <Checkbox checked={sel} onChange={e => toggleModel(m.id, e.target.checked)} />
                          <span className={styles.modelCheckName}>{m.id}</span>
                          {sel && <CheckOutlined className={styles.modelCheckMark} />}
                        </label>
                      );})}
                    </div>
                  </div>
                );
              })}
            </div>}
          </div>
          <div className={styles.modelModalFooter}>
            <Button onClick={() => setModelSelectVisible(false)}>取消</Button>
            <Button type="primary" onClick={confirmModels} disabled={selectedModelIds.size === 0}>确认选择（{selectedModelIds.size}）</Button>
          </div>
        </div>
      </Modal>

      {/* ======== 弹出层: 删除确认 ======== */}
      <Modal title="确认删除" open={!!deleteTarget} onCancel={() => setDeleteTarget(null)} onOk={delProvider} okText="删除" cancelText="取消" okButtonProps={{ danger: true }} centered width={400} zIndex={1100}>
        <div className={styles.delBody}>确定要删除API平台 <strong>{deleteTarget?.name}</strong> 吗？<br />删除后，依赖该平台的生成任务将无法正常工作。</div>
      </Modal>
    </div>
  );
};

export default Settings;
