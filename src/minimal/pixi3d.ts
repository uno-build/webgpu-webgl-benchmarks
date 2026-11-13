// Smallest lit PBR cube on WebGPU, for shipped bundle measurements.
import { Application } from 'pixi.js';
import { CubeGeometry, DirectionalLight, Material3D, Mesh3D, View3D } from '@pixi/3d';

const app = new Application();
await app.init({ canvas: document.querySelector('canvas')!, preference: 'webgpu', antialias: true });
const view = new View3D({ autoResize: true, toneMapping: 'aces' });
app.stage.addChild(view);
view.camera.position.set(0, 1.2, 3);
view.camera.lookAt({ x: 0, y: 0, z: 0 });
const sun = new DirectionalLight();
sun.lookAt({ x: -0.4, y: -1, z: -0.3 });
view.root.addChild(sun);
const cube = new Mesh3D({ geometry: new CubeGeometry(), material: new Material3D({ baseColor: 0xe79559, roughness: 0.5 }) });
view.root.addChild(cube);
app.ticker.add((ticker) => { cube.rotation.y += ticker.deltaMS / 1000 * Math.PI / 6; });
