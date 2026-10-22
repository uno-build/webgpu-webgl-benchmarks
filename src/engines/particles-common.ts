// Reference integration shared by the native Babylon and Lite compute adapters.
export const WORKGROUP = 256;
export const PARAMS = ['t', 'dt', 'count', 'bounds', 'radius', 'speed', 'strength', 'damping'] as const;

export const SIM = /* wgsl */ `
struct Params { ${PARAMS.map((p) => `${p}: f32`).join(', ')} };
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read_write> pos: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> vel: array<vec4f>;

@compute @workgroup_size(${WORKGROUP})
fn main(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= u32(params.count)) { return; }
  let a = params.t * params.speed;
  let attractor = vec3f(cos(a) * params.radius, sin(a * 1.3) * params.radius * 0.5, sin(a) * params.radius);
  var p = pos[i].xyz;
  var v = vel[i].xyz;
  let d = attractor - p;
  v += d * (params.strength / (dot(d, d) + 1.0)) * params.dt;
  v *= params.damping;
  p += v * params.dt;
  let out = abs(p) > vec3f(params.bounds);
  p = select(p, sign(p) * params.bounds, out);
  v = select(v, -v * 0.8, out);
  pos[i] = vec4f(p, 1.0);
  vel[i] = vec4f(v, 0.0);
}`;

