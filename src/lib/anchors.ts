import type { mat3 } from 'gl-matrix';
import type {
  AnchorOffsetRule,
  AnchorRefKind,
  GroupId,
  PathSegment,
  Point,
  Project,
  SymmetryAnchor
} from '../types';
import {
  compose,
  getCellSize,
  invert,
  latticeVectors,
  translation
} from './groups';
import { applyMatrixToPath, pathBounds, uid } from './path';

/**
 * Symmetry elements are named in a size-independent lattice coordinate frame so
 * that an anchor survives cell-size edits. Fractional coordinates are expressed
 * relative to the conventional cell (w, h): 1/2 tracks w/2 and h/2 exactly.
 */

interface Fraction {
  nx: number;
  dx: number; // x = nx*a + dx*w
  ny: number;
  dy: number; // y = ny*b + dy*h
}

export type ElementKind = 'rotation' | 'mirror' | 'glide';

export interface ElementSpec {
  id: string;
  label: string;
  kind: ElementKind;
  /** Rotation order for 'rotation' elements (2, 3, 4, 6). */
  order?: number;
  point?: Fraction;
  /** Axis direction angle in radians; mirror/glide axes only. */
  angle?: number;
  /** Axis passes through this lattice-coordinate point. */
  through?: Fraction;
  /** Glide vector along the axis, in primitive-lattice basis fractions (fx·a + fy·b). */
  glide?: { fx: number; fy: number };
}

const frac = (nx = 0, dx = 0, ny = 0, dy = 0): Fraction => ({ nx, dx, ny, dy });

function fractionPoint(f: Fraction, w: number, h: number, ax: number, ay: number, bx: number, by: number): Point {
  return [f.nx * ax + f.ny * bx + f.dx * w, f.ny * by + f.nx * ay + f.dy * h];
}

export interface ResolvedElement {
  id: string;
  label: string;
  kind: ElementKind;
  order?: number;
  /** Present for rotation elements. */
  point?: Point;
  /** Present for mirror/glide elements. */
  axis?: {
    angle: number;
    point: Point;
    direction: Point;
    glideVector?: Point;
  };
}

/**
 * The named elements of every wallpaper group. Names stay valid for every cell
 * size because positions use lattice fractions. Geometry matches the matrices
 * in groups.ts (the true group fixed sets, not decorative markers).
 */
