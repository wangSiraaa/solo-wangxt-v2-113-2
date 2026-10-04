import type { Anchor, ElementKind, GroupId, PathSegment, PatternObject, Point, Project } from '../types';
import {
  GROUP_SPECS,
  compose,
  getCellSize,
  latticeVectors,
  transformPoint,
  translationMatrix
} from './groups';
import { editablePoints, uid, type PathPoint } from './path';

/**
 * 对称元素登记：每个群中“命名”的旋转中心 / 镜线 / 滑移轴。
 * 位置用平移晶格的分数坐标 (u, v) 表示，因而与单元像素尺寸无关：
 *   世界点 P = u·t₁ + v·t₂。
 * 同一轨道的其余元素（平移像、其它陪集像）在拾取时动态生成，
 * 故这里只需列出每个轨道的一个代表。
 * 轴方向：h = 水平 (1,0)，v = 竖直 (0,1)，d = 常规坐标对角线 (1,1)，d30 = 30° 三角晶格轴。
 */
export type AxisDir = 'h' | 'v' | 'd' | 'd30';

interface ElementSpec {
  kind: ElementKind;
  /** 分数坐标键（与 Anchor.elementKey 同构）。 */
  key: string;
  order?: 2 | 3 | 4 | 6;
  dir?: AxisDir;
  label: string;
}

const rot = (order: 2 | 3 | 4 | 6, u: number, v: number): ElementSpec => ({
  kind: 'rotation',
  key: `r:${order}:${frac(u)}:${frac(v)}`,
  order,
  label: `${order} 重旋转中心`
});
const mir = (dir: AxisDir, u: number, v: number): ElementSpec => ({
  kind: 'mirror',
  key: `m:${dir}:${frac(u)}:${frac(v)}`,
  dir,
  label: '镜线'
});
const gli = (dir: AxisDir, u: number, v: number): ElementSpec => ({
  kind: 'glide',
  key: `g:${dir}:${frac(u)}:${frac(v)}`,
  dir,
  label: '滑移轴'
});

/** 有理分数序列化，避免 1/3 之类的浮点尾数进入持久化键。 */
function frac(value: number): string {
  const table: Array<[number, string]> = [
    [0, '0'],
    [1, '1'],
    [1 / 2, '1/2'],
    [1 / 3, '1/3'],
    [2 / 3, '2/3'],
    [1 / 4, '1/4'],
    [3 / 4, '3/4'],
    [1 / 6, '1/6'],
    [5 / 6, '5/6']
  ];
  for (const [q, text] of table) {
    if (Math.abs(value - q) < 1e-9) return text;
  }
  return String(Math.round(value * 1000) / 1000);
}

const PARSE_FRAC: Record<string, number> = {
  '0': 0,
  '1': 1,
  '1/2': 1 / 2,
  '1/3': 1 / 3,
  '2/3': 2 / 3,
  '1/4': 1 / 4,
  '3/4': 3 / 4,
  '1/6': 1 / 6,
  '5/6': 5 / 6
};

