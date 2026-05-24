/**
 * 提示词库页面
 * 卡片式UI，模仿角色库/风格库设计风格
 */
import * as React from 'react';
import { useEffect, useState, useCallback, memo } from 'react';
import { Card, Button, Modal, Input, Empty, Spin, message, Row, Col, Popconfirm, Select, Tag } from 'antd';
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
};

// ── 卡片组件 ──
interface TemplateCardItemProps {
  template: PromptTemplate;
  onEdit: (template: PromptTemplate) => void;
  onDelete: (id: string) => void;
  onPreview: (template: PromptTemplate) => void;
}

const TemplateCardItem = memo<TemplateCardItemProps>(({ template, onEdit, onDelete, onPreview }) => {
  const isImage = template.type === 'image';
  const isDirector = template.type === 'director';
  const cardTypeClass = isDirector ? styles.cardDirector : (isImage ? styles.cardImage : styles.cardVideo);
  const coverTypeClass = isDirector ? styles.coverDirector : (isImage ? styles.coverImage : styles.coverVideo);
  const ringTypeClass = isDirector ? styles.ringDirector : (isImage ? styles.ringImage : styles.ringVideo);
  const tagColor = isDirector ? 'gold' : (isImage ? 'blue' : 'green');
  return (
    <Col xs={24} sm={12} md={8} lg={6}>
      <Card
        hoverable
        className={`${styles.templateCard} ${cardTypeClass}`}
        onClick={() => onPreview(template)}
        cover={
          <div className={`${styles.cardCover} ${coverTypeClass}`}>
            <div className={styles.cardCoverBg} />
            <div className={styles.cardIconWrapper}>
              <div className={`${styles.cardIconRing} ${ringTypeClass}`}>
                {isDirector ? (
                  <FundViewOutlined className={styles.cardIcon} />
                ) : isImage ? (
                  <PictureOutlined className={styles.cardIcon} />
                ) : (
                  <VideoCameraOutlined className={styles.cardIcon} />
                )}
              </div>
            </div>
            <div className={styles.cardName}>{template.name}</div>
            <Tag
              color={tagColor}
              className={styles.cardTypeBadge}
            >
              {TYPE_LABELS[template.type]}
            </Tag>
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
        <Card.Meta
          description={
            <div className={styles.cardMetaDesc}>
              {template.positive_prompt || '暂无正向提示词'}
            </div>
          }
        />
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
    type: 'image' as 'image' | 'video' | 'director',
    positive_prompt: '',
    negative_prompt: '',
  });

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
      <div className={styles.header}>
        <h1>提示词库</h1>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreateModal}>
          新增模板
        </Button>
      </div>

      {templates.length === 0 ? (
        <Empty
          description="还没有任何提示词模板"
          className={styles.empty}
        >
          <Button type="primary" onClick={openCreateModal}>
            创建第一个模板
          </Button>
        </Empty>
      ) : (
        <Row gutter={[24, 24]}>
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
      )}

      <Modal
        title={editingTemplate ? '编辑模板' : '新增模板'}
        open={modalVisible}
        onOk={handleSave}
        onCancel={() => {
          setModalVisible(false);
          resetForm();
        }}
        okText="保存"
        cancelText="取消"
        width={600}
        destroyOnClose
      >
        <div className={styles.formItem}>
          <label>模板名称</label>
          <Input
            placeholder="请输入模板名称"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          />
        </div>

        <div className={styles.formItem}>
          <label>模板类型</label>
          <Select
            value={formData.type}
            onChange={(value) => setFormData({ ...formData, type: value })}
            options={[
              { label: '图片', value: 'image' },
              { label: '视频', value: 'video' },
              { label: '导演', value: 'director' },
            ]}
            style={{ width: '100%' }}
          />
        </div>

        <div className={styles.formItem}>
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
            rows={4}
          />
        </div>

        <div className={styles.formItem}>
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
            rows={3}
          />
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
        footer={null}
        width={640}
        centered
        className={styles.previewModal}
      >
        {previewTemplate && (
          <div className={styles.previewContent}>
            <div className={styles.previewHeader}>
              <span className={styles.previewName}>{previewTemplate.name}</span>
              <Tag color={previewTemplate.type === 'director' ? 'gold' : (previewTemplate.type === 'image' ? 'blue' : 'green')}>
                {TYPE_LABELS[previewTemplate.type]}
              </Tag>
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
