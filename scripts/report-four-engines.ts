// Rebuild the separate, self-contained four-engine report from one completed fresh session.
// Usage: node --import tsx scripts/report-four-engines.ts <session-folder>
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = join(import.meta.dirname, '..');
const session = process.argv[2];
if (!session || !/^[\w.-]+$/.test(session)) throw new Error('Pass a session folder name under results/');
const dir = join(ROOT, 'results', session);
const meta = JSON.parse(readFileSync(join(dir, 'session.json'), 'utf8'));
const queue = JSON.parse(readFileSync(join(dir, 'queue.json'), 'utf8'));
const raw = readFileSync(join(dir, 'results.jsonl'), 'utf8');
const records: any[] = [...new Map(raw.trim().split('\n').map((line) => {
  const r = JSON.parse(line);
  return [r.runId, r] as const;
})).values()];
const recorded = new Set(records.map((r) => r.runId));
if (queue.some((q: any) => !recorded.has(q.runId))) throw new Error('Session is incomplete; finish or resume it before exporting');
const environmentPath = join(dir, 'environment.json');
if (!existsSync(environmentPath)) throw new Error('Save measured machine/browser context in the session environment.json first');
const env = JSON.parse(readFileSync(environmentPath, 'utf8'));

execFileSync(process.execPath, ['--import', 'tsx', join(ROOT, 'scripts/report.ts'), '--sessions', session], { cwd: ROOT, stdio: 'inherit' });
const data = JSON.parse(readFileSync(join(ROOT, 'report/out/data.json'), 'utf8'));
const engines = ['three', 'playcanvas', 'babylon', 'babylon-lite'];
const labels: Record<string, string> = { three: 'three.js', playcanvas: 'PlayCanvas', babylon: 'Babylon.js', 'babylon-lite': 'Babylon Lite' };
for (const e of engines) if (!data.engines[e]) throw new Error(`No measured version for ${e}`);
data.cells = data.cells.filter((c: any) => engines.includes(c.engine));
data.scenarios = data.scenarios.map((s: any) => {
  const cells = data.cells.filter((c: any) => c.scenario === s.id);
  return { ...s, levels: [...new Set(cells.map((c: any) => c.level))].sort((a: any, b: any) => a - b),
    variants: s.variants.filter((v: string) => cells.some((c: any) => c.variant === v)),
    backends: ['webgpu'], engines };
}).filter((s: any) => s.levels.length);
data.machine = { ...data.machine, description: env.cpu };
const timing = records.filter((r) => r.status === 'ok' && r.params?.mode === 'timing' && !r.params?.tag);
const counters = records.filter((r) => r.status === 'ok' && r.params?.mode === 'counters');
if (timing.some((r) => r.engine?.init?.msaa !== 4 || r.engine?.init?.backend !== 'webgpu')) {
  throw new Error('A successful timing run used a different backend or sample count');
}
const ok = data.cells.filter((c: any) => c.status === 'ok');
if (ok.some((c: any) => c.repeats < 1)) throw new Error('Comparison needs timing runs; counters-only cells cannot be ranked');
const coverage = timing.map((r) => r.frames.gpuCoverage).filter(Number.isFinite);
const minCoverage = Math.min(...coverage);
const medCoverage = [...coverage].sort((a, b) => a - b)[Math.floor(coverage.length / 2)];
const minRepeats = Math.min(...ok.map((c: any) => c.repeats));
const maxRepeats = Math.max(...ok.map((c: any) => c.repeats));
const calibration = data.browsers[0].calibration?.intervalP50;
const spread = data.browsers[0].canary?.spread;
const rawFile = 'four-engines-runs.jsonl';
data.comparison = {
  session, machine: `${env.cpu} · ${env.memoryGiB} GB · macOS ${env.os}`, rawFile,
  summary: `Fresh measurements of all four engines on one ${env.cpu}, using ${env.browser}, WebGPU, 1920×1080 and 4× MSAA. Representative loads across all scenarios, with three planned timing repetitions and a separate counters pass. This is a new session, independent of the original reference report.`,
  method: [
    { title: 'Source and coverage', body: `Session ${session}. ${data.cells.length} engine/scenario/path/load combinations: ${ok.length} valid, ${data.cells.filter((c: any) => c.status === 'na').length} N/A, ${data.cells.filter((c: any) => c.status === 'error').length} failed, ${data.cells.filter((c: any) => c.status === 'skipped').length} skipped. ${timing.length} valid timing runs and ${counters.length} valid counters runs. Valid combinations have ${minRepeats === maxRepeats ? minRepeats : `${minRepeats}–${maxRepeats}`} timing repeats. No September reference measurements or previous smoke tests are included.` },
    { title: 'Machine and browser', body: `${env.cpu}, ${env.memoryGiB} GB RAM, macOS ${env.os}, ${env.power}. ${env.browser}. Browser user agent: ${records.find((r) => r.ua)?.ua}. Calibration interval p50: ${calibration?.toFixed(3)} ms. The browser is display-rate limited; interval and FPS are not uncapped throughput measurements. Compare engine CPU and GPU costs separately.` },
    { title: 'Protocol', body: 'Production build. Timing runs: at least 90 warm-up frames and 1.5 seconds, then at least 240 measured frames and 3 seconds, with a 15-second measurement cap. Three timing passes, engine order shuffled per workload, separate counters runs and periodic canaries. Shared deterministic input advances by 1/60 second per frame. Invalid GPU runs are excluded from aggregates. All raw attempts, including failures and early stops, are downloadable below.' },
    { title: 'Counters and images', body: 'Draw calls, uploads, submissions and live GPU allocation estimates come from the common API probe. Counters are collected in their own runs and are not included in timing medians. Gallery images are frame 60 of each measured scene/path. A blank gallery cell means no valid capture, not zero rendering cost.' },
    { title: 'Timing quality', body: `GPU timestamps use the browser's normal precision; differences below its timestamp granularity are not decisive. Valid timing runs have ${(minCoverage * 100).toFixed(1)}% minimum and ${(medCoverage * 100).toFixed(1)}% median GPU-sample coverage.${spread == null ? '' : ` Canary CPU spread is ±${(spread * 100).toFixed(1)}%.`} Engine CPU time excludes the shared simulation. Frame cost is max(CPU p95, GPU p95), an estimate excluding simulation and presentation; it is not measured end-to-end latency or a capacity prediction.` },
    { title: 'Adapter coverage', body: 'Babylon Lite implements every registered WebGPU scene: meshes/materials, forward and clustered lights, CSM + spot shadows, HDR bloom + ACES, glTF, independent skinned characters, phased VAT and reference compute particles. Unsupported optimized paths in other engines remain N/A, and actual execution errors retain their error status. N/A is not a performance win or loss.' },
    { title: 'Image equivalence', body: 'Engines consume the same geometry, materials, lights and camera inputs, but native shading may differ. In S5/S6, PlayCanvas uses a 2048-pixel atlas for four cascades (1024 per tile), while three.js and Babylon.js configure 2048 per cascade: their shadow GPU costs are not equal-resolution comparisons. Lite also uses 2048 per cascade, with native PCF filtering. Lite 1.36.0 has a build-time fix that composes its native CSM and PCF receiver fragments together. Lite forward lights do not have the glTF smooth range window, and native spotlights have no separate inner cone control: these lighting differences are recorded in run notes and limit pixel-equivalent GPU comparisons. Sponza advances the camera once per frame, so differing frame counts can cover different portions of the route.' },
    { title: 'Footprint and startup', body: 'Minimal app sizes were built from the pinned packages on this machine. Static imports and all reachable lazy chunks are both shown; some lazy code is required before the first frame. Startup is measured after priming each engine, from local serving, and uses the fastest valid repeat. It does not represent a cold internet download.' },
    { title: 'Scope', body: 'WebGPU only, one machine, one browser and representative loads. S1 includes 1,000 and 5,000 meshes; other scenarios use the load shown in their tables. No claims about untested levels, maximum object capacity, Firefox, Safari or WebGL2 follow from this report.' },
  ],
};

