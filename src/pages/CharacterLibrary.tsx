import * as React from 'react';
import { useEffect, useState, useCallback, memo } from 'react';
import { Card, Button, Modal, Input, Empty, Spin, message, Row, Col, Popconfirm, Upload } from 'antd';
import { PlusOutlined, DeleteOutlined, EditOutlined, UploadOutlined, RobotOutlined, EyeOutlined, ThunderboltOutlined, LoadingOutlined } from '@ant-design/icons';
import { useRecoilState } from 'recoil';
import { v4 as uuidv4 } from 'uuid';
import { characterListState } from '../store/projectStore';
import { getAllCharacters, saveCharacter, deleteCharacter as deleteCharacterFromDB } from '../services/database';
import { saveMedia, deleteMedia } from '../services/mediaService';
import { aiService, createTempScene } from '../services/aiService';
import { createThumbnail } from '../utils/imageUtils';
import { Character } from '../types';
import styles from './CharacterLibrary.module.css';

const { TextArea } = Input;

// 自包含的预览弹窗组件：通过自定义事件触发，完全不依赖父组件 state。
// 打开/关闭预览不会导致 CharacterLibrary 重渲染。
const PREVIEW_EVENT = 'character-preview';

function firePreview(src: string) {
  window.dispatchEvent(new CustomEvent(PREVIEW_EVENT, { detail: src }));
}

// 将 Base64 转换为 Object URL（浏览器渲染 Object URL 比多 MB 的 Base64 data URI 快得多）
function base64ToObjectUrl(base64: string): string {
  try {
    const parts = base64.split(',');
    if (parts.length < 2) return base64;
    const mimeMatch = parts[0].match(/:(.*?);/);
    const mime = mimeMatch ? mimeMatch[1] : 'image/png';
    const binary = atob(parts[1]);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return URL.createObjectURL(new Blob([bytes], { type: mime }));
  } catch {
    return base64;
  }
}

const CharacterPreviewModal: React.FC = () => {
  const [visible, setVisible] = useState(false);
  const [previewUrl, setPreviewUrl] = useState('');

  useEffect(() => {
    const handler = (e: Event) => {
      // 卡片已预转换为 Object URL 并预解码，直接显示
      setPreviewUrl((e as CustomEvent<string>).detail);
      setVisible(true);
    };
    window.addEventListener(PREVIEW_EVENT, handler);
    return () => window.removeEventListener(PREVIEW_EVENT, handler);
  }, []);

  return (
    <Modal
      open={visible}
      footer={null}
      onCancel={() => setVisible(false)}
      centered
      width="auto"
      destroyOnClose
      className={styles.previewModal}
    >
      {visible && previewUrl && (
        <img
          src={previewUrl}
          alt="预览"
          style={{ maxWidth: '80vw', maxHeight: '80vh' }}
        />
      )}
    </Modal>
  );
};

// 卡片组件：使用缩略图渲染，避免在DOM中放置完整Base64（数MB）
interface CharacterCardItemProps {
  character: Character;
  onEdit: (character: Character) => void;
  onDelete: (id: string) => void;
}

const CharacterCardItem = memo<CharacterCardItemProps>(({ character, onEdit, onDelete }) => {
  const [thumb, setThumb] = useState('');
  const [previewObjUrl, setPreviewObjUrl] = useState('');

  useEffect(() => {
    if (!character.referenceImage) return;
    // 同时生成缩略图和预览用 Object URL
    createThumbnail(character.referenceImage, 300, 0.7).then(setThumb);
    // 预转换 + 预解码：点击时即时显示
    const url = character.referenceImage.startsWith('data:')
      ? base64ToObjectUrl(character.referenceImage)
      : character.referenceImage;
    const img = new Image();
    img.src = url; // 预解码到浏览器缓存
    setPreviewObjUrl(url);
    return () => {
      if (url.startsWith('blob:')) URL.revokeObjectURL(url);
    };
  }, [character.referenceImage]);

  return (
    <Col xs={24} sm={12} md={8} lg={6}>
      <Card
        hoverable
        className={styles.characterCard}
        cover={
          <div 
            className={styles.cardCover}
            onClick={() => firePreview(previewObjUrl || character.referenceImage)}
            style={{ cursor: 'pointer' }}
          >
            {thumb && <img src={thumb} alt={character.name} />}
            <div className={styles.characterName}>{character.name}</div>
          </div>
        }
        actions={[
          <EditOutlined key="edit" onClick={() => onEdit(character)} />,
          <Popconfirm
            key="delete"
            title="确定删除此角色？"
            onConfirm={() => onDelete(character.id)}
            okText="确定"
            cancelText="取消"
          >
            <DeleteOutlined />
          </Popconfirm>,
        ]}
        bodyStyle={{ display: 'none' }}
      />
    </Col>
  );
}, (prev, next) => (
  prev.character.id === next.character.id &&
  prev.character.name === next.character.name &&
  prev.character.referenceImage === next.character.referenceImage
));

