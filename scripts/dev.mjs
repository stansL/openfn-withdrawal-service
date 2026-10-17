import { spawnSync } from 'node:child_process';

// Compile before loading the server so failed builds never run stale output.
const build = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json'], {
  stdio: 'inherit',
});

if (build.error) throw build.error;
if (build.status !== 0) process.exit(build.status ?? 1);

await import('../dist/server.js');