export const ELEMENT_REGISTRY: Record<GroupId, ElementSpec[]> = {
  p1: [],
  p2: [rot(2, 0, 0), rot(2, 1 / 2, 0), rot(2, 0, 1 / 2), rot(2, 1 / 2, 1 / 2)],
  pm: [mir('v', 0, 0), mir('v', 1 / 2, 0)],
  pg: [gli('h', 0, 0), gli('h', 0, 1 / 2)],
  cm: [mir('v', 0, 0), mir('v', 1 / 2, 0), gli('v', 1 / 4, 0)],
  pmm: [
    rot(2, 0, 0),
    rot(2, 1 / 2, 0),
    rot(2, 0, 1 / 2),
    rot(2, 1 / 2, 1 / 2),
    mir('v', 0, 0),
    mir('v', 1 / 2, 0),
    mir('h', 0, 0),
    mir('h', 0, 1 / 2)
  ],
  pmg: [
    rot(2, 0, 0),
    rot(2, 1 / 2, 1 / 2),
    mir('v', 0, 0),
    mir('v', 1 / 2, 0),
    gli('h', 0, 0),
    gli('h', 0, 1 / 2)
  ],
  cmm: [
    rot(2, 0, 0),
    rot(2, 1 / 2, 1 / 2),
    rot(2, 1 / 4, 1 / 4),
    mir('v', 0, 0),
    mir('h', 0, 0),
    mir('d', 0, 0),
    mir('d', 1 / 2, 0),
    gli('v', 1 / 2, 0)
  ],
  p4: [rot(4, 0, 0), rot(2, 1 / 2, 1 / 2)],
  p4m: [
    rot(4, 0, 0),
    rot(2, 1 / 2, 1 / 2),
    mir('v', 0, 0),
    mir('h', 0, 0),
    mir('d', 0, 0)
  ],
  p4g: [
    rot(4, 1 / 2, 1 / 2),
    rot(2, 0, 0),
    mir('d', 0, 0),
    gli('v', 1 / 2, 0)
  ],
  p3: [rot(3, 0, 0), rot(3, 1 / 6, 1 / 3), rot(3, 1 / 3, 2 / 3)],
  p3m1: [
    rot(3, 0, 0),
    rot(3, 1 / 6, 1 / 3),
    rot(3, 1 / 3, 2 / 3),
    mir('h', 0, 0),
    mir('d30', 0, 0)
  ],
  p31m: [
    rot(3, 0, 0),
    rot(3, 1 / 6, 1 / 3),
    rot(3, 1 / 3, 2 / 3),
    mir('d30', 0, 0)
  ],
  p6: [rot(6, 0, 0), rot(3, 1 / 6, 1 / 3), rot(3, 1 / 3, 2 / 3), rot(2, 1 / 2, 0)],
  p6m: [
    rot(6, 0, 0),
    rot(3, 1 / 6, 1 / 3),
    rot(3, 1 / 3, 2 / 3),
    rot(2, 1 / 2, 0),
    mir('d30', 0, 0),
    mir('v', 0, 0),
    gli('h', 0, 1 / 2)
  ]
};

export function elementSpec(group: GroupId, key: string): ElementSpec | undefined {
  return ELEMENT_REGISTRY[group].find((spec) => spec.key === key);
}

export function elementLabel(group: GroupId, key: string): string {
  const spec = elementSpec(group, key);
  if (spec) return spec.label;
  const [kind] = key.split(':');
  if (kind === 'r') return '旋转中心（当前群缺失）';
  if (kind === 'm') return '镜线（当前群缺失）';
  if (kind === 'g') return '滑移轴（当前群缺失）';
  return '未知对称元素';
}

export function fractionalToWorld(project: Project, u: number, v: number): Point {
  const [w, h] = getCellSize(project.group, project.cellWidth, project.cellHeight);
  const [[ax, ay], [bx, by]] = latticeVectors(project.group, w, h);
  return [u * ax + v * bx, u * ay + v * by];
}

function parseKey(key: string): { kind: ElementKind; order?: number; dir?: AxisDir; u: number; v: number } | null {
  const parts = key.split(':');
  if (parts.length !== 4) return null;
  const [kind, tag, us, vs] = parts as [string, string, string, string];
  const u = PARSE_FRAC[us!];
  const v = PARSE_FRAC[vs!];
  if (u === undefined || v === undefined) return null;
  if (kind === 'r') return { kind: 'rotation', order: Number(tag), u, v };
  if (kind === 'm') return { kind: 'mirror', dir: tag as AxisDir, u, v };
  if (kind === 'g') return { kind: 'glide', dir: tag as AxisDir, u, v };
  return null;
}

function axisDirectionWorld(dir: AxisDir): Point {
  if (dir === 'h') return [1, 0];
  if (dir === 'v') return [0, 1];
  if (dir === 'd') return [Math.SQRT1_2, Math.SQRT1_2];
  return [Math.cos(Math.PI / 6), Math.sin(Math.PI / 6)];
}

export interface ResolvedElement {
  key: string;
  kind: ElementKind;
  order?: number;
  /** 旋转中心，或轴上的基准点。 */
  point: Point;
  /** 镜线/滑移轴的单位方向；旋转中心为 null。 */
  axisDir: Point | null;
}

/** 解析一个命名键在当前群/单元尺寸下的世界坐标几何（轨道代表）。 */
export function resolveElement(project: Project, key: string): ResolvedElement | null {
  const parsed = parseKey(key);
  if (!parsed) return null;
  const point = fractionalToWorld(project, parsed.u, parsed.v);
  return {
    key,
    kind: parsed.kind,
    order: parsed.order,
    point,
    axisDir: parsed.dir ? axisDirectionWorld(parsed.dir) : null
  };
}

