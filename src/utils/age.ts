/**
 * Compute age in full years from a birth date.
 * Age is always derived from birth_date; it is never stored or accepted as input.
 */
export function calculateAge(birthDate: Date | string, today: Date = new Date()): number {
  const d = typeof birthDate === 'string' ? new Date(birthDate) : birthDate;
  if (Number.isNaN(d.getTime())) return 0;

  let age = today.getFullYear() - d.getFullYear();
  const m = today.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < d.getDate())) {
    age -= 1;
  }
  return age;
}

export const MIN_AGE = 18;

export function isAdult(birthDate: Date | string): boolean {
  return calculateAge(birthDate) >= MIN_AGE;
}
