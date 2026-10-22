import {
  AcesToneMapping, VERSION, addToScene, createDirectionalLight, createEngine, createFreeCamera,
  createHemisphericLight, createSceneContext, createTransformNode, disposeEngine, disposeScene,
  enableMirroredMeshes, loadGltf, registerScene, registerSceneWithShadowSupport, renderFrame, setEngineSize, setThinInstances,
  setMaxLights, type DirectionalLight, type EngineContext, type FreeCamera, type SceneContext,
} from '@babylonjs/lite';
import type { EngineAdapter, InitOptions, LoadReport, SceneData, Variant } from '../../harness/types';
import { srgb3 } from '../common';
import { applyCamera, normalizeGltf, toMaterial, toMesh } from './common';
import { buildField } from './field';
import { buildCharacters } from './characters';
import { buildParticles } from './particles';
import { addPost } from './post';

export function createAdapter(): EngineAdapter { return new BabylonLiteAdapter(); }

class BabylonLiteAdapter implements EngineAdapter {
  readonly name = 'babylon-lite';
  readonly version = VERSION;
  private engine?: EngineContext;
  private scene?: SceneContext;
  private camera!: FreeCamera;
  private update: (t: number, dt: number) => void = () => {};
  private cleanup: (() => void)[] = [];

  async init(canvas: HTMLCanvasElement, opts: InitOptions) {
    if (opts.backend !== 'webgpu') throw new Error('N/A: Babylon Lite only supports WebGPU');
    setMaxLights(16);
    this.engine = await createEngine(canvas, { msaaSamples: opts.msaa, alphaMode: 'opaque', maxDevicePixelRatio: 1 });
    setEngineSize(this.engine, opts.width, opts.height);
    this.camera = createFreeCamera({ x: 0, y: 0, z: -1 }, { x: 0, y: 0, z: 0 });
    return { backend: 'webgpu' as const, msaa: this.engine.msaaSamples };
  }

  async load(d: SceneData, variant: Variant, opt?: string): Promise<LoadReport> {
    if (opt) throw new Error(`babylon-lite: unknown opt "${opt}"; use the default native path`);
    // Keep Lite's default capacity except when this scene actually needs more
    // forward lights. Shader layouts bake this cap, so set it before scene creation.
    const forwardLights = 1 + (d.sun ? 1 : 0) + (d.kind === 'field'
      ? (d.spots?.length ?? 0) + (variant === 'naive' ? d.pointLights?.count ?? 0 : 0) : 0);
    setMaxLights(Math.max(16, forwardLights));
    const engine = this.engine!;
    const scene = this.scene = createSceneContext(engine, {
      defaultRenderTask: !(d.kind === 'particles' || (d.kind === 'field' && d.post)),
    });
    scene.camera = this.camera;
    applyCamera(this.camera, d.camera);
    const [r, g, b] = srgb3(d.clearColor);
    scene.clearColor = { r, g, b, a: 1 };
    scene.imageProcessing = { exposure: 1, contrast: 1, toneMappingEnabled: true, toneMapping: AcesToneMapping };
    const ambient = createHemisphericLight([0, 1, 0], d.ambient.intensity);
    ambient.diffuseColor = [...d.ambient.color];
    ambient.groundColor = [...d.ambient.color];
    ambient.specularColor = [0, 0, 0];
    addToScene(scene, ambient);
    let sun: DirectionalLight | undefined;
    if (d.sun) {
      sun = createDirectionalLight([d.sun.direction[0], d.sun.direction[1], -d.sun.direction[2]], d.sun.intensity * Math.PI);
      sun.diffuse = [...d.sun.color];
      sun.specular = [...d.sun.color];
      addToScene(scene, sun);
    }
    let path: string;
    let notes: string[] = [];
    if (d.kind === 'field') {
      const built = buildField(engine, scene, d, variant, sun);
      this.update = built.update;
      path = built.path;
      notes = built.notes;
      if (d.post) {
        this.cleanup.push(await addPost(engine, scene, d));
        path += ' → linear HDR MSAA → native bloom → ACES';
      }
    } else if (d.kind === 'instances') {
      const root = createTransformNode('right-handed instances', 0, 0, 0, 0, 0, 0, 1, 1, 1, -1);
      const mesh = toMesh(engine, d.geometry);
      mesh.material = toMaterial(d.material);
      mesh.parent = root;
      root.children.push(mesh);
      this.update = () => setThinInstances(mesh, d.matrices, d.count);
      this.update(0, 0);
      addToScene(scene, root);
      path = 'Thin instances, shared matrices uploaded every frame';
    } else if (d.kind === 'characters') {
      const built = await buildCharacters(engine, scene, d, variant);
      this.update = built.update;
      this.update(0, 0);
      path = built.path;
      notes = 'notes' in built ? built.notes! : [];
    } else if (d.kind === 'particles') {
      const built = await buildParticles(engine, scene, this.camera, d);
      this.update = built.update;
      this.cleanup.push(built.dispose);
      path = built.path;
    } else {
      addToScene(scene, normalizeGltf(await loadGltf(engine, d.url)));
      this.update = () => applyCamera(this.camera, d.camera);
      path = 'Native glTF loader → AssetContainer';
    }
    await enableMirroredMeshes(scene);
    if (d.kind === 'field' && d.shadows) await registerSceneWithShadowSupport(scene);
    else await registerScene(scene);
    return { path, notes };
  }

  frame(t: number, dt: number) {
    this.update(t, dt);
    // The harness owns rAF and deterministic time; never start Lite's own render loop.
    renderFrame(this.engine!, dt * 1000);
  }

  counters() { return { drawCalls: this.engine?.drawCallCount ?? 0 }; }

  async dispose() {
    if (this.scene) disposeScene(this.scene);
    for (const cleanup of this.cleanup.splice(0)) cleanup();
    if (this.engine) disposeEngine(this.engine);
    this.scene = undefined;
    this.engine = undefined;
    this.update = () => {};
  }
}