export const ELEMENTS: Record<GroupId, ElementSpec[]> = {
  p1: [],
  p2: [
    { id: 'rot2-origin', label: '二重中心 (0,0)', kind: 'rotation', order: 2, point: frac() },
    { id: 'rot2-hx', label: '二重中心 (½,0)', kind: 'rotation', order: 2, point: frac(0, 0.5) },
    { id: 'rot2-half', label: '二重中心 (½,½)', kind: 'rotation', order: 2, point: frac(0, 0.5, 0, 0.5) },
    { id: 'rot2-hy', label: '二重中心 (0,½)', kind: 'rotation', order: 2, point: frac(0, 0, 0, 0.5) }
  ],
  pm: [
    { id: 'mirror-v0', label: '竖直镜线 x=0', kind: 'mirror', angle: Math.PI / 2, through: frac() },
    { id: 'mirror-vhalf', label: '竖直镜线 x=½', kind: 'mirror', angle: Math.PI / 2, through: frac(0, 0.5) }
  ],
  pg: [
    {
      id: 'glide-h0',
      label: '水平滑移轴 y=0（滑移 ½a）',
      kind: 'glide',
      angle: 0,
      through: frac(),
      glide: { fx: 0.5, fy: 0 }
    },
    {
      id: 'glide-hhalf',
      label: '水平滑移轴 y=½（滑移 ½a）',
      kind: 'glide',
      angle: 0,
      through: frac(0, 0, 0, 0.5),
      glide: { fx: 0.5, fy: 0 }
    }
  ],
  cm: [
    { id: 'mirror-v0', label: '竖直镜线 x=0', kind: 'mirror', angle: Math.PI / 2, through: frac() },
    {
      id: 'glide-vhalf',
      label: '竖直滑移线 x=¼',
      kind: 'glide',
      angle: Math.PI / 2,
      through: frac(0, 0.25),
      glide: { fx: 0.5, fy: 0.5 }
    }
  ],
  pmm: [
    { id: 'rot2-origin', label: '二重中心 (0,0)', kind: 'rotation', order: 2, point: frac() },
    { id: 'rot2-hx', label: '二重中心 (½,0)', kind: 'rotation', order: 2, point: frac(0, 0.5) },
    { id: 'rot2-half', label: '二重中心 (½,½)', kind: 'rotation', order: 2, point: frac(0, 0.5, 0, 0.5) },
    { id: 'rot2-hy', label: '二重中心 (0,½)', kind: 'rotation', order: 2, point: frac(0, 0, 0, 0.5) },
    { id: 'mirror-v0', label: '竖直镜线 x=0', kind: 'mirror', angle: Math.PI / 2, through: frac() },
    { id: 'mirror-vhalf', label: '竖直镜线 x=½', kind: 'mirror', angle: Math.PI / 2, through: frac(0, 0.5) },
    { id: 'mirror-h0', label: '水平镜线 y=0', kind: 'mirror', angle: 0, through: frac() },
    { id: 'mirror-hhalf', label: '水平镜线 y=½', kind: 'mirror', angle: 0, through: frac(0, 0, 0, 0.5) }
  ],
  pmg: [
    { id: 'rot2-hx0', label: '二重中心 (¼,0)', kind: 'rotation', order: 2, point: frac(0, 0.25) },
    { id: 'rot2-hxhalf', label: '二重中心 (¼,½)', kind: 'rotation', order: 2, point: frac(0, 0.25, 0, 0.5) },
    { id: 'rot2-qx0', label: '二重中心 (¾,0)', kind: 'rotation', order: 2, point: frac(0, 0.75) },
    { id: 'rot2-qxhalf', label: '二重中心 (¾,½)', kind: 'rotation', order: 2, point: frac(0, 0.75, 0, 0.5) },
    { id: 'mirror-v0', label: '竖直镜线 x=0', kind: 'mirror', angle: Math.PI / 2, through: frac() },
    { id: 'mirror-vhalf', label: '竖直镜线 x=½', kind: 'mirror', angle: Math.PI / 2, through: frac(0, 0.5) },
    {
      id: 'glide-h0',
      label: '水平滑移轴 y=0（滑移 ½a）',
      kind: 'glide',
      angle: 0,
      through: frac(),
      glide: { fx: 0.5, fy: 0 }
    },
    {
      id: 'glide-hhalf',
      label: '水平滑移轴 y=½（滑移 ½a）',
      kind: 'glide',
      angle: 0,
      through: frac(0, 0, 0, 0.5),
      glide: { fx: 0.5, fy: 0 }
    }
  ],
  cmm: [
    { id: 'rot2-origin', label: '二重中心 (0,0)', kind: 'rotation', order: 2, point: frac() },
    { id: 'rot2-half', label: '二重中心 (½,½)', kind: 'rotation', order: 2, point: frac(0, 0.5, 0, 0.5) },
    { id: 'rot2-edge', label: '二重中心 (½,0)', kind: 'rotation', order: 2, point: frac(0, 0.5) },
    { id: 'mirror-v0', label: '竖直镜线 x=0', kind: 'mirror', angle: Math.PI / 2, through: frac() },
    { id: 'mirror-d', label: '对角镜线 y=x', kind: 'mirror', angle: Math.PI / 4, through: frac() },
    { id: 'mirror-h0', label: '水平镜线 y=0', kind: 'mirror', angle: 0, through: frac() }
  ],
  p4: [
    { id: 'rot4-origin', label: '四重中心 (0,0)', kind: 'rotation', order: 4, point: frac() },
    { id: 'rot2-half', label: '二重中心 (½,½)', kind: 'rotation', order: 2, point: frac(0, 0.5, 0, 0.5) }
  ],
  p4m: [
    { id: 'rot4-origin', label: '四重中心 (0,0)', kind: 'rotation', order: 4, point: frac() },
    { id: 'rot2-half', label: '二重中心 (½,½)', kind: 'rotation', order: 2, point: frac(0, 0.5, 0, 0.5) },
    { id: 'mirror-v0', label: '竖直镜线 x=0', kind: 'mirror', angle: Math.PI / 2, through: frac() },
    { id: 'mirror-h0', label: '水平镜线 y=0', kind: 'mirror', angle: 0, through: frac() },
    { id: 'mirror-d', label: '对角镜线 y=x', kind: 'mirror', angle: Math.PI / 4, through: frac() }
  ],
  p4g: [
    // In p4g the quarter-turn generator rotates about (w/2,w/2); the origin is a 2-centre.
    { id: 'rot4-half', label: '四重中心 (½,½)', kind: 'rotation', order: 4, point: frac(0, 0.5, 0, 0.5) },
    { id: 'rot2-origin', label: '二重中心 (0,0)', kind: 'rotation', order: 2, point: frac() },
    { id: 'mirror-d', label: '对角镜线 y=x', kind: 'mirror', angle: Math.PI / 4, through: frac() },
    {
      id: 'mirror-vhalf',
      label: '竖直镜线 x=½',
      kind: 'mirror',
      angle: Math.PI / 2,
      through: frac(0, 0.5)
    }
  ],
  p3: [
    { id: 'rot3-origin', label: '三重中心 (0,0)', kind: 'rotation', order: 3, point: frac() },
    { id: 'rot3-third', label: '三重中心 (⅓,⅓)', kind: 'rotation', order: 3, point: frac(0, 1 / 3, 0, 1 / 3) },
    { id: 'rot3-twothird', label: '三重中心 (⅔,⅔)', kind: 'rotation', order: 3, point: frac(0, 2 / 3, 0, 2 / 3) }
  ],
  p3m1: [
    { id: 'rot3-origin', label: '三重中心 (0,0)', kind: 'rotation', order: 3, point: frac() },
    { id: 'rot3-third', label: '三重中心 (⅓,⅓)', kind: 'rotation', order: 3, point: frac(0, 1 / 3, 0, 1 / 3) },
    { id: 'rot3-twothird', label: '三重中心 (⅔,⅔)', kind: 'rotation', order: 3, point: frac(0, 2 / 3, 0, 2 / 3) },
    { id: 'mirror-h0', label: '水平镜线 y=0', kind: 'mirror', angle: 0, through: frac() },
    { id: 'mirror-30', label: '30° 镜线', kind: 'mirror', angle: Math.PI / 6, through: frac() }
  ],
  p31m: [
    { id: 'rot3-origin', label: '三重中心 (0,0)', kind: 'rotation', order: 3, point: frac() },
    { id: 'rot3-third', label: '三重中心 (⅓,⅓)', kind: 'rotation', order: 3, point: frac(0, 1 / 3, 0, 1 / 3) },
    { id: 'rot3-twothird', label: '三重中心 (⅔,⅔)', kind: 'rotation', order: 3, point: frac(0, 2 / 3, 0, 2 / 3) },
    { id: 'mirror-30', label: '30° 镜线', kind: 'mirror', angle: Math.PI / 6, through: frac() }
  ],
  p6: [
    { id: 'rot6-origin', label: '六重中心 (0,0)', kind: 'rotation', order: 6, point: frac() },
    { id: 'rot3-third', label: '三重中心 (⅓,⅓)', kind: 'rotation', order: 3, point: frac(0, 1 / 3, 0, 1 / 3) },
    { id: 'rot3-twothird', label: '三重中心 (⅔,⅔)', kind: 'rotation', order: 3, point: frac(0, 2 / 3, 0, 2 / 3) },
    { id: 'rot2-half', label: '二重中心 (½,0)', kind: 'rotation', order: 2, point: frac(0, 0.5) }
  ],
  p6m: [
    { id: 'rot6-origin', label: '六重中心 (0,0)', kind: 'rotation', order: 6, point: frac() },
    { id: 'rot3-third', label: '三重中心 (⅓,⅓)', kind: 'rotation', order: 3, point: frac(0, 1 / 3, 0, 1 / 3) },
    { id: 'rot3-twothird', label: '三重中心 (⅔,⅔)', kind: 'rotation', order: 3, point: frac(0, 2 / 3, 0, 2 / 3) },
    { id: 'rot2-half', label: '二重中心 (½,0)', kind: 'rotation', order: 2, point: frac(0, 0.5) },
    { id: 'mirror-30', label: '30° 镜线', kind: 'mirror', angle: Math.PI / 6, through: frac() },
    { id: 'mirror-v0', label: '竖直镜线 x=0', kind: 'mirror', angle: Math.PI / 2, through: frac() },
    {
      id: 'glide-hhalf',
      label: '水平滑移轴 y=½',
      kind: 'glide',
      angle: 0,
      through: frac(0, 0, 0, 0.5),
      glide: { fx: 0.5, fy: 0 }
    }
  ]
};

