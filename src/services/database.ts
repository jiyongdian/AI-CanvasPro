import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { Project, Character, Style, PromptTemplate } from '../types';

async function getMediaFromDB(database: IDBPDatabase<ZhexianDB>, type: 'character' | 'style', ownerId: string): Promise<string | null> {
  const mediaId = `${type}_${ownerId}`;
  try { const r = await database.get('media', mediaId); return r?.base64 || null; } catch { return null; }
}

interface GeneratedCharacterRecord {
  id: string; prompt: string; imageUrl: string;
  status: 'generating' | 'completed' | 'failed'; createdAt: Date;
  aspectRatio?: string; imageSize?: string;
}

export interface MediaRecord {
  id: string; type: 'character' | 'style'; ownerId: string;
  base64: string; mimeType: string; size: number; createdAt: Date; updatedAt: Date;
}

interface ZhexianDB extends DBSchema {
  projects: { key: string; value: Project; indexes: { 'by-updated': Date } };
  characters: { key: string; value: Character; indexes: { 'by-name': string } };
  styles: { key: string; value: Style; indexes: { 'by-name': string } };
  ai_character_history: { key: string; value: GeneratedCharacterRecord; indexes: { 'by-created': Date } };
  media: { key: string; value: MediaRecord; indexes: { 'by-type': string; 'by-owner': string } };
  prompt_templates: { key: string; value: PromptTemplate; indexes: { 'by-updated': Date } };
  api_providers: { key: string; value: import('../types').ApiProvider };
}

let db: IDBPDatabase<ZhexianDB> | null = null;
let dbPromise: Promise<IDBPDatabase<ZhexianDB>> | null = null;

export async function initDatabase(): Promise<IDBPDatabase<ZhexianDB>> {
  if (db) return db;
  if (dbPromise) return dbPromise;
  dbPromise = openDB<ZhexianDB>('zhexian-comic-studio', 7, {
    upgrade(database, oldVersion) {
      if (oldVersion < 1) { const s = database.createObjectStore('projects', { keyPath: 'id' }); s.createIndex('by-updated', 'updatedAt'); const c = database.createObjectStore('characters', { keyPath: 'id' }); c.createIndex('by-name', 'name'); }
      if (oldVersion < 2) { const s = database.createObjectStore('styles', { keyPath: 'id' }); s.createIndex('by-name', 'name'); }
      if (oldVersion < 3) { const s = database.createObjectStore('ai_character_history', { keyPath: 'id' }); s.createIndex('by-created', 'createdAt'); }
      if (oldVersion < 4) { const s = database.createObjectStore('media', { keyPath: 'id' }); s.createIndex('by-type', 'type'); s.createIndex('by-owner', 'ownerId'); }
      if (oldVersion < 6) { const s = database.createObjectStore('prompt_templates', { keyPath: 'id' }); s.createIndex('by-updated', 'updated_at'); }
      if (oldVersion < 7) { database.createObjectStore('api_providers', { keyPath: 'id' }); }
    },
  });
  db = await dbPromise;
  return db;
}

export function getDatabase(): IDBPDatabase<ZhexianDB> | null { return db; }
export async function openDatabase(): Promise<IDBPDatabase<ZhexianDB>> { return initDatabase(); }

export async function getAllProjects(): Promise<Project[]> { const d = await initDatabase(); return d.getAllFromIndex('projects', 'by-updated'); }
export async function getProject(id: string): Promise<Project | undefined> { const d = await initDatabase(); return d.get('projects', id); }
export async function saveProject(project: Project): Promise<void> { const d = await initDatabase(); await d.put('projects', project); }
export async function deleteProject(id: string): Promise<void> { const d = await initDatabase(); await d.delete('projects', id); }

export async function getAllCharacters(): Promise<Character[]> {
  const d = await initDatabase();
  const chars = await d.getAllFromIndex('characters', 'by-name');
  for (const c of chars) {
    const needs = !c.referenceImage || c.referenceImage.startsWith('blob:') || c.referenceImage.startsWith('http');
    if (needs) { try { const m = await getMediaFromDB(d, 'character', c.id); if (m) { c.referenceImage = m; await d.put('characters', c); } } catch {} }
  }
  return chars;
}
export async function getCharacter(id: string): Promise<Character | undefined> { return (await initDatabase()).get('characters', id); }
export async function saveCharacter(c: Character): Promise<void> { await (await initDatabase()).put('characters', c); }
export async function deleteCharacter(id: string): Promise<void> { await (await initDatabase()).delete('characters', id); }

export async function getAllStyles(): Promise<Style[]> {
  const d = await initDatabase();
  const styles = await d.getAllFromIndex('styles', 'by-name');
  for (const s of styles) {
    const needs = !s.referenceImage || s.referenceImage.startsWith('blob:') || s.referenceImage.startsWith('http');
    if (needs) { try { const m = await getMediaFromDB(d, 'style', s.id); if (m) { s.referenceImage = m; await d.put('styles', s); } } catch {} }
  }
  return styles;
}
export async function getStyle(id: string): Promise<Style | undefined> { return (await initDatabase()).get('styles', id); }
export async function saveStyle(s: Style): Promise<void> { await (await initDatabase()).put('styles', s); }
export async function deleteStyle(id: string): Promise<void> { await (await initDatabase()).delete('styles', id); }

export async function saveMediaBlob(key: string, blob: Blob): Promise<void> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => { try { localStorage.setItem(`media_${key}`, reader.result as string); } catch {} resolve(); };
    reader.onerror = () => resolve();
    reader.readAsDataURL(blob);
  });
}
export async function getMediaBlob(key: string): Promise<string | null> { return localStorage.getItem(`media_${key}`); }
export async function deleteMediaBlob(key: string): Promise<void> { localStorage.removeItem(`media_${key}`); }

export async function downloadMedia(url: string, filename: string): Promise<void> {
  const r = await fetch(url); const blob = await r.blob();
  const u = URL.createObjectURL(blob); const a = document.createElement('a');
  a.href = u; a.download = filename; document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(u);
}
export async function saveUrlAsBlob(url: string, key: string): Promise<Blob | null> {
  try { const r = await fetch(url); const blob = await r.blob(); await saveMediaBlob(key, blob); return blob; } catch { return null; }
}

export async function getAllPromptTemplates(): Promise<PromptTemplate[]> { return (await initDatabase()).getAllFromIndex('prompt_templates', 'by-updated'); }
export async function getPromptTemplate(id: string): Promise<PromptTemplate | undefined> { return (await initDatabase()).get('prompt_templates', id); }
export async function savePromptTemplate(t: PromptTemplate): Promise<void> { await (await initDatabase()).put('prompt_templates', t); }
export async function deletePromptTemplate(id: string): Promise<void> { await (await initDatabase()).delete('prompt_templates', id); }

// v7: API提供商 IndexedDB (无限容量)
export async function getAllApiProviders(): Promise<import('../types').ApiProvider[]> {
  try { return await (await initDatabase()).getAll('api_providers'); } catch { return []; }
}
export async function saveAllApiProviders(providers: import('../types').ApiProvider[]): Promise<void> {
  const d = await initDatabase();
  const tx = d.transaction('api_providers', 'readwrite');
  await tx.store.clear();
  for (const p of providers) await tx.store.put(p);
  await tx.done;
}
