import { tidyRoom } from '../shots/common.mjs';
export default async function (sim) {
  await sim.enterXR();
  await sim.wait(4000);
  const film = { dev: sim.dev };
  console.log('removed', await tidyRoom(film));
  const info = await sim.dev((d) => {
    const out = [];
    const keys = Object.keys(d.sem).filter((k) => typeof d.sem[k] === 'object');
    d.sem.scene.traverse((o) => { if (o.isMesh && o.geometry.attributes.position.count === 3528) out.push({ idx: !!o.geometry.index, n: o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count, groups: o.geometry.groups.length, type: o.type, mat: Array.isArray(o.material) }); });
    return { keys, out };
  });
  console.log(JSON.stringify(info));
}