export function elementsForGroup(group: GroupId): ElementSpec[] {
  return ELEMENTS[group];
}

export function findElement(group: GroupId, elementId: string): ElementSpec | undefined {
  return ELEMENTS[group].find((element) => element.id === elementId);
}

export function resolveElement(group: GroupId, elementId: string, w: number, h: number): ResolvedElement | null {
  const spec = findElement(group, elementId);
  if (!spec) return null;
  const [cw, ch] = getCellSize(group, w, h);
  const [[ax, ay], [bx, by]] = latticeVectors(group, cw, ch);
  const resolve = (f: Fraction): Point => fractionPoint(f, cw, ch, ax, ay, bx, by);
  const resolved: ResolvedElement = { id: spec.id, label: spec.label, kind: spec.kind, order: spec.order };
  if (spec.kind === 'rotation' && spec.point) {
    resolved.point = resolve(spec.point);
  } else if ((spec.kind === 'mirror' || spec.kind === 'glide') && spec.through && spec.angle !== undefined) {
    const point = resolve(spec.through);
    const direction: Point = [Math.cos(spec.angle), Math.sin(spec.angle)];
    resolved.axis = {
      angle: spec.angle,
      point,
      direction,
      glideVector: spec.glide ? [spec.glide.fx * ax + spec.glide.fy * bx, spec.glide.fx * ay + spec.glide.fy * by] : undefined
    };
  }
  return resolved;
}

