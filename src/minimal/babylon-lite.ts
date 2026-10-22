// Smallest native Lite lit PBR cube, for the independent shipped-bundle measurement.
import {
  AcesToneMapping, addToScene, createBox, createDirectionalLight, createEngine, createFreeCamera,
  createHemisphericLight, createPbrMaterial, createSceneContext, registerScene, renderFrame,
} from '@babylonjs/lite';

const engine = await createEngine(document.querySelector('canvas')!, { msaaSamples: 4 });
const scene = createSceneContext(engine);
scene.camera = createFreeCamera({ x: 0, y: 1.2, z: -3 }, { x: 0, y: 0, z: 0 });
scene.imageProcessing = { exposure: 1, contrast: 1, toneMappingEnabled: true, toneMapping: AcesToneMapping };
addToScene(scene, createHemisphericLight([0, 1, 0], 0.5));
addToScene(scene, createDirectionalLight([-0.5, -1, 0.5], 3));
const cube = createBox(engine, { size: 1 });
cube.material = createPbrMaterial({ baseColorFactor: [0.8, 0.3, 0.1, 1], roughnessFactor: 0.4, metallicFactor: 0 });
addToScene(scene, cube);
await registerScene(scene);
let previous = performance.now(), angle = 0;
function frame(now: number) {
  const dt = now - previous;
  previous = now;
  angle += dt / 1000;
  cube.rotationQuaternion.set(0, Math.sin(angle / 2), 0, Math.cos(angle / 2));
  renderFrame(engine, dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
