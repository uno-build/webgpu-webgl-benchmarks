import { BatchedMesh3D, Geometry3D, Material3D, Mesh3D, PlaneGeometry, PointLight, RenderPassBit } from '@pixi/3d';
import type { FieldScene, InstancesScene, PbrSpec, Variant } from '../../harness/types';
import { srgb3 } from '../common';
import { LIGHT_SCALE, type Built, type PixiCtx } from './common';
import { copyMatrices, writeTransform } from './transforms';

function material(ctx: PixiCtx, m: PbrSpec) {
  const mat = new Material3D({ baseColor: srgb3(m.color), roughness: m.roughness, metallic: m.metalness });
  ctx.materials.push(mat);
  return mat;
}

export function buildField(ctx: PixiCtx, d: FieldScene, variant: Variant): Built {
  const { view } = ctx;
  const geometries = d.geometries.map((g) => new Geometry3D({ positions: g.positions, normals: g.normals, uvs: g.uvs, indices: g.indices }));
  ctx.geometries.push(...geometries);
  const materials = d.materials.map((m) => material(ctx, m));
  const batched = variant === 'optimized' && !d.pointLights;
  let updateObjects: () => void;
  if (batched) {
    const mesh = new BatchedMesh3D({ size: d.count });
    for (let i = 0; i < d.count; i++) {
      mesh.setGeometryAt(i, geometries[d.geom[i]]);
      mesh.setMaterialAt(i, materials[d.material[i]]);
      mesh.setPassesAt(i, RenderPassBit.OPAQUE);
    }
    view.root.addChild(mesh);
    const write = () => {
      const { data, offset, stride } = mesh.matrices;
      for (let i = 0, o = offset; i < d.count; i++, o += stride) writeTransform(data, o, d, i);
      mesh.matrices.update();
    };
    write();
    updateObjects = () => { if (d.animated) write(); };
  } else {
    const meshes: Mesh3D[] = [];
    for (let i = 0; i < d.count; i++) {
      const mesh = new Mesh3D({ geometry: geometries[d.geom[i]], material: materials[d.material[i]], castShadow: false, receiveShadow: false });
      mesh.position.set(d.position[i * 3], d.position[i * 3 + 1], d.position[i * 3 + 2]);
      mesh.scale.set(d.scale[i], d.scale[i], d.scale[i]);
      mesh.quaternion.set(d.quat[i * 4], d.quat[i * 4 + 1], d.quat[i * 4 + 2], d.quat[i * 4 + 3]);
      view.root.addChild(mesh);
      meshes.push(mesh);
    }
    updateObjects = () => {
      if (!d.animated) return;
      for (let i = 0; i < meshes.length; i++) meshes[i].quaternion.set(d.quat[i * 4], d.quat[i * 4 + 1], d.quat[i * 4 + 2], d.quat[i * 4 + 3]);
    };
  }
  if (d.ground) {
    const geometry = new PlaneGeometry({ width: d.ground.size, height: d.ground.size });
    ctx.geometries.push(geometry);
    const ground = new Mesh3D({ geometry, material: material(ctx, d.ground.material), castShadow: false, receiveShadow: false });
    ground.rotation.x = -Math.PI / 2;
    view.root.addChild(ground);
  }
  const lights: PointLight[] = [];
  if (d.pointLights) {
    const l = d.pointLights;
    for (let i = 0; i < l.count; i++) {
      const light = new PointLight({ color: srgb3([l.color[i * 3], l.color[i * 3 + 1], l.color[i * 3 + 2]]), intensity: l.intensity * LIGHT_SCALE, range: l.range });
      view.root.addChild(light);
      lights.push(light);
    }
  }
  return {
    path: batched ? 'BatchedMesh3D (bulk matrix upload)' : `Mesh3D scene nodes, native automatic batching${d.pointLights ? ', native tiled lighting (16×9 tiles + 32 depth bins)' : ''}`,
    update() {
      updateObjects();
      if (d.pointLights) {
        const p = d.pointLights.position;
        for (let i = 0; i < lights.length; i++) lights[i].position.set(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
      }
    },
  };
}

export function buildInstances(ctx: PixiCtx, d: InstancesScene): Built {
  const geometry = new Geometry3D({ positions: d.geometry.positions, normals: d.geometry.normals, uvs: d.geometry.uvs, indices: d.geometry.indices });
  ctx.geometries.push(geometry);
  const mat = material(ctx, d.material);
  const mesh = new BatchedMesh3D({ size: d.count });
  for (let i = 0; i < d.count; i++) {
    mesh.setGeometryAt(i, geometry);
    mesh.setMaterialAt(i, mat);
    mesh.setPassesAt(i, RenderPassBit.OPAQUE);
  }
  ctx.view.root.addChild(mesh);
  const update = () => {
    const { data, offset, stride } = mesh.matrices;
    copyMatrices(data, offset, stride, d.matrices);
    mesh.matrices.update();
  };
  update();
  return { path: 'BatchedMesh3D, shared geometry/material, all matrices uploaded every frame', update };
}