const EPS = 1e-5;

function samePoint(a: Point, b: Point, scale: number): boolean {
  return Math.hypot(a[0] - b[0], a[1] - b[1]) < EPS * Math.max(1, scale);
}

/**
 * 生成某命名元素在给定格点范围内的全部轨道像（平移像 × 陪集像）。
 * 这是“当前墙纸群中命名的旋转中心、镜线或滑移轴”的具体实例集合。
 * 默认围绕原点；拾取远离原点的元素时可用 centerU/centerV 指定分数格点中心。
 */
export function orbitElements(
  project: Project,
  key: string,
  nRange = 2,
  mRange = 2,
  centerU = 0,
  centerV = 0
): ResolvedElement[] {
  const base = resolveElement(project, key);
  if (!base) return [];
  const [w, h] = getCellSize(project.group, project.cellWidth, project.cellHeight);
  const spec = GROUP_SPECS[project.group];
  const cosets = spec.cosets(w, h);
  const scale = Math.max(w, h);
  const out: ResolvedElement[] = [];
  const n0 = Math.round(centerU);
  const m0 = Math.round(centerV);

  const consider = (point: Point, dir: Point | null) => {
    for (const existing of out) {
      if ((dir === null) !== (existing.axisDir === null)) continue;
      if (!samePoint(existing.point, point, scale)) continue;
      if (dir === null || existing.axisDir === null) return;
      // 同向直线（方向 ± 等价）视为同一根轴。
      const dot = Math.abs(dir[0] * existing.axisDir[0] + dir[1] * existing.axisDir[1]);
      if (dot > 1 - 1e-6) return;
    }
    out.push({ key, kind: base.kind, order: base.order, point, axisDir: dir ? [dir[0], dir[1]] : null });
  };

  for (let n = n0 - nRange; n <= n0 + nRange; n += 1) {
    for (let m = m0 - mRange; m <= m0 + mRange; m += 1) {
      const lattice = translationMatrix(project.group, w, h, n, m);
      for (const coset of cosets) {
        const g = compose(lattice, coset);
        const p = transformPoint(g, base.point[0], base.point[1]);
        let dir: Point | null = null;
        if (base.axisDir) {
          const dx = base.axisDir[0];
          const dy = base.axisDir[1];
          const q = transformPoint(g, base.point[0] + dx, base.point[1] + dy);
          let vx = q[0] - p[0];
          let vy = q[1] - p[1];
          const len = Math.hypot(vx, vy) || 1;
          vx /= len;
          vy /= len;
          dir = [vx, vy];
        }
        consider(p, dir);
      }
    }
  }
  return out;
}

export interface NearestElement extends ResolvedElement {
  distance: number;
}

function pointLineDistance(p: Point, origin: Point, dir: Point): number {
  return Math.abs((p[1] - origin[1]) * dir[0] - (p[0] - origin[0]) * dir[1]);
}

/** 在世界坐标 query 附近寻找最匹配的已登记对称元素（跨全部命名轨道）。 */
export function nearestElement(project: Project, query: Point, maxDistance = Infinity): NearestElement | null {
  let best: NearestElement | null = null;
  const [w, h] = getCellSize(project.group, project.cellWidth, project.cellHeight);
  const [[ax, ay], [bx, by]] = latticeVectors(project.group, w, h);
  const det = ax * by - ay * bx;
  const cu = (by * query[0] - bx * query[1]) / det;
  const cv = (-ay * query[0] + ax * query[1]) / det;
  for (const spec of ELEMENT_REGISTRY[project.group]) {
    for (const element of orbitElements(project, spec.key, 1, 1, cu, cv)) {
      const distance =
        element.axisDir === null
          ? Math.hypot(query[0] - element.point[0], query[1] - element.point[1])
          : pointLineDistance(query, element.point, element.axisDir);
      if (distance <= maxDistance && (!best || distance < best.distance)) {
        best = { ...element, distance };
      }
    }
  }
  return best;
}

