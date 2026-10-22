import {
  addToScene, attachVat, bakeVatMany, cloneTransformNode, createTransformNode, disposeMeshGpu,
  acquireTexture, getContainerMeshes, getMaterialTextures, goToFrame, loadGltf, releaseTexture, setThinInstances, setVatTime,
  type AnimationGroup, type AssetContainer, type EngineContext, type Mesh, type SceneContext,
} from '@babylonjs/lite';
import type { CharactersScene, Variant } from '../../harness/types';
import { normalizeGltf } from './common';

/** Keep geometry/skin/animation chunks intact but avoid decoding/uploading a texture per character.
 * The independent loads supply animation controllers and skeletons; rendering uses template clones. */
export function withoutMaterials(glb: ArrayBuffer): ArrayBuffer {
  const view = new DataView(glb);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2) throw new Error('Expected a glTF 2.0 GLB character');
  const jsonBytes = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(glb, 20, jsonBytes)));
  json.materials = (json.materials ?? []).map(() => ({ pbrMetallicRoughness: {} }));
  delete json.images; delete json.textures; delete json.samplers;
  const encoded = new TextEncoder().encode(JSON.stringify(json));
  const padded = (encoded.length + 3) & ~3;
  const tail = new Uint8Array(glb, 20 + jsonBytes);
  const result = new ArrayBuffer(20 + padded + tail.length);
  const out = new DataView(result);
  out.setUint32(0, 0x46546c67, true); out.setUint32(4, 2, true); out.setUint32(8, result.byteLength, true);
  out.setUint32(12, padded, true); out.setUint32(16, 0x4e4f534a, true);
  new Uint8Array(result, 20, padded).fill(32);
  new Uint8Array(result, 20, encoded.length).set(encoded);
  new Uint8Array(result, 20 + padded).set(tail);
  return result;
}

export async function buildCharacters(engine: EngineContext, scene: SceneContext, d: CharactersScene, variant: Variant) {
  const response = await fetch(d.url);
  if (!response.ok) throw new Error(`Character asset HTTP ${response.status}: ${d.url}`);
  const data = await response.arrayBuffer();
  const template = normalizeGltf(await loadGltf(engine, data));
  const group = template.animationGroups?.[d.clip];
  if (!group) throw new Error(`Missing animation clip ${d.clip}`);
  return variant === 'optimized' ? baked(engine, scene, d, template) : skinned(engine, scene, d, template, withoutMaterials(data));
}

async function skinned(engine: EngineContext, scene: SceneContext, d: CharactersScene, template: AssetContainer, data: ArrayBuffer) {
  const prototypes = getContainerMeshes(template);
  const groups: AnimationGroup[] = [];
  try {
    for (let i = 0; i < d.count; i++) {
      const instance = await loadGltf(engine, data);
      const loadedMeshes = getContainerMeshes(instance);
      // cloneTransformNode shares geometry. Suppress skeleton cloning so the new meshes
      // can take ownership of their own independently loaded skeletons, with no leaked retain.
      const templateSkeletons = prototypes.map((m) => m.skeleton);
      prototypes.forEach((m) => { m.skeleton = null; });
      let clone: AssetContainer;
      try {
        clone = { entities: template.entities.map((node) => cloneTransformNode(node as Mesh)) };
      } finally {
        prototypes.forEach((m, k) => { m.skeleton = templateSkeletons[k]; });
      }
      const meshes = getContainerMeshes(clone);
      if (meshes.length !== loadedMeshes.length) throw new Error('Character primitive count changed during skeleton load');
      for (let k = 0; k < meshes.length; k++) {
        meshes[k].skeleton = loadedMeshes[k].skeleton;
        loadedMeshes[k].skeleton = null; // ownership transferred, not shared
        disposeMeshGpu(loadedMeshes[k]);
      }
      // These texture-free loader materials never enter a scene, so retire their
      // default textures explicitly instead of waiting for the device to be destroyed.
      const unused = new Set(loadedMeshes.flatMap((mesh) => [...getMaterialTextures(mesh.material)]));
      unused.forEach((texture) => { acquireTexture(texture); releaseTexture(texture); });
      const root = createTransformNode(`character ${i}`, d.position[i * 3], d.position[i * 3 + 1], -d.position[i * 3 + 2],
        0, -Math.sin(d.yaw[i] / 2), 0, Math.cos(d.yaw[i] / 2), d.scale, d.scale, d.scale);
      for (const node of clone.entities) {
        node.parent = root;
        root.children.push(node);
      }
      addToScene(scene, root);
      groups.push(instance.animationGroups![d.clip]);
    }
  } finally {
    prototypes.forEach(disposeMeshGpu);
  }
  return {
    path: 'Shared geometry/material clones + independent native skeleton controllers (goToFrame)',
    notes: ['Independent controllers loaded from texture-free GLB; temporary geometry is released before rendering'],
    update(t: number) {
      for (let i = 0; i < groups.length; i++) {
        const group = groups[i];
        goToFrame(group, ((t + d.phase[i]) % group.duration) * (group.frameRate ?? 60), engine);
      }
    },
  };
}

function baked(engine: EngineContext, scene: SceneContext, d: CharactersScene, container: AssetContainer) {
  const group = container.animationGroups![d.clip];
  const meshes = getContainerMeshes(container).filter((m) => !!m.skeleton);
  const baked = bakeVatMany(engine, meshes.map((mesh) => ({ mesh })), [group]);
  const matrices = new Float32Array(d.count * 16), settings = new Float32Array(d.count * 4);
  const placement = createTransformNode('placement scratch');
  for (let i = 0; i < d.count; i++) {
    placement.position.set(d.position[i * 3], d.position[i * 3 + 1], -d.position[i * 3 + 2]);
    placement.rotationQuaternion.set(0, -Math.sin(d.yaw[i] / 2), 0, Math.cos(d.yaw[i] / 2));
    placement.scaling.set(d.scale, d.scale, d.scale);
    matrices.set(placement.worldMatrix, i * 16);
  }
  meshes.forEach((mesh, k) => {
    const handle = attachVat(engine, mesh, baked[k], group.name);
    const clip = handle.clips[group.name];
    // The baker includes the duplicated end pose. Exclude it from looping, as the
    // reference adapter does, and preserve each character's authored phase in frames.
    const frames = Math.max(1, clip.frameCount - 1), fps = frames / group.duration;
    for (let i = 0; i < d.count; i++) settings.set([clip.fromRow, clip.fromRow + frames - 1, (d.phase[i] % group.duration) * fps, fps], i * 4);
    setThinInstances(mesh, matrices, d.count);
    handle.setInstances(settings);
  });
  // Register only entities: no automatic animation clock can advance the shared phase.
  container.entities.forEach((node) => addToScene(scene, node));
  return {
    path: 'Native baked animation textures + thin instances with per-character phase',
    update(t: number) { meshes.forEach((mesh) => setVatTime(engine, mesh, t)); },
  };
}
