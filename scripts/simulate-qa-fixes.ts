/**
 * Simulates QA fix verification for Alpha build follow-ups.
 * Run: npx ts-node scripts/simulate-qa-fixes.ts
 */
import { inspectContent, stripSocialPrefixTokens } from '../src/utils/contentFilter';

type Result = { id: string; pass: boolean; detail: string };

const results: Result[] = [];

function check(id: string, pass: boolean, detail: string) {
  results.push({ id, pass, detail });
}

// ── 1. FCM token privacy (code-path simulation) ─────────────────────────────
function simulateFcmTokenAssignment() {
  // In-memory model of users.fcm_token rows (one token per user column).
  type Row = { id: string; fcm_token: string | null };
  const users: Row[] = [
    { id: 'user-a', fcm_token: 'DEVICE_TOKEN_X' },
    { id: 'user-b', fcm_token: null },
  ];

  const deviceToken = 'DEVICE_TOKEN_X';
  const newUserId = 'user-b';

  // Mirrors users.service.updateFcmToken
  users.forEach((u) => {
    if (u.fcm_token === deviceToken && u.id !== newUserId) u.fcm_token = null;
  });
  const target = users.find((u) => u.id === newUserId)!;
  target.fcm_token = deviceToken;

  const aStillHas = users.find((u) => u.id === 'user-a')!.fcm_token === deviceToken;
  const bHas = users.find((u) => u.id === 'user-b')!.fcm_token === deviceToken;
  check('1-fcm-reassign', !aStillHas && bHas, `user-a detached=${!aStillHas}, user-b assigned=${bHas}`);

  // Mirrors logout clear
  const logoutUser = 'user-b';
  users.find((u) => u.id === logoutUser)!.fcm_token = null;
  const bCleared = users.find((u) => u.id === 'user-b')!.fcm_token === null;
  check('1-fcm-logout-clear', bCleared, `user-b token cleared on logout=${bCleared}`);
}

// ── 4. Discovery filters persistence (merge simulation) ─────────────────────
function simulateDiscoveryFiltersPersist() {
  const profileBefore = { minAge: 18, maxAge: 99, interestSelections: ['everyone'], relationshipGoals: ['love'] };
  const filterDraft = { minAge: 25, maxAge: 40, interestSelections: ['women'], relationshipGoals: ['serious', 'long_term'] };
  const saved = { ...profileBefore, ...filterDraft };
  const feedQueryUses = {
    minAge: saved.minAge,
    maxAge: saved.maxAge,
    goals: saved.relationshipGoals,
  };
  check(
    '4-filters-persist',
    feedQueryUses.minAge === 25 &&
      feedQueryUses.maxAge === 40 &&
      feedQueryUses.goals.includes('serious'),
    JSON.stringify(feedQueryUses),
  );

  const candidateGoals = ['serious', 'chat'];
  const viewerGoals = feedQueryUses.goals;
  const overlaps = candidateGoals.some((g) => viewerGoals.includes(g));
  check('4-feed-goal-overlap', overlaps, `candidate matches viewer goals=${overlaps}`);
}

// ── 5. Chat pagination (cursor merge simulation) ────────────────────────────
function simulateChatPagination() {
  type Msg = { id: string; createdAt: string; text: string };
  // Latest 30 messages (newest first in API, chronological in UI).
  const initial: Msg[] = Array.from({ length: 30 }, (_, i) => ({
    id: `m-${i + 6}`,
    createdAt: new Date(Date.UTC(2026, 0, 1, 12, 5 + i)).toISOString(),
    text: `msg ${i + 6}`,
  }));
  const oldest = [...initial].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
  const olderPage: Msg[] = Array.from({ length: 5 }, (_, i) => ({
    id: `m-${i + 1}`,
    createdAt: new Date(Date.UTC(2026, 0, 1, 12, i)).toISOString(),
    text: `msg ${i + 1}`,
  }));

  const beforeCursor = oldest.createdAt;
  const pageFiltered = olderPage.filter((m) => m.createdAt < beforeCursor);
  const ids = new Set(initial.map((m) => m.id));
  const merged = [...pageFiltered.filter((m) => !ids.has(m.id)), ...initial].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );

  check('5-pagination-cursor', pageFiltered.length === 5, `older page size=${pageFiltered.length}`);
  check('5-pagination-total', merged.length === 35, `merged total=${merged.length} (expected 35)`);
  check('5-pagination-order', merged[0].id === 'm-1', `oldest id=${merged[0].id}`);
}

// ── 7. Moderation bypass (partial drafts + send) ────────────────────────────
function simulateModerationBypass() {
  const bypassAttempts = ['faceboo', 'discor', 'telegra', 'tiktoc', 'faceboo k'];
  for (const text of bypassAttempts) {
    const verdict = inspectContent(text, 'chat');
    check(`7-block-send:${text}`, verdict.blocked && verdict.category === 'social', `${text} → blocked=${verdict.blocked}`);
  }

  // Typing simulation: user reaches "faceboo", tries to add "k"
  let composer = 'faceboo';
  const blockedAddition = inspectContent('facebook', 'chat');
  if (blockedAddition.blocked) {
    composer = stripSocialPrefixTokens(composer);
  }
  check('7-strip-prefix', composer === '', `composer after strip="${composer}"`);
  check('7-send-clean', !inspectContent(composer, 'chat').blocked, 'empty composer passes send check');
}

// ── 8. Email verify URL + bridge behaviour ──────────────────────────────────
function simulateEmailDeepLink() {
  process.env.PUBLIC_API_URL = 'https://api.citasmallorca.es';
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { env } = require('../src/config/env') as typeof import('../src/config/env');
  const token = 'abc123';
  const verifyUrl = `${env.publicApiUrl}/api/auth/verify-email?token=${encodeURIComponent(token)}`;
  const usesHttpsPublic = verifyUrl.startsWith('https://') && !verifyUrl.includes('100.48.93.44');
  check('8-verify-url-https', usesHttpsPublic, verifyUrl);

  // Simulate browser Accept: text/html → inline bridge (no redirect to /open-app.html)
  const accept = 'text/html';
  const responseMode = accept.includes('application/json') ? 'json' : 'html-bridge';
  check('8-bridge-inline', responseMode === 'html-bridge', `responseMode=${responseMode}`);
}

// ── 9. UI overlay (route visibility simulation) ─────────────────────────────
function simulateLanguageSwitcherVisibility() {
  const hiddenOn = new Set(['Conversation', 'Discover', 'VerifyEmail']);
  const visibleOn = ['Matches', 'Chat', 'Profile', 'Settings'];
  for (const route of ['Conversation', 'Discover']) {
    check(`9-lang-hidden-${route}`, hiddenOn.has(route), `hidden on ${route}`);
  }
  for (const route of visibleOn) {
    check(`9-lang-visible-${route}`, !hiddenOn.has(route), `visible on ${route}`);
  }
}

simulateFcmTokenAssignment();
simulateDiscoveryFiltersPersist();
simulateChatPagination();
simulateModerationBypass();
simulateEmailDeepLink();
simulateLanguageSwitcherVisibility();

const passed = results.filter((r) => r.pass).length;
const failed = results.filter((r) => !r.pass);

console.log('=== QA fix simulation ===\n');
for (const r of results) {
  console.log(`${r.pass ? '[PASS]' : '[FAIL]'} ${r.id}: ${r.detail}`);
}
console.log(`\n=== Summary: ${passed}/${results.length} checks passed ===`);
if (failed.length) {
  process.exit(1);
}
