import { createMeshFromData, createPbrMaterial, type AssetContainer, type EngineContext, type FreeCamera } from '@babylonjs/lite';
import type { CameraSpec, Geometry, PbrSpec } from '../../harness/types';
import { deg } from '../common';

// Lite uses a left-handed world. Procedural meshes live below a Z-reflected root,
// so the shared instance matrices can be uploaded verbatim, without an O(N) conversion.
// Normalize glTF's native X reflection to the same Z reflection used by the camera.
export function normalizeGltf(container: AssetContainer): AssetContainer {
  for (const root of container.entities) {
    if (root.name !== '__root__' || root.scaling.x !== -1 || root.scaling.y !== 1 || root.scaling.z !== 1) {
      throw new Error('Unexpected Lite glTF coordinate conversion');
    }
    root.scaling.set(1, 1, -1);
  }
  return container;
}

export function applyCamera(camera: FreeCamera, spec: CameraSpec) {
  camera.position.set(spec.position[0], spec.position[1], -spec.position[2]);
  camera.target.set(spec.target[0], spec.target[1], -spec.target[2]);
  camera.fov = deg(spec.fovY);
  camera.nearPlane = spec.near;
  camera.farPlane = spec.far;
}

export function toMesh(engine: EngineContext, g: Geometry) {
  // Like Babylon.js, Lite's native builders use clockwise front faces.
  const indices = new Uint32Array(g.indices);
  for (let i = 0; i < indices.length; i += 3) {
    [indices[i + 1], indices[i + 2]] = [indices[i + 2], indices[i + 1]];
  }
  return createMeshFromData(engine, g.name, g.positions, g.normals, indices, g.uvs);
}

export const toMaterial = (m: PbrSpec) => createPbrMaterial({
  baseColorFactor: [...m.color, 1], roughnessFactor: m.roughness, metallicFactor: m.metalness,
});
