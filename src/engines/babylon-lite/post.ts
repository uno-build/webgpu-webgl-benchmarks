import {
  AcesToneMapping, addRenderDraw, addTask, computeTextureBinding, createBloomPostProcessTask,
  createComputeTextureResource, createRenderBindingSet, createRenderDraw, createRenderDrawTask,
  createRenderShader, createRenderTarget, createRenderTargetTexture, createRenderTask,
  disposeRenderBindingSet, disposeRenderShader, disposeRenderTargetTexture, enableMaterialPlugins,
  getMaterialFamily, prepareRenderShader, type EngineContext, type MaterialPlugin,
  type PbrMaterialProps, type SceneContext,
} from '@babylonjs/lite';
import type { FieldScene } from '../../harness/types';
import { WIDTH, HEIGHT } from '../../harness/scenes';

// Keep the PBR output in linear HDR. The public plugin hooks save it before the
// material's display transform and restore it immediately before the fragment output.
const linearOutput: MaterialPlugin = {
  name: 'benchmark-linear-HDR-output',
  getCustomCode(stage) {
    return stage === 'fragment' ? {
      CUSTOM_FRAGMENT_MAIN_BEGIN: 'var benchmarkLinearColor=vec3f(0);',
      CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION: 'benchmarkLinearColor=color;',
      CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: 'color=benchmarkLinearColor;',
    } : null;
  },
};

export async function addPost(engine: EngineContext, scene: SceneContext, d: FieldScene) {
  scene.imageProcessing.toneMappingEnabled = false;
  scene.clearColor = { r: d.clearColor[0], g: d.clearColor[1], b: d.clearColor[2], a: 1 };
  for (const mesh of scene.meshes) {
    if (getMaterialFamily(mesh.material) !== 'pbr') continue;
    const material = mesh.material as PbrMaterialProps;
    material.plugins = [linearOutput];
  }
  enableMaterialPlugins(scene);
  const source = createRenderTargetTexture(engine, { lbl: 'resolved HDR scene', format: 'rgba16float', samples: 1, size: { width: WIDTH, height: HEIGHT } });
  const msaa = createRenderTarget({ lbl: 'HDR scene MSAA', format: 'rgba16float', dFormat: 'depth24plus-stencil8', samples: engine.msaaSamples, size: engine });
  addTask(scene, createRenderTask({ name: 'HDR scene', rt: msaa, rst: source.rt, clr: true, clrColor: scene.clearColor }, engine, scene));
  const output = createRenderTargetTexture(engine, { lbl: 'HDR bloom composite', format: 'rgba16float', samples: 1, size: { width: WIDTH, height: HEIGHT } });
  const { bloom } = d.post!;
  addTask(scene, createBloomPostProcessTask({ name: 'bloom', sourceTexture: source.rt, targetTexture: output.rt,
    threshold: bloom.threshold, weight: bloom.strength, kernel: 128 * bloom.radius, bloomScale: 0.5, exposure: 1 }, engine, scene));
  const shader = createRenderShader(engine, { name: 'ACES display transform',
    vertexEntryPoint: 'vs', fragmentEntryPoint: 'fs',
    bindings: [computeTextureBinding('hdr', { group: 0, binding: 0 })],
    renderSource: /* wgsl */ `
      @group(0) @binding(0) var hdr:texture_2d<f32>;
      ${AcesToneMapping.helpersWGSL}
      @vertex fn vs(@builtin(vertex_index)i:u32)->@builtin(position)vec4f {
        let vertices=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));
        return vec4f(vertices[i],0,1);
      }
      @fragment fn fs(@builtin(position)p:vec4f)->@location(0)vec4f {
        var color=textureLoad(hdr,vec2i(p.xy),0).rgb;
        ${AcesToneMapping.callWGSL.replaceAll('scene.vImageInfos.x', '1.0')}
        return vec4f(clamp(pow(max(color,vec3f(0)),vec3f(1.0/2.2)),vec3f(0),vec3f(1)),1);
      }`,
  });
  const texture = await createComputeTextureResource(engine, output.texture);
  const bindings = createRenderBindingSet(shader, { hdr: texture });
  const display = createRenderDrawTask(engine, { name: 'ACES + display encoding', target: engine.scRT });
  addRenderDraw(display, createRenderDraw(shader, bindings, { vertexCount: 3 }));
  await prepareRenderShader(shader, engine.scRT);
  addTask(scene, display);
  return () => {
    disposeRenderBindingSet(bindings); disposeRenderShader(shader);
    disposeRenderTargetTexture(source); disposeRenderTargetTexture(output);
  };
}
