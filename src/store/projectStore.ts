import { atom, selector, selectorFamily } from 'recoil';
import { Project, Scene, Character } from '../types';

// 项目列表
export const projectListState = atom<Project[]>({
  key: 'projectList',
  default: []
});

// 当前项目
export const currentProjectState = atom<Project | null>({
  key: 'currentProject',
  default: null
});

// 当前激活的分镜ID
export const activeSceneIdState = atom<string | null>({
  key: 'activeSceneId',
  default: null
});

// 角色列表
export const characterListState = atom<Character[]>({
  key: 'characterList',
  default: []
});

// 当前选中的角色ID
export const selectedCharacterIdState = atom<string | null>({
  key: 'selectedCharacterId',
  default: null
});

// 派生状态：当前激活的分镜
export const activeSceneState = selector<Scene | null>({
  key: 'activeScene',
  get: ({ get }) => {
    const project = get(currentProjectState);
    const sceneId = get(activeSceneIdState);
    if (!project || !sceneId) return null;
    return project.script.find(s => s.id === sceneId) || null;
  }
});

// 派生状态：根据 ID 获取单个分镜（用于细粒度订阅）
export const sceneByIdState = selectorFamily<Scene | null, string>({
  key: 'sceneById',
  get: (sceneId) => ({ get }) => {
    const project = get(currentProjectState);
    if (!project) return null;
    return project.script.find(s => s.id === sceneId) || null;
  }
});

// 派生状态：分镜 ID 列表（用于列表渲染优化）
export const sceneIdsState = selector<string[]>({
  key: 'sceneIds',
  get: ({ get }) => {
    const project = get(currentProjectState);
    if (!project) return [];
    return project.script.map(s => s.id);
  }
});

// 派生状态：当前选中的角色
export const selectedCharacterState = selector<Character | null>({
  key: 'selectedCharacter',
  get: ({ get }) => {
    const characters = get(characterListState);
    const characterId = get(selectedCharacterIdState);
    if (!characterId) return null;
    return characters.find(c => c.id === characterId) || null;
  }
});

// 加载状态
export const loadingState = atom<{
  projects: boolean;
  scenes: boolean;
  characters: boolean;
  generation: boolean;
}>({
  key: 'loading',
  default: {
    projects: false,
    scenes: false,
    characters: false,
    generation: false
  }
});