/** 供画布拾取：以某世界点为中心、覆盖其周围若干原胞的全部元素实例。 */
export function elementsAround(project: Project, center: Point, range = 2): ResolvedElement[] {
  const [w, h] = getCellSize(project.group, project.cellWidth, project.cellHeight);
  const [[ax, ay], [bx, by]] = latticeVectors(project.group, w, h);
  const det = ax * by - ay * bx;
  const cu = (by * center[0] - bx * center[1]) / det;
  const cv = (-ay * center[0] + ax * center[1]) / det;
  const result: ResolvedElement[] = [];
  for (const spec of ELEMENT_REGISTRY[project.group]) {
    result.push(...orbitElements(project, spec.key, range, range, cu, cv));
  }
  return result;
}

// ---------------------------------------------------------------------------
// 参考点
// ---------------------------------------------------------------------------

export function anchorReferencePoint(object: PatternObject, anchor: Anchor): PathPoint | null {
  const points = editablePoints(object.path);
  return (
    points.find(
      (point) => point.segmentIndex === anchor.pointSegment && point.role === anchor.pointRole
    ) ?? null
  );
}

export function nearestEditablePoint(object: PatternObject, world: Point): PathPoint | null {
  const points = editablePoints(object.path);
  let best: PathPoint | null = null;
  let bestDistance = Infinity;
  for (const point of points) {
    const d = Math.hypot(point.x - world[0], point.y - world[1]);
    if (d < bestDistance) {
      best = point;
      bestDistance = d;
    }
  }
  return best;
}

export function makeAnchor(object: PatternObject, point: PathPoint, element: ResolvedElement): Anchor {
  return {
    id: uid('anchor'),
    objectId: object.id,
    pointSegment: point.segmentIndex,
    pointRole: point.role,
    pointX: point.x,
    pointY: point.y,
    elementKind: element.kind,
    elementKey: element.key,
    offsetAlong: 0,
    status: 'active',
    brokenReason: null,
    createdAt: Date.now()
  };
}

// ---------------------------------------------------------------------------
// 约束投影
// ---------------------------------------------------------------------------

function translatePath(path: PathSegment[], dx: number, dy: number): PathSegment[] {
  return path.map((segment) => {
    if (segment.type === 'M' || segment.type === 'L') {
      return { ...segment, x: segment.x + dx, y: segment.y + dy };
    }
    if (segment.type === 'Q') {
      return {
        ...segment,
        x: segment.x + dx,
        y: segment.y + dy,
        cx: segment.cx + dx,
        cy: segment.cy + dy
      };
    }
    if (segment.type === 'C') {
      return {
        ...segment,
        x: segment.x + dx,
        y: segment.y + dy,
        cx1: segment.cx1 + dx,
        cy1: segment.cy1 + dy,
        cx2: segment.cx2 + dx,
        cy2: segment.cy2 + dy
      };
    }
    return segment;
  });
}

/**
 * 把对象的锚定参考点投影回其锚定约束：
 * - 旋转中心：参考点必须与中心重合（不允许偏移），整体平移图元；
 * - 镜线/滑移轴：消除垂直方向偏差，沿轴坐标保持当前值（沿轴可自由偏移），
 *   整体平移图元而不是只拉一个节点，避免路径形变。
 * 源对象坐标即陪集恒等的世界坐标，因此直接在同一坐标系内投影。
 */
export function enforceObjectAnchors(object: PatternObject, project: Project): PatternObject {
  const anchors = object.anchors ?? [];
  if (anchors.length === 0) return object;
  let path = object.path;
  let changed = false;
  for (const anchor of anchors) {
    if (anchor.status !== 'active') continue;
    const ref = anchorReferencePoint({ ...object, path }, anchor);
    if (!ref) continue;
    const element = resolveElement(project, anchor.elementKey);
    if (!element) continue;
    let target: Point;
    if (element.axisDir === null) {
      target = element.point;
    } else {
      const along =
        (ref.x - element.point[0]) * element.axisDir[0] +
        (ref.y - element.point[1]) * element.axisDir[1];
      target = [
        element.point[0] + element.axisDir[0] * along,
        element.point[1] + element.axisDir[1] * along
      ];
    }
    const dx = target[0] - ref.x;
    const dy = target[1] - ref.y;
    if (Math.hypot(dx, dy) > 1e-7) {
      path = translatePath(path, dx, dy);
      changed = true;
    }
  }
  return changed ? { ...object, path } : object;
}

// ---------------------------------------------------------------------------
// 群/晶格变化时的重映射与待修复
// ---------------------------------------------------------------------------

const KIND_TEXT: Record<ElementKind, string> = {
  rotation: '旋转中心',
  mirror: '镜线',
  glide: '滑移轴'
};

