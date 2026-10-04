import { GROUP_SPECS, getCellSize, transformPoint, translationMatrix, compose } from '../src/lib/groups.ts';
import {
  ELEMENTS,
  reconcileAnchors,
  enforceAnchor,
  referencePoint,
  resolveElement,
  projectDragToAnchor,
  createAnchor,
  migrateProject
} from '../src/lib/anchors.ts';
import { imageKey, coincidenceGroups } from '../src/lib/render.ts';
import { applyMatrixToPath, ellipsePath, rectanglePath, uid } from '../src/lib/path.ts';
import type { GroupId, Project, SymmetryAnchor } from '../src/types.ts';

let failures = 0;
function check(name: string, condition: boolean, detail = '') {
  if (condition) {
    console.log('PASS', name);
  } else {
    failures++;
    console.log('FAIL', name, detail);
  }
}

function project(group: GroupId, w: number, h: number, objects: Project['objects'], anchors: SymmetryAnchor[] = []): Project {
  return {
    id: uid('project'),
    name: 'test',
    group,
    cellWidth: w,
    cellHeight: h,
    objects,
    anchors,
    schemaVersion: 2,
    updatedAt: 0
  };
}

/* ---- Acceptance 1: p4m anchor to 4-fold centre survives cell resize ---- */
{
  const obj = {
    id: 'o1',
    name: 'dot',
    path: ellipsePath(120, 130, 12, 12),
    fill: '#000',
    stroke: '#000',
    strokeWidth: 1,
    opacity: 1
  };
  let p = project('p4m', 240, 240, [obj]);
  const created = createAnchor({
    objectId: 'o1',
    elementId: 'rot4-origin',
    ref: 'bounds-center',
    rule: 'pin',
    project: p
  });
  p = created.project;
  const anchor = created.anchor;
  const [cx0, cy0] = referencePoint(p.objects[0]!.path, anchor.ref);
  check('p4m anchor snaps centre to (0,0)', Math.hypot(cx0, cy0) < 1e-6, `got ${cx0},${cy0}`);

  // Resize: re-enforce (the store does this via snapProjectAnchors).
  p = { ...p, cellWidth: 360 };
  p = enforceAnchorProject(p, anchor);
  const [cx1, cy1] = referencePoint(p.objects[0]!.path, anchor.ref);
  check('p4m centre stays (0,0) after resize', Math.hypot(cx1, cy1) < 1e-6, `got ${cx1},${cy1}`);

  // Resolved element itself tracks the fraction (still origin here).
  const el = resolveElement('p4m', 'rot4-origin', 360, 360);
  check('p4m element resolves at origin', el?.point && Math.hypot(el.point[0], el.point[1]) < 1e-6);
}

function enforceAnchorProject(p: Project, anchor: SymmetryAnchor): Project {
  return {
    ...p,
    objects: p.objects.map((o) =>
      o.id === anchor.objectId ? { ...o, path: enforceAnchor(o.path, anchor, p.cellWidth, p.cellHeight) } : o
    )
  };
}

/* ---- Stabilizer coincidence: rotationally symmetric motif on 4-centre ---- */
{
  const circle = {
    id: 'c',
    name: 'circle',
    path: ellipsePath(0, 0, 10, 10),
    fill: '#f00',
    stroke: '#000',
    strokeWidth: 1,
    opacity: 1
  };
  const p = project('p4m', 240, 240, [circle]);
  const range = { nMin: -1, nMax: 1, mMin: -1, mMax: 1 };
  const groups = coincidenceGroups(p, circle, range);
  // There should be groups with >1 coincident member at the origin (4 rotations + mirrors).
  const coincident = groups.filter((g) => g.coincident);
  check('p4m circle on centre has coincident images', coincident.length > 0,
    `coincident groups=${coincident.length}, total=${groups.length}`);
  // Total distinct images must be LESS than raw enumeration (8 cosets * 9).
  check('p4m dedup reduces image count', groups.length < 8 * 9, `got ${groups.length}`);

  // A non-symmetric motif nearby must NOT collapse.
  const wedge = {
    id: 'w',
    name: 'wedge',
    path: rectanglePath(30, 30, 40, 20),
    fill: '#00f',
    stroke: '#000',
    strokeWidth: 1,
    opacity: 1
  };
  const p2 = project('p4m', 240, 240, [wedge]);
  const groups2 = coincidenceGroups(p2, wedge, range);
  const coincident2 = groups2.filter((g) => g.coincident);
  check('off-centre asymmetric motif has no coincidence', coincident2.length === 0,
    `coincident=${coincident2.length}`);
}

