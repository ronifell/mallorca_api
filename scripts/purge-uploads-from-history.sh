#!/usr/bin/env bash
# Remove uploads/ blobs from entire git history (user media mistakenly committed).
# Run from Backend repo root. Requires a force-push afterwards — coordinate with the team.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "WARNING: This rewrites git history for uploads/."
echo "After it finishes you must force-push: git push --force-with-lease origin main"
echo ""

if command -v git-filter-repo >/dev/null 2>&1; then
  git filter-repo --force --path uploads --invert-paths
else
  echo "git-filter-repo not found — using git filter-branch fallback..."
  git filter-branch --force --index-filter \
    'git rm -rf --cached --ignore-unmatch uploads' \
    --prune-empty --tag-name-filter cat -- --all
  rm -rf .git/refs/original/
  git reflog expire --expire=now --all
  git gc --prune=now --aggressive
fi

echo ""
echo "Done. Verify: git log --all -- uploads  (should be empty)"
echo "Then: git push --force-with-lease origin main"