/**
 * 群或晶格尺寸变化后重映射全部锚定。
 * - 元素键在新群中仍存在（同名分数轨道）→ 保持 active，并重新投影到新几何；
 * - 参考点在路径中找不到（节点被删/段类型改变）→ broken；
 * - 新群缺少该元素（含 p1）→ broken，记录原因，但锚定绝不静默删除。
 */
export function remapProjectAnchors(project: Project): Project {
  let changed = false;
  const objects = project.objects.map((object) => {
    if (!object.anchors || object.anchors.length === 0) return object;
    const anchors = object.anchors.map((anchor): Anchor => {
      const ref = anchorReferencePoint(object, anchor);
      if (!ref) {
        const reason = '可编辑参考点已不存在（节点被删除或改变），请重新指定或解除锚定';
        return anchor.status === 'broken' && anchor.brokenReason === reason
          ? anchor
          : { ...anchor, status: 'broken' as const, brokenReason: reason };
      }
      if (!elementSpec(project.group, anchor.elementKey)) {
        const reason = `当前群 ${project.group} 不存在所锚定的${KIND_TEXT[anchor.elementKind]}，请修复到兼容元素或解除锚定`;
        return anchor.status === 'broken' && anchor.brokenReason === reason
          ? anchor
          : { ...anchor, status: 'broken' as const, brokenReason: reason };
      }
      return anchor.status === 'active' && anchor.brokenReason === null
        ? anchor
        : { ...anchor, status: 'active' as const, brokenReason: null };
    });
    let next: PatternObject =
      anchors.some((anchor, i) => anchor !== object.anchors![i])
        ? { ...object, anchors }
        : object;
    next = enforceObjectAnchors(next, project);
    if (next !== object) changed = true;
    return next;
  });
  return changed ? { ...project, objects } : project;
}

/**
 * 尝试修复一个待修复锚定：在其参考点附近重新匹配当前群的兼容元素。
 * 返回新锚定（仍可能为 broken，例如 p1 中没有任何元素）。
 */
export function repairAnchor(project: Project, anchor: Anchor): Anchor {
  const object = project.objects.find((item) => item.id === anchor.objectId);
  const ref = object ? anchorReferencePoint(object, anchor) : null;
  const query: Point = ref ? [ref.x, ref.y] : [anchor.pointX, anchor.pointY];
  const match = nearestElement(project, query);
  if (!match) {
    return {
      ...anchor,
      status: 'broken',
      brokenReason: `当前群 ${project.group} 没有可重新锚定的旋转中心、镜线或滑移轴`
    };
  }
  return {
    ...anchor,
    elementKind: match.kind,
    elementKey: match.key,
    status: 'active',
    brokenReason: null
  };
}

export function allAnchors(project: Project): Array<{ object: PatternObject; anchor: Anchor }> {
  return project.objects.flatMap((object) =>
    (object.anchors ?? []).map((anchor) => ({ object, anchor }))
  );
}

export function brokenAnchors(project: Project): Array<{ object: PatternObject; anchor: Anchor }> {
  return allAnchors(project).filter(({ anchor }) => anchor.status === 'broken');
}

// ---------------------------------------------------------------------------
// 稳定子造成的重合像归类
// ---------------------------------------------------------------------------

export interface CosetClass {
  representative: number;
  /** member 陪集的像 = 代表像平移 τ 个晶格矢量。 */
  members: Array<{ coset: number; tauN: number; tauM: number }>;
}

function modBasis(project: Project, p: Point): Point {
  const [w, h] = getCellSize(project.group, project.cellWidth, project.cellHeight);
  // latticeVectors 返回的两个矢量是 (ax,ay) 与 (bx,by)。
  const [[ax, ay], [bx, by]] = latticeVectors(project.group, w, h);
  const det = ax * by - ay * bx;
  // p = u·(ax,ay) + v·(bx,by) 的逆解，与 translationRange 中同一套公式。
  const u = (by * p[0] - bx * p[1]) / det;
  const v = (-ay * p[0] + ax * p[1]) / det;
  return [u, v];
}