// All findings are derived from this report's valid timing data, with no historical rankings.
const find = (engine: string, scenario: string, variant: string, level: number) => data.cells.find((c: any) => c.engine === engine && c.scenario === scenario && c.variant === variant && c.level === level && c.status === 'ok');
const compare = (scenario: string, variant: string, level: number, metric: 'cpu' | 'gpu') => engines.map((engine) => {
  const c = find(engine, scenario, variant, level), ms = c?.[metric]?.p50?.med;
  return { engine, ms };
}).filter((x) => typeof x.ms === 'number').sort((a, b) => a.ms - b.ms)
  .map((x) => `${labels[x.engine]} ${x.ms.toFixed(2)} ms`).join('; ');
data.findings = [
  { title: '5,000 separate animated meshes', body: `Engine CPU p50: ${compare('s1', 'naive', 5000, 'cpu')}. These are engine update/render costs, excluding the shared simulation.` },
  { title: '5,000 meshes with native instancing', body: `Engine CPU p50: ${compare('s1', 'optimized', 5000, 'cpu')}. Compare with the separate-mesh path using the Path filter; all four render the same shared object data.` },
  { title: '100,000 instances updated every frame', body: `Engine CPU p50: ${compare('s3', 'optimized', 100000, 'cpu')}. GPU p50: ${compare('s3', 'optimized', 100000, 'gpu')}. Upload and rendering costs can rank the engines differently.` },
  { title: '32 moving lights with clustering', body: `GPU p50: ${compare('s4', 'optimized', 32, 'gpu')}. Switch to Optimized to inspect all four native clustered paths. Forward-path failures or N/A entries are reported separately.` },
  { title: 'Coverage matters', body: `${ok.length} of ${data.cells.length} measured combinations produced valid timing results. Lite now has implementations for every scene. Any N/A entries belong to unavailable paths in the other adapters; actual rendering errors are displayed separately. This report only ranks valid rendered paths.` },
];

