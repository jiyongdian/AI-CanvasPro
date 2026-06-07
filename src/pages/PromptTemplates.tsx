/**
 * 提示词库页面
 * 卡片式UI，模仿角色库/风格库设计风格
 */
import * as React from 'react';
import { useEffect, useState, useCallback, useMemo, memo } from 'react';
import { Card, Button, Modal, Input, Empty, Spin, Row, Col, Popconfirm, Select } from 'antd';
import { appMessage as message } from '../utils/antdApp';
import { PlusOutlined, DeleteOutlined, EditOutlined, PictureOutlined, VideoCameraOutlined, FundViewOutlined, CopyOutlined, ExpandOutlined } from '@ant-design/icons';
import { FullscreenPromptEditor } from '../components/common';
import { v4 as uuidv4 } from 'uuid';
import {
  getAllPromptTemplates,
  savePromptTemplate,
  deletePromptTemplate,
} from '../services/database';
import type { PromptTemplate } from '../types';
import styles from './PromptTemplates.module.css';

const { TextArea } = Input;

const TYPE_LABELS: Record<string, string> = {
  image: '图片',
  video: '视频',
  director: '导演',
  script: '脚本',
};

// ── 卡片组件 ──
interface TemplateCardItemProps {
  template: PromptTemplate;
  onEdit: (template: PromptTemplate) => void;
  onDelete: (id: string) => void;
  onPreview: (template: PromptTemplate) => void;
}

const TemplateCardItem = memo<TemplateCardItemProps>(({ template, onEdit, onDelete, onPreview }) => {
  const themeClassMap: Record<PromptTemplate['type'], string> = {
    image: styles.cardImage,
    video: styles.cardVideo,
    director: styles.cardDirector,
    script: styles.cardScript,
  };
  const coverClassMap: Record<PromptTemplate['type'], string> = {
    image: styles.coverImage,
    video: styles.coverVideo,
    director: styles.coverDirector,
    script: styles.coverScript,
  };
  const ringClassMap: Record<PromptTemplate['type'], string> = {
    image: styles.ringImage,
    video: styles.ringVideo,
    director: styles.ringDirector,
    script: styles.ringScript,
  };
  const cardTypeClass = themeClassMap[template.type];
  const coverTypeClass = coverClassMap[template.type];
  const ringTypeClass = ringClassMap[template.type];
  const negativeLength = (template.negative_prompt || '').trim().length;
  const promptPreview = template.positive_prompt || '暂无正向提示词';
  const typeHintMap: Record<PromptTemplate['type'], string> = {
    image: '视觉构图与画面描述',
    video: '镜头节奏与动态指令',
    director: '场景调度与导演表达',
    script: '文本结构与叙事框架',
  };
  return (
    <Col xs={24} sm={12} md={8} lg={6}>
      <Card
        hoverable
        className={`${styles.templateCard} ${cardTypeClass}`}
        onClick={() => onPreview(template)}
        cover={
          <div className={`${styles.cardCover} ${coverTypeClass}`}>
            <div className={styles.cardCoverBg} />
            <div className={styles.cardAura} />
            <div className={styles.cardNoise} />
            <div className={styles.cardTopMeta}>
              <span className={styles.cardTopMetaLabel}>PROMPT ATLAS</span>
              <span className={styles.cardTopMetaValue}>{TYPE_LABELS[template.type]}</span>
            </div>
            <div className={styles.cardHero}>
              <div className={styles.cardIconWrapper}>
                <div className={`${styles.cardIconRing} ${ringTypeClass}`}>
                  {template.type === 'director' ? (
                  <FundViewOutlined className={styles.cardIcon} />
                  ) : template.type === 'image' ? (
                  <PictureOutlined className={styles.cardIcon} />
                  ) : template.type === 'script' ? (
                  <CopyOutlined className={styles.cardIcon} />
                ) : (
                  <VideoCameraOutlined className={styles.cardIcon} />
                  )}
                </div>
              </div>
              <div className={styles.cardHeroText}>
                <div className={styles.cardName}>{template.name}</div>
                <div className={styles.cardHint}>{typeHintMap[template.type]}</div>
              </div>
            </div>
            <div className={styles.cardStats}>
              <span className={styles.cardStatChip}>{negativeLength > 0 ? '含负向约束' : '纯正向模板'}</span>
              <span className={styles.cardStatChip}>点击预览</span>
            </div>
          </div>
        }
        actions={[
          <EditOutlined key="edit" onClick={(e) => { e.stopPropagation(); onEdit(template); }} />,
          <Popconfirm
            key="delete"
            title="确定要删除该提示词模板吗？"
            onConfirm={() => onDelete(template.id)}
            okText="确定"
            cancelText="取消"
          >
            <DeleteOutlined onClick={(e) => e.stopPropagation()} />
          </Popconfirm>,
        ]}
      >
        <div className={styles.cardContent}>
          <div className={styles.cardMetaDesc}>{promptPreview}</div>
          <div className={styles.cardContentFooter}>
            <span className={styles.cardFooterChip}>{negativeLength > 0 ? '含负向约束' : '无负向约束'}</span>
            <span className={styles.cardFooterChip}>点击查看全文</span>
          </div>
        </div>
      </Card>
    </Col>
  );
}, (prev, next) => (
  prev.template.id === next.template.id &&
  prev.template.name === next.template.name &&
  prev.template.type === next.template.type &&
  prev.template.positive_prompt === next.template.positive_prompt &&
  prev.template.negative_prompt === next.template.negative_prompt
));

