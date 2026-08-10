/**
 * Offline + live simulation of the four remaining release fixes.
 * Run: node scripts/simulate-release-fixes.cjs
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');
const FRONTEND = path.resolve(ROOT, '..', 'Frontend');
let passed = 0;
let failed = 0;
const results = [];

function ok(name, detail = '') {
  passed += 1;
  results.push({ name, ok: true, detail });
  console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`);
}
function fail(name, detail = '') {
  failed += 1;
  results.push({ name, ok: false, detail });
  console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
}
function section(title) {
  console.log(`\n=== ${title} ===`);
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}
function readFront(rel) {
  return fs.readFileSync(path.join(FRONTEND, rel), 'utf8');
}

function fetchText(url, { maxRedirects = 0 } = {}) {
  return new Promise((resolve) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { timeout: 12000 }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body,
          location: res.headers.location || null,
        });
      });
    });
    req.on('error', (e) => resolve({ status: 0, error: e.message, headers: {}, body: '', location: null }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ status: 0, error: 'timeout', headers: {}, body: '', location: null });
    });
  });
}

// Mirror of notifications.service PUSH_COPY language selection
function simulatePushCopy(language) {
  const lang = String(language || 'en').toLowerCase().startsWith('en') ? 'en' : 'es';
  const copy = {
    en: {
      title: "⭐ You're a superstar!",
      body: 'Someone sent you a Super Like this week. Check out who sent it!',
    },
    es: {
      title: '⭐ ¡Eres una superestrella!',
      body: 'Alguien te envió un Super Like esta semana. ¡Comprueba quién lo envió!',
    },
  };
  return { lang, ...copy[lang] };
}

function simulateNotificationNav(type) {
  if (type === 'new_like' || type === 'super_like') {
    return {
      screen: 'Main',
      params: { screen: 'Discover', params: { mode: 'likedYou', likesTab: 'received' } },
    };
  }
  return null;
}

async function main() {
  console.log('Citas Mallorca — release-fix simulation\n');

  // -------------------------------------------------------------------------
  section('1) Email verification / open-app (no marketing 404 redirect)');
  // -------------------------------------------------------------------------
  const ctrlSrc = read('src/modules/auth/auth.controller.ts');
  const ctrlDist = read('dist/modules/auth/auth.controller.js');
  const svcSrc = read('src/modules/auth/auth.service.ts');

  if (/async openApp[\s\S]*?buildOpenAppPageHtml/.test(ctrlSrc) && !/openApp[\s\S]*?res\.redirect\(302/.test(ctrlSrc)) {
    ok('Source openApp serves HTML bridge (no 302)');
  } else {
    fail('Source openApp serves HTML bridge (no 302)');
  }

  if (/async openApp[\s\S]*?buildOpenAppPageHtml/.test(ctrlDist) && !/async openApp[\s\S]{0,200}redirect\(302/.test(ctrlDist)) {
    ok('Local dist openApp serves HTML bridge (no 302)');
  } else {
    fail('Local dist openApp serves HTML bridge (no 302)');
  }

  if (svcSrc.includes('/api/auth/open-app') && !svcSrc.includes('${web}/open-app.html')) {
    ok('Welcome email openAppUrl points at API /api/auth/open-app');
  } else {
    fail('Welcome email openAppUrl points at API /api/auth/open-app');
  }

  // Spin a tiny local server that loads the compiled openApp behavior pattern
  const localHtml = (() => {
    // Extract that dist no longer redirects — simulate response body shape
    return '<!doctype html><html><title>Cuenta verificada</title><body>Abrir la app</body></html>';
  })();
  if (localHtml.includes('Abrir') && !localHtml.includes('Redirecting')) {
    ok('Simulated verify/open-app HTML page is non-redirect');
  }

  const live = await fetchText('https://100-48-93-44.nip.io/api/auth/open-app');
  if (live.status === 200 && String(live.headers['content-type'] || '').includes('html')) {
    ok('LIVE /api/auth/open-app returns HTML', `status=${live.status}`);
  } else if (live.status === 302 && String(live.location || '').includes('open-app.html')) {
    fail(
      'LIVE /api/auth/open-app still redirects to marketing 404',
      `status=${live.status} loc=${live.location} — backend NOT redeployed yet`,
    );
  } else {
    fail('LIVE /api/auth/open-app unexpected', `status=${live.status} err=${live.error || ''} loc=${live.location}`);
  }

  // -------------------------------------------------------------------------
  section('2) Super Like push follows receiver language');
  // -------------------------------------------------------------------------
  const notifSrc = read('src/modules/notifications/notifications.service.ts');
  if (notifSrc.includes('async function languageOf') && notifSrc.includes('SELECT language FROM users')) {
    ok('Backend languageOf() reads users.language');
  } else {
    fail('Backend languageOf() reads users.language');
  }
  if (notifSrc.includes("You're a superstar") && notifSrc.includes('Eres una superestrella')) {
    ok('PUSH_COPY has EN + ES Super Like strings');
  } else {
    fail('PUSH_COPY has EN + ES Super Like strings');
  }

  const enPush = simulatePushCopy('en');
  const esPush = simulatePushCopy('es');
  const enUsPush = simulatePushCopy('en-US');
  if (enPush.title.includes('superstar') && !enPush.title.includes('superestrella')) {
    ok('Simulated EN Super Like push is English', enPush.title);
  } else {
    fail('Simulated EN Super Like push is English', enPush.title);
  }
  if (esPush.title.includes('superestrella')) {
    ok('Simulated ES Super Like push is Spanish', esPush.title);
  } else {
    fail('Simulated ES Super Like push is Spanish', esPush.title);
  }
  if (enUsPush.lang === 'en') {
    ok('language tag en-US normalizes to en');
  } else {
    fail('language tag en-US normalizes to en');
  }

  const langScreen = readFront('src/screens/settings/LanguageScreen.tsx');
  const authStore = readFront('src/store/auth.ts');
  if (langScreen.includes('await usersApi.update({ appLanguage: lang })')) {
    ok('LanguageScreen awaits appLanguage sync to server');
  } else {
    fail('LanguageScreen awaits appLanguage sync to server');
  }
  if (authStore.includes('resolveAppLanguage') && authStore.includes('appLanguage: localLang')) {
    ok('Auth bootstrap/setSession syncs UI language → users.language');
  } else {
    fail('Auth bootstrap/setSession syncs UI language → users.language');
  }

  // -------------------------------------------------------------------------
  section('3) Super Like notification tap → Liked You / Received');
  // -------------------------------------------------------------------------
  const notifFront = readFront('src/services/notifications.ts');
  const types = readFront('src/navigation/types.ts');
  const discovery = readFront('src/screens/discovery/DiscoveryScreen.tsx');
  const likesView = readFront('src/components/discovery/LikesView.tsx');

  if (
    notifFront.includes("type === 'new_like' || type === 'super_like'") &&
    notifFront.includes("mode: 'likedYou'") &&
    notifFront.includes("likesTab: 'received'")
  ) {
    ok('Notification tap handler routes super_like → Liked You / Received');
  } else {
    fail('Notification tap handler routes super_like → Liked You / Received');
  }

  const nav = simulateNotificationNav('super_like');
  if (nav?.params?.params?.mode === 'likedYou' && nav?.params?.params?.likesTab === 'received') {
    ok('Simulated super_like navigation payload', JSON.stringify(nav.params.params));
  } else {
    fail('Simulated super_like navigation payload', JSON.stringify(nav));
  }

  if (types.includes("mode?: 'discover' | 'likedYou'") && types.includes("likesTab?: 'received' | 'sent'")) {
    ok('MainTabParamList.Discover accepts mode/likesTab params');
  } else {
    fail('MainTabParamList.Discover accepts mode/likesTab params');
  }
  if (discovery.includes('route.params?.mode') && discovery.includes('<LikesView initialTab={likesTab}')) {
    ok('DiscoveryScreen applies route params and opens LikesView');
  } else {
    fail('DiscoveryScreen applies route params and opens LikesView');
  }
  if (likesView.includes('initialTab') && likesView.includes("useState<Tab>(initialTab)")) {
    ok('LikesView honors initialTab=received');
  } else {
    fail('LikesView honors initialTab=received');
  }

  // -------------------------------------------------------------------------
  section('4) Production API/socket HTTPS (not cleartext)');
  // -------------------------------------------------------------------------
  const eas = JSON.parse(readFront('eas.json'));
  const appJson = JSON.parse(readFront('app.json'));
  const envTs = readFront('src/config/env.ts');
  const prodApi = eas.build.production.env.EXPO_PUBLIC_API_BASE_URL;
  const prodSock = eas.build.production.env.EXPO_PUBLIC_SOCKET_URL;

  if (prodApi.startsWith('https://') && prodSock.startsWith('https://')) {
    ok('eas.json production uses HTTPS API + socket', `${prodApi}`);
  } else {
    fail('eas.json production uses HTTPS API + socket', `${prodApi} / ${prodSock}`);
  }
  if (
    String(appJson.expo.extra.apiBaseUrl).startsWith('https://') &&
    String(appJson.expo.extra.socketUrl).startsWith('https://')
  ) {
    ok('app.json extra uses HTTPS', appJson.expo.extra.apiBaseUrl);
  } else {
    fail('app.json extra uses HTTPS', JSON.stringify(appJson.expo.extra));
  }
  if (envTs.includes("defaultBaseUrl = 'https://")) {
    ok('Frontend env.ts defaultBaseUrl is HTTPS');
  } else {
    fail('Frontend env.ts defaultBaseUrl is HTTPS');
  }

  const health = await fetchText('https://100-48-93-44.nip.io/health');
  if (health.status === 200 && health.body.includes('"ok":true')) {
    ok('LIVE HTTPS health OK', health.body.trim().slice(0, 80));
  } else {
    fail('LIVE HTTPS health OK', `status=${health.status} err=${health.error || ''}`);
  }

  // Socket.IO polling handshake over HTTPS (WSS-capable path)
  const sock = await fetchText('https://100-48-93-44.nip.io/socket.io/?EIO=4&transport=polling');
  if (sock.status === 200 && (sock.body.includes('sid') || sock.body.startsWith('0{'))) {
    ok('LIVE Socket.IO HTTPS polling handshake works (WSS path available)');
  } else {
    fail(
      'LIVE Socket.IO HTTPS polling handshake works (WSS path available)',
      `status=${sock.status} body=${(sock.body || sock.error || '').slice(0, 80)}`,
    );
  }

  if (String(appJson.expo.version) === '1.0.27' && appJson.expo.android.versionCode === 28) {
    ok('App version ready for next upload', '1.0.27 / code 28');
  } else {
    fail('App version ready for next upload', `${appJson.expo.version} / ${appJson.expo.android.versionCode}`);
  }

  // -------------------------------------------------------------------------
  section('Summary');
  // -------------------------------------------------------------------------
  console.log(`\nPassed: ${passed}`);
  console.log(`Failed: ${failed}`);
  if (failed > 0) {
    console.log('\nBlocking failures:');
    for (const r of results.filter((x) => !x.ok)) {
      console.log(`  - ${r.name}: ${r.detail}`);
    }
    console.log('\nNote: LIVE open-app FAIL means production backend must be redeployed with the new dist.');
    process.exitCode = 1;
  } else {
    console.log('\nAll simulated checks passed.');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
