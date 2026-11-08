// Survey a SEM room: list table planes, then screenshot from above the first table.
export default async function (sim) {
  const env = process.env.ENV;
  await sim.dev(async (d, e) => { d.controlMode = 'programmatic'; await d.sem.loadDefaultEnvironment(e); }, env);
  await sim.wait(1500);
  const tables = await sim.dev((d) => {
    const out = [];
    for (const p of d.sem.trackedPlanes) {
      if (p.semanticLabel !== 'table' && p.semanticLabel !== 'desk') continue;
      const m = p.transform?.matrix || p.matrix;
      const xs = p.polygon.map((q) => q.x), zs = p.polygon.map((q) => q.z);
      out.push({ label: p.semanticLabel, pos: [m[12], m[13], m[14]].map((v) => +v.toFixed(2)), size: [Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)].map((v) => +v.toFixed(2)) });
    }
    return out;
  });
  console.log(env, JSON.stringify(tables));
  await sim.enterXR();
  let k = 0;
  for (const t of tables) {
    const [x, y, z] = t.pos;
    await sim.dev((d, a) => {
      if (d.devui) { d.devui.devUIContainer.style.display = 'none'; d.devui.devUICanvas.style.display = 'none'; }
      d.position.set(a.x + 0.7, a.y + 0.65, a.z + 0.25);
      const yaw = Math.atan2(0.7, 0.25), pitch = -0.6;
      const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
      d.quaternion.set(cy * sp, sy * cp, -sy * sp, cy * cp);
    }, { x, y, z });
    await sim.wait(2500);
    await sim.shot(`${env}-${k++}`);
  }
}
