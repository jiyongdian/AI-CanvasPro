import * as React from 'react';
import { useEffect, useState, useCallback, memo } from 'react';
import { Card, Button, Modal, Input, Empty, Spin, Row, Col, Popconfirm, Upload } from 'antd';
import { appMessage as message } from '../utils/antdApp';
import { PlusOutlined, DeleteOutlined, EditOutlined, UploadOutlined, RobotOutlined, EyeOutlined, FormatPainterOutlined } from '@ant-design/icons';
import { v4 as uuidv4 } from 'uuid';
import { getAllStyles, saveStyle, deleteStyle as deleteStyleFromDB } from '../services/database';
import { saveMedia, deleteMedia } from '../services/mediaService';
import { aiService } from '../services/aiService';
import { Style } from '../types';
import { createThumbnail } from '../utils/imageUtils';
import styles from './StyleLibrary.module.css';

const { TextArea } = Input;

// 提取为独立 memo 组件，避免预览弹窗状态变化导致所有卡片重渲染
interface StyleCardItemProps {
  style: Style;
  onPreview: (image: string) => void;
  onEdit: (style: Style) => void;
  onDelete: (id: string) => void;
}

const StyleCardItem = memo<StyleCardItemProps>(({ style: styleItem, onPreview, onEdit, onDelete }) => {
  const [thumb, setThumb] = useState('');

  useEffect(() => {
    if (styleItem.referenceImage) {
      createThumbnail(styleItem.referenceImage, 300, 0.7).then(setThumb);
    }
  }, [styleItem.referenceImage]);

  return (
    <Col xs={24} sm={12} md={8} lg={6}>
      <Card
        hoverable
        className={styles.styleCard}
        cover={
          <div 
            className={styles.cardCover}
            onClick={() => styleItem.referenceImage ? onPreview(styleItem.referenceImage) : undefined}
            style={{ cursor: styleItem.referenceImage ? 'pointer' : 'default' }}
          >
            {thumb ? (
              <img src={thumb} alt={styleItem.name} />
            ) : (
              <div className={styles.noImagePlaceholder}>
                <FormatPainterOutlined style={{ fontSize: 36, opacity: 0.3 }} />
              </div>
            )}
            <div className={styles.cardCoverBadge}>{thumb ? '风格预览' : '风格封面'}</div>
            <div className={styles.styleName}>{styleItem.name}</div>
          </div>
        }
        actions={[
          <EditOutlined key="edit" onClick={() => onEdit(styleItem)} />,
          <Popconfirm
            key="delete"
            title="确定删除此风格？"
            onConfirm={() => onDelete(styleItem.id)}
            okText="确定"
            cancelText="取消"
          >
            <DeleteOutlined />
          </Popconfirm>,
        ]}
      >
        <div className={styles.styleCardBody}>
          <div className={styles.styleCardTitleRow}>
            <div className={styles.styleCardTitle}>{styleItem.name}</div>
            <span className={styles.styleCardChip}>{thumb ? '有参考图' : '无参考图'}</span>
          </div>
          <div className={styles.styleCardDesc}>{styleItem.description || '暂无描述'}</div>
          <div className={styles.styleMetaRow}>
            <span className={styles.styleMetaItem}>{thumb ? '可预览' : '纯文字风格'}</span>
            <span className={styles.styleMetaItem}>风格设定</span>
          </div>
        </div>
      </Card>
    </Col>
  );
}, (prev, next) => (
  prev.style.id === next.style.id &&
  prev.style.name === next.style.name &&
  prev.style.description === next.style.description &&
  prev.style.referenceImage === next.style.referenceImage
));

StyleCardItem.displayName = 'StyleCardItem';

