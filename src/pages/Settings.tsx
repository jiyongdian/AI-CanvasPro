import * as React from 'react';
import { useState, useEffect } from 'react';
import { Input, Button, message, Form, Select, Modal, Progress } from 'antd';
import { SaveOutlined, EyeOutlined, EyeInvisibleOutlined, ApiOutlined, FolderOpenOutlined, PlusOutlined, DeleteOutlined, SettingOutlined, CloudDownloadOutlined, ReloadOutlined } from '@ant-design/icons';
import { aiService } from '../services/aiService';
import { saveDirHandle, getDirHandle, verifyPermission } from '../utils/downloadHelper';
import { saveApiConfig, loadApiConfig } from '../services/secureStorage';
import { checkForUpdate, downloadAndInstallUpdate, type UpdateStatus } from '../services/updateService';
import { getVersion } from '@tauri-apps/api/app';
import styles from './Settings.module.css';

type ModelCategory = 'chat' | 'image' | 'video';

interface ModelsMap {
  chat: string[];
  image: string[];
  video: string[];
}

const MODELS_KEY = 'custom_models';

const presetModels: ModelsMap = {
  chat: [
    'gemini-3-flash-preview',
    'gemini-2.5-pro',
    'gpt-4o-mini-2024-07-18',
    'gpt-4-turbo-2024-04-09',
    'claude-sonnet-4-20250514',
  ],
  image: [
    'nano-banana-2-4k',
    'gemini-3-pro-image-preview',
    'gemini-2.5-flash-image',
  ],
  video: [
    'sora-2',
    'sora-2-pro',
    'veo3',
    'veo3-fast',
    'veo3-pro',
    'veo3-pro-frames',
    'veo3-fast-frames',
    'veo3.1',
    'veo3.1-pro',
    'veo3.1-components',
    'veo2',
    'veo2-fast',
    'veo2-fast-frames',
    'veo2-fast-components',
    'veo2-pro',
  ],
};

const loadModels = (): ModelsMap => {
  try {
    const saved = localStorage.getItem(MODELS_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      return {
        chat: Array.isArray(parsed.chat) ? parsed.chat : [...presetModels.chat],
        image: Array.isArray(parsed.image) ? parsed.image : [...presetModels.image],
        video: Array.isArray(parsed.video) ? parsed.video : [...presetModels.video],
      };
    }
  } catch { /* ignore */ }
  return {
    chat: [...presetModels.chat],
    image: [...presetModels.image],
    video: [...presetModels.video],
  };
};

const saveModels = (models: ModelsMap) => {
  localStorage.setItem(MODELS_KEY, JSON.stringify(models));
};

