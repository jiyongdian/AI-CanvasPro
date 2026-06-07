import * as React from 'react';
import { useState, useEffect } from 'react';
import { Modal, Input, Button, message, Divider, Spin, Table, Select } from 'antd';
import { ImportOutlined, SwapOutlined, UserOutlined, RobotOutlined, CopyOutlined, RedoOutlined } from '@ant-design/icons';
import { Scene, ApiProvider } from '../types';
import { aiService } from '../services/aiService';
import { loadApiProviders } from '../services/secureStorage';
import styles from './ScriptEditorModal.module.css';

const { TextArea } = Input;

interface ScriptEditorModalProps {
  visible: boolean;
  scenes: Scene[];
  onClose: () => void;
  onImport: (scenes: Scene[]) => void;
}

// 将场景数组转换为文本格式
const scenesToText = (scenes: Scene[]): string => {
  return scenes.map((scene, index) => {
    const parts: string[] = [];
    parts.push(`【分镜 ${index + 1}】`);
    if (scene.character) parts.push(`角色：${scene.character}`);
    if (scene.description) parts.push(`场景：${scene.description}`);
    if (scene.dialogue) parts.push(`对话：${scene.dialogue}`);
    if (scene.narration) parts.push(`旁白：${scene.narration}`);
    if (scene.actionDescription) parts.push(`动作：${scene.actionDescription}`);
    return parts.join('\n');
  }).join('\n\n');
};

// 将文本解析回场景数组
// 导入时清理所有正在进行的任务状态，避免状态不一致
const textToScenes = (text: string, originalScenes: Scene[]): Scene[] => {
  const blocks = text.split(/【分镜 \d+】/).filter(b => b.trim());
  
  return blocks.map((block, index) => {
    const original = originalScenes[index] || {
      id: `scene-${Date.now()}-${index}`,
      order: index + 1,
      description: '',
      prompt: '',
      generationMode: 'text-to-image' as const,
      images: {},
      videos: [],
      status: 'pending' as const,
    };
    
    const lines = block.trim().split('\n');
    const parsed: Partial<Scene> = {};
    
    lines.forEach(line => {
      if (line.startsWith('角色：')) parsed.character = line.replace('角色：', '').trim();
      else if (line.startsWith('场景：')) {
        parsed.description = line.replace('场景：', '').trim();
        parsed.prompt = parsed.description;
      }
      else if (line.startsWith('对话：')) parsed.dialogue = line.replace('对话：', '').trim();
      else if (line.startsWith('旁白：')) parsed.narration = line.replace('旁白：', '').trim();
      else if (line.startsWith('动作：')) parsed.actionDescription = line.replace('动作：', '').trim();
    });
    
    // 清理正在进行的任务状态，将 generating 状态重置为 pending
    // 同时清理 imageTasks 和 videoTasks 中的 processing 状态任务
    const cleanedImageTasks = (original.imageTasks || []).filter(t => t.status !== 'processing');
    const cleanedVideoTasks = (original.videoTasks || []).filter(t => t.status !== 'processing');
    
    return { 
      ...original, 
      ...parsed,
      // 重置生成状态为 pending
      status: original.status === 'generating' ? 'pending' : original.status,
      imageStatus: original.imageStatus === 'generating' ? 'pending' : original.imageStatus,
      videoStatus: original.videoStatus === 'generating' ? 'pending' : original.videoStatus,
      // 清理正在进行的任务
      imageTasks: cleanedImageTasks,
      videoTasks: cleanedVideoTasks,
    };
  });
};

interface CharacterName {
  role: string;
  name: string;
  description: string;
}

