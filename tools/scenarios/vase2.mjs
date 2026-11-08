import { tidyRoom } from '../shots/common.mjs';
import { seat } from './lib.mjs';
export default async function (sim) {
  await seat(sim);
  await sim.enterXR();
  await seat(sim);
  await sim.wait(3000);
  console.log('removed', await tidyRoom({ dev: sim.dev }));
  await sim.wait(3000);
  await sim.shot('table');
}
