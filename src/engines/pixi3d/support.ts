import type { SceneData, Variant } from '../../harness/types';

/** Limits of @pixi/3d 0.1.0. Reject incomplete workloads before allocating scene resources. */
export function checkSupport(d: SceneData, variant: Variant, opt?: string): void {
  if (d.kind === 'particles') throw new Error('N/A: PixiJS 3D adapter has no native path for the reference compute particle integration');
  if (d.kind === 'characters' && variant === 'optimized') {
    throw new Error('N/A: PixiJS 3D adapter has no baked animation path preserving independent character phases');
  }
  if (d.kind === 'field') {
    const lights = (d.sun ? 1 : 0) + (d.pointLights?.count ?? 0) + (d.spots?.length ?? 0);
    if (lights > 32) throw new Error(`N/A: PixiJS 3D supports 32 non-ambient lights; scene requires ${lights}`);
    const maps = (d.sun?.shadow?.cascades ?? 0) + (d.spots?.length ?? 0);
    if (maps > 16) throw new Error(`N/A: PixiJS 3D supports 16 shadow maps; scene requires ${maps}`);
    const sizes = new Set([...(d.sun?.shadow ? [d.sun.shadow.mapSize] : []), ...(d.spots?.map((s) => s.shadowMapSize) ?? [])]);
    if (sizes.size > 1) throw new Error('N/A: PixiJS 3D uses one shadow-map resolution per view; reference requires mixed map sizes');
    if (d.shadows || d.post) throw new Error('N/A: PixiJS 3D adapter has no validated path for this shadow/post workload');
    if (d.pointLights && variant === 'naive') {
      throw new Error('N/A: PixiJS 3D uses native tiled lighting and exposes no untiled forward path');
    }
  }
  if (opt && variant === 'optimized' && !(d.kind === 'field' && !d.pointLights && opt === 'batched')) {
    throw new Error(`pixi3d: unknown optimized path "${opt}"`);
  }
}
