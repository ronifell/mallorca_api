/**
 * Rules-based content filter for all user-authored text (chat messages, profile
 * fields, etc.). It is intentionally dependency-free and deterministic so it can
 * run inline on every write with no external API calls, latency, or cost.
 *
 * Detection is heuristic. The word lists and patterns below are meant to be
 * extended over time; tune them rather than relying on them being exhaustive.
 * For nuanced harassment/threat detection you can later layer an ML moderation
 * service (e.g. OpenAI Moderation) on top of these rules — the rules stay as the
 * cheap first line of defence for links / phones / handles / obvious abuse.
 */

export type ContentCategory =
  | 'link'
  | 'phone'
  | 'social'
  | 'spam'
  | 'sexual'
  | 'aggressive'
  | 'illegal';

/**
 * Where the text comes from. Profile fields are public and shown to strangers,
 * so they are held to a stricter standard than 1:1 chat between matched users.
 */
export type FilterContext = 'chat' | 'profile';

export interface FilterResult {
  blocked: boolean;
  category?: ContentCategory;
  /** The substring that triggered the block (useful for logging / debugging). */
  match?: string;
}

/** Lower-case + strip diacritics so "tú"/"TU" and "café" normalise consistently. */
function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function wordList(terms: string[]): RegExp {
  // Escape regex metacharacters, allow flexible internal whitespace for phrases.
  const escaped = terms
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'));
  // \b word boundaries on fold()ed ASCII-normalised input (Hermes-safe on the client mirror).
  return new RegExp(`\\b(${escaped.join('|')})\\b`, 'i');
}

// --- Links / URLs -----------------------------------------------------------
const URL_RE = /\b(?:https?:\/\/|www\.)\S+/i;
const TLD =
  '(?:com|net|org|io|me|es|co|info|biz|app|link|gg|tv|xyz|online|site|club|live|cc|to|ly|be|ru|de|fr|it|uk|nl|pt|eu|shop|store|page|dev)';
const DOMAIN_RE = new RegExp(`\\b[a-z0-9][a-z0-9-]{1,}\\.${TLD}\\b(?:\\/\\S*)?`, 'i');
// Obfuscated domains: "example dot com", "example (.) com", "example punto com".
const OBFUSCATED_DOMAIN_RE = new RegExp(
  `\\b[a-z0-9-]{2,}\\s*[\\[(]?\\s*(?:\\.|dot|punto)\\s*[\\])]?\\s*${TLD}\\b`,
  'i',
);

// --- Social handles / off-platform contact ----------------------------------
const HANDLE_RE = /(?:^|[^\w@/])@[a-z0-9._]{2,30}\b/i;
const SOCIAL_PLATFORM_RE = wordList([
  'instagram',
  'insta',
  'whatsapp',
  'whatsap',
  'whats app',
  'wasap',
  'wsp',
  'telegram',
  'snapchat',
  'snap chat',
  'tiktok',
  'tik tok',
  'facebook',
  'messenger',
  'onlyfans',
  'only fans',
  'twitter',
  'kik',
  'viber',
  'discord',
]);

// --- Phone numbers ----------------------------------------------------------
// Candidate runs of digits/separators; verified by digit count afterwards.
const PHONE_CANDIDATE_RE = /\+?\d(?:[\d\s().-]{5,}\d)/g;

// --- Spam -------------------------------------------------------------------
const REPEATED_CHAR_RE = /(.)\1{7,}/;
const REPEATED_WORD_RE = /\b([a-z]{2,})\b(?:\s+\1\b){3,}/i;
const SPAM_PHRASE_RE = wordList([
  'free money',
  'make money fast',
  'work from home',
  'click here',
  'buy followers',
  'crypto investment',
  'forex trading',
  'online casino',
  'casino bonus',
  'viagra',
  'gana dinero',
  'dinero facil',
  'dinero rapido',
  'gana desde casa',
  'haz clic aqui',
  'inversion garantizada',
  'criptomonedas gratis',
]);

// --- Sexual / explicit ------------------------------------------------------
const SEXUAL_RE = wordList([
  // English
  'porn',
  'porno',
  'pornhub',
  'xxx',
  'nudes',
  'nude pics',
  'send nudes',
  'sexting',
  'horny',
  'blowjob',
  'cumshot',
  'handjob',
  'masturbate',
  'masturbation',
  'dick pic',
  'cock',
  'pussy',
  'creampie',
  'anal',
  'escort',
  'escorts',
  'hookup for sex',
  // Spanish
  'pornografia',
  'desnudos',
  'fotos desnuda',
  'fotos desnudo',
  'mandame desnudos',
  'caliente',
  'mamada',
  'paja',
  'polla',
  'verga',
  'coño',
  'cono',
  'follar',
  'sexo gratis',
  'putas',
  'puta',
]);

