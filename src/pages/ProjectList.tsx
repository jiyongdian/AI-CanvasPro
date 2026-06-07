import * as React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Card, Button, Modal, Input, Empty, Spin, Row, Col, Popconfirm, Radio, Tag, Select } from 'antd';
import { appMessage as message } from '../utils/antdApp';
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
import { normalizeImportedScenePrompt } from '../utils/scenePrompt';
import styles from './ProjectList.module.css';

const { TextArea } = Input;
const CREATE_DRAFT_STORAGE_KEYS = {
  name: 'pl_name',
  novel: 'pl_novel',
  mode: 'pl_mode',
  requirement: 'pl_req',
  template: 'pl_template',
  provider: 'pl_provider',
  model: 'pl_model',
} as const;

const loadCreateDraft = () => ({
  name: localStorage.getItem(CREATE_DRAFT_STORAGE_KEYS.name) || '',
  novel: localStorage.getItem(CREATE_DRAFT_STORAGE_KEYS.novel) || '',
  mode: (localStorage.getItem(CREATE_DRAFT_STORAGE_KEYS.mode) as ScriptMode) || 'dialogue',
  requirement: localStorage.getItem(CREATE_DRAFT_STORAGE_KEYS.requirement) || '',
  template: localStorage.getItem(CREATE_DRAFT_STORAGE_KEYS.template) || undefined,
  provider: localStorage.getItem(CREATE_DRAFT_STORAGE_KEYS.provider) || undefined,
  model: localStorage.getItem(CREATE_DRAFT_STORAGE_KEYS.model) || undefined,
});

const normalizeImportedScene = (scene: Scene): Scene => normalizeImportedScenePrompt(scene);

