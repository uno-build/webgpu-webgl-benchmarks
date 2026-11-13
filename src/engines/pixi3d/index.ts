import { AmbientLight, DirectionalLight, View3D } from '@pixi/3d';
import { version } from '@pixi/3d/package.json';
import { Application, Assets, RendererType, VERSION as PIXI_VERSION, type WebGLRenderer } from 'pixi.js';
import type { EngineAdapter, InitOptions, InitReport, SceneData, Variant, Vec3 } from '../../harness/types';
import { srgb3 } from '../common';
import { buildField, buildInstances } from './field';
import { buildGltf } from './characters';
import { checkSupport } from './support';
import { LIGHT_SCALE, type Built, type PixiCtx } from './common';
const point = (v: Vec3) => ({ x: v[0], y: v[1], z: v[2] });

export function createAdapter(): EngineAdapter { return new PixiAdapter(); }

class PixiAdapter implements EngineAdapter {
  readonly name = 'PixiJS 3D';
  readonly version = `${version} (pixi.js ${PIXI_VERSION})`;
  private app?: Application;
  private ctx?: PixiCtx;
  private scene?: SceneData;
  private built?: Built;
  private width = 0;
  private height = 0;

  async init(canvas: HTMLCanvasElement, opts: InitOptions): Promise<InitReport> {
    const app = this.app = new Application();
    this.width = opts.width; this.height = opts.height;
    await app.init({
      canvas, width: opts.width, height: opts.height, resolution: 1,
      preference: opts.backend === 'webgpu' ? 'webgpu' : 'webgl', preferWebGLVersion: 2,
      antialias: opts.msaa === 4, backgroundAlpha: 1,
      autoStart: false, sharedTicker: false,
    });
    app.stage.eventMode = 'none';
    const backend = app.renderer.type === RendererType.WEBGPU ? 'webgpu' : 'webgl2';
    if (backend !== opts.backend) throw new Error(`pixi3d backend fallback: requested ${opts.backend}, got ${backend}`);
    let msaa = opts.msaa;
    if (app.renderer.type === RendererType.WEBGL) {
      const gl = (app.renderer as WebGLRenderer).gl;
      if (!(gl instanceof WebGL2RenderingContext)) throw new Error('pixi3d requires WebGL2; got WebGL1');
      msaa = gl.getParameter(gl.SAMPLES);
    }
    return { backend, msaa, notes: [`@pixi/3d ${version}, pixi.js ${PIXI_VERSION}; application ticker disabled; harness owns rendering`] };
  }

  async load(d: SceneData, variant: Variant, opt?: string) {
    checkSupport(d, variant, opt);
    const app = this.app!;
    const view = new View3D({ width: this.width, height: this.height, toneMapping: 'aces', eventMode: 'none' });
    const ctx = this.ctx = { view, geometries: [], materials: [], assetUrls: [] };
    app.stage.addChild(view);
    app.renderer.background.color = srgb3(d.clearColor);
    this.scene = d;
    view.camera.usePerspective(d.camera.fovY, d.camera.near, d.camera.far);
    view.root.addChild(new AmbientLight({ color: srgb3(d.ambient.color), intensity: d.ambient.intensity * LIGHT_SCALE }));
    if (d.sun) {
      const sun = new DirectionalLight({ color: srgb3(d.sun.color), intensity: d.sun.intensity * LIGHT_SCALE, castShadow: false });
      sun.lookAt(point(d.sun.direction));
      view.root.addChild(sun);
    }
    switch (d.kind) {
      case 'field': this.built = buildField(ctx, d, variant); break;
      case 'instances': this.built = buildInstances(ctx, d); break;
      case 'gltf-scene':
      case 'characters': this.built = await buildGltf(ctx, d); break;
      default: throw new Error('N/A: unsupported PixiJS 3D scene');
    }
    return { path: this.built.path, notes: ['Native PBR, ACES and sRGB output; linear scene colors converted to sRGB API inputs; lights scaled by π for the native Lambert normalization. Native automatic batching is retained on the naive scene-node path.'] };
  }

  frame(t: number, dt: number) {
    const camera = this.ctx!.view.camera;
    camera.position.set(...this.scene!.camera.position);
    camera.lookAt(point(this.scene!.camera.target));
    this.built!.update(t, dt);
    this.app!.render();
  }

  async dispose() {
    this.built = undefined; this.scene = undefined;
    if (this.ctx) {
      this.ctx.view.destroy({ children: true });
      for (const g of this.ctx.geometries) g.destroy();
      for (const m of this.ctx.materials) m.destroy();
      await Promise.all(this.ctx.assetUrls.map((url) => Assets.unload(url)));
      this.ctx = undefined;
    }
    this.app?.destroy(false, { children: true });
    this.app = undefined;
  }
}