/* ---- imageKey: identical geometry shares key, rotated differs ---- */
{
  const p = project('p4m', 240, 240, []);
  const circle = ellipsePath(0, 0, 10, 10);
  const r90 = GROUP_SPECS.p4m.cosets(240, 240)[1]!;
  const k1 = imageKey(p, circle, GROUP_SPECS.p4m.cosets(240, 240)[0]!);
  const k2 = imageKey(p, circle, r90);
  check('circle stabilizer images share key', k1 === k2);
  const rect = rectanglePath(5, 0, 30, 10);
  const kr1 = imageKey(p, rect, GROUP_SPECS.p4m.cosets(240, 240)[0]!);
  const kr2 = imageKey(p, rect, r90);
  check('asymmetric rotated images differ', kr1 !== kr2);
}

/* ---- Acceptance 2: pg glide axis drag keeps source + all images on axis ---- */
{
  const w = 260;
  const h = 200;
  const obj = {
    id: 'g',
    name: 'feather',
    path: ellipsePath(50, 40, 14, 9),
    fill: '#d00',
    stroke: '#000',
    strokeWidth: 1,
    opacity: 1
  };
  let p = project('pg', w, h, [obj]);
  const created = createAnchor({
    objectId: 'g',
    elementId: 'glide-h0',
    ref: 'bounds-center',
    rule: 'on',
    project: p
  });
  p = created.project;
  const anchor = created.anchor;
  check('pg anchor snaps ref onto y=0', Math.abs(referencePoint(p.objects[0]!.path, anchor.ref)[1]) < 1e-6);

  // Drag the MIRRORED image (coset 1, the glide) by a vector with a y-component.
  const [cw, ch] = getCellSize('pg', w, h);
  const glideMatrix = compose(translationMatrix('pg', cw, ch, 0, 0), GROUP_SPECS.pg.cosets(cw, ch)[1]!);
  const moved = projectDragToAnchor(p.objects[0]!.path, anchor, glideMatrix, 30, 47, cw, ch);
  const [mx, my] = referencePoint(moved, anchor.ref);
  check('pg source ref stays on axis after glide drag (y=0)', Math.abs(my) < 1e-6, `y=${my}`);
  // Along-axis motion (glide direction is horizontal) should survive.
  check('pg along-axis motion allowed', Math.abs(mx) > 1e-6, `x=${mx}`);

  // Every coset image must also satisfy the axis (residual in world coordinates).
  const cosets = GROUP_SPECS.pg.cosets(cw, ch);
  let maxResid = 0;
  cosets.forEach((c) => {
    const imagePath = applyMatrixToPath(moved, c);
    const [, iy] = referencePoint(imagePath, anchor.ref);
    // coset0 on y=0; the glide image of a point on the axis stays on the same axis.
    maxResid = Math.max(maxResid, Math.abs(iy));
  });
  check('pg all coset images lie on a glide axis', maxResid < 1e-6, `maxResid=${maxResid}`);
}

/* ---- Acceptance 3: switch to p1 preserves anchor, marks broken, undo recovers ---- */
{
  const obj = {
    id: 'x',
    name: 'x',
    path: ellipsePath(0, 0, 10, 10),
    fill: '#000',
    stroke: '#000',
    strokeWidth: 1,
    opacity: 1
  };
  let p = project('p4m', 240, 240, [obj]);
  const created = createAnchor({ objectId: 'x', elementId: 'rot4-origin', ref: 'bounds-center', rule: 'pin', project: p });
  p = created.project;
  const before = p.anchors![0]!;
  check('anchor active in p4m', before.status === 'active');

  // Switch group to p1 (stores.setGroup performs reconcileAnchors).
  p = reconcileAnchors({ ...p, group: 'p1' as GroupId });
  const after = p.anchors![0]!;
  check('anchor preserved (not deleted) on switch to p1', p.anchors!.length === 1);
  check('anchor broken in p1', after.status === 'broken');
  check('broken reason recorded', typeof after.brokenReason === 'string' && after.brokenReason.length > 0);
  check('anchor keeps original element identity', after.elementId === 'rot4-origin' && after.originGroup === 'p4m');

  // Switch back: should auto-reactivate.
  p = reconcileAnchors({ ...p, group: 'p4m' as GroupId });
  check('anchor reactivates returning to p4m', p.anchors![0]!.status === 'active');
}

