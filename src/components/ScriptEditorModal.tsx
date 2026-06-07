import * as React from 'react';
import { useState, useEffect } from 'react';
import { Modal, Input, Button, Divider, Spin, Table, Select } from 'antd';
import { appMessage as message } from '../utils/antdApp';
import { ImportOutlined, SwapOutlined, UserOutlined, RobotOutlined, CopyOutlined, RedoOutlined } from '@ant-design/icons';
import { Scene, ApiProvider, PromptTemplate } from '../types';
import { aiService } from '../services/aiService';
import { loadApiProviders } from '../services/secureStorage';
import { getAllPromptTemplates } from '../services/database';
import { buildStructuredScenePrompt } from '../utils/scenePrompt';
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
      }
      else if (line.startsWith('对话：')) parsed.dialogue = line.replace('对话：', '').trim();
      else if (line.startsWith('旁白：')) parsed.narration = line.replace('旁白：', '').trim();
      else if (line.startsWith('动作：')) parsed.actionDescription = line.replace('动作：', '').trim();
    });

    const structuredPrompt = buildStructuredScenePrompt({
      description: parsed.description || '',
      prompt: '',
      imagePrompt: '',
      videoPrompt: '',
      character: parsed.character || '',
      dialogue: parsed.dialogue || '',
      narration: parsed.narration || '',
      actionDescription: parsed.actionDescription || '',
    });
    
    // 清理正在进行的任务状态，将 generating 状态重置为 pending
    // 同时清理 imageTasks 和 videoTasks 中的 processing 状态任务
    const cleanedImageTasks = (original.imageTasks || []).filter(t => t.status !== 'processing');
    const cleanedVideoTasks = (original.videoTasks || []).filter(t => t.status !== 'processing');
    
    return { 
      ...original, 
      ...parsed,
      prompt: structuredPrompt || parsed.description || '',
      imagePrompt: structuredPrompt || undefined,
      videoPrompt: structuredPrompt || undefined,
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
  const [scriptTemplates, setScriptTemplates] = useState<PromptTemplate[]>([]);
  const [selectedScriptTemplateId, setSelectedScriptTemplateId] = useState<string | undefined>(undefined);

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

  useEffect(() => {
    getAllPromptTemplates()
      .then(list => setScriptTemplates(list.filter(t => t.type === 'script')))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (selectedScriptTemplateId && !scriptTemplates.some(t => t.id === selectedScriptTemplateId)) {
      setSelectedScriptTemplateId(undefined);
    }
  }, [scriptTemplates, selectedScriptTemplateId]);

  const selectedProvider = providers.find(p => p.id === selectedProviderId);
  const availableModels = selectedProvider?.models || [];
  const selectedScriptTemplate = scriptTemplates.find(t => t.id === selectedScriptTemplateId);

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
    if (!selectedScriptTemplate) {
      message.warning('请先从提示词库选择有效的脚本模板，未选择时已阻止重新生成');
      return;
    }

    setRegenerating(true);
    try {
      const result = await aiService.regenerateScript(scriptText, regenerateRequirement.trim(), {
        providerId: selectedProviderId,
        model: selectedModel,
        template: selectedScriptTemplate,
      });
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
      className={styles.editorModal}
      title={null}
      open={visible}
      onCancel={onClose}
      width={1280}
      centered
      styles={{ body: { height: '84vh', overflow: 'hidden', padding: 0 } }}
      forceRender
      destroyOnHidden={false}
      footer={
        <div className={styles.editorFooter}>
          <Button onClick={onClose}>取消</Button>
          <Button
            type="primary"
            icon={<ImportOutlined />}
            onClick={handleImport}
          >
            导入到工作台
          </Button>
        </div>
      }
    >
      <div className={styles.container}>
        <div className={styles.editorHead}>
          <div className={styles.editorHeadGroup}>
            <ImportOutlined className={styles.editorHeadIcon} />
            <div className={styles.editorHeadText}>
              <div className={styles.editorHeadTitle}>脚本编辑器</div>
              <div className={styles.editorHeadSubtitle}>按分镜结构直接编辑脚本文本，完成后可一键导回工作台</div>
            </div>
          </div>
          <div className={styles.editorHeadMeta}>
            <span className={styles.editorHeadChip}>{scenes.length} 个分镜</span>
            <span className={styles.editorHeadChip}>{scriptText.trim().length} 字</span>
          </div>
        </div>

        <div className={styles.editorBody}>
          <div className={`${styles.toolCard} ${styles.editorToolbarCompact}`}>
            <div className={`${styles.toolbarGroup} ${styles.replaceToolbarGroup}`}>
              <span className={styles.compactLabel}>替换名字</span>
              <Input
                size="small"
                placeholder="原角色名"
                value={oldCharacterName}
                onChange={(e) => setOldCharacterName(e.target.value)}
                className={styles.compactInput}
              />
              <SwapOutlined className={styles.replaceArrow} />
              <Input
                size="small"
                placeholder="新角色名"
                value={newCharacterName}
                onChange={(e) => setNewCharacterName(e.target.value)}
                className={styles.compactInput}
              />
              <Button type="primary" size="small" onClick={handleReplaceCharacterName}>
                替换
              </Button>
            </div>
            <div className={`${styles.toolbarGroup} ${styles.actionToolbarGroup}`}>
              <Button
                type="default"
                size="small"
                icon={<UserOutlined />}
                onClick={() => setNamingModalVisible(true)}
                className={styles.namingButton}
              >
                AI 起名
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
            {providers.length > 0 && (
              <div className={`${styles.toolbarGroup} ${styles.modelToolbarGroup}`}>
                <span className={styles.compactLabel}>优化模型</span>
                <Select
                  size="small"
                  placeholder="平台"
                  value={selectedProviderId}
                  onChange={(val) => { setSelectedProviderId(val); setSelectedModel(undefined); }}
                  className={styles.toolbarProviderSelect}
                  options={providers.map(p => ({ label: p.name, value: p.id }))}
                />
                <Select
                  size="small"
                  placeholder="模型"
                  value={selectedModel}
                  onChange={setSelectedModel}
                  className={styles.toolbarModelSelect}
                  options={availableModels.map(m => ({ label: m.id, value: m.id }))}
                  showSearch
                  filterOption={(input, option) =>
                    (option?.label as string)?.toLowerCase().includes(input.toLowerCase())
                  }
                />
              </div>
            )}
          </div>

          <div className={`${styles.toolCard} ${styles.editorCanvas}`}>
            <div className={styles.panelHead}>
              <div>
                <div className={styles.panelTitle}>脚本文本</div>
                <div className={styles.panelHint}>建议保持 `【分镜 n】` 的结构编辑，主编辑区会优先占据更多弹窗空间</div>
              </div>
            </div>
            <TextArea
              value={scriptText}
              onChange={(e) => setScriptText(e.target.value)}
              className={styles.scriptTextArea}
              placeholder="脚本内容..."
              rows={24}
            />
          </div>
        </div>

        {/* AI起名弹窗 */}
        <Modal
          className={styles.assistModal}
          title={null}
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
          <div className={styles.assistModalHead}>
            <UserOutlined className={styles.assistModalHeadIcon} />
            <div>
              <div className={styles.assistModalTitle}>AI 角色起名</div>
              <div className={styles.assistModalSubtitle}>根据人物设定、时代背景和气质方向生成可直接应用的名字</div>
            </div>
          </div>
          <div className={styles.assistModalBody}>
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
          </div>
        </Modal>

        {/* 重新生成脚本弹窗 */}
        <Modal
          className={styles.assistModal}
          title={null}
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
          <div className={styles.assistModalHead}>
            <RedoOutlined className={styles.assistModalHeadIcon} />
            <div>
              <div className={styles.assistModalTitle}>重新生成脚本</div>
              <div className={styles.assistModalSubtitle}>结合模板和优化要求，让当前脚本朝新的方向迭代</div>
            </div>
          </div>
          <div className={styles.assistModalBody}>
          <div className={styles.regenerateContainer}>
            <p className={styles.regenerateHint}>
              请输入您的优化需求，并选择提示词库中的脚本模板；系统已移除内置脚本模板，未选择模板时不会执行重新生成
            </p>
            <Select
              placeholder={scriptTemplates.length > 0 ? '请选择脚本模板' : '请先在提示词库创建 script 类型模板'}
              value={selectedScriptTemplateId}
              onChange={setSelectedScriptTemplateId}
              options={scriptTemplates.map(t => ({ label: t.name, value: t.id }))}
              style={{ width: '100%', marginBottom: 12 }}
            />
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
              disabled={!selectedScriptTemplate}
              className={styles.regenerateSubmitButton}
            >
              开始重新生成
            </Button>
          </div>
          </div>
        </Modal>
      </div>
    </Modal>
  );
};

export default ScriptEditorModal;
