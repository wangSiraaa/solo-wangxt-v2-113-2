import type { mat3 } from 'gl-matrix';
import type { Project } from '../types';
import { GROUP_SPECS, compose, getCellSize, translationMatrix } from './groups';
import { applyMat3, coincidenceGroups } from './render';
import { makePath2D, makePolygonPath } from './path';

export interface TileResult {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  repeats: [number, number];
  primitive: [number, number];
}

/**
 * Render a true periodic image. Rectangular groups use one conventional cell.
 * Triangular groups export a rectangular supercell formed by 2×2 primitive
 * vectors, which still repeats under the wallpaper group's translation lattice.
 * Each DISTINCT orbit image is painted once: stabilizer coincidences are
 * de-duplicated with the same geometry grouping as the on-screen renderer, so a
 * motif on a rotation centre is never stacked darker in the exported PNG.
 */
export function exportPeriodicTile(project: Project, scale = 2): TileResult {
  const [cellW, cellH] = getCellSize(project.group, project.cellWidth, project.cellHeight);
  const spec = GROUP_SPECS[project.group];
  const triangular =
    project.group === 'p3' ||
    project.group === 'p3m1' ||
    project.group === 'p31m' ||
    project.group === 'p6' ||
    project.group === 'p6m';
  const repeatN = triangular ? 2 : 1;
  const repeatM = triangular ? 2 : 1;
  const width = cellW * repeatN;
  const height = cellH * repeatM;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);
  // Keep the exported tile transparent: deliberately do not paint a background.
  ctx.clearRect(0, 0, width, height);

  const domainPath = makePath2D(makePolygonPath(spec.domain(cellW, cellH)));

  // A few extra neighboring primitive copies are needed only because some
  // fundamental domain coordinates (pm/pmg/cm) cross the rectangle's border.
  const range = triangular
    ? { nMin: -2, nMax: 3, mMin: -2, mMax: 3 }
    : { nMin: -2, nMax: 2, mMin: -2, mMax: 2 };

  const shift: mat3 = triangular ? translationMatrix(project.group, cellW, cellH, 1, 1) : null!;

  for (const item of project.objects) {
    const path = makePath2D(item.path);
    const groups = coincidenceGroups(project, item, range);
    for (const group of groups) {
      const representative = group.members[0]!;
      const matrix = triangular ? compose(shift, representative.matrix) : representative.matrix;
      ctx.save();
      applyMat3(ctx, matrix);
      ctx.beginPath();
      ctx.rect(-cellW, -cellH, width + cellW * 2, height + cellH * 2);
      ctx.clip();
      // A stabilizer coincidence paints the full motif once, without domain
      // clipping, so the exported tile has no dark double-stack at the centre.
      if (!group.coincident) ctx.clip(domainPath);
      ctx.globalAlpha = item.opacity;
      if (item.fill !== 'transparent') {
        ctx.fillStyle = item.fill;
        ctx.fill(path);
      }
      if (item.strokeWidth > 0) {
        ctx.strokeStyle = item.stroke;
        ctx.lineWidth = item.strokeWidth;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.stroke(path);
      }
      ctx.restore();
    }
  }
  return {
    canvas,
    width,
    height,
    repeats: [repeatN, repeatM],
    primitive: [cellW, cellH]
  };
}

export function downloadTile(project: Project, scale = 2) {
  const tile = exportPeriodicTile(project, scale);
  tile.canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.name.replace(/[^\p{L}\p{N}._-]+/gu, '-')}-${project.group}-tile.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, 'image/png');
}
