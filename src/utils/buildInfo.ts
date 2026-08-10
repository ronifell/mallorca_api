import fs from 'fs';
import path from 'path';

interface BuildInfo {
  gitCommit?: string | null;
  builtAt?: string | null;
}

function readBuildInfoFile(): BuildInfo | null {
  const candidates = [
    path.join(process.cwd(), 'dist', 'build-info.json'),
    path.join(__dirname, 'build-info.json'),
    path.join(__dirname, '..', 'build-info.json'),
  ];
  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) continue;
      return JSON.parse(fs.readFileSync(file, 'utf8')) as BuildInfo;
    } catch {
      // try next
    }
  }
  return null;
}

/** Prefer process env (deploy script), then build-time build-info.json. */
export function resolveGitCommit(): string | null {
  const fromEnv = (process.env.GIT_COMMIT ?? '').trim();
  if (fromEnv) return fromEnv;
  const info = readBuildInfoFile();
  const fromBuild = (info?.gitCommit ?? '').trim();
  return fromBuild || null;
}
