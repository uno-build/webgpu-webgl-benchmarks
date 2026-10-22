import {
  addComputeDispatch, addRenderDraw, addTask, computeStorageBufferBinding, computeUniformBufferBinding,
  createComputeBindingSet, createComputeDispatch, createComputeShader, createComputeTask,
  createCopyToTextureTask, createRenderBindingSet, createRenderDraw, createRenderDrawTask,
  createRenderShader, createRenderTarget, createStorageBuffer, createUniformBuffer,
  disposeComputeBindingSet, disposeComputeShader, disposeRenderBindingSet, disposeRenderShader,
  disposeRenderTarget, disposeStorageBuffer, disposeUniformBuffer, getViewMatrix,
  getViewProjectionMatrix, prepareComputeTask, prepareRenderShader, updateUniformBuffer,
  type EngineContext, type FreeCamera, type SceneContext,
} from '@babylonjs/lite';
import type { ParticlesScene } from '../../harness/types';
import { ASPECT } from '../../harness/scenes';
import { WORKGROUP, SIM } from '../particles-common';

const DRAW = /* wgsl */ `
struct Camera { vp:mat4x4f, right:vec4f, up:vec4f, extra:vec4f }
@group(0) @binding(0) var<uniform> camera:Camera;
@group(0) @binding(1) var<storage,read> pos:array<vec4f>;
@group(0) @binding(2) var<storage,read> vel:array<vec4f>;
struct Out { @builtin(position) position:vec4f, @location(0) color:vec3f }
@vertex fn vs(@builtin(vertex_index) vertex:u32,@builtin(instance_index) i:u32)->Out {
  let corners=array<vec2f,6>(vec2f(-.5,-.5),vec2f(.5,-.5),vec2f(.5,.5),vec2f(-.5,-.5),vec2f(.5,.5),vec2f(-.5,.5));
  let corner=(camera.right.xyz*corners[vertex].x+camera.up.xyz*corners[vertex].y)*camera.extra.x;
  // Sim state stays in the shared RH coordinates; convert only at the render boundary.
  let p=vec3f(pos[i].x,pos[i].y,-pos[i].z);
  let k=clamp(length(vel[i].xyz)/6.0,0.0,1.0);
  return Out(camera.vp*vec4f(p+corner,1),mix(vec3f(.1,.3,1),vec3f(1,.5,.1),k));
}
@fragment fn fs(input:Out)->@location(0) vec4f {
  let c=input.color;
  return vec4f(select(1.055*pow(c,vec3f(1.0/2.4))-.055,c*12.92,c<=vec3f(.0031308)),1);
}`;

export async function buildParticles(engine: EngineContext, scene: SceneContext, camera: FreeCamera, d: ParticlesScene) {
  const pos = createStorageBuffer(engine, d.initPosition, { writable: true, label: 'particle positions' });
  const vel = createStorageBuffer(engine, d.initVelocity, { writable: true, label: 'particle velocities' });
  const values = new Float32Array([0, 0, d.count, d.bounds, d.sim.attractorRadius, d.sim.attractorSpeed, d.sim.strength, d.sim.damping]);
  const params = createUniformBuffer(engine, values);
  const declarations = [computeUniformBufferBinding('params', { group: 0, binding: 0 }),
    computeStorageBufferBinding('pos', { group: 0, binding: 1, access: 'read-write' }),
    computeStorageBufferBinding('vel', { group: 0, binding: 2, access: 'read-write' })];
  const sim = createComputeShader(engine, { name: 'reference particle integration', computeSource: SIM, bindings: declarations });
  const simBindings = createComputeBindingSet(sim, { params, pos, vel });
  const compute = createComputeTask(engine, 'particle simulation');
  addComputeDispatch(compute, createComputeDispatch(sim, simBindings, { size: { x: Math.ceil(d.count / WORKGROUP) } }));
  await prepareComputeTask(compute);
  addTask(scene, compute);

  const view = getViewMatrix(camera);
  const cameraValues = new Float32Array(28);
  cameraValues.set(getViewProjectionMatrix(camera, ASPECT));
  cameraValues.set([view[0], view[4], view[8], 0], 16);
  cameraValues.set([view[1], view[5], view[9], 0], 20);
  cameraValues[24] = d.size;
  const cameraBuffer = createUniformBuffer(engine, cameraValues);
  const shader = createRenderShader(engine, { name: 'instanced particle billboards', renderSource: DRAW,
    vertexEntryPoint: 'vs', fragmentEntryPoint: 'fs',
    bindings: [computeUniformBufferBinding('camera', { group: 0, binding: 0 }),
      computeStorageBufferBinding('pos', { group: 0, binding: 1 }),
      computeStorageBufferBinding('vel', { group: 0, binding: 2 })],
    primitive: { topology: 'triangle-list', cullMode: 'none' }, depth: { depthWriteEnabled: true } });
  const bindings = createRenderBindingSet(shader, { camera: cameraBuffer, pos, vel });
  const target = createRenderTarget({ lbl: 'particle MSAA target', format: engine.format,
    dFormat: 'depth24plus-stencil8', samples: engine.msaaSamples, size: engine });
  const draw = createRenderDrawTask(engine, { name: 'particle billboards', target, clear: true, clearColor: scene.clearColor });
  addRenderDraw(draw, createRenderDraw(shader, bindings, { vertexCount: 6, instanceCount: d.count }));
  await prepareRenderShader(shader, target);
  addTask(scene, draw);
  addTask(scene, createCopyToTextureTask({ name: 'particle MSAA resolve', sourceTexture: target, resolveTexture: engine.scRT }, engine, scene));
  return {
    path: 'Native compute task + storage buffers + instanced billboards, hardware MSAA resolve',
    update(t: number, dt: number) {
      values[0] = t;
      values[1] = dt;
      updateUniformBuffer(engine, params, values);
    },
    dispose() {
      disposeComputeBindingSet(simBindings); disposeComputeShader(sim);
      disposeRenderBindingSet(bindings); disposeRenderShader(shader);
      disposeStorageBuffer(pos); disposeStorageBuffer(vel);
      disposeUniformBuffer(params); disposeUniformBuffer(cameraBuffer); disposeRenderTarget(target);
    },
  };
}
