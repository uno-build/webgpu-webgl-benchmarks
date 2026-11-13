import type { FieldScene } from '../../harness/types';

/** Column-major TRS, written into the engine's interleaved matrix rows. */
export function writeTransform(out: Float32Array, o: number, d: FieldScene, i: number) {
  const x = d.quat[i * 4], y = d.quat[i * 4 + 1], z = d.quat[i * 4 + 2], w = d.quat[i * 4 + 3], s = d.scale[i];
  const xx = 2 * x * x, xy = 2 * x * y, xz = 2 * x * z;
  const yy = 2 * y * y, yz = 2 * y * z, zz = 2 * z * z;
  const wx = 2 * w * x, wy = 2 * w * y, wz = 2 * w * z;
  out[o] = (1 - yy - zz) * s; out[o + 1] = (xy + wz) * s; out[o + 2] = (xz - wy) * s; out[o + 3] = 0;
  out[o + 4] = (xy - wz) * s; out[o + 5] = (1 - xx - zz) * s; out[o + 6] = (yz + wx) * s; out[o + 7] = 0;
  out[o + 8] = (xz + wy) * s; out[o + 9] = (yz - wx) * s; out[o + 10] = (1 - xx - yy) * s; out[o + 11] = 0;
  out[o + 12] = d.position[i * 3]; out[o + 13] = d.position[i * 3 + 1]; out[o + 14] = d.position[i * 3 + 2]; out[o + 15] = 1;
}

/** Preserve the material/geometry/visibility words following each 16-float matrix. */
export function copyMatrices(out: Float32Array, offset: number, stride: number, matrices: Float32Array) {
  for (let i = 0, o = offset; i < matrices.length; i += 16, o += stride) {
    for (let j = 0; j < 16; j++) out[o + j] = matrices[i + j];
  }
}