const ProjectList: React.FC = () => {
  const navigate = useNavigate();
  const [projects, setProjects] = useRecoilState(projectListState);
  const [currentProject, setCurrentProject] = useRecoilState(currentProjectState);
  const [loading, setLoading] = useState(true);
  const [modalVisible, setModalVisible] = useState(false);
  const [newProjectName, setNewProjectName] = useState(() => loadCreateDraft().name);
  const [novelContent, setNovelContent] = useState(() => loadCreateDraft().novel);
  const [scriptMode, setScriptMode] = useState<ScriptMode>(() => loadCreateDraft().mode);
  const [customRequirement, setCustomRequirement] = useState(() => loadCreateDraft().requirement);
  const [generating, setGenerating] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [generatingModal, setGeneratingModal] = useState(false);
  const [generatingLog, setGeneratingLog] = useState<string[]>([]);
  const [streamContent, setStreamContent] = useState('');
  const [scriptEditorVisible, setScriptEditorVisible] = useState(false);
  const [scriptEditorProject, setScriptEditorProject] = useState<Project | null>(null);

  // 脚本模板
  const [scriptTemplates, setScriptTemplates] = useState<PromptTemplate[]>([]);
  const [selectedScriptTemplateId, setSelectedScriptTemplateId] = useState<string | undefined>(() => loadCreateDraft().template);
  const selectedScriptTemplate = useMemo(
    () => scriptTemplates.find(t => t.id === selectedScriptTemplateId),
    [scriptTemplates, selectedScriptTemplateId],
  );
  const totalScenes = useMemo(
    () => projects.reduce((sum, project) => sum + project.script.length, 0),
    [projects],
  );

  useEffect(() => { getAllPromptTemplates().then(d => setScriptTemplates(d.filter(t => t.type === 'script'))).catch(() => {}); }, []);
  useEffect(() => {
    if (selectedScriptTemplateId && !scriptTemplates.some(t => t.id === selectedScriptTemplateId)) {
      setSelectedScriptTemplateId(undefined);
    }
  }, [scriptTemplates, selectedScriptTemplateId]);
  // 弹窗字段持久化
  const persistCreateDraftValue = (key: string, value?: string) => {
    if (editingProject) return;
    if (value && value.length > 0) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  };
  useEffect(() => { persistCreateDraftValue(CREATE_DRAFT_STORAGE_KEYS.name, newProjectName); }, [newProjectName, editingProject]);
  useEffect(() => { persistCreateDraftValue(CREATE_DRAFT_STORAGE_KEYS.novel, novelContent); }, [novelContent, editingProject]);
  useEffect(() => { persistCreateDraftValue(CREATE_DRAFT_STORAGE_KEYS.mode, scriptMode); }, [scriptMode, editingProject]);
  useEffect(() => { persistCreateDraftValue(CREATE_DRAFT_STORAGE_KEYS.requirement, customRequirement); }, [customRequirement, editingProject]);
  useEffect(() => { persistCreateDraftValue(CREATE_DRAFT_STORAGE_KEYS.template, selectedScriptTemplateId); }, [selectedScriptTemplateId, editingProject]);
  const applyCreateDraft = () => {
    const draft = loadCreateDraft();
    setNewProjectName(draft.name);
    setNovelContent(draft.novel);
    setScriptMode(draft.mode);
    setCustomRequirement(draft.requirement);
    setSelectedScriptTemplateId(draft.template);
    setSelectedProviderId(draft.provider);
    setSelectedModel(draft.model);
  };
  const clearCreateDraft = () => {
    setNewProjectName('');
    setNovelContent('');
    setScriptMode('dialogue');
    setCustomRequirement('');
    setSelectedScriptTemplateId(undefined);
    setSelectedProviderId(undefined);
    setSelectedModel(undefined);
    Object.values(CREATE_DRAFT_STORAGE_KEYS).forEach((key) => localStorage.removeItem(key));
  };

  // 模型选择
  const [providers, setProviders] = useState<ApiProvider[]>([]);
  const [providersLoaded, setProvidersLoaded] = useState(false);
  const [selectedProviderId, setSelectedProviderId] = useState<string | undefined>(() => loadCreateDraft().provider);
  const [selectedModel, setSelectedModel] = useState<string | undefined>(() => loadCreateDraft().model);

  useEffect(() => {
    (async () => {
      try {
        const list = await loadApiProviders();
        const enabledProviders = list.filter(p => p.enabled !== false);
        setProviders(enabledProviders);

        if (enabledProviders.length === 0) {
          setSelectedProviderId(undefined);
          setSelectedModel(undefined);
          return;
        }

        const draft = loadCreateDraft();
        const restoredProviderId = draft.provider && enabledProviders.some(p => p.id === draft.provider)
          ? draft.provider
          : enabledProviders[0].id;
        const restoredProvider = enabledProviders.find(p => p.id === restoredProviderId);
        const restoredModel = draft.model && restoredProvider?.models.some(m => m.id === draft.model)
          ? draft.model
          : undefined;

        setSelectedProviderId(restoredProviderId);
        setSelectedModel(restoredModel);
      } finally {
        setProvidersLoaded(true);
      }
    })();
  }, []);

  // 当前选中provider的模型列表
  const selectedProvider = providers.find(p => p.id === selectedProviderId);
  const availableModels = selectedProvider?.models || [];
  useEffect(() => {
    persistCreateDraftValue(CREATE_DRAFT_STORAGE_KEYS.provider, selectedProviderId);
  }, [selectedProviderId, editingProject]);
  useEffect(() => {
    if (editingProject || !providersLoaded) return;
    if (!selectedProvider) {
      if (selectedModel) setSelectedModel(undefined);
      return;
    }
    if (selectedModel && !selectedProvider.models.some(m => m.id === selectedModel)) {
      setSelectedModel(undefined);
    }
  }, [selectedProvider, selectedModel, editingProject, providersLoaded]);
  useEffect(() => {
    persistCreateDraftValue(CREATE_DRAFT_STORAGE_KEYS.model, selectedModel);
  }, [selectedModel, editingProject]);

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

    if (!selectedScriptTemplate) {
      message.warning('请先从提示词库选择有效的脚本模板，未选择时不允许开始生成');
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
      setStreamContent('');
      const scriptScenes = await aiService.generateScript(
        novelContent.trim(), scriptMode, customRequirement.trim() || undefined,
        { model: selectedModel, providerId: selectedProviderId,
          template: selectedScriptTemplate,
          onChunk: (text) => setStreamContent(text) },
      );
      setGeneratingLog(prev => [...prev, `✅ AI分析完成，共生成 ${scriptScenes.length} 个分镜`]);
      
      const scenes: Scene[] = scriptScenes.map((s, index) => normalizeImportedScene({
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
        clearCreateDraft();
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
      applyCreateDraft();
      message.success('项目更新成功');
    } catch (error) {
      message.error('更新项目失败');
      console.error(error);
    }
  };

  const handleDeleteProject = async (projectId: string) => {
    const wasCurrent = currentProject?.id === projectId;
    if (wasCurrent) setCurrentProject(null as any);
    try {
      await deleteProjectFromDB(projectId);
      setProjects(projects.filter(p => p.id !== projectId));
      message.success('项目已删除');
    } catch (error) {
      if (wasCurrent) setCurrentProject(currentProject);
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
      script: scenes.map(normalizeImportedScene),
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
    if (!selectedScriptTemplate) {
      message.warning('请先从提示词库选择有效的脚本模板，未选择时不允许开始生成');
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
      setStreamContent('');
      const scriptScenes = await aiService.generateScript(
        novelContent.trim(), scriptMode, customRequirement.trim() || undefined,
        { model: selectedModel, providerId: selectedProviderId,
          template: selectedScriptTemplate,
          onChunk: (text) => setStreamContent(text) },
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
        applyCreateDraft();
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
    applyCreateDraft();
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
      <div className={styles.hero}>
        <div className={styles.heroMain}>
          <div className={styles.heroTitleRow}>
            <h1>我的作品</h1>
            <span className={styles.heroCount}>{projects.length}</span>
          </div>
          <p className={styles.heroSubtle}>项目、分镜与创作入口统一管理</p>
        </div>
        <div className={styles.heroActions}>
          <div className={styles.heroStat}>
            <span>总分镜</span>
            <strong>{totalScenes}</strong>
          </div>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreateModal}>
            新建项目
          </Button>
        </div>
      </div>

      {projects.length === 0 ? (
        <div className={styles.emptyPanel}>
          <Empty
            description="还没有任何项目"
            className={styles.empty}
          >
            <Button type="primary" onClick={openCreateModal}>
              创建第一个项目
            </Button>
          </Empty>
        </div>
      ) : (
        <Row gutter={[24, 24]} className={styles.projectGrid}>
          {projects.map(project => (
            <Col key={project.id} xs={24} sm={12} md={8} lg={6}>
              <Card
                hoverable
                className={styles.projectCard}
                cover={
                  <div className={styles.cardCover}>
                    <div className={styles.coverBadge}>{project.script.length} 镜</div>
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
                <div className={styles.cardMeta}>
                  <div className={styles.cardTitleRow}>
                    <div className={styles.cardTitle}>{project.name}</div>
                    <Tag className={styles.sceneTag}>{project.script.length} 分镜</Tag>
                  </div>
                  <div className={styles.cardDesc}>
                    <span>最近更新</span>
                    <strong>{new Date(project.updatedAt).toLocaleDateString()}</strong>
                  </div>
                </div>
              </Card>
            </Col>
          ))}
        </Row>
      )}

      <Modal
        className={styles.projectEditorModal}
        title={null}
        open={modalVisible}
        onCancel={() => {
          setModalVisible(false);
          setEditingProject(null);
          if (editingProject) applyCreateDraft();
        }}
        footer={
          <div className={styles.projectEditorFooter}>
            <Button onClick={() => {
              setModalVisible(false);
              if (editingProject) {
                setEditingProject(null);
                applyCreateDraft();
              }
            }}
            >
              取消
            </Button>
            {editingProject?.script.length ? (
              <Button
                type="default"
                icon={<RobotOutlined />}
                loading={generating}
                disabled={!selectedScriptTemplate}
                onClick={handleImportScript}
              >
                重新导入脚本
              </Button>
            ) : null}
            {editingProject ? (
              <Button type="primary" onClick={handleUpdateProject}>
                保存项目
              </Button>
            ) : (
              <Button
                type="primary"
                icon={<RobotOutlined />}
                loading={generating}
                disabled={!selectedScriptTemplate}
                onClick={handleCreateProject}
              >
                AI 生成脚本
              </Button>
            )}
          </div>
        }
        width={1120}
        centered
        styles={{ body: { height: '86vh', overflow: 'auto', padding: 0 } }}
        forceRender
        destroyOnHidden={false}
      >
        <div className={styles.projectEditorHead}>
          <EditOutlined className={styles.projectEditorHeadIcon} />
          <div className={styles.projectEditorHeadText}>
            <div className={styles.projectEditorHeadTitle}>
              {editingProject ? '编辑项目信息' : '新建作品项目'}
            </div>
            <div className={styles.projectEditorHeadSubtitle}>
              {editingProject
                ? '快速调整参数，并把更多空间留给正文编辑'
                : '顶部参数简洁配置，主体区域专注原文与要求编辑'}
            </div>
          </div>
        </div>
        <div className={styles.projectEditorBody}>
          <div className={`${styles.formCard} ${styles.projectMetaCard}`}>
            <div className={styles.projectSectionHead}>
              <div>
                <div className={styles.projectSectionTitle}>生成参数</div>
                <div className={styles.projectSectionHint}>参数区保持简洁，主空间留给下方输入框</div>
              </div>
            </div>
            <div className={styles.projectMetaTopRow}>
              <div className={`${styles.formItem} ${styles.projectNameField}`}>
                <label>项目名称</label>
                <Input
                  placeholder="请输入项目名称，例如：第一集 分镜脚本"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  autoFocus
                />
              </div>
              <div className={styles.projectMetaStatus}>
                <span className={styles.projectSectionBadge}>{editingProject ? '编辑中' : '待生成'}</span>
                <span className={styles.projectSectionBadge}>
                  {scriptMode === 'dialogue' ? '纯对话剧本' : '解说对话模式'}
                </span>
              </div>
            </div>
            <div className={styles.projectMetaGrid}>
              <div className={styles.projectConfigBlock}>
                <div className={styles.projectConfigBlockHead}>
                  <span className={styles.projectConfigTitle}>脚本模式</span>
                  <span className={styles.projectConfigHint}>选择输出结构</span>
                </div>
                <Radio.Group
                  value={scriptMode}
                  onChange={(e) => setScriptMode(e.target.value)}
                  className={styles.modeSelector}
                >
                  <Radio.Button value="dialogue">纯对话剧本</Radio.Button>
                  <Radio.Button value="narration">解说对话模式</Radio.Button>
                </Radio.Group>
              </div>
              <div className={styles.projectConfigBlock}>
                <div className={styles.projectConfigBlockHead}>
                  <span className={styles.projectConfigTitle}>脚本模板 <Tag color="red" style={{ marginLeft: 6, fontSize: 11 }}>必选</Tag></span>
                  <span className={styles.projectConfigHint}>控制生成风格</span>
                </div>
                {scriptTemplates.length > 0 ? (
                  <Select
                    placeholder="必须选择提示词库中的脚本模板"
                    value={selectedScriptTemplateId}
                    onChange={setSelectedScriptTemplateId}
                    options={scriptTemplates.map(t => ({ label: t.name, value: t.id }))}
                  />
                ) : (
                  <div className={styles.projectInlineNotice}>
                    当前没有可用脚本模板，请先去提示词库创建。
                  </div>
                )}
              </div>
              {providers.length > 0 && (
                <div className={`${styles.projectConfigBlock} ${styles.projectModelBlock}`}>
                  <div className={styles.projectConfigBlockHead}>
                    <span className={styles.projectConfigTitle}>AI模型</span>
                    <span className={styles.projectConfigHint}>平台与模型组合</span>
                  </div>
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
                </div>
              )}
            </div>
          </div>

          <div className={styles.projectContentGrid}>
            <div className={`${styles.formCard} ${styles.projectNovelCard}`}>
              <div className={styles.projectSectionHead}>
                <div>
                  <div className={styles.projectSectionTitle}>小说原文</div>
                  <div className={styles.projectSectionHint}>主编辑区，优先保证更大的连续输入空间</div>
                </div>
              </div>
              <div className={styles.formItem}>
                <TextArea
                  placeholder="请输入小说原文内容，AI 将根据原文自动生成分镜脚本..."
                  value={novelContent}
                  onChange={(e) => setNovelContent(e.target.value)}
                  className={styles.novelInput}
                  rows={18}
                />
              </div>
            </div>

            <div className={`${styles.formCard} ${styles.projectRequirementCard}`}>
              <div className={styles.projectSectionHead}>
                <div>
                  <div className={styles.projectSectionTitle}>自定义创作要求</div>
                  <div className={styles.projectSectionHint}>补充风格、节奏、对白和镜头偏好</div>
                </div>
              </div>
              <div className={styles.formItem}>
                <div className={styles.customReqHeader}>
                  <BulbOutlined className={styles.customReqIcon} />
                  <label>创作要求 <Tag color="purple" style={{ marginLeft: 6, fontSize: 11 }}>可选</Tag></label>
                </div>
                <TextArea
                  placeholder="例如：主角说话要更有霸气，不要出现旁白解说，控制每集分镜在15个以内，多写动作描写..."
                  value={customRequirement}
                  onChange={(e) => setCustomRequirement(e.target.value)}
                  className={styles.customReqInput}
                  rows={8}
                  showCount
                  maxLength={500}
                />
              </div>
            </div>
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
        destroyOnHidden={false}
      >
        <div className={styles.generatingLog}>
          {generatingLog.map((log, index) => (
            <p key={index} className={styles.logItem}>{log}</p>
          ))}
          {generating && <Spin size="small" style={{ marginTop: 8 }} />}
          {streamContent && (
            <div className={styles.streamBox}>
              <div className={styles.streamLabel}>AI 实时输出:</div>
              <pre className={styles.streamText}>{streamContent}</pre>
            </div>
          )}
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
