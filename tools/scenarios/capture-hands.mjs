import { writeFileSync } from 'node:fs';
export default async function (sim) {
  await sim.wait(1000);
  const data = await sim.eval(() => window.capture(['open', 'flat', 'cup', 'claw', 'fist', 'pinch', 'default', 'point']));
  writeFileSync('/home/user/VR/tools/scenarios/hand-poses.json', JSON.stringify(data));
  console.log(Object.keys(data), data.open.slice(0, 3), data.fist[9]);
}