const StyleLibrary: React.FC = () => {
  const [styleList, setStyleList] = useState<Style[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalVisible, setModalVisible] = useState(false);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewImage, setPreviewImage] = useState('');
  const [generating, setGenerating] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [editingStyle, setEditingStyle] = useState<Style | null>(null);
  
  const [formData, setFormData] = useState<{
    name: string;
    description: string;
    referenceImage: string;
    referenceImageBlob?: Blob;
  }>({
    name: '',
    description: '',
    referenceImage: '',
    referenceImageBlob: undefined
  });

  useEffect(() => {
    loadStyles();
  }, []);

  const loadStyles = async () => {
    try {
      setLoading(true);
      const loadedStyles = await getAllStyles();
      setStyleList(loadedStyles);
    } catch (error) {
      message.error('加载风格失败');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      description: '',
      referenceImage: '',
      referenceImageBlob: undefined
    });
    setEditingStyle(null);
  };

  const handleCreateStyle = async () => {
    if (!formData.name.trim()) {
      message.warning('请输入风格名称');
      return;
    }

    const styleId = uuidv4();
    const newStyle: Style = {
      id: styleId,
      name: formData.name.trim(),
      description: formData.description.trim(),
      referenceImage: formData.referenceImage,
      referenceImageBlob: formData.referenceImageBlob,
      createdAt: new Date(),
    };

    try {
      await saveStyle(newStyle);
      
      // 同时保存参考图到媒体服务（持久化存储）
      if (formData.referenceImage || formData.referenceImageBlob) {
        try {
          await saveMedia('style', styleId, formData.referenceImageBlob || formData.referenceImage);
          console.log('[StyleLibrary] 风格参考图已保存到媒体服务:', newStyle.name);
        } catch (mediaError) {
          console.warn('[StyleLibrary] 保存参考图到媒体服务失败:', mediaError);
        }
      }
      
      setStyleList([...styleList, newStyle]);
      setModalVisible(false);
      resetForm();
      message.success('风格创建成功');
    } catch (error) {
      message.error('创建风格失败');
      console.error(error);
    }
  };

  const handleUpdateStyle = async () => {
    if (!editingStyle || !formData.name.trim()) {
      message.warning('请输入风格名称');
      return;
    }

    const updatedStyle: Style = {
      ...editingStyle,
      name: formData.name.trim(),
      description: formData.description.trim(),
      referenceImage: formData.referenceImage || editingStyle.referenceImage,
      referenceImageBlob: formData.referenceImageBlob || editingStyle.referenceImageBlob,
    };

    try {
      await saveStyle(updatedStyle);
      
      // 如果参考图有更新，同时更新媒体服务
      if (formData.referenceImage || formData.referenceImageBlob) {
        try {
          await saveMedia('style', editingStyle.id, formData.referenceImageBlob || formData.referenceImage);
          console.log('[StyleLibrary] 风格参考图已更新到媒体服务:', updatedStyle.name);
        } catch (mediaError) {
          console.warn('[StyleLibrary] 更新参考图到媒体服务失败:', mediaError);
        }
      }
      
      setStyleList(styleList.map(s => s.id === updatedStyle.id ? updatedStyle : s));
      setModalVisible(false);
      resetForm();
      message.success('风格更新成功');
    } catch (error) {
      message.error('更新风格失败');
      console.error(error);
    }
  };

  // 稳定回调：传给 memo 子组件
  const handlePreviewImage = useCallback((image: string) => {
    setPreviewImage(image);
    setPreviewVisible(true);
  }, []);

  const handleDeleteStyle = async (styleId: string) => {
    try {
      await deleteStyleFromDB(styleId);
      
      // 同时删除媒体服务中的参考图
      try {
        await deleteMedia('style', styleId);
      } catch (mediaError) {
        console.warn('[StyleLibrary] 删除媒体服务中的参考图失败:', mediaError);
      }
      
      setStyleList(styleList.filter(s => s.id !== styleId));
      message.success('风格已删除');
    } catch (error) {
      message.error('删除风格失败');
      console.error(error);
    }
  };

  const handleGenerateImage = async () => {
    if (!formData.description.trim()) {
      message.warning('请先输入风格描述，以便AI生成参考图');
      return;
    }

    try {
      setGenerating(true);
      const prompt = `风格参考图，${formData.name || '风格'}，${formData.description}，高质量，精细`;
      const imageUrl = await aiService.generateImage({
        id: '',
        order: 0,
        description: '',
        prompt,
        generationMode: 'text-to-image',
        images: {},
        videos: [],
        status: 'pending'
      });
      
      // 将URL转换为Blob保存，确保图片永久有效
      try {
        const response = await fetch(imageUrl);
        const blob = await response.blob();
        // 将Blob转为Base64用于显示
        const reader = new FileReader();
        reader.onload = (e) => {
          const base64 = e.target?.result as string;
          setFormData({ ...formData, referenceImage: base64, referenceImageBlob: blob });
        };
        reader.readAsDataURL(blob);
      } catch (fetchError) {
        // 如果无法获取Blob，至少保存URL
        console.warn('无法将URL转换为Blob:', fetchError);
        setFormData({ ...formData, referenceImage: imageUrl });
      }
      
      message.success('风格图像生成成功');
    } catch (error) {
      message.error('图像生成失败，请检查API配置');
      console.error(error);
    } finally {
      setGenerating(false);
    }
  };

  const handleOptimizeDescription = async () => {
    if (!formData.description.trim()) {
      message.warning('请先输入风格描述');
      return;
    }

    try {
      setOptimizing(true);
      const optimized = await aiService.optimizeStylePrompt(formData.description);
      setFormData({ ...formData, description: optimized });
      message.success('风格描述已优化');
    } catch (error) {
      message.error('AI优化失败，请检查API配置');
      console.error(error);
    } finally {
      setOptimizing(false);
    }
  };

  const handleUpload = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      // 同时保存Base64和Blob，确保图片永久有效
      setFormData({ ...formData, referenceImage: result, referenceImageBlob: file });
    };
    reader.readAsDataURL(file);
    return false;
  };

  const openEditModal = (style: Style) => {
    setEditingStyle(style);
    setFormData({
      name: style.name,
      description: style.description,
      referenceImage: style.referenceImage,
      referenceImageBlob: style.referenceImageBlob
    });
    setModalVisible(true);
  };

  const openCreateModal = () => {
    resetForm();
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
            <h1>风格库</h1>
            <span className={styles.heroCount}>{styleList.length}</span>
          </div>
          <p className={styles.heroSubtle}>统一管理画面风格、参考图与描述资产</p>
        </div>
        <div className={styles.heroActions}>
          <div className={styles.heroStat}>
            <span>已保存风格</span>
            <strong>{styleList.length}</strong>
          </div>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreateModal}>
            新建风格
          </Button>
        </div>
      </div>

      {styleList.length === 0 ? (
        <div className={styles.emptyPanel}>
          <Empty
            description="还没有任何风格"
            className={styles.empty}
          >
            <Button type="primary" onClick={openCreateModal}>
              创建第一个风格
            </Button>
          </Empty>
        </div>
      ) : (
        <div className={styles.sectionPanel}>
          <Row gutter={[24, 24]} className={styles.gridRow}>
            {styleList.map(styleItem => (
              <StyleCardItem
                key={styleItem.id}
                style={styleItem}
                onPreview={handlePreviewImage}
                onEdit={openEditModal}
                onDelete={handleDeleteStyle}
              />
            ))}
          </Row>
        </div>
      )}

      <Modal
        className={styles.editModal}
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
            <Button
              type="primary"
              loading={generating}
              onClick={editingStyle ? handleUpdateStyle : handleCreateStyle}
            >
              {editingStyle ? '保存风格' : '创建风格'}
            </Button>
          </div>
        }
        width={920}
        forceRender
        destroyOnHidden={false}
      >
        <div className={styles.editorModalHead}>
          <EditOutlined className={styles.modalHeadIcon} />
          <div className={styles.modalHeadText}>
            <div className={styles.modalHeadTitle}>{editingStyle ? '编辑风格' : '新建风格'}</div>
            <div className={styles.modalHeadSubtitle}>统一维护风格名称、描述与参考图素材</div>
          </div>
        </div>
        <div className={styles.editorModalBody}>
          <div className={styles.editorFormGrid}>
            <div className={`${styles.formCard} ${styles.editorMainCard}`}>
              <div className={styles.editorSectionHead}>
                <div>
                  <div className={styles.editorSectionTitle}>风格信息</div>
                  <div className={styles.editorSectionHint}>先确定风格名称，再整理描述内容与关键词</div>
                </div>
              </div>
              <div className={styles.formItem}>
                <label>风格名称</label>
                <Input
                  placeholder="请输入风格名称"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                />
              </div>

              <div className={styles.formItem}>
                <div className={styles.formLabelRow}>
                  <label>风格描述</label>
                  <Button
                    type="text"
                    size="small"
                    icon={<RobotOutlined />}
                    loading={optimizing}
                    onClick={handleOptimizeDescription}
                    disabled={!formData.description.trim()}
                    className={styles.optimizeButton}
                  >
                    AI优化
                  </Button>
                </div>
                <TextArea
                  placeholder="描述风格的特征，例如：赛博朋克风格，霓虹灯光，未来城市..."
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  rows={12}
                />
              </div>
            </div>

            <div className={`${styles.formCard} ${styles.editorSideCard}`}>
              <div className={styles.editorSectionHead}>
                <div>
                  <div className={styles.editorSectionTitle}>参考图像</div>
                  <div className={styles.editorSectionHint}>可上传或 AI 生成风格参考图，作为预览素材</div>
                </div>
              </div>
              <div className={styles.imageActions}>
                <Upload
                  accept="image/*"
                  showUploadList={false}
                  beforeUpload={handleUpload}
                >
                  <Button icon={<UploadOutlined />}>上传图片</Button>
                </Upload>
                <Button
                  icon={<RobotOutlined />}
                  onClick={handleGenerateImage}
                  loading={generating}
                >
                  AI生成
                </Button>
              </div>
              {formData.referenceImage ? (
                <div
                  className={styles.imagePreviewPanel}
                  onClick={() => setPreviewVisible(true)}
                >
                  <img src={formData.referenceImage} alt="预览" />
                  <div className={styles.previewOverlay}>
                    <EyeOutlined />
                  </div>
                </div>
              ) : (
                <div className={styles.emptyPreviewPanel}>
                  暂无参考图
                </div>
              )}
            </div>
          </div>
        </div>
      </Modal>

      <Modal
        open={previewVisible}
        footer={
          <div className={styles.previewModalFooter}>
            <Button onClick={() => setPreviewVisible(false)}>关闭</Button>
          </div>
        }
        onCancel={() => setPreviewVisible(false)}
        centered
        width={760}
        destroyOnHidden
        className={styles.previewModal}
        title={null}
      >
        {previewVisible && (
          <div className={styles.previewContent}>
            <div className={styles.previewHeader}>
              <div className={styles.modalHeadGroup}>
                <EyeOutlined className={styles.modalHeadIcon} />
                <div className={styles.modalHeadText}>
                  <div className={styles.modalHeadTitle}>风格预览</div>
                  <div className={styles.modalHeadSubtitle}>查看风格参考图的大图细节</div>
                </div>
              </div>
            </div>
            <div className={styles.previewMediaWrap}>
              <img
                src={previewImage || formData.referenceImage}
                alt="预览"
                className={styles.previewImage}
              />
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default StyleLibrary;
