import { get, writable } from 'svelte/store';
import type { Anchor, GroupId, PathSegment, PatternObject, Project, RenderOptions, Tool } from '../types';
import { defaultProject } from './samples';
import { cloneObject } from './path';
import {
  enforceObjectAnchors,
  migrateProject,
  remapProjectAnchors,
  repairAnchor
} from './anchors';

export interface EditorState {
  project: Project;
  selectedId: string | null;
  /** Identity of the concrete transformed path that was clicked, e.g. objectId@coset:n,m. */
  selectedInstance: string | null;
  tool: Tool;
  /** 锚定拾取模式开启后，下一次点击对称元素即为当前对象新建锚定。 */
  anchorPickPending: boolean;
  canUndo: boolean;
  canRedo: boolean;
  saved: boolean;
}

interface HistoryEntry {
  project: Project;
  selectedId: string | null;
  selectedInstance: string | null;
}

const initialProject = migrateProject(defaultProject());
const editorStore = writable<EditorState>({
  project: initialProject,
  selectedId: initialProject.objects[0]?.id ?? null,
  selectedInstance: null,
  tool: 'select',
  anchorPickPending: false,
  canUndo: false,
  canRedo: false,
  saved: false
});

const undoStack: HistoryEntry[] = [];
const redoStack: HistoryEntry[] = [];

function snapshot(state: EditorState): HistoryEntry {
  return {
    project: structuredClone(state.project),
    selectedId: state.selectedId,
    selectedInstance: state.selectedInstance
  };
}

export function pushHistory() {
  const state = get(editorStore);
  undoStack.push(snapshot(state));
  if (undoStack.length > 100) undoStack.shift();
  redoStack.length = 0;
  editorStore.update((s) => ({ ...s, canUndo: true, canRedo: false, saved: false }));
}

export function undo() {
  const entry = undoStack.pop();
  if (!entry) return;
  editorStore.update((state) => {
    redoStack.push(snapshot(state));
    return {
      ...state,
      project: structuredClone(entry.project),
      selectedId: entry.selectedId,
      selectedInstance: entry.selectedInstance,
      canUndo: undoStack.length > 0,
      canRedo: true,
      saved: false
    };
  });
}

export function redo() {
  const entry = redoStack.pop();
  if (!entry) return;
  editorStore.update((state) => {
    undoStack.push(snapshot(state));
    return {
      ...state,
      project: structuredClone(entry.project),
      selectedId: entry.selectedId,
      selectedInstance: entry.selectedInstance,
      canUndo: true,
      canRedo: redoStack.length > 0,
      saved: false
    };
  });
}

export function updateProject(mutator: (project: Project) => Project, record = true) {
  if (record) pushHistory();
  editorStore.update((state) => {
    const project = mutator(structuredClone(state.project));
    return { ...state, project, saved: false };
  });
}

export function setProject(project: Project, clearHistory = true) {
  const migrated = migrateProject(project);
  const remapped = remapProjectAnchors(migrated);
  if (clearHistory) {
    undoStack.length = 0;
    redoStack.length = 0;
  }
  editorStore.set({
    project: structuredClone(remapped),
    selectedId: remapped.objects[0]?.id ?? null,
    selectedInstance: null,
    tool: 'select',
    anchorPickPending: false,
    canUndo: false,
    canRedo: false,
    saved: false
  });
}

export function selectObject(id: string | null, instance: string | null = null) {
  editorStore.update((state) => ({
    ...state,
    selectedId: id,
    selectedInstance: instance,
    anchorPickPending: false
  }));
}

export function setTool(tool: Tool) {
  editorStore.update((state) => ({ ...state, tool, anchorPickPending: false }));
}

export function setGroup(group: GroupId) {
  updateProject((project) => {
    const square = group === 'p4' || group === 'p4m' || group === 'p4g';
    const triangular =
      group === 'p3' ||
      group === 'p3m1' ||
      group === 'p31m' ||
      group === 'p6' ||
      group === 'p6m';
    const cellHeight = square
      ? project.cellWidth
      : triangular
        ? Math.round((Math.sqrt(3) / 2) * project.cellWidth)
        : project.cellHeight;
    // 先切群再重映射：兼容群的锚定按分数键保留，p1 等不兼容群进入待修复而非删除。
    const switched: Project = { ...project, group, cellHeight };
    return remapProjectAnchors(switched);
  });
  editorStore.update((state) => ({ ...state, selectedInstance: null }));
}

