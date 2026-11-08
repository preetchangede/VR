import {
  BufferAttribute,
  BufferGeometry,
  Group,
  Matrix4,
  Mesh,
  Quaternion,
  Vector3,
} from '@iwsdk/core';
import { params } from '../core/params';
import { createReceiverMaterial } from '../render/receiver';

/** A horizontal surface we can build the forge on. */
export interface Surface {
  /** World-space center of the chosen forge point on the surface. */
  point: Vector3;
  /** Surface height (world y). */
  y: number;
  /** World-space outline of the surface (for the table cap), if known. */
  outline: Vector3[] | null;
  label: string;
  source: 'plane' | 'mesh' | 'hit' | 'palm' | 'virtual';
}

interface PlaneRec {
  label: string;
  orientation: string;
  mesh: Mesh;
  center: Vector3;
  normal: Vector3;
  outline: Vector3[];
  lastChanged: number;
}

interface MeshRec {
  label: string;
  mesh: Mesh;
  lastChanged: number;
  min: Vector3;
  max: Vector3;
}

const _m = new Matrix4();
const _q = new Quaternion();
const _v = new Vector3();

/**
 * Mirrors WebXR scene understanding (planes + meshes from the user's Space
 * Setup) into receiver geometry, and finds the best table for the forge.
 */
export class Room {
  readonly group = new Group();
  readonly planes = new Map<XRPlane, PlaneRec>();
  readonly meshes = new Map<XRMesh, MeshRec>();
  /** True once a room mesh (Quest 3 global mesh) is available. */
  hasGlobalMesh = false;
  private readonly surfaceMat = createReceiverMaterial('surface');

  constructor() {
    this.group.name = 'room-receivers';
  }

  update(frame: XRFrame | null, refSpace: XRReferenceSpace | null, origin: Matrix4) {
    if (!frame || !refSpace) return;
    const f = frame as XRFrame & { detectedPlanes?: XRPlaneSet; detectedMeshes?: XRMeshSet };
    if (!params.noPlanes && f.detectedPlanes) this.syncPlanes(frame, f.detectedPlanes, refSpace, origin);
    if (!params.noMesh && f.detectedMeshes) this.syncMeshes(frame, f.detectedMeshes, refSpace, origin);
    // Planes are only drawn as receivers when there is no room mesh, except
    // table-like planes, which the forge's table cap handles separately.
    for (const rec of this.planes.values()) {
      rec.mesh.visible = !this.hasGlobalMesh && rec.label !== 'table' && rec.label !== 'desk';
    }
  }

