import bcrypt from 'bcrypt';

const ROUNDS = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/**
 * Strong password policy: 8+ chars, at least one upper, one lower, one digit.
 * Symbols recommended but not required to keep onboarding friction low.
 */
export function isStrongPassword(p: string): boolean {
  if (p.length < 8 || p.length > 128) return false;
  if (!/[a-z]/.test(p)) return false;
  if (!/[A-Z]/.test(p)) return false;
  if (!/\d/.test(p)) return false;
  return true;
}
