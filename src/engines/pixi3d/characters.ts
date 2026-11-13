import { Model3D, type AnimationState, type Scene3DSource } from '@pixi/3d';
import { Assets } from 'pixi.js';
import type { CharactersScene, GltfScene } from '../../harness/types';
import type { Built, PixiCtx } from './common';
import { prepareNormals } from './normals';

export async function buildGltf(ctx: PixiCtx, d: GltfScene | CharactersScene): Promise<Built> {
  const source = await Assets.load<Scene3DSource>(d.url);
  ctx.assetUrls.push(d.url);
  prepareNormals(source);
  if (d.kind === 'gltf-scene') {
    ctx.view.root.addChild(new Model3D({ source, autoUpdate: false, autoPlay: false, castShadow: false, receiveShadow: false }));
    return { path: 'native glTF loader + Model3D, scripted camera', update() {} };
  }
  return buildCharacters(ctx, d, source);
}

export function buildCharacters(ctx: PixiCtx, d: CharactersScene, source: Scene3DSource): Built {
  const states: AnimationState[] = [];
  for (let i = 0; i < d.count; i++) {
    // Models share source geometry/materials but instantiate their own skeletons and players.
    const model = new Model3D({ source, autoUpdate: false, autoPlay: false, castShadow: false, receiveShadow: false });
    ctx.view.root.addChild(model);
    model.position.set(d.position[i * 3], d.position[i * 3 + 1], d.position[i * 3 + 2]);
    model.rotation.y = d.yaw[i];
    model.scale.set(d.scale, d.scale, d.scale);
    const player = model.player;
    const label = player?.animationLabels[d.clip];
    if (!player || label === undefined) throw new Error(`pixi3d: missing animation clip ${d.clip} in ${d.url}`);
    const state = player.getState(label);
    state.loop = true;
    states.push(state);
  }
  return {
    path: 'native Model3D skeletons + AnimationPlayer per character, shared geometry/materials',
    update(t) {
      for (let i = 0; i < states.length; i++) {
        const state = states[i];
        state.gotoAndStop((t + d.phase[i]) % state.animation.duration);
      }
    },
  };
}