const Settings: React.FC = () => {
  const [form] = Form.useForm();
  const [showApiKey, setShowApiKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ visible: boolean; success: boolean; message: string }>({
    visible: false,
    success: false,
    message: ''
  });
  const [downloadPath, setDownloadPath] = useState<string>('');
  const [models, setModels] = useState<ModelsMap>(loadModels);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [addModalCategory, setAddModalCategory] = useState<ModelCategory>('chat');
  const [addModalValue, setAddModalValue] = useState('');
  const [addModalError, setAddModalError] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<{ visible: boolean; category: ModelCategory; name: string }>({
    visible: false, category: 'chat', name: ''
  });

  // 自动更新状态
  const [appVersion, setAppVersion] = useState('0.1.0');
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ state: 'idle' });
  const [updateChecking, setUpdateChecking] = useState(false);

  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => {});
  }, []);

  const handleCheckUpdate = async () => {
    setUpdateChecking(true);
    setUpdateStatus({ state: 'checking' });
    try {
      const update = await checkForUpdate();
      if (update) {
        setUpdateStatus({
          state: 'available',
          version: update.version,
          body: update.body || undefined,
        });
      } else {
        setUpdateStatus({ state: 'up-to-date' });
        message.success('当前已是最新版本');
      }
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : '检查更新失败';
      setUpdateStatus({ state: 'error', message: errMsg });
      message.error('检查更新失败，请检查网络连接');
    } finally {
      setUpdateChecking(false);
    }
  };

  const handleDownloadUpdate = async () => {
    if (updateStatus.state !== 'available') return;
    try {
      const update = await checkForUpdate();
      if (!update) {
        message.info('未检测到可用更新');
        return;
      }
      setUpdateStatus({ state: 'downloading', progress: 0 });
      await downloadAndInstallUpdate(update, (progress, total) => {
        setUpdateStatus({ state: 'downloading', progress, total });
      });
      setUpdateStatus({ state: 'ready', version: update.version });
      message.success('更新下载完成，即将重启应用');
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : '下载更新失败';
      setUpdateStatus({ state: 'error', message: errMsg });
      message.error('下载更新失败，请重试');
    }
  };

  useEffect(() => {
    const initConfig = async () => {
      try {
        const secureConfig = await loadApiConfig();
        if (secureConfig.apiUrl || secureConfig.apiKey) {
          form.setFieldsValue(secureConfig);
          aiService.setApiKeys({ apiUrl: secureConfig.apiUrl, apiKey: secureConfig.apiKey });
        } else {
          // 尝试回退到旧 localStorage（迁移期间）
          const savedConfig = localStorage.getItem('api_config');
          if (savedConfig) {
            const config = JSON.parse(savedConfig);
            form.setFieldsValue(config);
            aiService.setApiKeys({ apiUrl: config.apiUrl, apiKey: config.apiKey });
          }
          // 无已保存配置时，不设置任何模型默认值，让 Select 显示为空
        }
      } catch {
        // 加载失败，也不设置默认值
      }
    };
    initConfig();
    // 加载下载路径配置（从 IndexedDB 恢复）
    const loadDownloadPath = async () => {
      const savedPath = localStorage.getItem('download_path');
      if (savedPath) {
        setDownloadPath(savedPath);
      }
      // 尝试恢复文件夹句柄并验证权限
      const handle = await getDirHandle();
      if (handle) {
        const hasPermission = await verifyPermission(handle);
        if (hasPermission) {
          setDownloadPath(handle.name);
        } else {
          // 权限失效，提示用户重新选择
          setDownloadPath('');
          localStorage.removeItem('download_path');
        }
      }
    };
    loadDownloadPath();
  }, [form]);

  const categoryLabels: Record<ModelCategory, string> = { chat: '聊天', image: '图像', video: '视频' };
  const fieldNameMap: Record<ModelCategory, string> = { chat: 'chatModel', image: 'imageModel', video: 'videoModel' };
  const defaultValueMap: Record<ModelCategory, string> = { chat: 'gemini-3-flash-preview', image: 'nano-banana-2-4k', video: 'sora-2' };

  const openManageModal = (category: ModelCategory) => {
    setAddModalCategory(category);
    setAddModalValue('');
    setAddModalError('');
    setAddModalOpen(true);
  };

  const handleAddModelInModal = () => {
    const name = addModalValue.trim();
    if (!name) {
      setAddModalError('请输入模型名称');
      return;
    }
    if (models[addModalCategory].includes(name)) {
      setAddModalError('该模型已存在，请勿重复添加');
      return;
    }
    const updated = { ...models, [addModalCategory]: [...models[addModalCategory], name] };
    setModels(updated);
    saveModels(updated);
    setAddModalValue('');
    setAddModalError('');
    message.success(`已添加${categoryLabels[addModalCategory]}模型: ${name}`);
  };

  const confirmDeleteModel = (category: ModelCategory, name: string) => {
    setDeleteConfirm({ visible: true, category, name });
  };

  const executeDeleteModel = () => {
    const { category, name } = deleteConfirm;
    const updated = { ...models, [category]: models[category].filter(m => m !== name) };
    setModels(updated);
    saveModels(updated);
    const fn = fieldNameMap[category];
    const currentValue = form.getFieldValue(fn);
    if (currentValue === name) {
      // 删除后若列表为空，清空表单字段（允许 Select 为空状态）
      form.setFieldValue(fn, undefined);
      saveConfig();
    }
    setDeleteConfirm({ ...deleteConfirm, visible: false });
    message.success(`已删除模型: ${name}`);
  };

  // 选择下载文件夹
  const handleSelectDownloadFolder = async () => {
    try {
      // 使用 File System Access API 选择文件夹
      // @ts-ignore - showDirectoryPicker 是较新的 API
      const dirHandle = await window.showDirectoryPicker({
        mode: 'readwrite',
        startIn: 'downloads'
      });
      const path = dirHandle.name;
      setDownloadPath(path);
      // 保存文件夹句柄到 IndexedDB（持久化存储）
      await saveDirHandle(dirHandle);
      localStorage.setItem('download_path', path);
      message.success(`已选择下载目录: ${path}`);
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.error('选择文件夹失败:', err);
        message.error('选择文件夹失败，请重试');
      }
    }
  };

  const saveConfig = (showMessage = false) => {
    const values = form.getFieldsValue();
    const config = {
      apiUrl: values.apiUrl || '',
      apiKey: values.apiKey || '',
      chatModel: values.chatModel || '',
      imageModel: values.imageModel || '',
      videoModel: values.videoModel || '',
    };

    // 使用安全存储代替 localStorage 明文存储
    saveApiConfig(config);
    aiService.setApiKeys({ apiUrl: config.apiUrl, apiKey: config.apiKey });
    aiService.refreshConfig();
    if (showMessage) {
      message.success('API配置已保存');
    }
  };

  const handleSaveConfig = () => saveConfig(true);

  const handleTestApi = async () => {
    const values = form.getFieldsValue();
    const apiUrl = values.apiUrl;
    const apiKey = values.apiKey;

    if (!apiUrl || !apiKey) {
      setTestResult({
        visible: true,
        success: false,
        message: '请先填写API地址和密钥'
      });
      return;
    }

    // 安全检查：生产环境建议使用 HTTPS
    const urlLower = apiUrl.toLowerCase();
    if (urlLower.startsWith('http://') && !urlLower.includes('localhost') && !urlLower.includes('127.0.0.1')) {
      setTestResult({
        visible: true,
        success: false,
        message: '安全警告：API 地址使用 HTTP 明文协议，密钥可能在网络中泄露。\n建议使用 HTTPS 地址。\n\n如果这是本地测试服务器，请忽略此警告。'
      });
      // 不阻止用户继续，但给出明确警告
    }

    setTesting(true);

    try {
      const response = await fetch(`${apiUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: values.chatModel || 'gemini-3-flash-preview',
          messages: [{ role: 'user', content: 'Hi' }],
          max_tokens: 10
        })
      });

      if (response.ok) {
        const data = await response.json();
        setTestResult({
          visible: true,
          success: true,
          message: `连接成功！\n模型: ${data.model || values.chatModel}\n响应状态: ${response.status}`
        });
      } else {
        const errorData = await response.json().catch(() => ({}));
        setTestResult({
          visible: true,
          success: false,
          message: `连接失败\n状态码: ${response.status}\n${errorData.error?.message || response.statusText}`
        });
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : '无法连接到服务器';
      let hint = '';
      if (errorMsg.includes('not valid JSON') || errorMsg.includes('Unexpected token')) {
        hint = '\n\n💡 提示：服务器返回了非JSON响应，请检查API地址是否正确。\n例如：https://api.openai.com/v1';
      }
      setTestResult({
        visible: true,
        success: false,
        message: `网络错误: ${errorMsg}${hint}`
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className={styles.container}>
      <Form form={form} layout="vertical" className={styles.form} onValuesChange={() => saveConfig()}>
        <Form.Item label="API 地址" name="apiUrl">
          <Input
            placeholder="请输入 API 地址，例如：https://api.openai.com/v1"
            size="middle"
            className={styles.input}
          />
        </Form.Item>

        <Form.Item label="API 密钥" name="apiKey">
          <Input.Password
            placeholder="请输入 API Key"
            size="middle"
            className={styles.input}
            visibilityToggle={{
              visible: showApiKey,
              onVisibleChange: () => setShowApiKey(!showApiKey),
            }}
            iconRender={(visible) => visible ? <EyeOutlined /> : <EyeInvisibleOutlined />}
          />
        </Form.Item>

        <div className={styles.modelRow}>
          {([
            { category: 'chat' as ModelCategory, label: '聊天模型', fieldName: 'chatModel', placeholder: '选择聊天模型' },
            { category: 'image' as ModelCategory, label: '图像模型', fieldName: 'imageModel', placeholder: '选择图像模型' },
            { category: 'video' as ModelCategory, label: '视频模型', fieldName: 'videoModel', placeholder: '选择视频模型' },
          ]).map(({ category, label, fieldName, placeholder }) => {
            const options = models[category].map(name => ({ label: name, value: name }));
            return (
              <div key={category} className={styles.modelItem}>
                <Form.Item
                  name={fieldName}
                  label={
                    <div className={styles.modelLabelRow}>
                      <span>{label}</span>
                      <SettingOutlined
                        className={styles.manageModelBtn}
                        onClick={() => openManageModal(category)}
                        title={`管理${categoryLabels[category]}模型`}
                      />
                    </div>
                  }
                >
                  <Select
                    placeholder={placeholder}
                    options={options}
                    size="middle"
                  />
                </Form.Item>
              </div>
            );
          })}
        </div>

        <div className={styles.downloadSection}>
          <Form.Item label="下载保存位置" className={styles.downloadItem}>
            <div className={styles.downloadPathRow}>
              <Input 
                value={downloadPath ? `📁 ${downloadPath}` : '未设置（使用浏览器默认下载目录）'} 
                readOnly 
                size="middle"
                className={`${styles.downloadPathInput} ${downloadPath ? styles.downloadPathSet : ''}`}
                placeholder="点击右侧按钮选择下载目录"
              />
              <Button 
                icon={<FolderOpenOutlined />}
                onClick={handleSelectDownloadFolder}
                size="middle"
                type={downloadPath ? 'default' : 'primary'}
              >
                {downloadPath ? '更换文件夹' : '选择文件夹'}
              </Button>
            </div>
            <div className={styles.downloadHint}>
              {downloadPath 
                ? `✅ 已设置自定义下载目录，视频将保存到「${downloadPath}」文件夹中`
                : '⚠️ 未设置下载目录，视频将下载到浏览器默认位置'}
            </div>
          </Form.Item>
        </div>

        <div className={styles.updateSection}>
          <div className={styles.sectionTitle}>软件更新</div>
          <div className={styles.updateRow}>
            <span className={styles.versionLabel}>当前版本：v{appVersion}</span>
            <Button
              icon={<ReloadOutlined />}
              onClick={handleCheckUpdate}
              loading={updateChecking}
              size="middle"
            >
              检查更新
            </Button>
          </div>
          {updateStatus.state === 'available' && (
            <div className={styles.updateAvailable}>
              <div className={styles.updateVersion}>新版本：v{updateStatus.version}</div>
              {updateStatus.body && (
                <div className={styles.updateBody}>{updateStatus.body}</div>
              )}
              <Button
                type="primary"
                icon={<CloudDownloadOutlined />}
                onClick={handleDownloadUpdate}
                size="middle"
              >
                下载并安装更新
              </Button>
            </div>
          )}
          {updateStatus.state === 'downloading' && (
            <div className={styles.updateDownloading}>
              <span>正在下载更新...</span>
              <Progress percent={updateStatus.progress} size="small" />
            </div>
          )}
          {updateStatus.state === 'ready' && (
            <div className={styles.updateReady}>
              更新已下载完成，应用即将重启...
            </div>
          )}
          {updateStatus.state === 'up-to-date' && !updateChecking && (
            <div className={styles.updateUpToDate}>当前已是最新版本</div>
          )}
          {updateStatus.state === 'error' && (
            <div className={styles.updateError}>检查失败：{updateStatus.message}</div>
          )}
        </div>

        <div className={styles.buttonGroup}>
          <Button
            icon={<ApiOutlined />}
            onClick={handleTestApi}
            loading={testing}
            size="middle"
            className={styles.testBtn}
          >
            测试连接
          </Button>
          <Button type="primary" icon={<SaveOutlined />} onClick={handleSaveConfig} size="middle" className={styles.saveBtn}>
            保存配置
          </Button>
        </div>
      </Form>

      <Modal
        title={testResult.success ? '✅ 测试成功' : '❌ 测试失败'}
        open={testResult.visible}
        onCancel={() => setTestResult({ ...testResult, visible: false })}
        footer={[
          <Button key="ok" type="primary" onClick={() => setTestResult({ ...testResult, visible: false })}>
            确定
          </Button>
        ]}
        centered
        width={400}
        forceRender
        destroyOnClose={false}
      >
        <div className={styles.testResult}>
          <pre>{testResult.message}</pre>
        </div>
      </Modal>

      <Modal
        title={`管理${categoryLabels[addModalCategory]}模型`}
        open={addModalOpen}
        onCancel={() => setAddModalOpen(false)}
        footer={[
          <Button key="close" onClick={() => setAddModalOpen(false)}>关闭</Button>
        ]}
        centered
        width={420}
        destroyOnClose
      >
        <div className={styles.manageModalBody}>
          {models[addModalCategory].length > 0 && (
            <div className={styles.customModelList}>
              <div className={styles.customModelListTitle}>当前模型列表</div>
              {models[addModalCategory].map((name) => (
                <div key={name} className={styles.customModelItem}>
                  <span className={styles.customModelName}>{name}</span>
                  <DeleteOutlined
                    className={styles.customModelDelete}
                    onClick={() => confirmDeleteModel(addModalCategory, name)}
                  />
                </div>
              ))}
            </div>
          )}
          {models[addModalCategory].length === 0 && (
            <div className={styles.customModelEmpty}>暂无模型，请添加</div>
          )}
          <div className={styles.addModelSection}>
            <div className={styles.addModalLabel}>添加新模型</div>
            <div className={styles.addModelInputRow}>
              <Input
                placeholder="输入模型名称，例如：gpt-4o"
                value={addModalValue}
                onChange={(e) => {
                  setAddModalValue(e.target.value);
                  if (addModalError) setAddModalError('');
                }}
                onPressEnter={handleAddModelInModal}
                status={addModalError ? 'error' : undefined}
                className={styles.addModalInput}
              />
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={handleAddModelInModal}
              >
                添加
              </Button>
            </div>
            {addModalError && <div className={styles.addModalError}>{addModalError}</div>}
          </div>
        </div>
      </Modal>

      <Modal
        title="确认删除"
        open={deleteConfirm.visible}
        onCancel={() => setDeleteConfirm({ ...deleteConfirm, visible: false })}
        onOk={executeDeleteModel}
        okText="删除"
        cancelText="取消"
        okButtonProps={{ danger: true }}
        centered
        width={360}
        zIndex={1100}
      >
        <div className={styles.deleteConfirmBody}>
          确定要删除模型 <strong>{deleteConfirm.name}</strong> 吗？
        </div>
      </Modal>
    </div>
  );
};

export default Settings;
