import type { Geometry3D, Material3D, View3D } from '@pixi/3d';

// Native PBR divides direct and ambient diffuse by π, like three.js.
export const LIGHT_SCALE = Math.PI;

export interface PixiCtx {
  view: View3D;
  geometries: Geometry3D[];
  materials: Material3D[];
  assetUrls: string[];
}

export interface Built { path: string; update(t: number, dt: number): void }