  private syncPlanes(frame: XRFrame, set: XRPlaneSet, refSpace: XRReferenceSpace, origin: Matrix4) {
    for (const [plane, rec] of this.planes) {
      if (!set.has(plane)) {
        rec.mesh.geometry.dispose();
        this.group.remove(rec.mesh);
        this.planes.delete(plane);
      }
    }
    set.forEach((plane) => {
      const pose = frame.getPose(plane.planeSpace, refSpace);
      if (!pose) return;
      let rec = this.planes.get(plane);
      if (!rec || rec.lastChanged !== plane.lastChangedTime) {
        const geo = rec?.mesh.geometry ?? new BufferGeometry();
        const poly = plane.polygon;
        const n = poly.length;
        const pos = new Float32Array(n * 3);
        const nor = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) {
          pos[i * 3] = poly[i].x;
          pos[i * 3 + 1] = poly[i].y;
          pos[i * 3 + 2] = poly[i].z;
          nor[i * 3 + 1] = 1;
        }
        const idx: number[] = [];
        for (let i = 1; i < n - 1; i++) idx.push(0, i, i + 1, 0, i + 1, i);
        geo.setAttribute('position', new BufferAttribute(pos, 3));
        geo.setAttribute('normal', new BufferAttribute(nor, 3));
        geo.setIndex(idx);
        geo.computeBoundingSphere();
        if (!rec) {
          const mesh = new Mesh(geo, this.surfaceMat);
          mesh.renderOrder = -100;
          mesh.matrixAutoUpdate = false;
          this.group.add(mesh);
          rec = {
            label: (plane as XRPlane & { semanticLabel?: string }).semanticLabel || 'other',
            orientation: plane.orientation,
            mesh,
            center: new Vector3(),
            normal: new Vector3(),
            outline: [],
            lastChanged: plane.lastChangedTime,
          };
          this.planes.set(plane, rec);
        }
        rec.lastChanged = plane.lastChangedTime;
        rec.outline = poly.map((p) => new Vector3(p.x, p.y, p.z));
        (rec as PlaneRec & { localOutline?: Vector3[] }).localOutline = rec.outline.map((p) => p.clone());
      }
      _m.fromArray(pose.transform.matrix).premultiply(origin);
      rec.mesh.matrix.copy(_m);
      rec.mesh.matrixWorldNeedsUpdate = true;
      rec.center.setFromMatrixPosition(_m);
      _q.setFromRotationMatrix(_m);
      rec.normal.set(0, 1, 0).applyQuaternion(_q);
      const local = (rec as PlaneRec & { localOutline?: Vector3[] }).localOutline!;
      rec.outline = local.map((p) => p.clone().applyMatrix4(_m));
    });
  }

  private syncMeshes(frame: XRFrame, set: XRMeshSet, refSpace: XRReferenceSpace, origin: Matrix4) {
    for (const [xrMesh, rec] of this.meshes) {
      if (!set.has(xrMesh)) {
        rec.mesh.geometry.dispose();
        this.group.remove(rec.mesh);
        this.meshes.delete(xrMesh);
      }
    }
    let global = false;
    set.forEach((xrMesh) => {
      const pose = frame.getPose(xrMesh.meshSpace, refSpace);
      if (!pose) return;
      const label = (xrMesh as XRMesh & { semanticLabel?: string }).semanticLabel || 'other';
      let rec = this.meshes.get(xrMesh);
      if (!rec || rec.lastChanged !== xrMesh.lastChangedTime) {
        const geo = rec?.mesh.geometry ?? new BufferGeometry();
        geo.setAttribute('position', new BufferAttribute(new Float32Array(xrMesh.vertices), 3));
        geo.setIndex(new BufferAttribute(filterExcluded(xrMesh.vertices, new Uint32Array(xrMesh.indices), pose.transform.matrix), 1));
        geo.computeVertexNormals();
        geo.computeBoundingBox();
        geo.computeBoundingSphere();
        if (!rec) {
          const mesh = new Mesh(geo, this.surfaceMat);
          mesh.renderOrder = -100;
          mesh.matrixAutoUpdate = false;
          this.group.add(mesh);
          rec = { label, mesh, lastChanged: xrMesh.lastChangedTime, min: new Vector3(), max: new Vector3() };
          this.meshes.set(xrMesh, rec);
        }
        rec.lastChanged = xrMesh.lastChangedTime;
      }
      _m.fromArray(pose.transform.matrix).premultiply(origin);
      rec.mesh.matrix.copy(_m);
      rec.mesh.matrixWorldNeedsUpdate = true;
      const bb = rec.mesh.geometry.boundingBox!;
      rec.min.copy(bb.min).applyMatrix4(_m);
      rec.max.copy(bb.max).applyMatrix4(_m);
      if (label === 'global mesh') global = true;
    });
    this.hasGlobalMesh = global;
    // Furniture volumes duplicate the global mesh; draw only the global mesh
    // when present, otherwise the volumes give partial coverage.
    for (const rec of this.meshes.values()) {
      rec.mesh.visible = global ? rec.label === 'global mesh' : true;
    }
  }

  /**
   * Choose the best surface for a seated player at `head` looking along
   * `forward`. Prefers labeled tables at seated height that are in front of
   * the player and within reach.
   */
  findTable(head: Vector3, forward: Vector3): Surface | null {
    let best: Surface | null = null;
    let bestScore = -Infinity;
    const fwd = _v.set(forward.x, 0, forward.z).normalize();
    for (const rec of this.planes.values()) {
      if (rec.orientation !== 'horizontal' && Math.abs(rec.normal.y) < 0.9) continue;
      const y = rec.center.y;
      const below = head.y - y;
      if (y < 0.25 || below < 0.18 || below > 1.25) continue;
      const isTable = rec.label === 'table' || rec.label === 'desk';
      if (!isTable && rec.label !== 'other') continue;
      const point = closestReachPoint(rec.outline, head, fwd, y);
      if (!point) continue;
      const dx = point.x - head.x;
      const dz = point.z - head.z;
      const horiz = Math.hypot(dx, dz);
      const facing = (dx * fwd.x + dz * fwd.z) / Math.max(horiz, 1e-3);
      let score = 0;
      score += isTable ? 3 : 0;
      score -= Math.abs(horiz - 0.42) * 6;
      score -= Math.abs(below - 0.45) * 2;
      score += facing * 2;
      if (score > bestScore) {
        bestScore = score;
        best = { point, y, outline: rec.outline.map((p) => p.clone()), label: rec.label, source: 'plane' };
      }
    }
    if (!best) {
      // No plane: try table-like mesh volumes.
      for (const rec of this.meshes.values()) {
        if (rec.label !== 'table' && rec.label !== 'desk') continue;
        const y = rec.max.y;
        const below = head.y - y;
        if (below < 0.18 || below > 1.25) continue;
        const outline = [
          new Vector3(rec.min.x, y, rec.min.z),
          new Vector3(rec.max.x, y, rec.min.z),
          new Vector3(rec.max.x, y, rec.max.z),
          new Vector3(rec.min.x, y, rec.max.z),
        ];
        const point = closestReachPoint(outline, head, fwd, y);
        if (!point) continue;
        const score = -point.distanceTo(head);
        if (score > bestScore) {
          bestScore = score;
          best = { point, y, outline, label: rec.label, source: 'mesh' };
        }
      }
    }
    return best;
  }
}