/** 带“相差整数晶格平移”容差的点集匹配，返回晶格平移量 (τn, τm)。 */
function latticeShiftBetween(
  project: Project,
  a: Point[],
  b: Point[]
): { tauN: number; tauM: number } | null {
  if (a.length !== b.length || a.length === 0) return null;
  const [w, h] = getCellSize(project.group, project.cellWidth, project.cellHeight);
  const [[ax, ay], [bx, by]] = latticeVectors(project.group, w, h);
  const scale = Math.max(1, w, h);
  // 晶格基矢可能非正交（居中/三角晶格），误差阈值按物理长度给。
  const tol = 1e-6 * scale;
  const used = new Array(b.length).fill(false);
  // 用第一对点枚举候选平移，再验证整体双射。
  const first = a[0]!;
  for (let j = 0; j < b.length; j += 1) {
    const delta: Point = [b[j]![0] - first[0], b[j]![1] - first[1]];
    const [ru, rv] = modBasis(project, delta);
    const tauN = Math.round(ru);
    const tauM = Math.round(rv);
    // 判定“接近整数晶格平移”时要换算回笛卡尔长度：分数系数 1e-6 的误差
    // 在数百像素的晶格矢量上会放大，不能直接用系数绝对值比较。
    const residual = Math.hypot((ru - tauN) * ax + (rv - tauM) * bx, (ru - tauN) * ay + (rv - tauM) * by);
    if (residual > tol) continue;
    used.fill(false);
    used[j] = true;
    let ok = true;
    for (let i = 1; i < a.length && ok; i += 1) {
      const px = a[i]![0] + tauN * ax + tauM * bx;
      const py = a[i]![1] + tauN * ay + tauM * by;
      let found = -1;
      for (let k = 0; k < b.length; k += 1) {
        if (used[k]) continue;
        if (Math.hypot(b[k]![0] - px, b[k]![1] - py) <= tol) {
          found = k;
          break;
        }
      }
      if (found < 0) {
        ok = false;
      } else {
        used[found] = true;
      }
    }
    if (ok) return { tauN, tauM };
  }
  return null;
}

const classCache = new Map<string, CosetClass[]>();

/**
 * 计算一个源对象在当前群各陪集下的重合像等价类。
 * 当某个非平凡群元素（稳定子）把整条路径映成自身的晶格平移像时
 * （例如图元精确坐在旋转中心且自身具有该旋转对称性，或跨在镜面上），
 * 多个陪集画出来是同一批像素——渲染/命中/导出只保留代表，杜绝叠色与身份歧义。
 */
export function cosetClasses(project: Project, object: PatternObject): CosetClass[] {
  const [w, h] = getCellSize(project.group, project.cellWidth, project.cellHeight);
  const spec = GROUP_SPECS[project.group];
  const cosets = spec.cosets(w, h);
  // 闭合路径的末点与起点是同一个几何点（可编辑点列里会重复出现），
  // 稳定子判定按“去重点集”做双射，避免同一点被算两次而误判不重合。
  const rawPoints = editablePoints(object.path).map((p): Point => [p.x, p.y]);
  const points: Point[] = [];
  const pointTol = 1e-8 * Math.max(1, w, h);
  for (const candidate of rawPoints) {
    if (!points.some((p) => Math.hypot(p[0] - candidate[0], p[1] - candidate[1]) <= pointTol)) {
      points.push(candidate);
    }
  }
  const signature = `${project.group}|${w}|${h}|${object.id}|${points
    .map((p) => `${Math.round(p[0] * 1000)},${Math.round(p[1] * 1000)}`)
    .join(';')}`;
  const cached = classCache.get(signature);
  if (cached) return cached;

  const images = cosets.map((coset) => points.map((p) => transformPoint(coset, p[0], p[1])));
  const parent = images.map((_, i) => i);
  const find = (i: number): number => {
    let root = i;
    while (parent[root] !== root) root = parent[root]!;
    for (let x = i; parent[x] !== x; ) {
      const next = parent[x]!;
      parent[x] = root;
      x = next;
    }
    return root;
  };
  // shift[i] 记录 image i 相对其并查集根像的晶格平移。
  const shifts = images.map(() => ({ tauN: 0, tauM: 0 }));
  for (let i = 0; i < images.length; i += 1) {
    for (let j = i + 1; j < images.length; j += 1) {
      if (find(i) === find(j)) continue;
      // images[j] = images[i] + τ ？
      const shift = latticeShiftBetween(project, images[i]!, images[j]!);
      if (!shift) continue;
      const rootI = find(i);
      const rootJ = find(j);
      // j 根并入 i 根：推导 rootJ 相对 rootI 的平移。
      const relI = shifts[i]!;
      const relJ = shifts[j]!;
      parent[rootJ] = rootI;
      shifts[rootJ] = {
        tauN: relI.tauN + shift.tauN - relJ.tauN,
        tauM: relI.tauM + shift.tauM - relJ.tauM
      };
    }
  }
  const groups = new Map<number, number[]>();
  images.forEach((_, i) => {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(i);
  });
  const classes: CosetClass[] = [];
  for (const members of groups.values()) {
    const representative = members[0]!;
    classes.push({
      representative,
      members: members
        .slice()
        .sort((a, b) => a - b)
        .map((coset) => {
          const root = find(coset);
          const rel = shifts[coset]!;
          const rootRel = shifts[root]!;
          return { coset, tauN: rel.tauN - rootRel.tauN, tauM: rel.tauM - rootRel.tauM };
        })
    });
  }
  if (classCache.size > 400) classCache.clear();
  classCache.set(signature, classes);
  return classes;
}

