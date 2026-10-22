import test from 'node:test';
import assert from 'node:assert/strict';
import { mixedShadowReceiverSource } from '../server/lite-compat';
import { withoutMaterials } from '../src/engines/babylon-lite/characters';
import { createTransformNode } from '@babylonjs/lite';
import { normalizeGltf } from '../src/engines/babylon-lite/common';

test('glTF conversion uses the camera Z reflection and preserves authored child transforms', () => {
  const root = createTransformNode('__root__', 0, 0, 0, 0, 0, 0, 1, -1, 1, 1);
  const child = createTransformNode('authored', 3, 4, 5);
  child.parent = root; root.children.push(child);
  normalizeGltf({ entities: [root] });
  assert.equal(child.worldMatrix[12], 3);
  assert.equal(child.worldMatrix[13], 4);
  assert.equal(child.worldMatrix[14], -5);
  assert.equal(child.position.z, 5);
});

test('mixed CSM/PCF receiver keeps all five shadow maps and their original binding order', () => {
  const source = mixedShadowReceiverSource.replace(/^import .*;$/gm, '').replace(/^export .*;$/gm, '');
  const fragment = (slot: { lightIndex: number }, type: string) => ({
    _varyings: type === 'pcf' ? [`varying-${slot.lightIndex}`] : [],
    _bindings: Array.from({ length: 3 }, (_, i) => `${type}-${slot.lightIndex}-${i}`),
    _fragmentSlots: { [type === 'pcf' ? 'AD' : 'AS']: `shadowFactors[${slot.lightIndex}]=${type};` },
    _vertexSlots: type === 'pcf' ? { VB: `project-${slot.lightIndex};` } : {},
  });
  const create = new Function('getCsmPbrReceiverFactory', 'createMaterialShadowBindings', `${source}\nreturn createPbrShadowFragment;`)(
    () => (slots: { lightIndex: number }[]) => fragment(slots[0], 'csm'), () => {},
  );
  for (const types of [['csm', 'pcf', 'pcf', 'pcf', 'pcf'], ['pcf', 'pcf', 'csm', 'pcf', 'pcf']]) {
    const slots = types.map((shadowType, lightIndex) => ({ shadowType, lightIndex }));
    const result = create(slots, (_id: string, entries: { lightIndex: number }[]) => fragment(entries[0], 'pcf'));
    assert.deepEqual(result._bindings, slots.flatMap((s) => Array.from({ length: 3 }, (_, i) => `${s.shadowType}-${s.lightIndex}-${i}`)));
    assert.equal(result._varyings.length, 4);
    for (const s of slots) assert.ok(result._fragmentSlots.AS.includes(`shadowFactors[${s.lightIndex}]=${s.shadowType};`));
  }
});

test('texture-free character load preserves animation, skins and binary accessor data', () => {
  const original = { asset: { version: '2.0' }, skins: [{ joints: [0, 1] }], animations: [{ name: 'Walk', channels: [1] }],
    materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }], images: [{ bufferView: 0 }], textures: [{ source: 0 }],
    buffers: [{ byteLength: 8 }], bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 8 }] };
  const encoded = new TextEncoder().encode(JSON.stringify(original)), length = (encoded.length + 3) & ~3;
  const glb = new ArrayBuffer(20 + length + 16), view = new DataView(glb);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, glb.byteLength, true);
  view.setUint32(12, length, true); view.setUint32(16, 0x4e4f534a, true);
  new Uint8Array(glb, 20, length).fill(32); new Uint8Array(glb, 20, encoded.length).set(encoded);
  view.setUint32(20 + length, 8, true); view.setUint32(24 + length, 0x004e4942, true);
  new Uint8Array(glb, 28 + length).set([7, 6, 5, 4, 3, 2, 1, 0]);
  const result = withoutMaterials(glb), out = new DataView(result), jsonLength = out.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(result, 20, jsonLength)));
  assert.deepEqual(json.skins, original.skins); assert.deepEqual(json.animations, original.animations);
  assert.deepEqual(json.bufferViews, original.bufferViews);
  assert.deepEqual(new Uint8Array(result, 20 + jsonLength), new Uint8Array(glb, 20 + length));
  assert.equal(out.getUint32(8, true), result.byteLength); assert.equal(json.images, undefined);
  assert.equal(json.materials[0].pbrMetallicRoughness.baseColorTexture, undefined);
});
