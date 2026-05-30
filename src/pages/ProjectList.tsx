import * as React from 'react';
import { useEffect, useState } from 'react';
import { Card, Button, Modal, Input, Empty, Spin, message, Row, Col, Popconfirm, Radio, Tag, Select } from 'antd';
import { PlusOutlined, DeleteOutlined, EditOutlined, PlayCircleOutlined, RobotOutlined, BulbOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useRecoilState } from 'recoil';
import { v4 as uuidv4 } from 'uuid';
import { projectListState, currentProjectState } from '../store/projectStore';
import { getAllProjects, saveProject, deleteProject as deleteProjectFromDB } from '../services/database';
import { Project, Scene, ApiProvider, PromptTemplate } from '../types';
import { aiService, ScriptMode } from '../services/aiService';
import { loadApiProviders } from '../services/secureStorage';
import { getAllPromptTemplates } from '../services/database';
import ScriptEditorModal from '../components/ScriptEditorModal';
import styles from './ProjectList.module.css';

const { TextArea } = Input;

const ProjectList: React.FC = () => {
  const navigate = useNavigate();
  const [projects, setProjects] = useRecoilState(projectListState);
  const [currentProject, setCurrentProject] = useRecoilState(currentProjectState);
  const [loading, setLoading] = useState(true);
  const [modalVisible, setModalVisible] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [novelContent, setNovelContent] = useState('');
  const [scriptMode, setScriptMode] = useState<ScriptMode>('dialogue');
  const [customRequirement, setCustomRequirement] = useState('');
  const [generating, setGenerating] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [generatingModal, setGeneratingModal] = useState(false);
  const [generatingLog, setGeneratingLog] = useState<string[]>([]);
  const [scriptEditorVisible, setScriptEditorVisible] = useState(false);
  const [scriptEditorProject, setScriptEditorProject] = useState<Project | null>(null);

  // 脚本模板
  const [scriptTemplates, setScriptTemplates] = useState<PromptTemplate[]>([]);
  const [selectedScriptTemplateId, setSelectedScriptTemplateId] = useState<string | undefined>(undefined);

  useEffect(() => { getAllPromptTemplates().then(d => setScriptTemplates(d.filter(t => t.type === 'script'))).catch(() => {}); }, []);

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
        if (first && !selectedProviderId) {
          setSelectedProviderId(first.id);
        }
      }
    })();
  }, []);

  // 当前选中provider的模型列表
  const selectedProvider = providers.find(p => p.id === selectedProviderId);
  const availableModels = selectedProvider?.models || [];

  useEffect(() => {
    let cancelled = false;
    const loadProjects = async () => {
      try {
        setLoading(true);
        const loadedProjects = await getAllProjects();
        if (cancelled) return;
        setProjects([...loadedProjects].reverse());
      } catch (error) {
        if (cancelled) return;
        message.error('加载项目失败');
        console.error(error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    loadProjects();
    return () => { cancelled = true; };
  }, []);

  const handleCreateProject = async () => {
    if (!newProjectName.trim()) {
      message.warning('请输入项目名称');
      return;
    }

    if (!novelContent.trim()) {
      message.warning('请输入小说原文');
      return;
    }

    setGenerating(true);
    setGeneratingModal(true);
    const hasCustomReq = customRequirement.trim().length > 0;
    setGeneratingLog([
      '✅ 开始生成分镜脚本...',
      `📝 脚本模式: ${scriptMode === 'dialogue' ? '纯对话剧本' : '解说对话模式'}`,
      ...(hasCustomReq ? [`🎯 自定义要求: ${customRequirement.trim().slice(0, 50)}${customRequirement.trim().length > 50 ? '...' : ''}`] : []),
      '⏳ 正在调用AI模型...'
    ]);

    try {
      setGeneratingLog(prev => [...prev, '🤖 AI正在分析小说内容...']);
      const selTemplate = selectedScriptTemplateId ? scriptTemplates.find(t => t.id === selectedScriptTemplateId) : undefined;
      const scriptScenes = await aiService.generateScript(
        novelContent.trim(), scriptMode, customRequirement.trim() || undefined,
        { model: selectedModel, providerId: selectedProviderId,
          template: selTemplate ? { positive_prompt: selTemplate.positive_prompt } : undefined },
      );
      setGeneratingLog(prev => [...prev, `✅ AI分析完成，共生成 ${scriptScenes.length} 个分镜`]);
      
      const scenes: Scene[] = scriptScenes.map((s, index) => ({
        id: uuidv4(),
        order: s.order || index + 1,
        description: s.sceneDescription,
        prompt: s.sceneDescription || '',
        generationMode: 'text-to-image' as const,
        images: {},
        videos: [],
        status: 'pending' as const,
        dialogue: s.dialogue,
        character: s.character,
        narration: s.narration,
        actionDescription: s.actionDescription
      }));

      const newProject: Project = {
        id: uuidv4(),
        name: newProjectName.trim(),
        script: scenes,
        novelContent: novelContent.trim(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      setGeneratingLog(prev => [...prev, '💾 正在保存项目...']);
      await saveProject(newProject);
      setProjects([newProject, ...projects]);
      setGeneratingLog(prev => [...prev, '✅ 项目保存成功！']);
      
      setTimeout(() => {
        setGeneratingModal(false);
        setModalVisible(false);
        setNewProjectName('');
        setNovelContent('');
        setCustomRequirement('');
        setCurrentProject(newProject);
        navigate(`/workspace/${newProject.id}`);
      }, 1500);
    } catch (error) {
      setGeneratingLog(prev => [...prev, `❌ 生成失败: ${error instanceof Error ? error.message : '请检查API配置'}`]);
      console.error(error);
    } finally {
      setGenerating(false);
    }
  };

  const handleUpdateProject = async () => {
    if (!editingProject || !newProjectName.trim()) {
      message.warning('请输入项目名称');
      return;
    }

    const updatedProject: Project = {
      ...editingProject,
      name: newProjectName.trim(),
      updatedAt: new Date(),
    };

    try {
      await saveProject(updatedProject);
      setProjects(projects.map(p => p.id === updatedProject.id ? updatedProject : p));
      setEditingProject(null);
      setModalVisible(false);
      setNewProjectName('');
      message.success('项目更新成功');
    } catch (error) {
      message.error('更新项目失败');
      console.error(error);
    }
  };

  const handleDeleteProject = async (projectId: string) => {
    try {
      await deleteProjectFromDB(projectId);
      setProjects(projects.filter(p => p.id !== projectId));
      if (currentProject?.id === projectId) setCurrentProject(null as any);
      message.success('项目已删除');
    } catch (error) {
      message.error('删除项目失败');
      console.error(error);
    }
  };

  const handleOpenProject = (project: Project) => {
    setCurrentProject(project);
    navigate(`/workspace/${project.id}`);
  };

  const openEditModal = (project: Project, e: React.MouseEvent) => {
    e.stopPropagation();
    // 如果项目已有脚本，打开脚本编辑弹窗
    if (project.script && project.script.length > 0) {
      setScriptEditorProject(project);
      setScriptEditorVisible(true);
    } else {
      // 否则打开原有的编辑弹窗
      setEditingProject(project);
      setNewProjectName(project.name);
      setNovelContent(project.novelContent || '');
      setModalVisible(true);
    }
  };

  // 处理脚本导入
  const handleScriptImport = async (scenes: Scene[]) => {
    if (!scriptEditorProject) return;
    
    const updatedProject: Project = {
      ...scriptEditorProject,
      script: scenes,
      updatedAt: new Date(),
    };
    
    try {
      await saveProject(updatedProject);
      setProjects(projects.map(p => p.id === updatedProject.id ? updatedProject : p));
      setScriptEditorProject(null);
      setScriptEditorVisible(false);
    } catch (error) {
      message.error('保存脚本失败');
      console.error(error);
    }
  };

  const handleImportScript = async () => {
    if (!editingProject) return;
    if (!novelContent.trim()) {
      message.warning('请先输入小说原文');
      return;
    }

    setGenerating(true);
    setGeneratingModal(true);
    const hasCustomReqForImport = customRequirement.trim().length > 0;
    setGeneratingLog([
      '✅ 开始重新生成分镜脚本...',
      `📝 脚本模式: ${scriptMode === 'dialogue' ? '纯对话剧本' : '解说对话模式'}`,
      ...(hasCustomReqForImport ? [`🎯 自定义要求: ${customRequirement.trim().slice(0, 50)}${customRequirement.trim().length > 50 ? '...' : ''}`] : []),
      '⏳ 正在调用AI模型...'
    ]);

    try {
      setGeneratingLog(prev => [...prev, '🤖 AI正在分析小说内容...']);
      const selTemplate2 = selectedScriptTemplateId ? scriptTemplates.find(t => t.id === selectedScriptTemplateId) : undefined;
      const scriptScenes = await aiService.generateScript(
        novelContent.trim(), scriptMode, customRequirement.trim() || undefined,
        { model: selectedModel, providerId: selectedProviderId,
          template: selTemplate2 ? { positive_prompt: selTemplate2.positive_prompt } : undefined },
      );
      setGeneratingLog(prev => [...prev, `✅ AI分析完成，共生成 ${scriptScenes.length} 个分镜`]);
      
      const scenes: Scene[] = scriptScenes.map((s, index) => ({
        id: uuidv4(),
        order: s.order || index + 1,
        description: s.sceneDescription,
        prompt: s.sceneDescription || '',
        generationMode: 'text-to-image' as const,
        images: {},
        videos: [],
        status: 'pending' as const,
        dialogue: s.dialogue,
        character: s.character,
        narration: s.narration,
        actionDescription: s.actionDescription
      }));

      const updatedProject: Project = {
        ...editingProject,
        name: newProjectName.trim(),
        novelContent: novelContent.trim(),
        script: scenes,
        updatedAt: new Date(),
      };

      setGeneratingLog(prev => [...prev, '💾 正在保存项目...']);
      await saveProject(updatedProject);
      setProjects(projects.map(p => p.id === updatedProject.id ? updatedProject : p));
      setGeneratingLog(prev => [...prev, '✅ 脚本导入成功！']);
      
      setTimeout(() => {
        setGeneratingModal(false);
        setModalVisible(false);
        setEditingProject(null);
        setNewProjectName('');
        setNovelContent('');
        setCustomRequirement('');
      }, 1500);
    } catch (error) {
      setGeneratingLog(prev => [...prev, `❌ 导入失败: ${error instanceof Error ? error.message : '请检查API配置'}`]);
      console.error(error);
    } finally {
      setGenerating(false);
    }
  };

  const openCreateModal = () => {
    setEditingProject(null);
    setNewProjectName('');
    setNovelContent('');
    setScriptMode('dialogue');
    setCustomRequirement('');
    setModalVisible(true);
  };

  if (loading) {
    return (
      <div className={styles.loadingContainer}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1>我的作品</h1>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreateModal}>
          新建项目
        </Button>
      </div>

      {projects.length === 0 ? (
        <Empty
          description="还没有任何项目"
          className={styles.empty}
        >
          <Button type="primary" onClick={openCreateModal}>
            创建第一个项目
          </Button>
        </Empty>
      ) : (
        <Row gutter={[24, 24]}>
          {projects.map(project => (
            <Col key={project.id} xs={24} sm={12} md={8} lg={6}>
              <Card
                hoverable
                className={styles.projectCard}
                cover={
                  <div className={styles.cardCover}>
                    {project.cover ? (
                      <img src={project.cover} alt={project.name} />
                    ) : project.script?.[0]?.images?.keyFrame ? (
                      <img src={project.script[0].images.keyFrame} alt={project.name} />
                    ) : (
                      <div className={styles.placeholder}>
                        <PlayCircleOutlined />
                      </div>
                    )}
                  </div>
                }
                actions={[
                  <EditOutlined key="edit" onClick={(e) => openEditModal(project, e)} />,
                  <Popconfirm
                    key="delete"
                    title="确定删除此项目？"
                    onConfirm={() => handleDeleteProject(project.id)}
                    okText="确定"
                    cancelText="取消"
                  >
                    <DeleteOutlined onClick={(e) => e.stopPropagation()} />
                  </Popconfirm>,
                ]}
                onClick={() => handleOpenProject(project)}
              >
                <Card.Meta
                  title={project.name}
                  description={`${project.script.length} 个分镜 · ${new Date(project.updatedAt).toLocaleDateString()}`}
                />
              </Card>
            </Col>
          ))}
        </Row>
      )}

      <Modal
        className="premium-modal"
        title={editingProject ? '编辑项目' : '新建项目'}
        open={modalVisible}
        onCancel={() => {
          setModalVisible(false);
          setEditingProject(null);
          setNewProjectName('');
          setNovelContent('');
          setCustomRequirement('');
        }}
        footer={editingProject ? [
          <Button key="cancel" onClick={() => {
            setModalVisible(false);
            setEditingProject(null);
            setNewProjectName('');
            setNovelContent('');
            setCustomRequirement('');
          }}>取消</Button>,
          editingProject.script.length > 0 && (
            <Button 
              key="import" 
              type="default" 
              icon={<RobotOutlined />}
              loading={generating}
              onClick={handleImportScript}
            >
              重新导入脚本
            </Button>
          ),
          <Button key="ok" type="primary" onClick={handleUpdateProject}>保存</Button>
        ].filter(Boolean) : [
          <Button key="cancel" onClick={() => {
            setModalVisible(false);
            setNewProjectName('');
            setNovelContent('');
            setCustomRequirement('');
          }}>取消</Button>,
          <Button 
            key="generate" 
            type="primary" 
            icon={<RobotOutlined />}
            loading={generating}
            onClick={handleCreateProject}
          >
            AI 生成脚本
          </Button>
        ]}
        width="75vw"
        style={{ top: '12.5vh' }}
        styles={{ body: { height: '60vh', overflow: 'auto' } }}
        forceRender
        destroyOnClose={false}
      >
        <div className={styles.modalForm}>
          <div className={styles.formItem}>
            <label>项目名称</label>
            <Input
              placeholder="请输入项目名称"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              autoFocus
            />
          </div>
          <div className={styles.formItem}>
            <label>脚本模式</label>
            <Radio.Group 
              value={scriptMode} 
              onChange={(e) => setScriptMode(e.target.value)}
              className={styles.modeSelector}
            >
              <Radio.Button value="dialogue">纯对话剧本</Radio.Button>
              <Radio.Button value="narration">解说对话模式</Radio.Button>
            </Radio.Group>
            <p className={styles.modeHint}>
              {scriptMode === 'dialogue' 
                ? '纯对话剧本：只包含角色之间的对话，适合对话驱动的故事' 
                : '解说对话模式：包含旁白解说词和角色对话，适合需要场景描述的故事'}
            </p>
          </div>

          {/* 脚本模板选择器 */}
          {scriptTemplates.length > 0 && (
            <div className={styles.formItem}>
              <label>脚本模板 <Tag color="purple" style={{ marginLeft: 6, fontSize: 11 }}>可选</Tag></label>
              <Select
                placeholder="选择提示词库中的脚本模板"
                value={selectedScriptTemplateId}
                onChange={setSelectedScriptTemplateId}
                allowClear
                options={scriptTemplates.map(t => ({ label: t.name, value: t.id }))}
              />
              <p className={styles.modeHint} style={{ marginTop: 6 }}>
                选择模板后AI将按模板格式生成脚本，模板可在提示词库中自定义创建
              </p>
            </div>
          )}

          {/* 模型选择器 */}
          {providers.length > 0 && (
            <div className={styles.formItem}>
              <label>AI模型选择</label>
              <div className={styles.modelSelectorRow}>
                <Select
                  placeholder="选择API平台"
                  value={selectedProviderId}
                  onChange={(val) => {
                    setSelectedProviderId(val);
                    setSelectedModel(undefined);
                  }}
                  className={styles.providerSelect}
                  options={providers.map(p => ({ label: p.name, value: p.id }))}
                />
                <Select
                  placeholder="选择模型"
                  value={selectedModel}
                  onChange={setSelectedModel}
                  className={styles.modelSelect}
                  options={availableModels.map(m => ({ label: m.id, value: m.id }))}
                  showSearch
                  filterOption={(input, option) =>
                    (option?.label as string)?.toLowerCase().includes(input.toLowerCase())
                  }
                />
              </div>
              <p className={styles.modelSelectorHint}>
                选择用于生成脚本的API平台和模型
              </p>
            </div>
          )}

          <div className={styles.formItem}>
            <label>小说原文</label>
            <TextArea
              placeholder="请输入小说原文内容，AI将根据原文自动生成分镜脚本..."
              value={novelContent}
              onChange={(e) => setNovelContent(e.target.value)}
              className={styles.novelInput}
              autoSize={{ minRows: 12, maxRows: 20 }}
            />
          </div>
          <div className={styles.formItem}>
            <div className={styles.customReqHeader}>
              <BulbOutlined className={styles.customReqIcon} />
              <label>自定义创作要求 <Tag color="purple" style={{ marginLeft: 6, fontSize: 11 }}>可选</Tag></label>
            </div>
            <p className={styles.customReqHint}>
              AI 将严格遵守您的创作要求生成脚本。例如：主角要更强势、减少旁白多写对话、每集控制在20个分镜内、突出感情戏等。
            </p>
            <TextArea
              placeholder="例如：主角说话要更有霸气，不要出现旁白解说，控制每集分镜在15个以内，多写动作描写..."
              value={customRequirement}
              onChange={(e) => setCustomRequirement(e.target.value)}
              className={styles.customReqInput}
              autoSize={{ minRows: 3, maxRows: 6 }}
              showCount
              maxLength={500}
            />
          </div>
        </div>
      </Modal>

      <Modal
        title="🎬 生成分镜脚本"
        open={generatingModal}
        footer={generating ? null : [
          <Button key="close" onClick={() => setGeneratingModal(false)}>关闭</Button>
        ]}
        closable={!generating}
        maskClosable={false}
        centered
        width={500}
        forceRender
        destroyOnClose={false}
      >
        <div className={styles.generatingLog}>
          {generatingLog.map((log, index) => (
            <p key={index} className={styles.logItem}>{log}</p>
          ))}
          {generating && <Spin size="small" style={{ marginTop: 8 }} />}
        </div>
      </Modal>

      {/* 脚本编辑弹窗 */}
      <ScriptEditorModal
        visible={scriptEditorVisible}
        scenes={scriptEditorProject?.script || []}
        onClose={() => {
          setScriptEditorVisible(false);
          setScriptEditorProject(null);
        }}
        onImport={handleScriptImport}
      />
    </div>
  );
};

export default ProjectList;