/* ---- Broken on incompatible group keeps object movable; repair restores ---- */
{
  const obj = { id: 'x', name: 'x', path: ellipsePath(10, 10, 5, 5), fill: '#000', stroke: '#000', strokeWidth: 1, opacity: 1 };
  let p = project('pg', 200, 200, [obj]);
  const created = createAnchor({ objectId: 'x', elementId: 'glide-h0', ref: 'bounds-center', rule: 'on', project: p });
  p = created.project;
  p = reconcileAnchors({ ...p, group: 'p1' as GroupId });
  check('pg glide anchor broken under p1', p.anchors![0]!.status === 'broken');
  // Residual is Infinity/undefined enforcement: enforceAnchor must not throw on broken anchor
  const enforced = enforceAnchor(p.objects[0]!.path, p.anchors![0]!, 200, 200);
  check('broken anchor enforcement is a no-op (object free)', enforced === p.objects[0]!.path || enforced.length === p.objects[0]!.path.length);
}

/* ---- Acceptance 4: migration of an old v1 project (no anchors) ---- */
{
  const old: any = {
    id: 'old',
    name: 'v1',
    group: 'p4m',
    cellWidth: 200,
    cellHeight: 200,
    objects: [{ id: 'legacy', name: 'legacy', path: rectanglePath(0, 0, 10, 10), fill: '#000', stroke: '#000', strokeWidth: 1, opacity: 1 }],
    updatedAt: 0
  };
  const migrated = migrateProject(old);
  check('v1 migration adds empty anchors', Array.isArray(migrated.anchors) && migrated.anchors.length === 0);
  check('v1 migration sets schemaVersion 2', migrated.schemaVersion === 2);
  check('v1 object id preserved', migrated.objects[0]!.id === 'legacy');
  // Anchors referring to a missing object are dropped/marked.
  const withDangling: any = {
    ...old,
    id: 'old2',
    anchors: [{ id: 'a', objectId: 'ghost', ref: 'bounds-center', originGroup: 'p4m', elementId: 'rot4-origin', elementLabel: 'x', rule: 'pin', offset: 0, status: 'active', createdAt: 0 }],
    schemaVersion: 1
  };
  const m2 = migrateProject(withDangling);
  check('dangling anchor dropped on migration', m2.anchors!.length === 0);
}

/* ---- Element registry completeness: named elements match matrix fixed sets ---- */
{
  // p4m rot4-origin must be fixed by the r4 generator (about origin).
  const r = GROUP_SPECS.p4m.generators.find((g) => g.symbol === 'r₄')!.matrix(240, 240);
  const fixed = transformPoint(r, 0, 0);
  check('p4m r4 fixes origin', Math.hypot(fixed[0], fixed[1]) < 1e-9);
  // pg glide axis y=0 is mapped to itself by g.
  const g = GROUP_SPECS.pg.generators.find((gg) => gg.symbol === 'g')!.matrix(260, 200);
  const [, gy] = transformPoint(g, 37, 0);
  check('pg g keeps points on y=0', Math.abs(gy) < 1e-9);
  // Every group element id resolves to geometry.
  let allResolve = true;
  (Object.keys(ELEMENTS) as GroupId[]).forEach((grp) => {
    const [cw, ch] = getCellSize(grp, 200, 200);
    ELEMENTS[grp].forEach((e) => {
      const resolved = resolveElement(grp, e.id, cw, ch);
      if (!resolved) allResolve = false;
      if (e.kind === 'rotation' && !resolved?.point) allResolve = false;
      if (e.kind !== 'rotation' && !resolved?.axis) allResolve = false;
    });
  });
  check('every named element resolves', allResolve);
}

/* ---- Cell resize keeps fractional element position (½,½ 2-centre) ---- */
{
  const el200 = resolveElement('p4m', 'rot2-half', 200, 200);
  const el400 = resolveElement('p4m', 'rot2-half', 400, 400);
  check('fractional 2-centre scales with cell',
    el200?.point && el400?.point &&
    Math.abs(el200.point[0] - 100) < 1e-6 && Math.abs(el400.point[0] - 200) < 1e-6,
    `${el200?.point} ${el400?.point}`);
}

process.exit(failures ? 1 : 0);