/* ------------------------------------------------------------------ */
/* Reference points                                                   */
/* ------------------------------------------------------------------ */

export function referencePoint(path: PathSegment[], ref: AnchorRefKind): Point {
  if (ref === 'first-point') {
    const first = path.find((segment) => 'x' in segment && 'y' in segment);
    if (first && 'x' in first) return [first.x, first.y];
  }
  const bounds = pathBounds(path);
  return [bounds.x + bounds.w / 2, bounds.y + bounds.h / 2];
}

/* ------------------------------------------------------------------ */
/* Projection onto anchor constraints                                 */
/* ------------------------------------------------------------------ */

/** Closest point on an axis; offset is applied along the axis normal when requested. */
function projectPointToAxis(
  axis: NonNullable<ResolvedElement['axis']>,
  p: Point,
  rule: AnchorOffsetRule,
  offset: number
): Point {
  const [dx, dy] = axis.direction;
  const [px, py] = axis.point;
  const vx = p[0] - px;
  const vy = p[1] - py;
  const signed = vx * -dy + vy * dx;
  const target = rule === 'offset' ? offset : 0;
  const normalCorrection = target - signed;
  // Normal n = (-dy, dx); move the point so its signed distance equals target.
  return [p[0] + -dy * normalCorrection, p[1] + dx * normalCorrection];
}

/**
 * Translate the whole path so its reference point satisfies the anchor.
 * Rotation pins are exact 2-D coincidences; axes only constrain the normal
 * direction, so movement along the axis (including a glide drag) is preserved.
 */