CharacterCardItem.displayName = 'CharacterCardItem';

const CharacterLibrary: React.FC = () => {
  const [characters, setCharacters] = useRecoilState(characterListState);
  const [loading, setLoading] = useState(true);
  const [modalVisible, setModalVisible] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [optimizingVoice, setOptimizingVoice] = useState(false);
  const [editingCharacter, setEditingCharacter] = useState<Character | null>(null);
  
  const [formData, setFormData] = useState<{
    name: string;
    description: string;
    voiceType: string;
    referenceImage: string;
    referenceImageBlob?: Blob;
  }>({
    name: '',
    description: '',
    voiceType: 'gentle_female',
    referenceImage: '',
    referenceImageBlob: undefined
  });

  useEffect(() => {
    loadCharacters();
  }, []);

  const loadCharacters = async () => {
    try {
      setLoading(true);
      const loadedCharacters = await getAllCharacters();
      setCharacters(loadedCharacters);
    } catch (error) {
      message.error('加载角色失败');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      description: '',
      voiceType: 'gentle_female',
      referenceImage: '',
      referenceImageBlob: undefined
    });
    setEditingCharacter(null);
  };

  const handleCreateCharacter = async () => {
    if (!formData.name.trim()) {
      message.warning('请输入角色名称');
      return;
    }

    if (!formData.referenceImage) {
      message.warning('请上传或生成角色参考图');
      return;
    }

    const characterId = uuidv4();
    const newCharacter: Character = {
      id: characterId,
      name: formData.name.trim(),
      description: formData.description.trim(),
      voiceType: formData.voiceType,
      referenceImage: formData.referenceImage,
      referenceImageBlob: formData.referenceImageBlob,
      createdAt: new Date(),
    };

    try {
      // 保存角色到数据库
      await saveCharacter(newCharacter);
      
      // 同时保存参考图到媒体服务（持久化存储）
      if (formData.referenceImage || formData.referenceImageBlob) {
        try {
          await saveMedia('character', characterId, formData.referenceImageBlob || formData.referenceImage);
          console.log('[CharacterLibrary] 角色参考图已保存到媒体服务:', newCharacter.name);
        } catch (mediaError) {
          console.warn('[CharacterLibrary] 保存参考图到媒体服务失败:', mediaError);
        }
      }
      
      setCharacters([...characters, newCharacter]);
      setModalVisible(false);
      resetForm();
      message.success('角色创建成功');
    } catch (error) {
      message.error('创建角色失败');
      console.error(error);
    }
  };

  const handleUpdateCharacter = async () => {
    if (!editingCharacter || !formData.name.trim()) {
      message.warning('请输入角色名称');
      return;
    }

    const updatedCharacter: Character = {
      ...editingCharacter,
      name: formData.name.trim(),
      description: formData.description.trim(),
      voiceType: formData.voiceType,
      referenceImage: formData.referenceImage || editingCharacter.referenceImage,
      referenceImageBlob: formData.referenceImageBlob || editingCharacter.referenceImageBlob,
    };

    try {
      await saveCharacter(updatedCharacter);
      
      // 如果参考图有更新，同时更新媒体服务
      if (formData.referenceImage || formData.referenceImageBlob) {
        try {
          await saveMedia('character', editingCharacter.id, formData.referenceImageBlob || formData.referenceImage);
          console.log('[CharacterLibrary] 角色参考图已更新到媒体服务:', updatedCharacter.name);
        } catch (mediaError) {
          console.warn('[CharacterLibrary] 更新参考图到媒体服务失败:', mediaError);
        }
      }
      
      setCharacters(characters.map(c => c.id === updatedCharacter.id ? updatedCharacter : c));
      setModalVisible(false);
      resetForm();
      message.success('角色更新成功');
    } catch (error) {
      message.error('更新角色失败');
      console.error(error);
    }
  };

  const handleDeleteCharacter = useCallback(async (characterId: string) => {
    try {
      await deleteCharacterFromDB(characterId);
      
      // 同时删除媒体服务中的参考图
      try {
        await deleteMedia('character', characterId);
      } catch (mediaError) {
        console.warn('[CharacterLibrary] 删除媒体服务中的参考图失败:', mediaError);
      }
      
      setCharacters(prev => prev.filter(c => c.id !== characterId));
      message.success('角色已删除');
    } catch (error) {
      message.error('删除角色失败');
      console.error(error);
    }
  }, [setCharacters]);

  const handleGenerateImage = async () => {
    if (!formData.description.trim()) {
      message.warning('请先输入角色描述，以便AI生成参考图');
      return;
    }

    try {
      setGenerating(true);
      const prompt = `角色立绘，${formData.name || '角色'}，${formData.description}，高质量，精细，全身像`;
      const tempScene = createTempScene(prompt);
      const imageUrl = await aiService.generateImage(tempScene);
      
      // 将URL转换为Blob和Base64保存，确保刷新后不会失效
      try {
        const response = await fetch(imageUrl);
        const blob = await response.blob();
        const reader = new FileReader();
        reader.onload = (e) => {
          const base64 = e.target?.result as string;
          setFormData({ ...formData, referenceImage: base64, referenceImageBlob: blob });
        };
        reader.readAsDataURL(blob);
      } catch (fetchError) {
        console.warn('无法将URL转换为Base64:', fetchError);
        setFormData({ ...formData, referenceImage: imageUrl });
      }
      
      message.success('角色图像生成成功');
    } catch (error) {
      message.error('图像生成失败，请检查API配置');
      console.error(error);
    } finally {
      setGenerating(false);
    }
  };

  const handleOptimizeVoice = async () => {
    if (!formData.description.trim()) {
      message.warning('请先输入角色描述，以便AI生成音色提示词');
      return;
    }

    try {
      setOptimizingVoice(true);
      const optimizedVoice = await aiService.optimizeVoiceType(formData.description.trim(), formData.voiceType);
      setFormData({ ...formData, voiceType: optimizedVoice });
      message.success('音色提示词优化成功');
    } catch (error) {
      message.error('音色优化失败，请检查API配置');
      console.error(error);
    } finally {
      setOptimizingVoice(false);
    }
  };

  const handleUpload = (file: File) => {
    // 将图片转换为Base64保存，确保刷新后不会失效
    const reader = new FileReader();
    reader.onload = (e) => {
      const base64 = e.target?.result as string;
      setFormData({ 
        ...formData, 
        referenceImage: base64,  // 使用Base64而不是临时Blob URL
        referenceImageBlob: file
      });
    };
    reader.readAsDataURL(file);
    return false;
  };

  const openEditModal = useCallback((character: Character) => {
    setEditingCharacter(character);
    // 直接使用 referenceImage（已经是 Base64 格式），避免创建 Blob URL 导致卡顿
    setFormData({
      name: character.name,
      description: character.description,
      voiceType: character.voiceType,
      referenceImage: character.referenceImage,
      referenceImageBlob: character.referenceImageBlob
    });
    setModalVisible(true);
  }, []);

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
      <div className={styles.header}>
        <h1>角色库</h1>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreateModal}>
          新建角色
        </Button>
      </div>

      {characters.length === 0 ? (
        <Empty
          description="还没有任何角色"
          className={styles.empty}
        >
          <Button type="primary" onClick={openCreateModal}>
            创建第一个角色
          </Button>
        </Empty>
      ) : (
        <Row gutter={[24, 24]}>
          {characters.map(character => (
            <CharacterCardItem
              key={character.id}
              character={character}
              onEdit={openEditModal}
              onDelete={handleDeleteCharacter}
            />
          ))}
        </Row>
      )}

      <Modal
        title={editingCharacter ? '编辑角色' : '新建角色'}
        open={modalVisible}
        onOk={editingCharacter ? handleUpdateCharacter : handleCreateCharacter}
        onCancel={() => {
          setModalVisible(false);
          resetForm();
        }}
        okText="确定"
        cancelText="取消"
        width={600}
        confirmLoading={generating}
        destroyOnClose
        className={styles.editModal}
      >
        <div className={styles.formItem}>
          <label>角色名称</label>
          <Input
            placeholder="请输入角色名称"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          />
        </div>

        <div className={styles.formItem}>
          <label>角色描述</label>
          <TextArea
            placeholder="描述角色的外貌特征、性格等..."
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            rows={4}
          />
        </div>

        <div className={styles.formItem}>
          <label>音色</label>
          <div className={styles.voiceInputWrapper}>
            <TextArea
              placeholder="请输入音色描述，例如：温柔女声、成熟男声..."
              value={formData.voiceType}
              onChange={(e) => setFormData({ ...formData, voiceType: e.target.value })}
              rows={4}
            />
            <Button
              type="default"
              icon={optimizingVoice ? <LoadingOutlined /> : <ThunderboltOutlined />}
              onClick={handleOptimizeVoice}
              disabled={optimizingVoice || !formData.description.trim()}
              className={styles.optimizeVoiceButton}
            >
              {optimizingVoice ? '优化中...' : 'AI优化'}
            </Button>
          </div>
        </div>

        <div className={styles.formItem}>
          <label>参考图像</label>
          <div className={styles.imageActions}>
            <Upload
              accept="image/*"
              showUploadList={false}
              beforeUpload={handleUpload}
            >
              <Button icon={<UploadOutlined />}>上传图片</Button>
            </Upload>
          </div>
          {formData.referenceImage && (
            <div 
              className={styles.imagePreviewSquare}
              onClick={() => firePreview(formData.referenceImage)}
            >
              <img src={formData.referenceImage} alt="预览" />
              <div className={styles.previewOverlay}>
                <EyeOutlined />
              </div>
            </div>
          )}
        </div>
      </Modal>

      <CharacterPreviewModal />
    </div>
  );
};

export default CharacterLibrary;
