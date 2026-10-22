import {
  addClusteredLightContainer, addToScene, cloneTransformNode, createClusteredLightContainer, createClusteredPointLight,
  createCsmDirectionalShadowGenerator, createPcfSpotlightShadowGenerator, createSpotLight,
  createPointLight, createGround, createTransformNode, disposeMeshGpu, markClusteredLightContainerDirty,
  setShadowTaskCasterMeshes, setThinInstances, type DirectionalLight, type EngineContext, type Mesh, type SceneContext,
} from '@babylonjs/lite';
import type { FieldScene, Variant } from '../../harness/types';
import { toMaterial, toMesh } from './common';
import { deg } from '../common';

export function buildField(engine: EngineContext, scene: SceneContext, d: FieldScene, variant: Variant, sun?: DirectionalLight) {
  const notes: string[] = [];
  const casters: Mesh[] = [];
  const root = createTransformNode('right-handed scene', 0, 0, 0, 0, 0, 0, 1, 1, 1, -1);
  const attach = (mesh: Mesh) => {
    mesh.parent = root;
    root.children.push(mesh);
    mesh.receiveShadows = d.shadows;
    casters.push(mesh);
  };
  const mats = d.materials.map(toMaterial);
  const instanced = variant === 'optimized' && !d.pointLights;
  let updateObjects: () => void;

  if (instanced) {
    const buckets = new Map<number, number[]>();
    for (let i = 0; i < d.count; i++) {
      const key = d.geom[i] * mats.length + d.material[i];
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push(i);
    }
    // Reuse one native transform to compose matrices without allocating per instance.
    const transform = createTransformNode('matrix scratch');
    const parts = [...buckets].map(([key, ids]) => {
      const mesh = toMesh(engine, d.geometries[Math.floor(key / mats.length)]);
      mesh.material = mats[key % mats.length];
      attach(mesh);
      return { mesh, ids, matrices: new Float32Array(ids.length * 16) };
    });
    updateObjects = () => {
      for (const { mesh, ids, matrices } of parts) {
        for (let k = 0; k < ids.length; k++) {
          const i = ids[k], p = i * 3, q = i * 4, s = d.scale[i];
          transform.position.set(d.position[p], d.position[p + 1], d.position[p + 2]);
          transform.rotationQuaternion.set(d.quat[q], d.quat[q + 1], d.quat[q + 2], d.quat[q + 3]);
          transform.scaling.set(s, s, s);
          matrices.set(transform.worldMatrix, k * 16);
        }
        setThinInstances(mesh, matrices, ids.length);
      }
    };
    updateObjects();
  } else {
    const sources = d.geometries.map((g) => toMesh(engine, g));
    const meshes: Mesh[] = [];
    try {
      for (let i = 0; i < d.count; i++) {
        const mesh = cloneTransformNode(sources[d.geom[i]]) as Mesh;
        mesh.material = mats[d.material[i]];
        mesh.position.set(d.position[i * 3], d.position[i * 3 + 1], d.position[i * 3 + 2]);
        mesh.scaling.set(d.scale[i], d.scale[i], d.scale[i]);
        attach(mesh);
        meshes.push(mesh);
      }
    } finally {
      // Clones retain the shared geometry; retire the templates that never enter the scene.
      sources.forEach(disposeMeshGpu);
    }
    updateObjects = () => {
      for (let i = 0; i < meshes.length; i++) {
        const q = i * 4;
        meshes[i].rotationQuaternion.set(d.quat[q], d.quat[q + 1], d.quat[q + 2], d.quat[q + 3]);
      }
    };
    updateObjects();
  }
  addToScene(scene, root);
  if (d.ground) {
    const ground = createGround(engine, { width: d.ground.size, height: d.ground.size });
    ground.material = toMaterial(d.ground.material);
    ground.receiveShadows = d.shadows;
    addToScene(scene, ground);
  }

  let updateLights = () => {};
  if (d.pointLights && variant === 'optimized') {
    const pl = d.pointLights;
    const container = createClusteredLightContainer();
    const lights = Array.from({ length: pl.count }, (_, i) => createClusteredPointLight(container, {
      position: [pl.position[i * 3], pl.position[i * 3 + 1], -pl.position[i * 3 + 2]],
      diffuse: [pl.color[i * 3], pl.color[i * 3 + 1], pl.color[i * 3 + 2]],
      intensity: pl.intensity * Math.PI, range: pl.range,
    }));
    addClusteredLightContainer(scene, container);
    updateLights = () => {
      for (let i = 0; i < lights.length; i++) {
        const p = lights[i].position;
        p[0] = pl.position[i * 3];
        p[1] = pl.position[i * 3 + 1];
        p[2] = -pl.position[i * 3 + 2];
      }
      markClusteredLightContainerDirty(container);
    };
  } else if (d.pointLights) {
    const pl = d.pointLights;
    const lights = Array.from({ length: pl.count }, (_, i) => {
      const light = createPointLight([pl.position[i * 3], pl.position[i * 3 + 1], -pl.position[i * 3 + 2]], pl.intensity * Math.PI);
      light.diffuse = light.specular = [pl.color[i * 3], pl.color[i * 3 + 1], pl.color[i * 3 + 2]];
      light.range = pl.range;
      addToScene(scene, light);
      return light;
    });
    updateLights = () => lights.forEach((light, i) => light.position.set(pl.position[i * 3], pl.position[i * 3 + 1], -pl.position[i * 3 + 2]));
    notes.push('Native forward inverse-square attenuation; unlike clustered/glTF falloff, Lite does not smooth the range cutoff');
  }
  for (const s of d.spots ?? []) {
    const dx = s.target[0] - s.position[0], dy = s.target[1] - s.position[1], dz = -(s.target[2] - s.position[2]);
    const length = Math.hypot(dx, dy, dz);
    const light = createSpotLight([s.position[0], s.position[1], -s.position[2]], [dx / length, dy / length, dz / length], deg(s.angle * 2), 2, s.intensity * Math.PI);
    light.diffuse = light.specular = [...s.color];
    light.range = s.range;
    addToScene(scene, light);
    if (d.shadows) {
      const generator = createPcfSpotlightShadowGenerator(engine, light, { mapSize: s.shadowMapSize, bias: 0.01, normalBias: 0.02, far: s.range, forceRefreshEveryFrame: true });
      light.shadowGenerator = generator;
      setShadowTaskCasterMeshes(generator, casters);
    }
  }
  if (d.shadows && d.sun?.shadow && sun) {
    const sh = d.sun.shadow;
    const generator = createCsmDirectionalShadowGenerator(engine, sun, { mapSize: sh.mapSize, numCascades: sh.cascades, shadowMaxZ: sh.maxDistance, bias: 0.01, forceRefreshEveryFrame: true });
    sun.shadowGenerator = generator;
    setShadowTaskCasterMeshes(generator, casters);
  }
  if (d.spots?.length) {
    notes.push('Native physical spotlight cone falloff; Lite has no separate inner cone/penumbra control');
  }
  if (d.shadows) {
    notes.push('Native PCF filtering; Lite 1.36.0 mixed CSM/PCF receiver composition fixed at build time (server/lite-compat.ts)');
  }
  return {
    path: instanced ? 'Thin instances per geometry/material' : d.pointLights
      ? `Mesh clone per object + ${variant === 'optimized' ? 'clustered' : 'forward'} point lights`
      : d.shadows ? 'Mesh clones + 4 native CSM cascades + 4 PCF spot shadow maps' : 'Mesh clone per object (scene defaults)',
    notes,
    update() {
      if (d.animated) updateObjects();
      updateLights();
    },
  };
}
