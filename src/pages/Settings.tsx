import * as React from 'react';
import { useState, useEffect } from 'react';
import { Input, Button, message, Modal, Progress, Slider, Tag, Tooltip, Checkbox, Empty, Spin } from 'antd';
import {
  PlusOutlined, DeleteOutlined, ApiOutlined, FolderOpenOutlined,
  CloudDownloadOutlined, ReloadOutlined,
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

const CAT_ICON: Record<ModelCategory, string> = { text:'💬', image:'🖼️', video:'🎬', audio:'🎵', other:'📦' };
const CAT_COLOR: Record<ModelCategory, string> = { text:'#3b82f6', image:'#22c55e', video:'#f59e0b', audio:'#a855f7', other:'#6b7280' };
const CAT_BG: Record<ModelCategory, string> = { text:'rgba(59,130,246,0.10)', image:'rgba(34,197,94,0.10)', video:'rgba(245,158,11,0.10)', audio:'rgba(168,85,247,0.10)', other:'rgba(107,114,128,0.08)' };
const CAT_BORDER: Record<ModelCategory, string> = { text:'rgba(59,130,246,0.28)', image:'rgba(34,197,94,0.28)', video:'rgba(245,158,11,0.28)', audio:'rgba(168,85,247,0.28)', other:'rgba(107,114,128,0.18)' };

const Settings: React.FC = () => {
  const [providers, setProviders] = useState<ApiProvider[]>([]);
  const [providersLoading, setProvidersLoading] = useState(true);

  const [editOpen, setEditOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<ApiProvider | null>(null);
  const [editName, setEditName] = useState('');
  const [editApiUrl, setEditApiUrl] = useState('');
  const [editApiKey, setEditApiKey] = useState('');
  const [editModels, setEditModels] = useState<ProviderModel[]>([]);
  const [editShowKey, setEditShowKey] = useState(false);
  const [fetchLoading, setFetchLoading] = useState(false);
  const [testLoading, setTestLoading] = useState(false);
  const [testResult, setTestResult] = useState<{visible:boolean;success:boolean;message:string}>({visible:false,success:false,message:''});

  const [modelOpen, setModelOpen] = useState(false);
  const [fetchedModels, setFetchedModels] = useState<ProviderModel[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [modelSearch, setModelSearch] = useState('');

  const [deleteTarget, setDeleteTarget] = useState<ApiProvider | null>(null);

  const [temperature, setTemperature] = useState(0.6);
  const [maxTokens, setMaxTokens] = useState(4096);
  const [downloadPath, setDownloadPath] = useState('');

  const [isTauri, setIsTauri] = useState(false);
  const [appVersion, setAppVersion] = useState('0.1.0');
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({state:'idle'});
  const [updateChecking, setUpdateChecking] = useState(false);

  // 统一系统设置弹窗
  const [sysOpen, setSysOpen] = useState(false);

  // ==================== init ====================

  useEffect(() => {(async()=>{try{const a=await import('@tauri-apps/api/app');setAppVersion(await a.getVersion());setIsTauri(true)}catch{}})()},[]);

  useEffect(()=>{
    (async()=>{setProvidersLoading(true);try{const l=await loadApiProviders();setProviders(l);aiService.refreshProviders()}catch{}setProvidersLoading(false)})();
    (async()=>{try{const{loadApiConfig}=await import('../services/secureStorage');const c=await loadApiConfig();if(c.temperature)setTemperature(parseFloat(c.temperature));if(c.maxTokens)setMaxTokens(parseInt(c.maxTokens))}catch{};const p=localStorage.getItem('download_path');if(p)setDownloadPath(p);try{const h=await getDirHandle();if(h){if(await verifyPermission(h))setDownloadPath(h.name);else{setDownloadPath('');localStorage.removeItem('download_path')}}}catch{}})();
  },[]);

  // ==================== provider CRUD ====================

  const persist = async (list: ApiProvider[]) => { setProviders(list); await saveApiProviders(list); aiService.refreshProviders(); };

  const openAdd = () => {
    setEditingProvider(null); setEditName(''); setEditApiUrl(''); setEditApiKey('');
    setEditModels([]); setEditShowKey(false); setTestResult({visible:false,success:false,message:''});
    setEditOpen(true);
  };
  const openEdit = (p: ApiProvider) => {
    setEditingProvider(p); setEditName(p.name); setEditApiUrl(p.apiUrl); setEditApiKey(p.apiKey);
    setEditModels([...p.models]); setEditShowKey(false); setTestResult({visible:false,success:false,message:''});
    setEditOpen(true);
  };

  const saveProvider = async () => {
    if (!editName.trim()) { message.warning('请输入API网站名称'); return; }
    if (!editApiUrl.trim()) { message.warning('请输入API地址'); return; }
    if (!editApiKey.trim()) { message.warning('请输入密钥'); return; }
    const now = new Date();
    try {
      if (editingProvider) {
        await persist(providers.map(p => p.id===editingProvider.id ? {...p, name:editName.trim(), apiUrl:editApiUrl.trim(), apiKey:editApiKey.trim(), models:editModels, updatedAt:now} : p));
        message.success('API配置已更新');
      } else {
        await persist([...providers, {id:`p-${Date.now()}-${Math.random().toString(36).slice(2,6)}`, name:editName.trim(), apiUrl:editApiUrl.trim(), apiKey:editApiKey.trim(), models:editModels, enabled:true, createdAt:now, updatedAt:now}]);
        message.success('API平台已添加');
      }
    } catch (e: any) {
      message.error('保存失败: ' + (e?.message || '存储空间不足，请清理旧数据'));
      return;
    }
    setEditOpen(false);
  };

  const delProvider = async () => { if(!deleteTarget)return; await persist(providers.filter(p=>p.id!==deleteTarget.id)); setDeleteTarget(null); };

  // ==================== fetch models ====================

  const handleFetch = async () => {
    if(!editApiUrl.trim()||!editApiKey.trim()){message.warning('请先填写API地址和密钥');return}
    setFetchLoading(true);
    try {
      const models = await fetchModelsFromApi(editApiUrl.trim(), editApiKey.trim());
      setFetchedModels(models); setSelectedIds(new Set(editModels.map(m=>m.id))); setModelSearch('');
      setModelOpen(true);
    } catch(e:any){message.error(e.message||'拉取失败')}
    finally{setFetchLoading(false)}
  };

  const confirmModels = () => {
    setEditModels(fetchedModels.filter(m=>selectedIds.has(m.id)));
    setModelOpen(false);
  };

  const toggleModel = (id:string, checked:boolean) => setSelectedIds(p=>{const n=new Set(p);checked?n.add(id):n.delete(id);return n});
  const toggleCatAll = (cat:ModelCategory, models:ProviderModel[]) => setSelectedIds(p=>{const n=new Set(p);const all=models.every(m=>n.has(m.id));models.forEach(m=>all?n.delete(m.id):n.add(m.id));return n});

  // ==================== test ====================

  const handleTest = async () => {
    if(!editApiUrl.trim()||!editApiKey.trim()){message.warning('请先填写API地址和密钥');return}
    setTestLoading(true);
    try{const r=await testApiConnection(editApiUrl.trim(),editApiKey.trim());setTestResult({visible:true,...r})}
    catch{setTestResult({visible:true,success:false,message:'测试失败'})}
    finally{setTestLoading(false)}
  };

  // ==================== system ====================

  const handleTemp = async (v:number) => { setTemperature(v); const {loadApiConfig} = await import('../services/secureStorage'); const c = await loadApiConfig(); await saveApiConfig({...c, temperature:String(v)}); aiService.refreshConfig(); };
  const handleMaxTokens = async (v:number) => { setMaxTokens(v); const {loadApiConfig} = await import('../services/secureStorage'); const c = await loadApiConfig(); await saveApiConfig({...c, maxTokens:String(v)}); aiService.refreshConfig(); };
  const handleDownload = async () => {
    try{const h=await(window as any).showDirectoryPicker({mode:'readwrite',startIn:'downloads'});setDownloadPath(h.name);await saveDirHandle(h);localStorage.setItem('download_path',h.name);message.success(`已选择: ${h.name}`)}catch(e:any){if(e.name!=='AbortError')message.error('选择失败')}
  };
  const handleCheck = async () => { setUpdateChecking(true); setUpdateStatus({state:'checking'}); try{const u=await checkForUpdate();if(u)setUpdateStatus({state:'available',version:u.version,body:u.body||undefined});else{setUpdateStatus({state:'up-to-date'});message.success('已是最新版本')}}catch(e:any){setUpdateStatus({state:'error',message:e.message||'检查失败'})}finally{setUpdateChecking(false)} };
  const handleDownloadUpd = async () => { if(updateStatus.state!=='available')return; try{const u=await checkForUpdate();if(!u){message.info('无可用更新');return}setUpdateStatus({state:'downloading',progress:0});await downloadAndInstallUpdate(u,(p:number)=>setUpdateStatus({state:'downloading',progress:p}));setUpdateStatus({state:'ready',version:u.version})}catch(e:any){setUpdateStatus({state:'error',message:e.message||'下载失败'})} };

  // ==================== utils ====================

  const maskUrl = (u:string) => { try{const p=new URL(u);return`${p.protocol}//${p.hostname}${p.pathname}`}catch{return u.length>40?u.slice(0,40)+'...':u} };
  const maskKey = (k:string) => k.length<=8?'••••••••':k.slice(0,4)+'••••••••'+k.slice(-4);

  // ==================== model grouping ====================

  const grouped: Record<ModelCategory, ProviderModel[]> = {text:[],image:[],video:[],audio:[],other:[]};
  const sl = modelSearch.toLowerCase();
  fetchedModels.forEach(m=>{if(sl&&!m.id.toLowerCase().includes(sl))return;grouped[m.category].push(m)});
  const totalFiltered = Object.values(grouped).reduce((s,a)=>s+a.length,0);

  // ==================== RENDER ====================

  return (
    <div className={styles.container}>

      {/* ======== 右上角系统设置按钮 ======== */}
      <Tooltip title="系统设置">
        <Button
          shape="circle"
          icon={<SettingOutlined />}
          className={styles.sysFloatBtn}
          onClick={() => setSysOpen(true)}
        />
      </Tooltip>

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
            <div className={styles.emptyIcon}><ApiOutlined style={{fontSize:52}} /></div>
            <Empty description="暂无API平台配置" />
            <Button type="primary" icon={<PlusOutlined />} onClick={openAdd} style={{marginTop:16}}>添加第一个API平台</Button>
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
                    <Tooltip title="编辑"><Button type="text" size="small" icon={<EditOutlined />} onClick={()=>openEdit(p)} className={styles.actBtn} /></Tooltip>
                    <Tooltip title="删除"><Button type="text" size="small" danger icon={<DeleteOutlined />} onClick={()=>setDeleteTarget(p)} className={styles.actBtn} /></Tooltip>
                  </div>
                </div>
                <div className={styles.apiCardBody}>
                  <div className={styles.apiRow}><LinkOutlined className={styles.apiRowIcon} /><span className={styles.apiRowText} title={p.apiUrl}>{maskUrl(p.apiUrl)}</span></div>
                  <div className={styles.apiRow}><KeyOutlined className={styles.apiRowIcon} /><span className={styles.apiRowText}>{maskKey(p.apiKey)}</span></div>
                  <div className={styles.apiModels}>
                    {p.models.length===0 ? <span className={styles.noModels}>尚未选择模型 — 点击编辑并拉取</span>
                    : <div className={styles.tagWrap}>{p.models.slice(0,8).map(m=><Tag key={m.id} color={CAT_COLOR[m.category]} className={styles.modelTag}>{m.id}</Tag>)}{p.models.length>8&&<Tag className={styles.tagMore}>+{p.models.length-8}</Tag>}</div>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ======== 统一系统设置弹窗 ======== */}
      <Modal
        title={null}
        open={sysOpen}
        onCancel={() => setSysOpen(false)}
        footer={null}
        width={480}
        centered
        className={styles.sysModal}
        forceRender destroyOnHidden={false}
      >
        <div className={styles.sysModalWrap}>
          <div className={styles.sysModalBar}>
            <div className={styles.sysModalBarIcon}><SettingOutlined /></div>
            <span className={styles.sysModalBarTitle}>系统设置</span>
          </div>
          <div className={styles.sysModalContent}>
            {/* 温度 */}
            <div className={styles.sysBlock}>
              <div className={styles.sysBlockHead}>
                <ThunderboltOutlined className={styles.sysBlockIcon} />
                <span className={styles.sysBlockLabel}>AI 稳定性</span>
                <span className={styles.sysBlockVal}>{temperature}</span>
              </div>
              <Slider min={0.1} max={2.0} step={0.1} value={temperature} onChange={handleTemp} tooltip={{formatter:(v:any)=>`${v}`}} />
              <p className={styles.sysBlockHint}>0 = 高度确定 · 1 = 平衡 · 2 = 高度创造</p>
            </div>
            <div className={styles.sysBlock}>
              <div className={styles.sysBlockHead}>
                <ThunderboltOutlined className={styles.sysBlockIcon} />
                <span className={styles.sysBlockLabel}>脚本生成最大输出</span>
                <span className={styles.sysBlockVal}>{maxTokens} tokens</span>
              </div>
              <Slider min={1024} max={16000} step={1024} value={maxTokens} onChange={handleMaxTokens} tooltip={{formatter:(v:any)=>`${v} tokens`}} />
              <p className={styles.sysBlockHint}>AI脚本最大输出长度。小模型4096,大模型可设16000。过高会导致API拒绝</p>
            </div>
            {/* 下载 */}
            <div className={styles.sysBlock}>
              <div className={styles.sysBlockHead}>
                <FolderOpenOutlined className={styles.sysBlockIcon} />
                <span className={styles.sysBlockLabel}>下载保存位置</span>
              </div>
              <div className={styles.sysDlRow}>
                <Input value={downloadPath||'未设置'} readOnly className={styles.sysDlInput} />
                <Button icon={<FolderOpenOutlined />} onClick={handleDownload} type="primary" size="small">{downloadPath?'更换':'选择'}</Button>
              </div>
              <p className={styles.sysBlockHint}>{downloadPath?`✅ 视频保存到「${downloadPath}」`:'⚠️ 使用浏览器默认下载目录'}</p>
            </div>
            {/* 更新 */}
            {isTauri && (
              <div className={styles.sysBlock}>
                <div className={styles.sysBlockHead}>
                  <CloudDownloadOutlined className={styles.sysBlockIcon} />
                  <span className={styles.sysBlockLabel}>软件更新</span>
                  <span className={styles.sysBlockVer}>v{appVersion}</span>
                </div>
                <div className={styles.sysUpdRow}>
                  <Button icon={<ReloadOutlined />} onClick={handleCheck} loading={updateChecking} size="small" block>检查更新</Button>
                </div>
                {updateStatus.state==='available'&&<div className={styles.sysUpdAvail}><span className={styles.sysUpdNew}>v{updateStatus.version}</span>{updateStatus.body&&<div className={styles.sysUpdBody}>{updateStatus.body.slice(0,200)}</div>}<Button type="primary" icon={<CloudDownloadOutlined />} onClick={handleDownloadUpd} size="small" block>下载并安装</Button></div>}
                {updateStatus.state==='downloading'&&<div className={styles.sysUpdDl}><span>下载中...</span><Progress percent={updateStatus.progress} size="small" /></div>}
                {updateStatus.state==='ready'&&<div className={styles.sysUpdReady}>下载完成，即将重启...</div>}
                {updateStatus.state==='up-to-date'&&!updateChecking&&<div className={styles.sysUpdOk}>✅ 已是最新版本</div>}
                {updateStatus.state==='error'&&<div className={styles.sysUpdErr}>{updateStatus.message}</div>}
              </div>
            )}
          </div>
          <div className={styles.sysModalFooter}>
            <Button type="primary" onClick={() => setSysOpen(false)}>完成</Button>
          </div>
        </div>
      </Modal>

      {/* ======== 添加/编辑 API 弹窗 ======== */}
      <Modal
        title={null}
        open={editOpen}
        onCancel={() => setEditOpen(false)}
        footer={null}
        width={560}
        centered
        className={styles.editModal}
        forceRender destroyOnHidden={false}
      >
        <div className={styles.editModalWrap}>
          <div className={styles.editModalBar}>
            <div className={styles.editModalBarIcon}><ApiOutlined /></div>
            <span className={styles.editModalBarTitle}>{editingProvider?'编辑API平台':'添加API平台'}</span>
          </div>
          <div className={styles.editModalContent}>
            <div className={styles.editF}>
              <label className={styles.editL}>API网站名称</label>
              <Input placeholder="如：我的OpenAI、硅基流动" value={editName} onChange={e=>setEditName(e.target.value)} />
            </div>
            <div className={styles.editF}>
              <label className={styles.editL}>API地址</label>
              <Input placeholder="https://api.openai.com/v1" value={editApiUrl} onChange={e=>setEditApiUrl(e.target.value)} />
            </div>
            <div className={styles.editF}>
              <label className={styles.editL}>密钥</label>
              <Password placeholder="sk-..." value={editApiKey} onChange={e=>setEditApiKey(e.target.value)}
                visibilityToggle={{visible:editShowKey,onVisibleChange:setEditShowKey}}
                iconRender={(v:boolean)=>v?<EyeOutlined/>:<EyeInvisibleOutlined/>} />
            </div>
            <div className={styles.editF}>
              <label className={styles.editL}>模型</label>
              <div className={styles.editModelZone}>
                {editModels.length===0?<span className={styles.noModels}>暂无模型，点击下方按钮拉取</span>
                :<div className={styles.tagWrap}>{editModels.map(m=><Tag key={m.id} color={CAT_COLOR[m.category]} closable onClose={()=>setEditModels(p=>p.filter(x=>x.id!==m.id))} className={styles.modelTag}>{m.id}</Tag>)}</div>}
              </div>
            </div>
            <div className={styles.editBtnRow}>
              <Button icon={<DownloadOutlined />} onClick={handleFetch} loading={fetchLoading} className={styles.fetchBtn}>拉取模型</Button>
              <Button icon={<ApiOutlined />} onClick={handleTest} loading={testLoading} className={styles.testBtn2}>测试连接</Button>
            </div>
            {testResult.visible && (
              <div className={`${styles.testBanner} ${testResult.success?styles.testOk:styles.testBad}`}>
                {testResult.success?<CheckCircleOutlined/>:<CloseCircleOutlined/>}<pre>{testResult.message}</pre>
              </div>
            )}
          </div>
          <div className={styles.editModalFooter}>
            <Button onClick={()=>setEditOpen(false)}>取消</Button>
            <Button type="primary" onClick={saveProvider}>保存</Button>
          </div>
        </div>
      </Modal>

      {/* ======== 模型选择弹窗（确认按钮固定底部） ======== */}
      <Modal
        title={null}
        open={modelOpen}
        onCancel={() => setModelOpen(false)}
        footer={null}
        width={780}
        centered
        zIndex={1050}
        className={styles.modelModal}
        forceRender destroyOnHidden={false}
        styles={{ body: { padding: 0, display: 'flex', flexDirection: 'column', maxHeight: '70vh' } }}
      >
        {/* 顶栏 */}
        <div className={styles.modelTopBar}>
          <div className={styles.modelTopBarIcon}><DownloadOutlined /></div>
          <span className={styles.modelTopBarTitle}>选择模型</span>
          <span className={styles.modelTopBarStat}>共 {fetchedModels.length} 个 · 已选 {selectedIds.size}</span>
        </div>

        {/* 可滚动内容区 */}
        <div className={styles.modelScrollArea}>
          <div className={styles.modelSearchWrap}>
            <SearchOutlined className={styles.modelSearchIcon} />
            <input type="text" className={styles.modelSearchInput} placeholder="搜索模型名称..." value={modelSearch} onChange={e=>setModelSearch(e.target.value)} />
            {modelSearch && <Button type="text" size="small" className={styles.modelSearchClear} onClick={()=>setModelSearch('')}>清除</Button>}
          </div>
          {totalFiltered===0 ? <Empty description={modelSearch?'未找到匹配的模型':'未能获取到模型'} style={{marginTop:32}} />
          : <div className={styles.modelCatList}>
            {(Object.entries(grouped) as [ModelCategory, ProviderModel[]][]).map(([cat,models])=>{
              if(models.length===0)return null;
              const allSel=models.every(m=>selectedIds.has(m.id));
              return (
                <div key={cat} className={styles.modelCat} style={{background:CAT_BG[cat],borderColor:CAT_BORDER[cat]}}>
                  <div className={styles.modelCatHead}>
                    <span className={styles.modelCatEmoji}>{CAT_ICON[cat]}</span>
                    <span className={styles.modelCatName}>{MODEL_CATEGORY_LABELS[cat]}</span>
                    <span className={styles.modelCatCount}>{models.length}</span>
                    <span className={styles.modelCatDot} style={{background:CAT_COLOR[cat]}} />
                    <Button type="link" size="small" onClick={()=>toggleCatAll(cat,models)} className={styles.modelCatToggle}>{allSel?'取消全选':'全选'}</Button>
                  </div>
                  <div className={styles.modelCheckGrid}>
                    {models.map(m=>{const sel=selectedIds.has(m.id);return(
                      <label key={m.id} className={`${styles.modelCheck} ${sel?styles.modelCheckOn:''}`}>
                        <Checkbox checked={sel} onChange={e=>toggleModel(m.id,e.target.checked)} />
                        <span className={styles.modelCheckName}>{m.id}</span>
                        {sel&&<CheckOutlined className={styles.modelCheckMark} />}
                      </label>
                    )})}
                  </div>
                </div>
              );
            })}
          </div>}
        </div>

        {/* 固定底部按钮栏 */}
        <div className={styles.modelBottomBar}>
          <Button onClick={()=>setModelOpen(false)}>取消</Button>
          <Button type="primary" onClick={confirmModels} disabled={selectedIds.size===0}>确认选择（{selectedIds.size}）</Button>
        </div>
      </Modal>

      {/* ======== 删除确认 ======== */}
      <Modal title="确认删除" open={!!deleteTarget} onCancel={()=>setDeleteTarget(null)} onOk={delProvider} okText="删除" cancelText="取消" okButtonProps={{danger:true}} centered width={400} zIndex={1100}>
        <div className={styles.delBody}>确定要删除API平台 <strong>{deleteTarget?.name}</strong> 吗？<br />删除后，依赖该平台的生成任务将无法正常工作。</div>
      </Modal>
    </div>
  );
};

export default Settings;
