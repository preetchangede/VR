// TEMPORARY stand-in for src/render/planet.ts (being built in parallel). Same API.
import { Color, Group, Mesh, MeshBasicMaterial, SphereGeometry, Vector3 } from '@iwsdk/core';
export type PlanetKind = 'rocky' | 'gas' | 'moon';
export interface PlanetLook {
  kind: PlanetKind; seed: number; radius: number; molten: number; ocean: number; ice: number; clouds: number; life: number;
  atmosphere: Color; bands: Color[]; rings: number; dustTint: Color;
}
export class PlanetVisual {
  readonly group = new Group();
  private readonly mesh: Mesh;
  private look: PlanetLook;
  constructor(look: PlanetLook) {
    this.look = { ...look };
    this.mesh = new Mesh(new SphereGeometry(1, 32, 24), new MeshBasicMaterial({ color: 0xff7733 }));
    this.group.add(this.mesh);
  }
  setLook(l: Partial<PlanetLook>) { Object.assign(this.look, l); }
  update(_dt: number, _t: number, _s: Vector3, _c: Color, _i: number, _cam: Vector3) {
    this.mesh.scale.setScalar(this.look.radius);
    const m = this.mesh.material as MeshBasicMaterial;
    m.color.setRGB(1, 0.45, 0.2).lerp(new Color(0.2, 0.45, 0.9), 1 - this.look.molten);
  }
  setHighlight(_v: number) {}
  dispose() {}
}
