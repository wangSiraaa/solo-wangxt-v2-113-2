export type Point = [number, number];

export type PathSegment =
  | { type: 'M'; x: number; y: number }
  | { type: 'L'; x: number; y: number }
  | { type: 'Q'; cx: number; cy: number; x: number; y: number }
  | { type: 'C'; cx1: number; cy1: number; cx2: number; cy2: number; x: number; y: number }
  | { type: 'Z' };

export type GroupId =
  | 'p1'
  | 'p2'
  | 'pm'
  | 'pg'
  | 'cm'
  | 'pmm'
  | 'pmg'
  | 'cmm'
  | 'p4'
  | 'p4m'
  | 'p4g'
  | 'p3'
  | 'p3m1'
  | 'p31m'
  | 'p6'
  | 'p6m';

export interface StyleSpec {
  fill: string;
  stroke: string;
  strokeWidth: number;
  opacity: number;
}

/**
 * 对称元素类型：旋转中心 / 镜线 / 滑移轴。
 */
export type ElementKind = 'rotation' | 'mirror' | 'glide';

/**
 * 对同一图元在稳定子（固定它的群元素）下的重合像归类后，
 * 每个等价类只有一个代表陪集参与渲染、命中与导出。
 */
export interface CosetClass {
  representative: number;
  members: number[];
}

/**
 * 锚点关联对象的一个可编辑参考点（按段索引+角色定位，节点重排时会进入待修复），
 * 以及当前墙纸群中按命名键（分数坐标，与单元尺寸无关）登记的旋转中心 / 镜线 / 滑移轴。
 * 偏移规则：旋转中心不允许偏移；镜线/滑移轴仅允许沿轴偏移（offsetAlong，源对象坐标）。
 */
export interface Anchor {
  id: string;
  objectId: string;
  /** 可编辑参考点定位信息，对应 editablePoints 中的一项。 */
  pointSegment: number;
  pointRole: 'end' | 'qControl' | 'c1' | 'c2';
  /** 建锚时的点坐标快照，用于参考点失效后仍可定位待修复位置。 */
  pointX: number;
  pointY: number;
  elementKind: ElementKind;
  /** 对称元素命名键：r:{order}:{u}:{v} | m:{axis}:{u}:{v} | g:{axis}:{u}:{v}，分数坐标。 */
  elementKey: string;
  /** 仅对镜线/滑移轴有效：沿轴方向允许的偏移。 */
  offsetAlong: number;
  status: 'active' | 'broken';
  brokenReason: string | null;
  createdAt: number;
}

export interface PatternObject extends StyleSpec {
  id: string;
  name: string;
  path: PathSegment[];
  anchors?: Anchor[];
}

export interface Project {
  id: string;
  name: string;
  group: GroupId;
  cellWidth: number;
  cellHeight: number;
  objects: PatternObject[];
  /** 持久化版本：1 = 无锚定旧工程，迁移后升至 2。 */
  schemaVersion?: number;
  updatedAt: number;
}

export type Tool = 'select' | 'node' | 'pen' | 'rectangle' | 'ellipse';

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export interface RenderOptions {
  showDomain: boolean;
  showGrid: boolean;
  showSymmetry: boolean;
  showHandles: boolean;
}
