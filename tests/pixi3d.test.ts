import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { Animation, BatchedMesh3D, Geometry3D, Material3D, Mesh3D, Model3D, Scene3DSource, Vector3Track, View3D, getAttributeData } from '@pixi/3d';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { allCells, SCENARIOS } from '../src/harness/matrix';
import { buildScene } from '../src/harness/scenes';
import { buildField, buildInstances } from '../src/engines/pixi3d/field';
import { checkSupport } from '../src/engines/pixi3d/support';
import { buildCharacters } from '../src/engines/pixi3d/characters';
import { withFaceNormals } from '../src/engines/pixi3d/normals';
import type { PixiCtx } from '../src/engines/pixi3d/common';
import type { CharactersScene, FieldScene, InstancesScene } from '../src/harness/types';

function context(t: TestContext): PixiCtx {
  const ctx: PixiCtx = { view: new View3D(), geometries: [], materials: [], assetUrls: [] };
  t.after(() => {
    ctx.view.destroy({ children: true });
    for (const g of ctx.geometries) g.destroy();
    for (const m of ctx.materials) m.destroy();
  });
  return ctx;
}

function close(actual: ArrayLike<number>, expected: ArrayLike<number>) {
  assert.equal(actual.length, expected.length);
  for (let i = 0; i < expected.length; i++) assert.ok(Math.abs(actual[i] - expected[i]) < 1e-5, `matrix[${i}]: ${actual[i]} vs ${expected[i]}`);
}

test('PixiJS 3D is registered for every scenario on both supported backends', () => {
  const cells = allCells({ engine: ['pixi3d'] });
  for (const scenario of SCENARIOS) {
    assert.ok(scenario.engines.includes('pixi3d'));
    for (const backend of scenario.backends) assert.ok(cells.some((c) => c.scenario === scenario.id && c.backend === backend));
  }
  assert.ok(!cells.some((c) => c.scenario === 's9' && c.backend === 'webgl2'));
});

test('native light/shadow caps cannot silently reduce the reference workload', () => {
  for (const n of [8, 32]) assert.doesNotThrow(() => checkSupport(buildScene('s4', n, null), 'optimized'));
  for (const n of [128, 512]) assert.throws(() => checkSupport(buildScene('s4', n, null), 'optimized'), /^Error: N\/A:.*32 non-ambient lights/);
  assert.throws(() => checkSupport(buildScene('s4', 8, null), 'naive'), /N\/A:.*no untiled forward path/);
  for (const id of ['s5', 's6'] as const) assert.throws(() => checkSupport(buildScene(id, 2000, null), 'naive'), /N\/A:.*one shadow-map resolution.*mixed map sizes/);
  assert.throws(() => checkSupport(buildScene('s9', 1, null), 'naive'), /N\/A:.*reference compute/);
});

test('native nodes and bulk batches render the same animated TRS without corrupting slot metadata', (t) => {
  const d = buildScene('s1', 24, null) as FieldScene;
  const nodes = context(t), batch = context(t);
  const native = buildField(nodes, d, 'naive'), bulk = buildField(batch, d, 'optimized');
  const meshes = nodes.view.root.children.filter((n): n is Mesh3D => n instanceof Mesh3D);
  const batched = batch.view.root.children.find((n): n is BatchedMesh3D => n instanceof BatchedMesh3D)!;
  const metadata = () => {
    const { data, offset, stride } = batched.matrices;
    const words = new Uint32Array(data.buffer, data.byteOffset, data.length);
    return Array.from({ length: d.count }, (_, i) => Array.from(words.slice(offset + i * stride + 16, offset + (i + 1) * stride)));
  };
  const before = metadata();
  for (const time of [0, 1.25, 5]) {
    d.update(time); native.update(time, 1 / 60); bulk.update(time, 1 / 60);
    const { data, offset, stride } = batched.matrices;
    for (let i = 0; i < d.count; i++) {
      const expected = new Matrix4().compose(
        new Vector3().fromArray(d.position, i * 3), new Quaternion().fromArray(d.quat, i * 4), new Vector3().setScalar(d.scale[i]),
      );
      close(data.subarray(offset + i * stride, offset + i * stride + 16), expected.elements);
      close(meshes[i].getGlobalTransform().elements, expected.elements);
      assert.equal(meshes[i].geometry, meshes.find((_, j) => d.geom[j] === d.geom[i])!.geometry);
    }
    assert.deepEqual(metadata(), before);
  }
});

