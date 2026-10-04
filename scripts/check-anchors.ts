import {
  cosetClassIndex,
  canonicalInstanceKey,
  enforceObjectAnchors,
  makeAnchor,
  migrateProject,
  nearestElement,
  remapProjectAnchors,
  repairAnchor,
  resolveElement
} from '../src/lib/anchors.ts';
import { GROUP_SPECS, getCellSize, compose, invert, transformPoint, translation, latticeVectors } from '../src/lib/groups.ts';
import { ellipsePath, editablePoints, uid } from '../src/lib/path.ts';
import { applyMatrixToPath } from '../src/lib/path.ts';
import type { Anchor, GroupId, PatternObject, Point, Project } from '../src/types.ts';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  console.log(`${cond ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures += 1;
}
const approx = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;
function project(group: GroupId, w: number, h: number, objects: PatternObject[]): Project {
  return {
    id: uid('project'),
    name: 'acceptance',
    group,
    cellWidth: w,
    cellHeight: h,
    objects,
    schemaVersion: 2,
    updatedAt: 0
  };
}
function obj(path: ReturnType<typeof ellipsePath>, anchors?: Anchor[]): PatternObject {
  return {
    id: uid('object'),
    name: 't',
    path,
    fill: '#f00',
    stroke: '#000',
    strokeWidth: 1,
    opacity: 1,
    anchors
  };
}
/** 独立地用矩阵像核对：两个 (coset,n,m) 的路径点像是否只差整数晶格平移。 */
function imagesCoincideUpToLattice(p: Project, item: PatternObject, a: { coset: number; n: number; m: number }, b: { coset: number; n: number; m: number }): boolean {
  const [w, h] = getCellSize(p.group, p.cellWidth, p.cellHeight);
  const cosets = GROUP_SPECS[p.group].cosets(w, h);
  const inst = (c: number, n: number, m: number) => {
    const [[ax, ay], [bx, by]] = lattice(p, w, h);
    return compose(translation(n * ax + m * bx, n * ay + m * by), cosets[c]!);
  };
  const pts = editablePoints(item.path).map((q): Point => [q.x, q.y]);
  const ia = inst(a.coset, a.n, a.m);
  const ib = inst(b.coset, b.n, b.m);
  const pa = pts.map((q) => transformPoint(ia, q[0], q[1]));
  const pb = pts.map((q) => transformPoint(ib, q[0], q[1]));
  // pb - pa 必须全部相等且为晶格整数平移
  const d0: Point = [pb[0]![0] - pa[0]![0], pb[0]![1] - pa[0]![1]];
  const [[ax, ay], [bx, by]] = lattice(p, w, h);
  const det = ax * by - ay * bx;
  const un = (by * d0[0] - bx * d0[1]) / det;
  const um = (-ay * d0[0] + ax * d0[1]) / det;
  if (!approx(un, Math.round(un), 1e-4) || !approx(um, Math.round(um), 1e-4)) return false;
  return pa.every((q, i) => approx(q[0] + d0[0], pb[i]![0], 1e-4) && approx(q[1] + d0[1], pb[i]![1], 1e-4));
}
function lattice(p: Project, w: number, h: number): [Point, Point] {
  if (p.group === 'cm' || p.group === 'cmm') return [[w / 2, h / 2], [-w / 2, h / 2]];
  const tri = ['p3', 'p3m1', 'p31m', 'p6', 'p6m'].includes(p.group);
  if (tri) return [[w, 0], [w / 2, h]];
  return [[w, 0], [0, h]];
}

// ── ① p4m：锚到四重中心，改单元尺寸后位置保持；重合像去重 ──────────────────────
{
  const ellipse = obj(ellipsePath(0, 0, 20, 12));
  let p = project('p4m', 240, 240, [ellipse]);
  const element = nearestElement(p, [0, 0], 5)!;
  check('p4m 拾取到四重中心', element?.key === 'r:4:0:0', element?.key);
  const ref = editablePoints(ellipse.path).find((q) => approx(q.x, 20, 1e-9) && approx(q.y, 0))!;
  const anchor = makeAnchor(ellipse, ref, element);
  ellipse.anchors = [anchor];
  let anchored = enforceObjectAnchors(ellipse, p);
  p.objects = [anchored];
  const refNow = editablePoints(anchored.path).find((_, i) => i === 0)!;
  // 椭圆右顶点原本在 (20,0)，参考点是中心 (0,0) 吗？——椭圆路径没有中心点节点，
  // 因此参考点选右顶点；锚定旋转中心意味着右顶点必须落在 (0,0)，整圆平移 -20。
  const picked = editablePoints(anchored.path).find(
    (q) => q.segmentIndex === anchor.pointSegment && q.role === anchor.pointRole
  )!;
  check('锚定后参考点与四重中心重合', approx(picked.x, 0) && approx(picked.y, 0), `(${picked.x},${picked.y})`);

  // 改变单元尺寸（p4m 正方形 240→320）
  p = remapProjectAnchors({ ...p, cellWidth: 320, cellHeight: 320 });
  const after = editablePoints(p.objects[0]!.path).find(
    (q) => q.segmentIndex === anchor.pointSegment && q.role === anchor.pointRole
  )!;
  check('改单元尺寸后参考点仍在四重中心 (0,0)', approx(after.x, 0) && approx(after.y, 0), `(${after.x},${after.y})`);

  // 重合像归类：与锚定记录解耦，只看路径在稳定子下的实际几何重合——
  // 圆（全 D4 稳定子）→ 1 类；中心椭圆（4 元稳定子）→ 2 类；非对称 → 8 类。
  // 这些形状“恰好坐在旋转中心”正是导出/画布叠色风险出现的场景。
  const cCircle = cosetClassIndex(p, obj(ellipsePath(0, 0, 20, 20))).classes;
  check('中心圆 8 个陪集全部重合为 1 类', cCircle.length === 1 && cCircle[0]!.members.length === 8);
  const cEllipse = cosetClassIndex(p, obj(ellipsePath(0, 0, 20, 12))).classes;
  check('中心椭圆归为 2 类（每类 4 像）', cEllipse.length === 2 && cEllipse.every((c) => c.members.length === 4));
  // 右顶点被锚到中心的椭圆中心在 (-20,0)，恰好横跨过中心的水平镜线 y=0：
  // 椭圆自身关于该轴对称，存在 2 阶镜面稳定子 → 8 个像归为 4 类（每类 2 像）。
  const cAnchored = cosetClassIndex(p, p.objects[0]!).classes;
  check(
    '锚定后跨镜面椭圆有 2 阶镜面稳定子（4 类 × 2 像）',
    cAnchored.length === 4 && cAnchored.every((c) => c.members.length === 2)
  );
  // p2：半转对称、且有节点坐在中心的图元 → 2 个陪集重合
  const bowtie: PatternObject['path'] = [
    { type: 'M', x: 0, y: 0 },
    { type: 'L', x: 20, y: 0 },
    { type: 'L', x: 0, y: -8 },
    { type: 'L', x: -20, y: 0 },
    { type: 'L', x: 0, y: 8 },
    { type: 'Z' }
  ];
  const p2 = project('p2', 240, 200, []);
  const cP2 = cosetClassIndex(p2, obj(bowtie)).classes;
  check('p2 中心半转图元的 2 个陪集重合为 1 类', cP2.length === 1 && cP2[0]!.members.length === 2);
  const wedge = obj([
    { type: 'M', x: 0, y: 0 },
    { type: 'L', x: 40, y: 5 },
    { type: 'L', x: 8, y: 30 },
    { type: 'Z' }
  ]);
  const cWedge = cosetClassIndex(p, wedge).classes;
  check('非对称楔形 8 个像互不重合', cWedge.length === 8);

  // 规范键与实际几何一致：同类成员的像确实只相差晶格平移。
  // 用完全非对称的楔形对象（8 类）单独验证键系统，避免稳定子特例干扰。
  const { byCoset } = cosetClassIndex(p, wedge);
  let consistent = true;
  for (let c = 0; c < 8; c += 1) {
    const canon = canonicalInstanceKey(byCoset, c, 2, -1);
    consistent &&= imagesCoincideUpToLattice(
      p,
      wedge,
      { coset: c, n: 2, m: -1 },
      { coset: canon.coset, n: canon.n, m: canon.m }
    );
  }
  check('规范像身份与实际重合几何一致', consistent);

  const keys = new Set<string>();
  let dups = 0;
  for (let c = 0; c < 8; c += 1) for (let n = 0; n < 4; n++) for (let m = 0; m < 4; m++) {
    const k = canonicalInstanceKey(byCoset, c, n, m).key;
    if (keys.has(k)) dups += 1;
    keys.add(k);
  }
  check('非对称楔形：枚举网格内规范键无重复（不会叠色）', dups === 0, `${dups} dup`);
  check('非对称楔形：去重不丢像（总数 = 类数 × 格点数 = 8×16）', keys.size === 8 * 16);

  // 跨镜面椭圆（4 类 × 2 像）：128 次枚举去重为 4 × 16 = 64 个规范像
  const idxEllipse = cosetClassIndex(p, obj(ellipsePath(0, 0, 20, 12))).byCoset;
  const keysE = new Set<string>();
  for (let c = 0; c < 8; c += 1) for (let n = 0; n < 4; n++) for (let m = 0; m < 4; m++) {
    keysE.add(canonicalInstanceKey(idxEllipse, c, n, m).key);
  }
  check('中心椭圆：128 次枚举去重为 32 个规范像', keysE.size === 32, `${keysE.size}`);

  const idxMirror = cosetClassIndex(p, p.objects[0]!).byCoset;
  const keysM = new Set<string>();
  for (let c = 0; c < 8; c += 1) for (let n = 0; n < 4; n++) for (let m = 0; m < 4; m++) {
    keysM.add(canonicalInstanceKey(idxMirror, c, n, m).key);
  }
  check('跨镜面椭圆：128 次枚举去重为 64 个规范像', keysM.size === 64, `${keysM.size}`);
}

// ── ② pg：锚到滑移轴，拖动镜像实例后源对象与全部实例满足轴约束 ────────────────
{
  let p = project('pg', 260, 200, [obj(ellipsePath(50, 40, 16, 10))]);
  const item = p.objects[0]!;
  const ref0 = editablePoints(item.path)[0]!;
  const element = nearestElement(p, [ref0.x, 0], 30)!;
  check('pg 拾取到滑移轴 y=0', element?.key === 'g:h:0:0', element?.key);
  const anchor = makeAnchor(item, ref0, element);
  item.anchors = [anchor];
  let anchored = enforceObjectAnchors(item, p);
  p.objects = [anchored];
  const onAxis = (x: number, y: number, h: number) =>
    approx(y % (h / 2), 0, 1e-6) || approx(((y % h) + h) % h, 0, 1e-6) || approx(((y % (h / 2)) + h / 2) % (h / 2), 0, 1e-6);
  const refP = (object: PatternObject) => {
    const q = editablePoints(object.path).find(
      (x) => x.segmentIndex === anchor.pointSegment && x.role === anchor.pointRole
    )!;
    return q;
  };
  check('源对象参考点落到 y=0 轴', approx(refP(anchored).y, 0, 1e-6), `y=${refP(anchored).y}`);

  // 拖动一个镜像实例（coset 1,0,0），世界位移 (37, -29)。
  // g: (x,y) ↦ (x + w/2, -y)，世界 Δy=-29 映射到源 Δy=+29，锚定投影会整体消掉离轴量；
  // 世界 Δx=37 沿轴方向，可逆映射回源对象并保留。
  const [w, h] = getCellSize('pg', 260, 200);
  const g = GROUP_SPECS.pg.cosets(w, h)[1]!;
  const sourceDelta = compose(invert(g), translation(37, -29));
  const dragged = applyMatrixToPath(anchored.path, sourceDelta);
  anchored = enforceObjectAnchors({ ...anchored, path: dragged }, p);
  p.objects = [anchored];
  check('拖动镜像后源对象参考点仍在轴上', onAxis(refP(anchored).x, refP(anchored).y, h), `y=${refP(anchored).y}`);
  check('沿轴偏移被保留、离轴偏移被消除', approx(refP(anchored).x, -27, 1e-6) && approx(refP(anchored).y, 0, 1e-6),
    `(${refP(anchored).x},${refP(anchored).y})`);

  // 所有实例（两个陪集 × 若干平移）的参考点像都在滑移轴族 y = k·h/2 上
  const rp = refP(anchored);
  let allOnAxis = true;
  for (let c = 0; c < 2; c++) {
    for (let n = -1; n <= 1; n++) {
      for (let m = -1; m <= 1; m++) {
        const mat = compose(translation(n * w, m * h), GROUP_SPECS.pg.cosets(w, h)[c]!);
        const [, iy] = transformPoint(mat, rp.x, rp.y);
        const mod = ((iy % (h / 2)) + h / 2) % (h / 2);
        if (!approx(mod, 0, 1e-6)) allOnAxis = false;
      }
    }
  }
  check('源对象与全部实例满足滑移轴约束', allOnAxis);
}

// ── ③ 切到 p1：锚定不丢失、进入待修复；撤销可恢复；修复后可重新锚定 ──────────
{
  let p = project('p4m', 240, 240, [obj(ellipsePath(0, 0, 18, 18))]);
  const item = p.objects[0]!;
  const anchor: Anchor = {
    id: uid('anchor'),
    objectId: item.id,
    pointSegment: 0,
    pointRole: 'end',
    pointX: 18,
    pointY: 0,
    elementKind: 'rotation',
    elementKey: 'r:4:0:0',
    offsetAlong: 0,
    status: 'active',
    brokenReason: null,
    createdAt: 0
  };
  item.anchors = [anchor];
  p = remapProjectAnchors(p);
  const before = p.objects[0]!.anchors![0]!;
  check('p4m 中锚定有效', before.status === 'active');

  const switched = remapProjectAnchors({ ...p, group: 'p1' as GroupId });
  const broken = switched.objects[0]!.anchors![0]!;
  check('切到 p1 后锚定保留且为待修复', switched.objects[0]!.anchors!.length === 1 && broken.status === 'broken');
  check('待修复原因明确点名 p1', !!broken.brokenReason && broken.brokenReason.includes('p1'), broken.brokenReason ?? '');

  // 撤销群切换（模拟：旧 project 直接还原）→ 锚定恢复 active
  const undone = remapProjectAnchors({ ...p });
  check('撤销群切换后锚定恢复 active', undone.objects[0]!.anchors![0]!.status === 'active');

  // 在 p1 中尝试修复：没有任何对称元素，仍 broken（不静默脱离）
  const repairedInP1 = repairAnchor(switched, broken);
  check('p1 中修复不会伪造锚定', repairedInP1.status === 'broken');

  // 回到兼容群 p4 后修复 → 自动重新匹配
  const back = { ...switched, group: 'p4' as GroupId, cellHeight: 240 };
  const repaired = repairAnchor(back, broken);
  check('切回兼容群 p4 后重新匹配成功', repaired.status === 'active' && repaired.elementKey === 'r:4:0:0', repaired.elementKey);

  // 不兼容类型（镜键在 p2）也进入待修复
  const mirrorAnchor: Anchor = { ...anchor, id: uid('anchor'), elementKind: 'mirror', elementKey: 'm:v:0:0' };
  const p2p = remapProjectAnchors({
    ...project('pmm', 200, 160, []),
    objects: [{ ...item, anchors: [mirrorAnchor] }]
  });
  const toP2 = remapProjectAnchors({ ...p2p, group: 'p2' as GroupId });
  check('pmm→p2 镜线锚定进入待修复', toP2.objects[0]!.anchors![0]!.status === 'broken');
}

// ── ④ 旧工程迁移：对象 ID/锚定身份保留；无锚定旧图案行为不变 ─────────────────
{
  const oldPath = ellipsePath(10, 10, 30, 20);
  const old = {
    id: 'project_old',
    name: 'legacy',
    group: 'pg' as GroupId,
    cellWidth: 100,
    cellHeight: 80,
    objects: [
      { id: 'object_keep', name: '旧图案', path: oldPath, fill: '#fff', stroke: '#000', strokeWidth: 1, opacity: 0.5 }
    ],
    updatedAt: 123
  };
  const migrated = migrateProject(old as unknown as Project);
  check('旧工程升到 schemaVersion 2', migrated.schemaVersion === 2);
  check('对象 ID 保持一致', migrated.objects[0]!.id === 'object_keep');
  check('未锚定旧图案 anchors 为空', JSON.stringify(migrated.objects[0]!.anchors) === '[]');
  check('旧图案路径逐点保持', JSON.stringify(migrated.objects[0]!.path) === JSON.stringify(oldPath));
  check('旧图案样式保持', migrated.objects[0]!.fill === '#fff' && migrated.objects[0]!.opacity === 0.5);
  const again = migrateProject(migrated);
  check('迁移幂等', again === migrated || (again.schemaVersion === 2 && again.objects[0]!.anchors!.length === 0));

  // 已含锚定的工程迁移：锚定身份保持，脏数据被规整
  const withAnchor = {
    ...migrated,
    objects: [
      {
        ...migrated.objects[0]!,
        anchors: [
          { id: 'anchor_keep', objectId: 'object_keep', pointSegment: 0, pointRole: 'end', pointX: 40, pointY: 10, elementKind: 'glide', elementKey: 'g:h:0:0', status: 'active', brokenReason: null, createdAt: 1 }
        ]
      }
    ]
  };
  const m2 = migrateProject(withAnchor);
  check('迁移后锚定身份保持', m2.objects[0]!.anchors![0]!.id === 'anchor_keep');
  check('迁移后锚定键保持', m2.objects[0]!.anchors![0]!.elementKey === 'g:h:0:0');

  // 刷新/重开模拟：序列化往返（structuredClone）后待修复状态与身份仍一致
  const p = remapProjectAnchors({
    ...project('p1', 100, 100, []),
    objects: m2.objects
  });
  const roundtrip = structuredClone(p);
  check('刷新往返后锚定数量/身份一致', roundtrip.objects[0]!.anchors!.length === 1 && roundtrip.objects[0]!.anchors![0]!.id === 'anchor_keep');
  check('刷新往返后仍为待修复', roundtrip.objects[0]!.anchors![0]!.status === 'broken');
}

// ── 存储层撤销/重做集成 ──────────────────────────────────────────────────────
{
  const { get } = await import('svelte/store');
  const { editor, setGroup, undo, redo, setProject } = await import('../src/lib/stores.ts');
  let p = project('p4m', 240, 240, []);
  const item = obj(ellipsePath(0, 0, 18, 18));
  const anchor: Anchor = {
    id: uid('anchor'), objectId: item.id, pointSegment: 0, pointRole: 'end',
    pointX: 18, pointY: 0, elementKind: 'rotation', elementKey: 'r:4:0:0',
    offsetAlong: 0, status: 'active', brokenReason: null, createdAt: 0
  };
  item.anchors = [anchor];
  p.objects = [item];
  setProject(p);
  setGroup('p1');
  type StoreSnapshot = { project: Project; canUndo: boolean; canRedo: boolean };
  let state = get(editor) as StoreSnapshot;
  check('store：切 p1 后待修复', state.project.objects[0]!.anchors![0]!.status === 'broken');
  undo();
  state = get(editor) as StoreSnapshot;
  check('store：撤销恢复 active 且可重做', state.project.objects[0]!.anchors![0]!.status === 'active' && state.canRedo);
  redo();
  state = get(editor) as StoreSnapshot;
  check('store：重做再次待修复', state.project.objects[0]!.anchors![0]!.status === 'broken');
}

// ── resolveElement 分数坐标随尺寸变化 ────────────────────────────────────────
{
  const pA = project('pg', 260, 200, []);
  const pB = project('pg', 400, 300, []);
  const eA = resolveElement(pA, 'g:h:0:1/2')!;
  const eB = resolveElement(pB, 'g:h:0:1/2')!;
  check('滑移轴分数位置随尺寸重映射 (100→150)', approx(eA.point[1], 100) && approx(eB.point[1], 150));
  const p4a = project('p4m', 240, 240, []);
  const p4b = project('p4m', 320, 320, []);
  const rA = resolveElement(p4a, 'r:4:0:0')!;
  const rB = resolveElement(p4b, 'r:4:0:0')!;
  check('四重中心原点在尺寸变化时不动', approx(rA.point[0], 0) && approx(rB.point[0], 0));
}

// ── 导出/画布去重覆盖完备性：每个被枚举的实例都由范围内的代表覆盖 ─────────────
{
  function coverageComplete(group: GroupId, w: number, h: number, shape: PatternObject['path']) {
    const p = project(group, w, h, []);
    const item = obj(shape);
    const { byCoset } = cosetClassIndex(p, item);
    const cosetCount = GROUP_SPECS[group].cosets(w, h).length;
    // 与 export.ts 相同（非三角）枚举窗：-2..2；三角：-2..3（随后 +1 平移）。
    const tri = ['p3', 'p3m1', 'p31m', 'p6', 'p6m'].includes(group);
    const min = -2;
    const max = tri ? 3 : 2;
    const drawn = new Set<string>();
    for (let c = 0; c < cosetCount; c++)
      for (let n = min; n <= max; n++)
        for (let m = min; m <= max; m++) {
          const tn = n + (tri ? 1 : 0);
          const tm = m + (tri ? 1 : 0);
          drawn.add(canonicalInstanceKey(byCoset, c, tn, tm).key);
        }
    // 对输出超级矩形覆盖所需的每个 (coset,n,m)（-1..2 或 0..1 窗），其规范像必须在 drawn 中。
    const needMin = tri ? -1 : -1;
    const needMax = tri ? 2 : 1;
    for (let c = 0; c < cosetCount; c++)
      for (let n = needMin; n <= needMax; n++)
        for (let m = needMin; m <= needMax; m++) {
          const tn = n + (tri ? 1 : 0);
          const tm = m + (tri ? 1 : 0);
          const key = canonicalInstanceKey(byCoset, c, tn, tm).key;
          if (!drawn.has(key)) return false;
        }
    return true;
  }
  const circle = ellipsePath(0, 0, 18, 18);
  const ellipse = ellipsePath(0, 0, 26, 9);
  const bowtie: PatternObject['path'] = [
    { type: 'M', x: 0, y: 0 },
    { type: 'L', x: 20, y: 0 },
    { type: 'L', x: 0, y: -8 },
    { type: 'L', x: -20, y: 0 },
    { type: 'L', x: 0, y: 8 },
    { type: 'Z' }
  ];
  check('导出覆盖完备 p4m/中心圆（D4 稳定子）', coverageComplete('p4m', 240, 240, circle));
  check('导出覆盖完备 p4m/跨镜椭圆（镜面稳定子）', coverageComplete('p4m', 240, 240, ellipse));
  check('导出覆盖完备 p2/半转领结（半转稳定子）', coverageComplete('p2', 240, 200, bowtie));
  check('导出覆盖完备 p6m/中心圆（D6 稳定子）', coverageComplete('p6m', 240, Math.round((Math.sqrt(3) / 2) * 240), circle));
  check('导出覆盖完备 pg/水平椭圆（无稳定子对照）', coverageComplete('pg', 260, 200, ellipsePath(50, 40, 16, 10)));
}

console.log(failures ? `\n${failures} 项失败` : '\n全部锚定验收检查通过');
process.exit(failures ? 1 : 0);
