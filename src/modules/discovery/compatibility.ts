/**
 * Reciprocal compatibility utilities.
 *
 * Compatibility rules (see description.md "Core Business Logic"):
 *
 *   me.interestedIn must include other.gender
 *   AND
 *   other.interestedIn must include me.gender
 *
 * Genders supported (DB enum `gender_t`):
 *   - 'male' / 'female'                (binary, used by the gendered filters)
 *   - 'non_binary' | 'gender_fluid' | 'other' | 'prefer_not_to_say'
 *     (treated as "non-binary" for matching: only show to viewers whose
 *      `interestedIn` is `'both'` / "Everyone").
 *
 * Interests (DB enum `interested_in_t`):
 *   - 'men' | 'women' | 'both'
 *     'both' is mapped from "Everyone" or any multi-select that covers
 *     more than one bucket.
 */

export type Gender =
  | 'male'
  | 'female'
  | 'non_binary'
  | 'gender_fluid'
  | 'other'
  | 'prefer_not_to_say';

export type BinaryGender = 'male' | 'female';
export type InterestedIn = 'men' | 'women' | 'both';

export const NON_BINARY_GENDERS: Gender[] = [
  'non_binary',
  'gender_fluid',
  'other',
  'prefer_not_to_say',
];

export function isBinaryGender(g: Gender): g is BinaryGender {
  return g === 'male' || g === 'female';
}

export function genderMatchesInterest(gender: Gender, interest: InterestedIn): boolean {
  if (interest === 'both') return true;
  if (!isBinaryGender(gender)) {
    // Non-binary / gender-fluid / other / prefer-not-to-say users only
    // surface to viewers who selected "Everyone".
    return false;
  }
  if (interest === 'men' && gender === 'male') return true;
  if (interest === 'women' && gender === 'female') return true;
  return false;
}

export function isMutuallyCompatible(
  me: { gender: Gender; interestedIn: InterestedIn },
  other: { gender: Gender; interestedIn: InterestedIn },
): boolean {
  return (
    genderMatchesInterest(other.gender, me.interestedIn) &&
    genderMatchesInterest(me.gender, other.interestedIn)
  );
}

/**
 * Set of "other.gender" values accepted by my interestedIn value. Used
 * directly inside the discovery SQL as `u.gender = ANY($2::gender_t[])`.
 */
export function acceptedGendersFor(interest: InterestedIn): Gender[] {
  if (interest === 'both') {
    // "Everyone" -> all known genders, including non-binary ones.
    return ['male', 'female', ...NON_BINARY_GENDERS];
  }
  return interest === 'men' ? ['male'] : ['female'];
}

/**
 * Set of "me.interestedIn" values that would accept a given gender. Used to
 * filter the OTHER side of the reciprocity check.
 */
export function interestsAcceptingGender(gender: Gender): InterestedIn[] {
  if (!isBinaryGender(gender)) {
    // Non-binary users are only accepted by people who selected "Everyone".
    return ['both'];
  }
  return gender === 'male' ? ['men', 'both'] : ['women', 'both'];
}
