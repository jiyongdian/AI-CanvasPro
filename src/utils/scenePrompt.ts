import { Scene } from '../types';

type ScriptSceneLike = Pick<Scene, 'description' | 'prompt' | 'imagePrompt' | 'videoPrompt' | 'character' | 'dialogue' | 'narration' | 'actionDescription'>;

export const buildStructuredScenePrompt = (scene: ScriptSceneLike): string => {
  const parts: string[] = [];

  if (scene.description?.trim()) parts.push(`场景：${scene.description.trim()}`);
  if (scene.character?.trim()) parts.push(`角色：${scene.character.trim()}`);
  if (scene.actionDescription?.trim()) parts.push(`动作：${scene.actionDescription.trim()}`);
  if (scene.narration?.trim()) parts.push(`旁白：${scene.narration.trim()}`);
  if (scene.dialogue?.trim()) parts.push(`对话：${scene.dialogue.trim()}`);

  return parts.join('\n');
};

export const normalizeImportedScenePrompt = (scene: Scene): Scene => {
  const description = scene.description?.trim() || '';
  const manualPrompt = scene.prompt?.trim() || '';
  const structuredPrompt = buildStructuredScenePrompt(scene);
  const normalizedPrompt = (manualPrompt && manualPrompt !== description)
    ? manualPrompt
    : (structuredPrompt || manualPrompt || description);

  return {
    ...scene,
    prompt: normalizedPrompt,
    imagePrompt: normalizedPrompt || undefined,
    videoPrompt: normalizedPrompt || undefined,
  };
};
