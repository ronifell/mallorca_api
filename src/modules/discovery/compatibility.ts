/**
 * Reciprocal compatibility utilities.
 *
 * Compatibility rules (see description.md "Core Business Logic"):
 *
 *   me.interestedIn must include other.gender
 *   AND
 *   other.interestedIn must include me.gender
 *
 * 'both' means both 'men' and 'women' are accepted.
 */

export type Gender = 'male' | 'female';
export type InterestedIn = 'men' | 'women' | 'both';

export function genderMatchesInterest(gender: Gender, interest: InterestedIn): boolean {
  if (interest === 'both') return true;
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
 * SQL fragment producing the set of "other.gender" values that are accepted by
 * my interestedIn value. Used inline in discovery queries.
 */
export function acceptedGendersFor(interest: InterestedIn): Gender[] {
  if (interest === 'both') return ['male', 'female'];
  return interest === 'men' ? ['male'] : ['female'];
}

/**
 * SQL fragment producing the set of "me.interestedIn" values that would accept
 * a given gender. (used when filtering the other side of compatibility).
 */
export function interestsAcceptingGender(gender: Gender): InterestedIn[] {
  return gender === 'male' ? ['men', 'both'] : ['women', 'both'];
}
