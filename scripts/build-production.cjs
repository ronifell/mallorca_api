/**
 * Low-memory production build for small VPS (e.g. t3.micro).
 * Transpiles with esbuild (no full typecheck) and copies SQL migrations.
 */
const esbuild = require('esbuild');
const { cpSync, mkdirSync, rmSync } = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');

async function main() {
  rmSync(dist, { recursive: true, force: true });
  mkdirSync(path.join(dist, 'db'), { recursive: true });

  const common = {
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    packages: 'external',
    sourcemap: true,
    logLevel: 'info',
    bundle: true,
  };

  await esbuild.build({
    ...common,
    entryPoints: [path.join(root, 'src/index.ts')],
    outfile: path.join(dist, 'index.js'),
  });

  await esbuild.build({
    ...common,
    entryPoints: [path.join(root, 'src/db/migrate.ts')],
    outfile: path.join(dist, 'db/migrate.js'),
  });

  const migrationsSrc = path.join(root, 'src/db/migrations');
  const migrationsDest = path.join(dist, 'db/migrations');
  mkdirSync(migrationsDest, { recursive: true });
  cpSync(migrationsSrc, migrationsDest, { recursive: true });

  console.log('Production build written to dist/');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