TemplateCardItem.displayName = 'TemplateCardItem';

const PromptTemplates: React.FC = () => {
  const [templates, setTemplates] = useState<PromptTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<PromptTemplate | null>(null);
  const [fullscreenField, setFullscreenField] = useState<'positive' | 'negative' | null>(null);
  const [previewTemplate, setPreviewTemplate] = useState<PromptTemplate | null>(null);

  const [formData, setFormData] = useState({
    name: '',
    type: 'image' as PromptTemplate['type'],
    positive_prompt: '',
    negative_prompt: '',
  });

  const typeCount = useMemo(() => {
    const kinds = new Set(templates.map((template) => template.type));
    return kinds.size;
  }, [templates]);

  useEffect(() => {
    loadTemplates();
  }, []);

  const loadTemplates = async () => {
    try {
      setLoading(true);
      const data = await getAllPromptTemplates();
      setTemplates([...data].reverse());
    } catch {
      message.error('加载提示词模板失败');
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      type: 'image',
      positive_prompt: '',
      negative_prompt: '',
    });
    setEditingTemplate(null);
  };

  const handleSave = async () => {
    if (!formData.name.trim()) {
      message.warning('请输入模板名称');
      return;
    }
    if (!formData.positive_prompt.trim()) {
      message.warning('请输入正向提示词');
      return;
    }

    const now = new Date();

    if (editingTemplate) {
      const updated: PromptTemplate = {
        ...editingTemplate,
        name: formData.name.trim(),
        type: formData.type,
        positive_prompt: formData.positive_prompt,
        negative_prompt: formData.negative_prompt.trim() || undefined,
        updated_at: now,
      };
      await savePromptTemplate(updated);
      setTemplates((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
      message.success('模板已更新');
    } else {
      const newTemplate: PromptTemplate = {
        id: uuidv4(),
        name: formData.name.trim(),
        type: formData.type,
        positive_prompt: formData.positive_prompt,
        negative_prompt: formData.negative_prompt.trim() || undefined,
        created_at: now,
        updated_at: now,
      };
      await savePromptTemplate(newTemplate);
      setTemplates((prev) => [newTemplate, ...prev]);
      message.success('模板已创建');
    }

    setModalVisible(false);
    resetForm();
  };

  const handleDelete = async (id: string) => {
    try {
      await deletePromptTemplate(id);
      setTemplates((prev) => prev.filter((t) => t.id !== id));
      message.success('模板已删除');
    } catch {
      message.error('删除失败');
    }
  };

  const openCreateModal = () => {
    resetForm();
    setModalVisible(true);
  };

  const handleCopyPrompt = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      message.success(`${label}已复制到剪贴板`);
    } catch {
      message.error('复制失败');
    }
  };

  const openEditModal = useCallback((template: PromptTemplate) => {
    setEditingTemplate(template);
    setFormData({
      name: template.name,
      type: template.type,
      positive_prompt: template.positive_prompt,
      negative_prompt: template.negative_prompt || '',
    });
    setModalVisible(true);
  }, []);

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
            <h1>提示词库</h1>
            <span className={styles.heroCount}>{templates.length}</span>
          </div>
          <p className={styles.heroSubtle}>统一管理图片、视频、导演与脚本模板</p>
        </div>
        <div className={styles.heroActions}>
          <div className={styles.heroStat}>
            <span>模板类型</span>
            <strong>{typeCount}</strong>
          </div>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreateModal}>
            新增模板
          </Button>
        </div>
      </div>

      {templates.length === 0 ? (
        <div className={styles.emptyPanel}>
          <Empty
            description="还没有任何提示词模板"
            className={styles.empty}
          >
            <Button type="primary" onClick={openCreateModal}>
              创建第一个模板
            </Button>
          </Empty>
        </div>
      ) : (
        <div className={styles.sectionPanel}>
          <Row gutter={[24, 24]} className={styles.gridRow}>
            {templates.map((template) => (
              <TemplateCardItem
                key={template.id}
                template={template}
                onEdit={openEditModal}
                onDelete={handleDelete}
                onPreview={setPreviewTemplate}
              />
            ))}
          </Row>
        </div>
      )}

      <Modal
        className={styles.editorModal}
        title={null}
        open={modalVisible}
        onCancel={() => {
          setModalVisible(false);
          resetForm();
        }}
        footer={
          <div className={styles.editorModalFooter}>
            <Button
              onClick={() => {
                setModalVisible(false);
                resetForm();
              }}
            >
              取消
            </Button>
            <Button type="primary" onClick={handleSave}>
              保存模板
            </Button>
          </div>
        }
        width={920}
        centered
        destroyOnHidden
      >
        <div className={styles.editorModalHead}>
          <EditOutlined className={styles.modalHeadIcon} />
          <div className={styles.modalHeadText}>
            <div className={styles.modalHeadTitle}>{editingTemplate ? '编辑提示词模板' : '新建提示词模板'}</div>
            <div className={styles.modalHeadSubtitle}>统一维护模板名称、类型与正反向提示词内容</div>
          </div>
        </div>
        <div className={styles.editorModalBody}>
          <div className={`${styles.formItem} ${styles.formCard} ${styles.editorMetaCard}`}>
            <div className={styles.editorSectionHead}>
              <div className={styles.editorSectionTitle}>基础信息</div>
              <div className={styles.editorSectionHint}>先确定模板名称与类型，再编辑正反向提示词</div>
            </div>
            <div className={styles.formGrid}>
              <div className={styles.formGridField}>
                <label>模板名称</label>
                <Input
                  placeholder="请输入模板名称"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                />
              </div>
              <div className={styles.formGridField}>
                <label>模板类型</label>
                <Select
                  value={formData.type}
                  onChange={(value) => setFormData({ ...formData, type: value })}
                  options={[
                    { label: '图片', value: 'image' },
                    { label: '视频', value: 'video' },
                    { label: '导演', value: 'director' },
                    { label: '脚本', value: 'script' },
                  ]}
                  style={{ width: '100%' }}
                />
              </div>
            </div>
          </div>

          <div className={styles.editorPromptGrid}>
            <div className={`${styles.formItem} ${styles.formCard} ${styles.promptPrimaryCard}`}>
              <div className={styles.formLabelRow}>
                <label>正向提示词</label>
                <Button
                  type="text"
                  size="small"
                  icon={<ExpandOutlined />}
                  onClick={() => setFullscreenField('positive')}
                  className={styles.expandBtn}
                >
                  放大编辑
                </Button>
              </div>
              <TextArea
                placeholder="请输入正向提示词"
                value={formData.positive_prompt}
                onChange={(e) => setFormData({ ...formData, positive_prompt: e.target.value })}
                rows={10}
              />
            </div>

            <div className={`${styles.formItem} ${styles.formCard} ${styles.promptSecondaryCard}`}>
              <div className={styles.formLabelRow}>
                <label>反向提示词</label>
                <Button
                  type="text"
                  size="small"
                  icon={<ExpandOutlined />}
                  onClick={() => setFullscreenField('negative')}
                  className={styles.expandBtn}
                >
                  放大编辑
                </Button>
              </div>
              <TextArea
                placeholder="请输入反向提示词（可选）"
                value={formData.negative_prompt}
                onChange={(e) => setFormData({ ...formData, negative_prompt: e.target.value })}
                rows={8}
              />
            </div>
          </div>
        </div>
      </Modal>

      {/* 全屏放大编辑弹窗 */}
      <FullscreenPromptEditor
        open={fullscreenField !== null}
        title={fullscreenField === 'positive' ? '正向提示词' : '反向提示词'}
        value={fullscreenField === 'positive' ? formData.positive_prompt : formData.negative_prompt}
        placeholder={fullscreenField === 'positive' ? '请输入正向提示词' : '请输入反向提示词（可选）'}
        onChange={(val) => {
          if (fullscreenField === 'positive') {
            setFormData({ ...formData, positive_prompt: val });
          } else if (fullscreenField === 'negative') {
            setFormData({ ...formData, negative_prompt: val });
          }
        }}
        onClose={() => setFullscreenField(null)}
      />

      {/* 预览提示词弹窗 */}
      <Modal
        open={previewTemplate !== null}
        onCancel={() => setPreviewTemplate(null)}
        footer={
          <div className={styles.previewModalFooter}>
            <Button onClick={() => setPreviewTemplate(null)}>关闭</Button>
          </div>
        }
        width={760}
        centered
        className={styles.previewModal}
        title={null}
      >
        {previewTemplate && (
          <div className={styles.previewContent}>
            <div className={styles.previewHeader}>
              <div className={styles.modalHeadGroup}>
                <CopyOutlined className={styles.modalHeadIcon} />
                <div className={styles.modalHeadText}>
                  <div className={styles.modalHeadTitle}>{previewTemplate.name}</div>
                  <div className={styles.modalHeadSubtitle}>模板预览与提示词复制</div>
                </div>
              </div>
              <span className={styles.previewTypeBadge}>{TYPE_LABELS[previewTemplate.type]}</span>
            </div>
            <div className={styles.previewMetaRow}>
              <span className={styles.previewMetaChip}>正向 {previewTemplate.positive_prompt.trim().length}</span>
              <span className={styles.previewMetaChip}>
                {previewTemplate.negative_prompt?.trim() ? '含反向提示词' : '无反向提示词'}
              </span>
            </div>
            <div className={styles.previewSection}>
              <div className={styles.previewLabelRow}>
                <div className={styles.previewLabel}>正向提示词</div>
                <Button
                  type="text" size="small"
                  icon={<CopyOutlined />}
                  onClick={() => handleCopyPrompt(previewTemplate.positive_prompt, '正向提示词')}
                >复制</Button>
              </div>
              <div className={styles.previewText}>{previewTemplate.positive_prompt}</div>
            </div>
            {previewTemplate.negative_prompt && (
              <div className={styles.previewSection}>
                <div className={styles.previewLabelRow}>
                  <div className={styles.previewLabel}>反向提示词</div>
                  <Button
                    type="text" size="small"
                    icon={<CopyOutlined />}
                    onClick={() => handleCopyPrompt(previewTemplate.negative_prompt || '', '反向提示词')}
                  >复制</Button>
                </div>
                <div className={styles.previewText}>{previewTemplate.negative_prompt}</div>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
};

export default PromptTemplates;
