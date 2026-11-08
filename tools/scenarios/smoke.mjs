// Smoke test: load, enter XR, check frame rate, screenshot.
export default async function (sim) {
  await sim.wait(1500);
  await sim.shot('00-page');
  await sim.enterXR();
  await sim.wait(3000);
  sim.log('fps', (await sim.fps(3000)).toFixed(1));
  await sim.shot('01-xr');
}
