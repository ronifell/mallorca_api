/** Write dist/build-info.json with the current git SHA (used by GET /health). */
const { execSync } = require('child_process');
const { mkdirSync, writeFileSync } = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');
mkdirSync(dist, { recursive: true });

function resolveGitCommit() {
  if (process.env.GIT_COMMIT && process.env.GIT_COMMIT.trim()) {
    return process.env.GIT_COMMIT.trim();
  }
  try {
    return execSync('git rev-parse HEAD', { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

const gitCommit = resolveGitCommit();
const payload = { gitCommit, builtAt: new Date().toISOString() };
writeFileSync(path.join(dist, 'build-info.json'), JSON.stringify(payload, null, 2));
console.log(
  gitCommit
    ? `build-info.json gitCommit=${gitCommit}`
    : 'build-info.json: gitCommit unavailable',
);
