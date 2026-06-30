/**
 * Simulates content-filter rules across categories and surfaces.
 * Run: npx ts-node scripts/verify-content-filter.ts
 */
import { inspectContent } from '../src/utils/contentFilter';

type Case = {
  label: string;
  text: string;
  context: 'chat' | 'profile';
  expectBlocked: boolean;
  expectCategory?: string;
};

const cases: Case[] = [
  // --- Allowed ---
  { label: 'normal chat', text: 'Hola, ¿qué tal el fin de semana?', context: 'chat', expectBlocked: false },
  { label: 'normal profile name', text: 'María', context: 'profile', expectBlocked: false },
  { label: 'short number (age)', text: 'I am 25 years old', context: 'profile', expectBlocked: false },

  // --- Phone ---
  { label: 'phone spaced', text: 'Llámame al 612 345 678', context: 'chat', expectBlocked: true, expectCategory: 'phone' },
  { label: 'phone international', text: '+34 600 123 456', context: 'profile', expectBlocked: true, expectCategory: 'phone' },
  { label: 'phone dashed', text: '600-123-4567', context: 'chat', expectBlocked: true, expectCategory: 'phone' },

  // --- Social ---
  { label: 'instagram mention', text: 'Sígueme en instagram', context: 'chat', expectBlocked: true, expectCategory: 'social' },
  { label: 'whatsapp', text: 'Escríbeme por whatsapp', context: 'profile', expectBlocked: true, expectCategory: 'social' },
  { label: 'handle @user', text: 'Mi usuario es @cooluser123', context: 'chat', expectBlocked: true, expectCategory: 'social' },
  { label: 'telegram', text: 'Hablemos por telegram', context: 'chat', expectBlocked: true, expectCategory: 'social' },
  { label: 'linkedin', text: 'Add me on linkedin', context: 'chat', expectBlocked: true, expectCategory: 'social' },

  // --- Links ---
  { label: 'https url', text: 'Visita https://evil.com', context: 'chat', expectBlocked: true, expectCategory: 'link' },
  { label: 'www url', text: 'Mira www.example.com', context: 'profile', expectBlocked: true, expectCategory: 'link' },
  { label: 'obfuscated domain', text: 'Ve a example punto com', context: 'chat', expectBlocked: true, expectCategory: 'link' },

  // --- Sexual / illegal / aggressive ---
  { label: 'sexual term', text: 'send nudes', context: 'chat', expectBlocked: true, expectCategory: 'sexual' },
  { label: 'aggressive', text: 'kill yourself', context: 'chat', expectBlocked: true, expectCategory: 'aggressive' },
  { label: 'illegal drugs', text: 'vendo cocaina', context: 'chat', expectBlocked: true, expectCategory: 'illegal' },

  // --- Spam ---
  { label: 'spam phrase', text: 'gana dinero facil desde casa', context: 'chat', expectBlocked: true, expectCategory: 'spam' },
];

type SurfaceCheck = { surface: string; frontend: string; backend: string };

const surfaceCoverage: SurfaceCheck[] = [
  {
    surface: 'Chat messages',
    frontend: 'ConversationScreen — filter on type + send',
    backend: 'chat.service.sendMessage — inspectContent(text, chat)',
  },
  {
    surface: 'Profile firstName / bio',
    frontend: 'CreateProfile + EditProfile — Input/BioTextArea + validateProfileFields',
    backend: 'users.service.updateProfile — firstName, city, bio',
  },
  {
    surface: 'Report details',
    frontend: 'ReportUserSheet — useFilteredText + check on submit',
    backend: 'moderation.service.report — inspectContent(details, chat)',
  },
  {
    surface: 'City field',
    frontend: 'CityPicker — predefined list (no free-text submit)',
    backend: 'users.service.updateProfile — city inspected if sent',
  },
  {
    surface: 'Auth email/password',
    frontend: 'Login/Register — no content filter',
    backend: 'auth — no content filter (credentials only)',
  },
  {
    surface: 'Social search bar',
    frontend: 'SocialSearchBar — local search only, not persisted',
    backend: 'N/A',
  },
];

function runCases(): { passed: number; failed: Case[] } {
  const failed: Case[] = [];
  for (const c of cases) {
    const result = inspectContent(c.text, c.context);
    const blockedOk = result.blocked === c.expectBlocked;
    const categoryOk = !c.expectCategory || result.category === c.expectCategory;
    if (!blockedOk || !categoryOk) failed.push(c);
  }
  return { passed: cases.length - failed.length, failed };
}

function main() {
  console.log('=== Content filter simulation ===\n');

  const { passed, failed } = runCases();
  console.log(`Rule engine: ${passed}/${cases.length} test cases passed\n`);

  if (failed.length) {
    console.log('Failed cases:');
    for (const c of failed) {
      const r = inspectContent(c.text, c.context);
      console.log(`  - ${c.label}: expected blocked=${c.expectBlocked} category=${c.expectCategory ?? 'n/a'}, got blocked=${r.blocked} category=${r.category ?? 'n/a'}`);
    }
    console.log();
  }

  console.log('=== Surface coverage ===\n');
  for (const s of surfaceCoverage) {
    const gap = s.backend.includes('gap') || s.backend.includes('NO inspectContent');
    console.log(`${gap ? '[GAP]' : '[OK] '} ${s.surface}`);
    console.log(`      Frontend: ${s.frontend}`);
    console.log(`      Backend:  ${s.backend}\n`);
  }

  const gaps = surfaceCoverage.filter((s) => s.backend.includes('gap') || s.backend.includes('NO inspectContent'));
  console.log('=== Summary ===');
  console.log(`Categories blocked: phone, social, links, sexual, aggressive, illegal, spam`);
  console.log(`Dual-layer: frontend (instant) + backend (authoritative) on chat + profile`);
  console.log(`Coverage gaps: ${gaps.length} — ${gaps.map((g) => g.surface).join(', ') || 'none'}`);

  process.exit(failed.length > 0 ? 1 : 0);
}

main();