// --- Aggressive / harassment ------------------------------------------------
const AGGRESSIVE_RE = wordList([
  // English threats / slurs (kept curated; extend as needed)
  'kill yourself',
  'kys',
  'i will kill you',
  'i will find you',
  'i will hurt you',
  'rape you',
  'fuck you',
  'fuck off',
  'son of a bitch',
  'bitch',
  'whore',
  'slut',
  'retard',
  'faggot',
  'nigger',
  // Spanish
  'te voy a matar',
  'te voy a encontrar',
  'te voy a hacer dano',
  'matate',
  'puta de mierda',
  'maricon',
  'zorra',
  'hijo de puta',
  'vete a la mierda',
  'cabron',
  'imbecil',
  'idiota de mierda',
]);

// --- Illegal ----------------------------------------------------------------
const ILLEGAL_RE = wordList([
  // Drug sales
  'buy cocaine',
  'sell cocaine',
  'buy weed',
  'sell drugs',
  'buy mdma',
  'buy meth',
  'cocaine for sale',
  'vendo droga',
  'vendo cocaina',
  'vendo marihuana',
  'venta de droga',
  // Weapons
  'buy a gun',
  'guns for sale',
  'vendo armas',
  // Minors / CSAM indicators (any sexual reference to minors is blocked outright)
  'child porn',
  'cp pics',
  'underage',
  'menor de edad sexo',
  'pornografia infantil',
  'preteen',
  'lolita',
]);

function hasLink(folded: string, raw: string): boolean {
  return URL_RE.test(raw) || DOMAIN_RE.test(folded) || OBFUSCATED_DOMAIN_RE.test(folded);
}

function hasPhone(raw: string): boolean {
  PHONE_CANDIDATE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PHONE_CANDIDATE_RE.exec(raw)) !== null) {
    const digits = m[0].replace(/\D/g, '');
    // 7–15 digits covers local numbers up to full E.164 length.
    if (digits.length >= 7 && digits.length <= 15) return true;
  }
  return false;
}

function hasSocial(folded: string, raw: string, context: FilterContext): boolean {
  if (HANDLE_RE.test(raw)) return true;
  if (SOCIAL_PLATFORM_RE.test(folded)) {
    // Mentioning a platform anywhere is treated as an attempt to move
    // off-platform; this is the behaviour we want for both profile and chat.
    return true;
  }
  // `context` reserved for future stricter/looser tuning per surface.
  void context;
  return false;
}

function isCapsFlood(raw: string): boolean {
  const letters = raw.replace(/[^a-zA-Z]/g, '');
  if (letters.length < 15) return false;
  const upper = letters.replace(/[^A-Z]/g, '').length;
  return upper / letters.length >= 0.8;
}

function hasSpam(folded: string, raw: string): boolean {
  return (
    REPEATED_CHAR_RE.test(raw) ||
    REPEATED_WORD_RE.test(folded) ||
    SPAM_PHRASE_RE.test(folded) ||
    isCapsFlood(raw)
  );
}

/**
 * Inspect a piece of text and return the first violation found, if any.
 * Order is chosen so the most serious / most actionable category wins.
 */
export function inspectContent(raw: string, context: FilterContext = 'chat'): FilterResult {
  if (!raw || !raw.trim()) return { blocked: false };
  const folded = fold(raw);

  const illegal = folded.match(ILLEGAL_RE);
  if (illegal) return { blocked: true, category: 'illegal', match: illegal[1] };

  const sexual = folded.match(SEXUAL_RE);
  if (sexual) return { blocked: true, category: 'sexual', match: sexual[1] };

  const aggressive = folded.match(AGGRESSIVE_RE);
  if (aggressive) return { blocked: true, category: 'aggressive', match: aggressive[1] };

  if (hasLink(folded, raw)) return { blocked: true, category: 'link' };
  if (hasPhone(raw)) return { blocked: true, category: 'phone' };
  if (hasSocial(folded, raw, context)) return { blocked: true, category: 'social' };
  if (hasSpam(folded, raw)) return { blocked: true, category: 'spam' };

  return { blocked: false };
}

const CATEGORY_MESSAGES: Record<ContentCategory, string> = {
  link: 'Links and website addresses are not allowed.',
  phone: 'Sharing phone numbers is not allowed.',
  social: 'Sharing social media accounts or external contact details is not allowed.',
  spam: 'This message looks like spam.',
  sexual: 'Sexual or explicit content is not allowed.',
  aggressive: 'Aggressive, hateful or harassing language is not allowed.',
  illegal: 'This content is not allowed.',
};

export function categoryMessage(category: ContentCategory): string {
  return CATEGORY_MESSAGES[category];
}
