import { seat, hands } from './lib.mjs';
export default async function (sim) {
  await seat(sim);
  await sim.enterXR();
  await seat(sim);
  await sim.wait(6000);
  const info = await sim.eval(() => {
    const g = window.sunsmith;
    const out = [];
    g.scene.traverse((o) => { if (o.isMesh || o.isPoints || o.isLine || o.isInstancedMesh) { const p = o.getWorldPosition(new o.position.constructor()); out.push(`${o.type} ${o.name || o.parent?.name || ''} vis=${o.visible} ro=${o.renderOrder} pos=${p.toArray().map((v) => v.toFixed(2))} mat=${o.material?.type}`); } });
    const va = g.world.input?.xr?.visualAdapters;
    return { n: out.length, out: out.slice(0, 60), hand: va ? { l: !!va.hand.left.visual, r: !!va.hand.right.visual } : null, info: g.renderer.info.render };
  });
  console.log(JSON.stringify(info, null, 1));
  await sim.shot('a-all');
  await sim.eval(() => { const g = window.sunsmith; g.scene.traverse((o) => { if ((o.isMesh || o.isPoints) && o.parent === g.scene && o !== g.dimmer.mesh) o.userData.v = o.visible; }); g.room.group.visible = false; g.handReceivers.mesh.visible = false; });
  await sim.wait(2500);
  await sim.shot('b-noroom-nohands');
}
