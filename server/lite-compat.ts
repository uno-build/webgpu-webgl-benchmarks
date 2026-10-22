import type { Plugin } from 'vite';

// Lite 1.36.0's PBR receiver chooses CSM *instead of* PCF when both exist,
// but its bind group still binds every light. Compose its native receiver
// fragments in the original light order so all five shadow maps are sampled.
// This build-time compatibility fix does not replace any shadow algorithm.
export const mixedShadowReceiverSource = `
import { getCsmPbrReceiverFactory } from '../../../shadow/csm-receiver-registry.js';
import { createMaterialShadowBindings } from '../../../shadow/material-shadow-bindings.js';

function toPbrShadowFragment(fragment) {
  return { ...fragment, _fragmentSlots: { AS: fragment._fragmentSlots?.AD ?? '' } };
}
function mergeShadowFragments(fragments) {
  const result = { _id: 'pbr-mixed-shadows', _varyings: [], _bindings: [],
    _helperFunctions: '', _vertexHelperFunctions: '', _vertexSlots: {}, _fragmentSlots: {} };
  for (const fragment of fragments) {
    result._varyings.push(...(fragment._varyings ?? []));
    result._bindings.push(...(fragment._bindings ?? []));
    result._helperFunctions += '\\n' + (fragment._helperFunctions ?? '');
    result._vertexHelperFunctions += '\\n' + (fragment._vertexHelperFunctions ?? '');
    for (const name of ['_vertexSlots', '_fragmentSlots']) {
      for (const [slot, code] of Object.entries(fragment[name] ?? {})) {
        result[name][slot] = (result[name][slot] ?? '') + '\\n' + code;
      }
    }
  }
  return result;
}
function createPbrShadowFragment(slots, fallback) {
  return mergeShadowFragments(slots.map((slot) => slot.shadowType === 'csm'
    ? getCsmPbrReceiverFactory()([{ lightIndex: slot.lightIndex }])
    : toPbrShadowFragment(fallback('pbr-shadow-' + slot.lightIndex, [slot]))));
}
async function preparePbrShadowFragment(slots) {
  const fallbackSlots = slots.filter((slot) => slot.shadowType !== 'csm');
  const fallback = fallbackSlots.length
    ? await (await import('../../../shader/fragments/shadow-fragment-builder.js')).loadShadowFragmentFactory(fallbackSlots)
    : null;
  return (lights) => createPbrShadowFragment(lights, fallback);
}
export { createMaterialShadowBindings, createPbrShadowFragment, preparePbrShadowFragment };
`;

export function liteCompatibility(): Plugin {
  return {
    name: 'lite-1.36-mixed-shadow-receivers',
    enforce: 'pre',
    transform(source, id) {
      if (!id.split('?')[0].endsWith('/@babylonjs/lite/lib/material/pbr/fragments/pbr-shadow-fragment.js')) return;
      if (!source.includes('csmSlots.length > 0') || !source.includes('preparePbrShadowFragment')) {
        throw new Error('Babylon Lite shadow receiver changed; review the 1.36.0 compatibility patch');
      }
      return { code: mixedShadowReceiverSource, map: null };
    },
  };
}