/** coset → 所属等价类映射，便于渲染/命中/导出共享。 */
export function cosetClassIndex(project: Project, object: PatternObject) {
  const classes = cosetClasses(project, object);
  const byCoset = new Map<number, { class: CosetClass; tauN: number; tauM: number }>();
  for (const cls of classes) {
    for (const member of cls.members) {
      byCoset.set(member.coset, { class: cls, tauN: member.tauN, tauM: member.tauM });
    }
  }
  return { classes, byCoset };
}

/**
 * 实例 (coset,n,m) 的规范像键：被稳定子合并时统一映射到代表陪集的实例身份，
 * 键全局唯一，供渲染去重与命中身份归一。
 */
export function canonicalInstanceKey(
  byCoset: Map<number, { class: CosetClass; tauN: number; tauM: number }>,
  coset: number,
  n: number,
  m: number
): { key: string; coset: number; n: number; m: number } {
  const info = byCoset.get(coset);
  if (!info) return { key: `${coset}:${n},${m}`, coset, n, m };
  const cn = n + info.tauN;
  const cm = m + info.tauM;
  return { key: `${info.class.representative}:${cn},${cm}`, coset: info.class.representative, n: cn, m: cm };
}

// ---------------------------------------------------------------------------
// 旧工程迁移
// ---------------------------------------------------------------------------

/** 迁移旧工程：无 anchors 字段的对象保持原有行为，仅补齐空数组与 schema 版本。 */
export function migrateProject(project: Project): Project {
  const wasOld = project.schemaVersion === undefined;
  const objects = project.objects.map((object) => {
    if (Array.isArray(object.anchors)) {
      const anchors = object.anchors.map((anchor) => sanitizeAnchor(anchor));
      const same = anchors.every((anchor, i) => anchor === object.anchors![i]);
      return same ? object : { ...object, anchors };
    }
    // 未锚定旧图案：锚定数组留空，编辑、渲染、导出行为与旧版完全一致。
    return { ...object, anchors: [] };
  });
  if (!wasOld && objects.every((object, i) => object === project.objects[i])) return project;
  return { ...project, schemaVersion: 2, objects };
}

function sanitizeAnchor(input: unknown): Anchor {
  const anchor = (input ?? {}) as Partial<Anchor>;
  return {
    id: typeof anchor.id === 'string' ? anchor.id : uid('anchor'),
    objectId: String(anchor.objectId ?? ''),
    pointSegment: Number(anchor.pointSegment ?? 0),
    pointRole: (['end', 'qControl', 'c1', 'c2'].includes(anchor.pointRole as string)
      ? anchor.pointRole
      : 'end') as Anchor['pointRole'],
    pointX: Number(anchor.pointX ?? 0),
    pointY: Number(anchor.pointY ?? 0),
    elementKind: (['rotation', 'mirror', 'glide'].includes(anchor.elementKind as string)
      ? anchor.elementKind
      : 'rotation') as ElementKind,
    elementKey: String(anchor.elementKey ?? 'r:2:0:0'),
    offsetAlong: Number(anchor.offsetAlong ?? 0),
    status: anchor.status === 'broken' ? 'broken' : 'active',
    brokenReason: typeof anchor.brokenReason === 'string' ? anchor.brokenReason : null,
    createdAt: Number(anchor.createdAt ?? Date.now())
  };
}