const ScriptEditorModal: React.FC<ScriptEditorModalProps> = ({
  visible,
  scenes,
  onClose,
  onImport,
}) => {
  const [scriptText, setScriptText] = useState('');
  const [oldCharacterName, setOldCharacterName] = useState('');
  const [newCharacterName, setNewCharacterName] = useState('');
  
  // 起名功能状态
  const [namingModalVisible, setNamingModalVisible] = useState(false);
  const [namingIdea, setNamingIdea] = useState('');
  const [generatedNames, setGeneratedNames] = useState<CharacterName[]>([]);
  const [namingLoading, setNamingLoading] = useState(false);

  // 重新生成功能状态
  const [regenerateModalVisible, setRegenerateModalVisible] = useState(false);
  const [regenerateRequirement, setRegenerateRequirement] = useState('');
  const [regenerating, setRegenerating] = useState(false);

  // 模型选择
  const [providers, setProviders] = useState<ApiProvider[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState<string | undefined>(undefined);
  const [selectedModel, setSelectedModel] = useState<string | undefined>(undefined);

  useEffect(() => {
    (async () => {
      const list = await loadApiProviders();
      setProviders(list.filter(p => p.enabled !== false));
      if (list.length > 0) {
        const first = list.find(p => p.enabled !== false);
        if (first && !selectedProviderId) setSelectedProviderId(first.id);
      }
    })();
  }, []);

  const selectedProvider = providers.find(p => p.id === selectedProviderId);
  const availableModels = selectedProvider?.models || [];

  useEffect(() => {
    if (visible && scenes) {
      setScriptText(scenesToText(scenes));
    }
  }, [visible, scenes]);

  // 替换角色名
  const handleReplaceCharacterName = () => {
    if (!oldCharacterName.trim()) {
      message.warning('请输入要替换的角色名');
      return;
    }
    if (!newCharacterName.trim()) {
      message.warning('请输入新的角色名');
      return;
    }

    const regex = new RegExp(oldCharacterName, 'g');
    const newText = scriptText.replace(regex, newCharacterName);
    const count = (scriptText.match(regex) || []).length;
    
    setScriptText(newText);
    message.success(`已替换 ${count} 处角色名`);
    setOldCharacterName('');
    setNewCharacterName('');
  };

  // 导入脚本到工作台
  const handleImport = () => {
    const parsedScenes = textToScenes(scriptText, scenes);
    onImport(parsedScenes);
    message.success('脚本已导入到工作台');
    onClose();
  };

  // AI生成角色名
  const handleGenerateNames = async () => {
    if (!namingIdea.trim()) {
      message.warning('请输入您的想法');
      return;
    }

    setNamingLoading(true);
    try {
      const names = await aiService.generateCharacterNames(namingIdea.trim());
      if (names.length === 0) {
        message.warning('未能生成角色名，请尝试更详细的描述');
      } else {
        setGeneratedNames(names);
        message.success(`成功生成 ${names.length} 个角色名`);
      }
    } catch (error) {
      message.error(`生成失败: ${error instanceof Error ? error.message : '请检查API配置'}`);
    } finally {
      setNamingLoading(false);
    }
  };

  // 重新生成脚本
  const handleRegenerateScript = async () => {
    if (!regenerateRequirement.trim()) {
      message.warning('请输入您的优化需求');
      return;
    }
    if (!scriptText.trim()) {
      message.warning('当前脚本为空，无法重新生成');
      return;
    }

    setRegenerating(true);
    try {
      const result = await aiService.regenerateScript(scriptText, regenerateRequirement.trim());
      if (result) {
        setScriptText(result);
        setRegenerateModalVisible(false);
        setRegenerateRequirement('');
        message.success('脚本已根据您的需求重新生成');
      } else {
        message.warning('生成结果为空，请重试');
      }
    } catch (error) {
      message.error(`重新生成失败: ${error instanceof Error ? error.message : '请检查API配置'}`);
    } finally {
      setRegenerating(false);
    }
  };

  // 复制角色名到剪贴板
  const handleCopyName = (name: string) => {
    navigator.clipboard.writeText(name);
    message.success(`已复制: ${name}`);
  };

  // 应用角色名到脚本（替换）
  const handleApplyName = (name: string) => {
    setOldCharacterName('');
    setNewCharacterName(name);
    setNamingModalVisible(false);
    message.info(`已填入新角色名: ${name}，请在替换工具中输入要替换的原角色名`);
  };

  // 起名弹窗表格列配置
  const nameColumns = [
    {
      title: '角色类型',
      dataIndex: 'role',
      key: 'role',
      width: 100,
    },
    {
      title: '名字',
      dataIndex: 'name',
      key: 'name',
      width: 120,
      render: (name: string) => <span style={{ fontWeight: 'bold', color: '#a855f7' }}>{name}</span>,
    },
    {
      title: '描述',
      dataIndex: 'description',
      key: 'description',
    },
    {
      title: '操作',
      key: 'action',
      width: 150,
      render: (_: unknown, record: CharacterName) => (
        <>
          <Button 
            type="link" 
            size="small" 
            icon={<CopyOutlined />}
            onClick={() => handleCopyName(record.name)}
          >
            复制
          </Button>
          <Button 
            type="link" 
            size="small"
            onClick={() => handleApplyName(record.name)}
          >
            应用
          </Button>
        </>
      ),
    },
  ];

return (
    <Modal
      title="脚本编辑器"
      open={visible}
      onCancel={onClose}
      width="75vw"
      style={{ top: '8vh' }}
      styles={{ body: { height: '65vh', overflow: 'auto', padding: '16px' } }}
      forceRender
      destroyOnHidden={false}
      footer={[
        <Button key="cancel" onClick={onClose}>取消</Button>,
        <Button 
          key="import" 
          type="primary" 
          icon={<ImportOutlined />}
          onClick={handleImport}
        >
          导入到工作台
        </Button>
      ]}
    >
      <div className={styles.container}>
        {/* 角色名替换工具 */}
        <div className={styles.replaceToolbar}>
          <span className={styles.toolbarLabel}>角色名替换：</span>
          <Input
            placeholder="原角色名"
            value={oldCharacterName}
            onChange={(e) => setOldCharacterName(e.target.value)}
            style={{ width: 120 }}
            size="small"
          />
          <SwapOutlined style={{ margin: '0 8px', color: '#a855f7' }} />
          <Input
            placeholder="新角色名"
            value={newCharacterName}
            onChange={(e) => setNewCharacterName(e.target.value)}
            style={{ width: 120 }}
            size="small"
          />
          <Button 
            type="primary" 
            size="small"
            onClick={handleReplaceCharacterName}
            style={{ marginLeft: 8 }}
          >
            替换
          </Button>
          <Divider type="vertical" style={{ height: 24, margin: '0 16px', borderColor: 'rgba(168, 85, 247, 0.3)' }} />
          <Button 
            type="default" 
            size="small"
            icon={<UserOutlined />}
            onClick={() => setNamingModalVisible(true)}
            className={styles.namingButton}
          >
            AI起名
          </Button>
          <Button 
            type="default" 
            size="small"
            icon={<RedoOutlined />}
            onClick={() => setRegenerateModalVisible(true)}
            className={styles.regenerateButton}
          >
            重新生成
          </Button>
        </div>

        {/* 模型选择器 */}
        {providers.length > 0 && (
          <div className={styles.modelSelectorBar}>
            <span className={styles.modelSelectorLabel}>AI模型：</span>
            <Select
              size="small"
              placeholder="平台"
              value={selectedProviderId}
              onChange={(val) => { setSelectedProviderId(val); setSelectedModel(undefined); }}
              style={{ width: 140 }}
              options={providers.map(p => ({ label: p.name, value: p.id }))}
            />
            <Select
              size="small"
              placeholder="模型"
              value={selectedModel}
              onChange={setSelectedModel}
              style={{ width: 180 }}
              options={availableModels.map(m => ({ label: m.id, value: m.id }))}
              showSearch
              filterOption={(input, option) =>
                (option?.label as string)?.toLowerCase().includes(input.toLowerCase())
              }
            />
          </div>
        )}

        <Divider style={{ margin: '12px 0' }} />

        {/* 脚本文本编辑区 */}
        <TextArea
          value={scriptText}
          onChange={(e) => setScriptText(e.target.value)}
          className={styles.scriptTextArea}
          placeholder="脚本内容..."
        />

        {/* AI起名弹窗 */}
        <Modal
          title={<><UserOutlined style={{ marginRight: 8 }} />AI角色起名</>}
          open={namingModalVisible}
          onCancel={() => {
            setNamingModalVisible(false);
            setGeneratedNames([]);
            setNamingIdea('');
          }}
          footer={null}
          width={700}
          centered
          forceRender
          destroyOnHidden={false}
        >
          <div className={styles.namingContainer}>
            <div className={styles.namingInputSection}>
              <p className={styles.namingHint}>
                请输入您的想法，例如：故事背景、角色性格、时代风格等，AI将为您生成合适的角色名字
              </p>
              <Input.TextArea
                placeholder="例如：古代仙侠风格，需要一个正义感强的男主角，一个温柔的女主角，一个阴险的反派..."
                value={namingIdea}
                onChange={(e) => setNamingIdea(e.target.value)}
                rows={4}
                className={styles.namingInput}
              />
              <Button
                type="primary"
                icon={<RobotOutlined />}
                onClick={handleGenerateNames}
                loading={namingLoading}
                className={styles.generateNameButton}
              >
                生成角色名
              </Button>
            </div>
            {namingLoading ? (
              <div className={styles.namingLoading}>
                <Spin tip="正在生成角色名..." />
              </div>
            ) : generatedNames.length > 0 && (
              <div className={styles.namingResults}>
                <Divider>生成结果</Divider>
                <Table
                  dataSource={generatedNames.map((item, index) => ({ ...item, key: index }))}
                  columns={nameColumns}
                  pagination={false}
                  size="small"
                  className={styles.namingTable}
                />
              </div>
            )}
          </div>
        </Modal>

        {/* 重新生成脚本弹窗 */}
        <Modal
          title={<><RedoOutlined style={{ marginRight: 8 }} />重新生成脚本</>}
          open={regenerateModalVisible}
          onCancel={() => {
            setRegenerateModalVisible(false);
            setRegenerateRequirement('');
          }}
          footer={null}
          width={600}
          centered
          forceRender
          destroyOnHidden={false}
        >
          <div className={styles.regenerateContainer}>
            <p className={styles.regenerateHint}>
              请输入您的优化需求，AI将基于当前脚本内容，按照您的要求重新生成脚本
            </p>
            <Input.TextArea
              placeholder="例如：增加更多对话场景、让反派角色更有深度、减少旁白增加动作描述、将节奏加快..."
              value={regenerateRequirement}
              onChange={(e) => setRegenerateRequirement(e.target.value)}
              rows={4}
              className={styles.regenerateInput}
            />
            <Button
              type="primary"
              icon={<RobotOutlined />}
              onClick={handleRegenerateScript}
              loading={regenerating}
              className={styles.regenerateSubmitButton}
            >
              开始重新生成
            </Button>
          </div>
        </Modal>
      </div>
    </Modal>
  );
};

export default ScriptEditorModal;