export function enforceAnchor(path: PathSegment[], anchor: SymmetryAnchor, w: number, h: number): PathSegment[] {
  const element = resolveElement(anchor.originGroup, anchor.elementId, w, h);
  if (!element) return path;
  const [rx, ry] = referencePoint(path, anchor.ref);
  let delta: Point;
  if (element.kind === 'rotation' && element.point) {
    delta = [element.point[0] - rx, element.point[1] - ry];
  } else if (element.axis) {
    const projected = projectPointToAxis(element.axis, [rx, ry], anchor.rule, anchor.offset);
    delta = [projected[0] - rx, projected[1] - ry];
  } else {
    return path;
  }
  if (Math.hypot(delta[0], delta[1]) < 1e-9) return path;
  return applyMatrixToPath(path, translation(delta[0], delta[1]));
}

export function anchorResidual(path: PathSegment[], anchor: SymmetryAnchor, w: number, h: number): number {
  const element = resolveElement(anchor.originGroup, anchor.elementId, w, h);
  if (!element) return Infinity;
  const p = referencePoint(path, anchor.ref);
  if (element.kind === 'rotation' && element.point) {
    return Math.hypot(p[0] - element.point[0], p[1] - element.point[1]);
  }
  if (element.axis) {
    const [dx, dy] = element.axis.direction;
    const signed = (p[0] - element.axis.point[0]) * -dy + (p[1] - element.axis.point[1]) * dx;
    const target = anchor.rule === 'offset' ? anchor.offset : 0;
    return Math.abs(signed - target);
  }
  return Infinity;
}

/* ------------------------------------------------------------------ */
/* Validation, group-change reconciliation and migration              */
/* ------------------------------------------------------------------ */

export const ANCHOR_TOLERANCE = 0.5;

export function validateAnchor(anchor: SymmetryAnchor, project: Project): string | null {
  if (!project.objects.some((item) => item.id === anchor.objectId)) return 'object-missing';
  const element = findElement(anchor.originGroup, anchor.elementId);
  if (!element) return 'element-missing';
  if (element.kind === 'rotation' && anchor.rule !== 'pin') return 'rule-mismatch';
  if ((element.kind === 'mirror' || element.kind === 'glide') && anchor.rule === 'pin') {
    return 'rule-mismatch';
  }
  return null;
}

function describeBroken(reason: string | null): string | undefined {
  switch (reason) {
    case 'object-missing':
      return '原始对象已删除';
    case 'element-missing':
      return '当前墙纸群不含该命名对称元素';
    case 'rule-mismatch':
      return '偏移规则与对称元素类型不兼容';
    default:
      return undefined;
  }
}

/**
 * Re-map every anchor after the group (or any project metadata) changes.
 * An element is re-mapped by its stable id: if the current wallpaper group still
 * contains that named element (and the object/rule are still valid), the anchor
 * stays active and adopts the current group as its origin. Otherwise it is marked
 * broken with an explicit reason instead of being silently detached. Returning to
 * a compatible group re-activates the anchor automatically.
 */
export function reconcileAnchors(project: Project): Project {
  const anchors = (project.anchors ?? []).map((anchor): SymmetryAnchor => {
    if (!project.objects.some((item) => item.id === anchor.objectId)) {
      return { ...anchor, status: 'broken', brokenReason: describeBroken('object-missing') };
    }
    const element = findElement(project.group, anchor.elementId);
    if (!element) {
      return { ...anchor, status: 'broken', brokenReason: describeBroken('element-missing') };
    }
    const ruleOk =
      element.kind === 'rotation'
        ? anchor.rule === 'pin'
        : anchor.rule !== 'pin';
    if (!ruleOk) {
      return { ...anchor, status: 'broken', brokenReason: describeBroken('rule-mismatch') };
    }
    return {
      ...anchor,
      status: 'active',
      brokenReason: undefined,
      originGroup: project.group,
      elementLabel: element.label
    };
  });
  return { ...project, anchors };
}

