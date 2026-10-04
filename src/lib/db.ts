import type { Project } from '../types';
import { migrateProject } from './anchors';

const DB_NAME = 'wallpaper-symmetry-editor';
// v2 adds per-object symmetry anchors; v1 records are migrated on read.
const DB_VERSION = 2;
const STORE = 'projects';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('无法打开 IndexedDB'));
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB 操作失败'));
  });
}

export async function saveProject(project: Project): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readwrite');
    await requestToPromise(tx.objectStore(STORE).put({ ...project, updatedAt: Date.now() }));
  } finally {
    db.close();
  }
}

export async function loadProject(id: string): Promise<Project | undefined> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readonly');
    const raw = await requestToPromise<Project | undefined>(tx.objectStore(STORE).get(id) as IDBRequest<Project | undefined>);
    return raw ? migrateProject(raw) : undefined;
  } finally {
    db.close();
  }
}

export async function listProjects(): Promise<Project[]> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readonly');
    const raw = await requestToPromise<Project[]>(tx.objectStore(STORE).getAll() as IDBRequest<Project[]>);
    return raw.map(migrateProject).sort((a, b) => b.updatedAt - a.updatedAt);
  } finally {
    db.close();
  }
}

export async function deleteProject(id: string): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readwrite');
    await requestToPromise(tx.objectStore(STORE).delete(id));
  } finally {
    db.close();
  }
}