/**
 * Film-set dressing hook: triangles inside `window.__sunsmithExclude` boxes
 * (world space) are dropped from the room mesh. Unused in normal play.
 */
function filterExcluded(verts: Float32Array, idx: Uint32Array, matrix: Float32Array): Uint32Array {
  const boxes = (globalThis as { __sunsmithExclude?: { min: number[]; max: number[] }[] }).__sunsmithExclude;
  if (!boxes?.length) return idx;
  const m = matrix;
  const inside = (i: number) => {
    const x = verts[i * 3], y = verts[i * 3 + 1], z = verts[i * 3 + 2];
    const wx = m[0] * x + m[4] * y + m[8] * z + m[12];
    const wy = m[1] * x + m[5] * y + m[9] * z + m[13];
    const wz = m[2] * x + m[6] * y + m[10] * z + m[14];
    return boxes.some((b) => wx > b.min[0] && wx < b.max[0] && wy > b.min[1] && wy < b.max[1] && wz > b.min[2] && wz < b.max[2]);
  };
  const keep: number[] = [];
  for (let t = 0; t < idx.length; t += 3) {
    if (inside(idx[t]) && inside(idx[t + 1]) && inside(idx[t + 2])) continue;
    keep.push(idx[t], idx[t + 1], idx[t + 2]);
  }
  return new Uint32Array(keep);
}

/**
 * The point on a table where the forge should sit: straight ahead of the
 * player, ~42 cm away horizontally, pulled inside the table outline so the
 * well never hangs over an edge.
 */
function closestReachPoint(outline: Vector3[], head: Vector3, fwd: Vector3, y: number): Vector3 | null {
  if (outline.length < 3) return null;
  const ideal = new Vector3(head.x + fwd.x * 0.42, y, head.z + fwd.z * 0.42);
  const c = new Vector3();
  for (const p of outline) c.add(p);
  c.divideScalar(outline.length);
  c.y = y;
  // Walk from the ideal point toward the centroid until we are inset by 16 cm.
  const p = ideal.clone();
  for (let i = 0; i <= 20; i++) {
    if (insetDistance(outline, p) >= 0.16) return p;
    p.lerpVectors(ideal, c, i / 20);
  }
  return insetDistance(outline, c) > 0.04 ? c : null;
}

/** Signed distance from p to the polygon edge (positive inside), in xz. */
function insetDistance(poly: Vector3[], p: Vector3) {
  let inside = false;
  let minD = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
    const ex = b.x - a.x;
    const ez = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.z - a.z) * ez) / (ex * ex + ez * ez || 1)));
    const d = Math.hypot(p.x - (a.x + ex * t), p.z - (a.z + ez * t));
    minD = Math.min(minD, d);
  }
  return inside ? minD : -minD;
}