/** Re-apply every active anchor constraint, e.g. right after a cell-size edit. */
export function snapProjectAnchors(project: Project): Project {
  const [w, h] = [project.cellWidth, project.cellHeight];
  const objects = project.objects.map((item) => {
    const anchor = project.anchors?.find(
      (candidate) => candidate.status === 'active' && candidate.objectId === item.id
    );
    if (!anchor) return item;
    return { ...item, path: enforceAnchor(item.path, anchor, w, h) };
  });
  return { ...project, objects };
}

/** User repairs a broken anchor by picking an element in the current group. */
export function repairAnchor(
  anchorId: string,
  elementId: string,
  rule: AnchorOffsetRule,
  offset: number,
  project: Project
): Project {
  const element = findElement(project.group, elementId);
  if (!element) return project;
  return {
    ...project,
    anchors: (project.anchors ?? []).map((anchor) => {
      if (anchor.id !== anchorId) return anchor;
      return {
        ...anchor,
        elementId,
        elementLabel: element.label,
        originGroup: project.group,
        rule,
        offset: rule === 'offset' ? offset : 0,
        status: 'active',
        brokenReason: undefined
      };
    }),
    objects: project.objects
  };
}

export function createAnchor(input: {
  objectId: string;
  elementId: string;
  ref: AnchorRefKind;
  rule: AnchorOffsetRule;
  offset?: number;
  project: Project;
}): { project: Project; anchor: SymmetryAnchor } {
  const element = findElement(input.project.group, input.elementId);
  if (!element) throw new Error('对称元素不存在');
  const anchor: SymmetryAnchor = {
    id: uid('anchor'),
    objectId: input.objectId,
    ref: input.ref,
    originGroup: input.project.group,
    elementId: input.elementId,
    elementLabel: element.label,
    rule: input.rule,
    offset: input.rule === 'offset' ? input.offset ?? 0 : 0,
    status: 'active',
    createdAt: Date.now()
  };
  const project: Project = {
    ...input.project,
    anchors: [...(input.project.anchors ?? []).filter((item) => item.objectId !== input.objectId), anchor]
  };
  return { project: snapProjectAnchors(project), anchor };
}

export function removeAnchor(anchorId: string, project: Project): Project {
  return { ...project, anchors: (project.anchors ?? []).filter((anchor) => anchor.id !== anchorId) };
}

/**
 * Map a drag that started on ANY matrix instance back to the unique source
 * object, then project the resulting source path onto its anchor constraint.
 * `instanceMatrix` maps source coordinates to the dragged image.
 */
export function projectDragToAnchor(
  sourcePath: PathSegment[],
  anchor: SymmetryAnchor,
  instanceMatrix: mat3,
  dxWorld: number,
  dyWorld: number,
  w: number,
  h: number
): PathSegment[] {
  const sourceDelta = compose(invert(instanceMatrix), translation(dxWorld, dyWorld));
  const moved = applyMatrixToPath(sourcePath, sourceDelta);
  if (anchor.status !== 'active') return moved;
  return enforceAnchor(moved, anchor, w, h);
}

/* ------------------------------------------------------------------ */
/* Migration                                                          */
/* ------------------------------------------------------------------ */

/** v1 projects have no anchors/schemaVersion; both are filled here. */
export function migrateProject(project: Project): Project {
  const migrated: Project = { ...project };
  if (!Array.isArray(migrated.anchors)) migrated.anchors = [];
  // Drop anchors pointing at deleted objects defensively.
  migrated.anchors = migrated.anchors.filter((anchor) =>
    migrated.objects.some((item) => item.id === anchor.objectId)
  );
  if ((migrated.schemaVersion ?? 1) < 2) migrated.schemaVersion = 2;
  return reconcileAnchors(migrated);
}

export function offsetRuleLabel(rule: AnchorOffsetRule): string {
  switch (rule) {
    case 'pin':
      return '精确重合（不可移动）';
    case 'on':
      return '落在轴上（可沿轴滑动）';
    case 'offset':
      return '与轴保持固定法向距离';
  }
}