// Include every captured path at a representative measured load, so clustered lights and
// instanced scenes have four-engine visual comparisons as well as numerical comparisons.
const thumbs = mkdtempSync(join(tmpdir(), 'wgb-four-engines-'));
data.gallery = [];
try {
for (const s of data.scenarios) for (const variant of s.variants) {
  const level = s.levels[0];
  for (const engine of engines) {
    const c = find(engine, s.id, variant, level);
    if (!c?.counters) continue;
    const name = `${engine}_webgpu_${s.id}_${variant}_${level}`;
    const source = join(dir, 'shots', `${name}.png`);
    if (!existsSync(source)) continue;
    const dst = join(thumbs, `${name}.jpg`);
    execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '78', '-Z', '640', source, '--out', dst], { stdio: 'ignore' });
    data.gallery.push({ engine, backend: 'webgpu', scenario: s.id, variant, level, img: `data:image/jpeg;base64,${readFileSync(dst).toString('base64')}` });
  }
}
} finally {
  rmSync(thumbs, { recursive: true, force: true });
}
const template = readFileSync(join(ROOT, 'report/template.html'), 'utf8');
const html = template.replace('/*__DATA__*/null', () => JSON.stringify(data).replace(/</g, '\\u003c'));
const output = join(ROOT, 'docs', 'index-four-engines.html');
writeFileSync(output, `<!doctype html>\n<html lang="en">\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n${html}\n</html>\n`);
copyFileSync(join(dir, 'results.jsonl'), join(ROOT, 'docs', rawFile));
writeFileSync(join(ROOT, 'docs', 'four-engines-session.json'), JSON.stringify({ ...meta, environment: env }, null, 2));
console.log(`Wrote ${output}: ${data.cells.length} combinations, ${data.gallery.length} screenshots`);
