import { get } from 'svelte/store';
import {
  editor,
  setProject,
  setCellSize,
  setGroup,
  anchorSelected,
  undo,
  redo,
  detachAnchor,
  selectObject
} from '../src/lib/stores.ts';
import { ellipsePath, uid } from '../src/lib/path.ts';
import { referencePoint } from '../src/lib/anchors.ts';
import type { Project } from '../src/types.ts';

let failures = 0;
function check(name: string, condition: boolean, detail = '') {
  if (condition) console.log('PASS', name);
  else {
    failures++;
    console.log('FAIL', name, detail);
  }
}

function makeProject(group: Project['group'], w: number, h: number): Project {
  return {
    id: uid('project'),
    name: 'store-test',
    group,
    cellWidth: w,
    cellHeight: h,
    objects: [
      { id: 'obj', name: 'dot', path: ellipsePath(120, 120, 10, 10), fill: '#000', stroke: '#000', strokeWidth: 1, opacity: 1 }
    ],
    anchors: [],
    schemaVersion: 2,
    updatedAt: 0
  };
}

/* Acceptance 1: p4m 4-centre anchor holds across cell resize, via real store actions */
{
  setProject(makeProject('p4m', 240, 240));
  selectObject('obj', null);
  anchorSelected({ elementId: 'rot4-origin', ref: 'bounds-center', rule: 'pin' });
  let p = get(editor).project;
  check('store: anchor created and snapped to origin', Math.abs(referencePoint(p.objects[0]!.path, 'bounds-center')[0]) < 1e-6);
  setCellSize(400, 400);
  p = get(editor).project;
  const [x, y] = referencePoint(p.objects[0]!.path, 'bounds-center');
  check('store: anchor still on origin after resize to 400', Math.hypot(x, y) < 1e-6, `got ${x},${y}`);
  check('store: anchor stays active after resize', p.anchors![0]!.status === 'active');
}

/* Acceptance 3: p4m -> p1 marks broken; undo restores active anchor */
{
  setGroup('p1');
  let p = get(editor).project;
  check('store: switching to p1 keeps anchor record', p.anchors!.length === 1);
  check('store: anchor broken under p1', p.anchors![0]!.status === 'broken');
  check('store: broken reason present', !!p.anchors![0]!.brokenReason);
  undo(); // undoes the group change
  p = get(editor).project;
  check('store: undo restores p4m group', p.group === 'p4m');
  check('store: undo reactivates anchor', p.anchors![0]!.status === 'active');
  redo();
  p = get(editor).project;
  check('store: redo returns to broken p1', p.group === 'p1' && p.anchors![0]!.status === 'broken');
}

/* Anchor identity and object id stable across undo/redo */
{
  undo(); // back to active p4m
  const before = get(editor).project;
  const anchorId = before.anchors![0]!.id;
  setCellSize(520, 520);
  undo();
  const after = get(editor).project;
  check('store: anchor id stable through undo', after.anchors![0]!.id === anchorId);
  check('store: object id stable through undo', after.objects[0]!.id === 'obj');
}

/* Detach records history and is undoable */
{
  const anchorId = get(editor).project.anchors![0]!.id;
  detachAnchor(anchorId);
  let p = get(editor).project;
  check('store: detach removes anchor', p.anchors!.length === 0);
  undo();
  p = get(editor).project;
  check('store: undo restores detached anchor', p.anchors!.length === 1 && p.anchors![0]!.id === anchorId);
}

/* pg -> p2 (incompatible: no glide) then back reactivates; object still exists */
{
  const pg = makeProject('pg', 260, 200);
  setProject(pg);
  selectObject('obj', null);
  anchorSelected({ elementId: 'glide-h0', ref: 'bounds-center', rule: 'on' });
  setGroup('p2');
  let p = get(editor).project;
  check('store: pg glide anchor broken under p2', p.anchors![0]!.status === 'broken');
  check('store: object retained while anchor broken', p.objects.some((o) => o.id === 'obj'));
  setGroup('pg');
  p = get(editor).project;
  check('store: anchor reactivates returning to pg', p.anchors![0]!.status === 'active');
  const [, ay] = referencePoint(p.objects[0]!.path, 'bounds-center');
  check('store: reactivated anchor re-snapped onto axis', Math.abs(ay) < 1e-6, `y=${ay}`);
}

process.exit(failures ? 1 : 0);