export function setCellSize(width: number, height: number) {
  updateProject((project) => {
    const resized: Project = {
      ...project,
      cellWidth: Math.max(40, Math.round(width)),
      cellHeight: Math.max(40, Math.round(height))
    };
    // 分数坐标锚定随新单元尺寸重算并重新投影：四重中心/滑移轴等关系保持。
    return remapProjectAnchors(resized);
  });
}

export function addObject(item: PatternObject, select = true) {
  pushHistory();
  editorStore.update((state) => ({
    ...state,
    project: { ...state.project, objects: [...state.project.objects, cloneObject(item)] },
    selectedId: select ? item.id : state.selectedId,
    selectedInstance: select ? null : state.selectedInstance
  }));
}

export function updateSelectedObject(mutator: (item: PatternObject) => PatternObject, record = true) {
  updateProject((project) => {
    const objects = project.objects.map((item) => (item.id === get(editorStore).selectedId ? mutator(item) : item));
    return { ...project, objects };
  }, record);
}

export function updateObjectGeometry(id: string, path: PathSegment[], record = false) {
  updateProject((project) => ({
    ...project,
    objects: project.objects.map((item) => (item.id === id ? { ...item, path } : item))
  }), record);
}

/**
 * 以满足锚定约束的方式提交一次几何编辑（拖拽实例/节点）。
 * 先写入调用方映射回源对象后的路径，再把活动锚定的参考点整体投影回约束。
 */
export function commitConstrainedGeometry(id: string, path: PathSegment[], record = false) {
  updateProject((project) => {
    const objects = project.objects.map((item) =>
      item.id === id ? enforceObjectAnchors({ ...item, path }, project) : item
    );
    return { ...project, objects };
  }, record);
}

export function beginAnchorPick() {
  if (!get(editorStore).selectedId) return;
  editorStore.update((state) => ({ ...state, anchorPickPending: true }));
}

export function cancelAnchorPick() {
  editorStore.update((state) => ({ ...state, anchorPickPending: false }));
}

export function addAnchor(objectId: string, anchor: Anchor) {
  updateProject((project) => ({
    ...project,
    objects: project.objects.map((item) =>
      item.id === objectId
        ? enforceObjectAnchors(
            { ...item, anchors: [...(item.anchors ?? []), anchor] },
            project
          )
        : item
    )
  }));
  editorStore.update((state) => ({ ...state, anchorPickPending: false }));
}

export function removeAnchor(anchorId: string) {
  updateProject((project) => ({
    ...project,
    objects: project.objects.map((item) =>
      item.anchors?.some((anchor) => anchor.id === anchorId)
        ? { ...item, anchors: item.anchors.filter((anchor) => anchor.id !== anchorId) }
        : item
    )
  }));
}

export function repairAnchorById(anchorId: string) {
  updateProject((project) => {
    let target: Anchor | undefined;
    for (const object of project.objects) {
      target = object.anchors?.find((anchor) => anchor.id === anchorId);
      if (target) break;
    }
    if (!target) return project;
    const repaired = repairAnchor(project, target);
    const objects = project.objects.map((item) =>
      item.id === repaired.objectId && item.anchors
        ? enforceObjectAnchors(
            {
              ...item,
              anchors: item.anchors.map((anchor) => (anchor.id === anchorId ? repaired : anchor))
            },
            project
          )
        : item
    );
    return { ...project, objects };
  });
}

export function deleteSelected() {
  updateProject((project) => ({
    ...project,
    objects: project.objects.filter((item) => item.id !== get(editorStore).selectedId)
  }));
  editorStore.update((state) => ({
    ...state,
    selectedId: null,
    selectedInstance: null,
    anchorPickPending: false
  }));
}

export function markSaved() {
  editorStore.update((state) => ({ ...state, saved: true }));
}

export const renderOptions = writable<RenderOptions>({
  showDomain: true,
  showGrid: true,
  showSymmetry: true,
  showHandles: true
});

export const editor = editorStore;
