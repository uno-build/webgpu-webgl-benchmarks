import { Geometry3D, getAttributeData, type Scene3DSource } from '@pixi/3d';
import { Buffer, BufferUsage, getAttributeInfoFromFormat, type Attribute } from 'pixi.js';

/** glTF requires flat face normals when NORMAL is absent (including the reference Fox). */
export function withFaceNormals(g: Geometry3D): Geometry3D {
  if (g.attributes.aNormal) return g;
  if (g.topology !== 'triangle-list') throw new Error('N/A: missing normals on non-triangle glTF geometry');
  const indices = g.indices;
  const expand = (values: Float32Array, size: number) => {
    const out = new Float32Array(indices.length * size);
    for (let i = 0; i < indices.length; i++) {
      for (let c = 0; c < size; c++) out[i * size + c] = values[indices[i] * size + c];
    }
    return out;
  };
  const attributes: Record<string, Attribute> = {};
  for (const [name, a] of Object.entries(g.attributes)) {
    const size = getAttributeInfoFromFormat(a.format!).size;
    const floats = expand(getAttributeData(g, name, size), size);
    // Preserve integer joint inputs; normalized attributes have already been decoded to floats.
    const integer = a.format!.startsWith('uint') ? 'uint32' : a.format!.startsWith('sint') ? 'sint32' : 'float32';
    const data = integer === 'uint32' ? new Uint32Array(floats) : integer === 'sint32' ? new Int32Array(floats) : floats;
    attributes[name] = { buffer: new Buffer({ data, usage: BufferUsage.VERTEX | BufferUsage.COPY_DST }), format: `${integer}${size > 1 ? `x${size}` : ''}` as Attribute['format'], stride: size * data.BYTES_PER_ELEMENT, offset: 0 };
  }
  const positions = expand(getAttributeData(g, 'aPosition', 3), 3);
  const normals = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 9) {
    const ax = positions[i + 3] - positions[i], ay = positions[i + 4] - positions[i + 1], az = positions[i + 5] - positions[i + 2];
    const bx = positions[i + 6] - positions[i], by = positions[i + 7] - positions[i + 1], bz = positions[i + 8] - positions[i + 2];
    const x = ay * bz - az * by, y = az * bx - ax * bz, z = ax * by - ay * bx;
    const length = Math.hypot(x, y, z) || 1;
    for (let c = 0; c < 9; c += 3) { normals[i + c] = x / length; normals[i + c + 1] = y / length; normals[i + c + 2] = z / length; }
  }
  attributes.aNormal = { buffer: new Buffer({ data: normals, usage: BufferUsage.VERTEX | BufferUsage.COPY_DST }), format: 'float32x3', stride: 12, offset: 0 };
  return new Geometry3D({
    attributes, bounds3D: g.bounds3D.clone(), topology: g.topology,
    morphTargets: g._morphTargets?.map((m) => ({ positions: expand(m.positions, 3), normals: m.normals ? expand(m.normals, 3) : undefined })),
  });
}

/** Prepare the shared source once, before instantiating any models or skeletons. */
export function prepareNormals(source: Scene3DSource) {
  const replacements = new Map<Geometry3D, Geometry3D>();
  for (const primitives of source.geometries) {
    for (let i = 0; i < primitives.length; i++) {
      const old = primitives[i];
      if (old.attributes.aNormal) continue;
      let replacement = replacements.get(old);
      if (!replacement) { replacement = withFaceNormals(old); replacements.set(old, replacement); }
      primitives[i] = replacement;
    }
  }
  for (const [name, g] of Object.entries(source.geometry)) source.geometry[name] = replacements.get(g) ?? g;
  for (const old of replacements.keys()) old.destroy(true);
}