test('S3 copies every live matrix through the native interleaved upload API', (t) => {
  const d = buildScene('s3', 24, null) as InstancesScene;
  const ctx = context(t), built = buildInstances(ctx, d);
  const mesh = ctx.view.root.children.find((n): n is BatchedMesh3D => n instanceof BatchedMesh3D)!;
  for (const time of [0, 0.75]) {
    d.update(time); built.update(time, 1 / 60);
    const { data, offset, stride } = mesh.matrices;
    for (let i = 0; i < d.count; i++) close(data.subarray(offset + i * stride, offset + i * stride + 16), d.matrices.subarray(i * 16, (i + 1) * 16));
  }
  assert.equal(new Set(mesh.batch.items.map((i) => i.geometry)).size, 1);
  assert.equal(new Set(mesh.batch.items.map((i) => i.material)).size, 1);
});

test('native characters share resources, keep independent skeletons, and sample repeatable phase offsets without a ticker', (t) => {
  const source = new Scene3DSource({
    scenes: [{ children: [0, 1] }],
    nodes: [{ label: 'joint', children: [], isJoint: true }, { label: 'mesh', children: [], geometry: 0, materials: [0], skin: 0 }],
    skins: [{ inverseBindMatrices: new Float32Array(new Matrix4().elements), skeletonParent: new Int16Array([-1]), skeletonJoints: new Int16Array([0]), skeletonNodes: new Int32Array([0]), skeletonToModelRoot: false }],
  });
  source.geometries.push([new Geometry3D({ positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), indices: new Uint16Array([0, 1, 2]) })]);
  source.materials.push(new Material3D());
  source.animations.walk = new Animation({ label: 'walk', tracks: [new Vector3Track({ label: '0.position', times: [0, 2], values: [0, 0, 0, 2, 0, 0] })] });
  const ctx = context(t);
  t.after(() => source.destroy());
  const d: CharactersScene = {
    kind: 'characters', url: 'fixture.glb', count: 2, clip: 0, scale: 1,
    position: new Float32Array([0, 0, 0, 3, 0, 0]), yaw: new Float32Array([0, 1]), phase: new Float32Array([0, 0.5]),
    camera: { position: [0, 0, 5], target: [0, 0, 0], fovY: 60, near: 0.1, far: 100 }, clearColor: [0, 0, 0], ambient: { color: [1, 1, 1], intensity: 1 }, update() {},
  };
  const built = buildCharacters(ctx, d, source);
  const models = ctx.view.root.children.filter((n): n is Model3D => n instanceof Model3D);
  assert.notEqual(models[0].skeletons[0], models[1].skeletons[0]);
  for (const model of models) {
    const mesh = model.children[0] as Mesh3D;
    assert.equal(mesh.geometry, source.geometries[0][0]);
    assert.equal(mesh.material, source.materials[0]);
    assert.equal(model.player!.autoUpdate, false);
  }
  for (const time of [0.25, 2.25, 0.25]) {
    built.update(time, 1 / 60);
    close(models[0].skeletons[0].localPosition, [0.25, 0, 0]);
    close(models[1].skeletons[0].localPosition, [0.75, 0, 0]);
    for (const model of models) assert.equal(model.player!.playing, false);
  }
  assert.throws(() => checkSupport(d, 'optimized'), /N\/A:.*independent character phases/);
});

test('missing glTF normals become flat normals while UVs, joint indices and weights follow expanded triangles', (t) => {
  const g = new Geometry3D({
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]), indices: new Uint16Array([0, 1, 2, 0, 3, 1]),
    uvs: new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), joints: new Uint16Array([1, 0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0, 4, 0, 0, 0]),
    weights: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]),
  });
  const repaired = withFaceNormals(g);
  t.after(() => { g.destroy(true); repaired.destroy(true); });
  assert.equal(repaired.vertexCount, 6);
  close(getAttributeData(repaired, 'aNormal', 3), [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0]);
  close(getAttributeData(repaired, 'aUV', 2), [0, 0, 1, 0, 0, 1, 0, 0, 1, 1, 1, 0]);
  close(getAttributeData(repaired, 'aJoints', 4), [1, 0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0, 1, 0, 0, 0, 4, 0, 0, 0, 2, 0, 0, 0]);
  close(getAttributeData(repaired, 'aWeights', 4), Array.from({ length: 24 }, (_, i) => i % 4 === 0 ? 1 : 0));
  assert.equal(withFaceNormals(repaired), repaired);
});
