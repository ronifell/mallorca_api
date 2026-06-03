/**
 * Inserts demo discovery profiles for local development.
 * Safe to re-run: removes previous @seed.citasmallorca.local users first.
 *
 * Usage: npm run seed:discovery
 */
import { pool } from '../config/database';
import { hashPassword } from '../utils/password';
import { logger } from '../utils/logger';

const SEED_EMAIL_DOMAIN = '@seed.citasmallorca.local';
const SEED_PASSWORD = 'DemoSeed1!';

interface SeedProfile {
  email: string;
  firstName: string;
  gender: 'male' | 'female';
  interestedIn: 'men' | 'women' | 'both';
  birthDate: string;
  city: string;
  bio: string;
  languages: string[];
  photoSeed: string;
}

const PROFILES: SeedProfile[] = [
  {
    email: `sofia.martinez${SEED_EMAIL_DOMAIN}`,
    firstName: 'Sofia',
    gender: 'female',
    interestedIn: 'both',
    birthDate: '1996-03-14',
    city: 'Palma',
    bio: 'Coffee, coast walks, and good conversation.',
    languages: ['es', 'en'],
    photoSeed: 'sofia',
  },
  {
    email: `lucia.ferrer${SEED_EMAIL_DOMAIN}`,
    firstName: 'Lucía',
    gender: 'female',
    interestedIn: 'men',
    birthDate: '1994-07-22',
    city: 'Alcúdia',
    bio: 'Yoga at sunrise, tapas at sunset.',
    languages: ['es', 'ca'],
    photoSeed: 'lucia',
  },
  {
    email: `emma.walsh${SEED_EMAIL_DOMAIN}`,
    firstName: 'Emma',
    gender: 'female',
    interestedIn: 'both',
    birthDate: '1998-11-05',
    city: 'Sóller',
    bio: 'New to the island — show me your favourite beach.',
    languages: ['en'],
    photoSeed: 'emma',
  },
  {
    email: `marco.rossi${SEED_EMAIL_DOMAIN}`,
    firstName: 'Marco',
    gender: 'male',
    interestedIn: 'women',
    birthDate: '1993-01-18',
    city: 'Palma',
    bio: 'Cycling, sailing, and weekend markets.',
    languages: ['it', 'en', 'es'],
    photoSeed: 'marco',
  },
  {
    email: `david.chen${SEED_EMAIL_DOMAIN}`,
    firstName: 'David',
    gender: 'male',
    interestedIn: 'both',
    birthDate: '1995-09-30',
    city: 'Magaluf',
    bio: 'Remote dev who traded the city for the sea.',
    languages: ['en'],
    photoSeed: 'david',
  },
  {
    email: `pau.vidal${SEED_EMAIL_DOMAIN}`,
    firstName: 'Pau',
    gender: 'male',
    interestedIn: 'both',
    birthDate: '1997-05-12',
    city: 'Manacor',
    bio: 'Music, hiking, and finding the quiet calas.',
    languages: ['ca', 'es'],
    photoSeed: 'pau',
  },
];

async function removePreviousSeedUsers(): Promise<void> {
  const r = await pool.query<{ id: string }>(
    `SELECT id FROM users WHERE email LIKE $1`,
    [`%${SEED_EMAIL_DOMAIN}`],
  );
  if (!r.rowCount) return;
  const ids = r.rows.map((row) => row.id);
  await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [ids]);
  logger.info('Removed previous seed users', { count: ids.length });
}

async function insertProfile(profile: SeedProfile, passwordHash: string): Promise<void> {
  const photoUrl = `https://picsum.photos/seed/${profile.photoSeed}/600/800`;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const userR = await client.query<{ id: string }>(
      `INSERT INTO users (
         email, password_hash, first_name, birth_date, gender, city, bio,
         status, language, last_active_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', 'en', NOW())
       RETURNING id`,
      [
        profile.email.toLowerCase(),
        passwordHash,
        profile.firstName,
        profile.birthDate,
        profile.gender,
        profile.city,
        profile.bio,
      ],
    );
    const userId = userR.rows[0].id;

    await client.query(
      `INSERT INTO user_preferences (user_id, interested_in, min_age, max_age)
       VALUES ($1, $2, 18, 99)`,
      [userId, profile.interestedIn],
    );

    await client.query(
      `INSERT INTO notification_settings (user_id) VALUES ($1)
       ON CONFLICT (user_id) DO NOTHING`,
      [userId],
    );

    for (const lang of profile.languages) {
      await client.query(
        'INSERT INTO user_languages (user_id, language) VALUES ($1, $2)',
        [userId, lang],
      );
    }

    await client.query(
      `INSERT INTO photos (user_id, image_url, order_index) VALUES ($1, $2, 0)`,
      [userId, photoUrl],
    );

    await client.query('COMMIT');
    logger.info('Seeded profile', { email: profile.email });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function main() {
  const passwordHash = await hashPassword(SEED_PASSWORD);
  await removePreviousSeedUsers();

  for (const profile of PROFILES) {
    await insertProfile(profile, passwordHash);
  }

  logger.info('Discovery seed complete', {
    count: PROFILES.length,
    hint: 'Pull to refresh Discover or tap Retry',
  });
}

main()
  .then(() => pool.end())
  .catch((err) => {
    logger.error('Discovery seed failed', {
      err: err instanceof Error ? err.message : String(err),
    });
    pool.end().finally(() => process.exit(1));
  });
