export default async function (sim) {
  await sim.wait(2000);
  await sim.enterXR();
  await sim.wait(3000);
  const r = await sim.dev((d) => {
    const scene = d.sem.scene;
    const out = [];
    scene.traverse((o) => {
      if (!o.isMesh) return;
      const g = o.geometry;
      g.computeBoundingBox();
      const bb = g.boundingBox.clone().applyMatrix4(o.matrixWorld);
      const c = bb.getCenter(new bb.min.constructor());
      const s = bb.getSize(new bb.min.constructor());
      if (Math.abs(c.x + 0.95) < 0.8 && Math.abs(c.z - 1.35) < 0.8) out.push(`${o.name || '-'} | ${o.material?.name || o.material?.type} | c=${c.toArray().map((v) => v.toFixed(2))} s=${s.toArray().map((v) => v.toFixed(2))} vis=${o.visible} verts=${g.attributes.position.count}`);
    });
    return out;
  });
  console.log(r.join('\n'));
}
