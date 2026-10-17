// Runs a TypeScript tool: bundles tools/<name>.ts to .cache/<name>.mjs, then runs it.
//   node tools/run.mjs build [args]
import { buildSync } from 'esbuild';
import { spawnSync } from 'node:child_process';
const [name, ...args] = process.argv.slice(2);
buildSync({ entryPoints: [`tools/${name}.ts`], bundle: true, platform: 'node', format: 'esm', packages: 'external', outfile: `.cache/${name}.mjs`, logLevel: 'error' });
const r = spawnSync(process.execPath, [`.cache/${name}.mjs`, ...args], { stdio: 'inherit' });
process.exit(r.status ?? 1);
