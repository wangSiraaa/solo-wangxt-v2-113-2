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

export interface PatternObject extends StyleSpec {
  id: string;
  name: string;
  path: PathSegment[];
}

/** Which editable point of the source object the anchor constrains. */
export type AnchorRefKind = 'bounds-center' | 'first-point';

/**
 * pin    : the reference point coincides with the rotation centre (no movement).
 * on     : the reference point lies on a mirror/glide axis and may slide along it.
 * offset : like 'on', but keeps a fixed signed perpendicular distance to the axis.
 */
export type AnchorOffsetRule = 'pin' | 'on' | 'offset';

export type AnchorStatus = 'active' | 'broken';

export interface SymmetryAnchor {
  id: string;
  objectId: string;
  /** Editable reference point carried by the source object. */
  ref: AnchorRefKind;
  /** Group in which elementId is defined; preserved when the user switches groups. */
  originGroup: GroupId;
  /** Stable, size-independent name of the rotation centre / mirror / glide axis. */
  elementId: string;
  /** Human-readable element label captured at creation, shown while the anchor is broken. */
  elementLabel: string;
  rule: AnchorOffsetRule;
  /** Signed perpendicular offset for rule === 'offset'. */
  offset: number;
  status: AnchorStatus;
  /** Present when status === 'broken'; explains why the anchor cannot be applied. */
  brokenReason?: string;
  createdAt: number;
}

export const PROJECT_SCHEMA_VERSION = 2;

export interface Project {
  id: string;
  name: string;
  group: GroupId;
  cellWidth: number;
  cellHeight: number;
  objects: PatternObject[];
  /** v1 projects lack this field; migration fills an empty list. */
  anchors?: SymmetryAnchor[];
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
