// List the synthetic environment's tracked planes and meshes.
export default async function (sim) {
  const env = process.env.ENV || 'sunlit_living_room';
  await sim.dev(async (d, e) => { await d.sem.loadDefaultEnvironment(e); }, env);
  await sim.wait(1500);
  const info = await sim.dev((d) => {
    const out = { envs: d.sem.environments, planes: [], meshes: [] };
    for (const p of d.sem.trackedPlanes) {
      const o = {};
      for (const k of Object.keys(p)) { const v = p[k]; if (typeof v !== 'object' || v === null) o[k] = v; }
      o.label = p.semanticLabel; o.orientation = p.orientation;
      const m = p.transform?.matrix || p.matrix;
      if (m) o.pos = [m[12], m[13], m[14]].map((x) => +x.toFixed(2));
      if (p.polygon) { const xs = p.polygon.map((q) => q.x), zs = p.polygon.map((q) => q.z);
        o.size = [Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)].map((x) => +x.toFixed(2)); }
      out.planes.push(o);
    }
    for (const m of d.sem.trackedMeshes) out.meshes.push({ label: m.semanticLabel, verts: m.vertices?.length / 3 });
    return out;
  });
  console.log(JSON.stringify(info, null, 1).slice(0, 6000));
}
