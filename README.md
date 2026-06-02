# Mallorca Dating – Backend

Node.js + Express + TypeScript REST/Realtime API for the Mallorca dating & networking mobile app.

## Stack

- **Runtime**: Node.js ≥ 18
- **Framework**: Express 4
- **DB**: PostgreSQL 14+
- **Realtime**: Socket.io 4
- **Auth**: JWT (access + refresh, rotated on each refresh)
- **Storage**: AWS S3 / Cloudflare R2 (S3-compatible)
- **Push**: Firebase Cloud Messaging
- **Payments**: Google Play (architecture ready for App Store)
- **Validation**: Zod

## Project layout

```
src/
  app.ts                – Express app factory (middleware + routes)
  index.ts              – HTTP + Socket.io entry point
  config/               – env + database pool
  middleware/           – auth, validation, rate limit, error handler
  modules/
    auth/               – register/login/refresh/forgot/reset
    users/              – profile, photos, GDPR export/delete, FCM, notification settings
    discovery/          – reciprocal-compat feed + swipes
    matches/            – match list, unmatch
    chat/               – conversations, messages, images, read receipts
    subscriptions/      – plan listing, Google Play validation, premium status
    moderation/         – block, report, admin endpoints
    notifications/      – FCM push (matches, messages, expiry)
  sockets/io.ts         – Socket.io: rooms, typing, read receipts
  services/             – mailer, S3 storage abstraction
  utils/                – jwt, password, age, errors, logger, asyncHandler
  db/migrations/        – SQL migrations
  db/migrate.ts         – migration runner
```

## Setup

```bash
cd Backend
cp .env.example .env       # then edit secrets
npm install
npm run migrate            # creates schema in DATABASE_URL
npm run dev                # http://localhost:4000
```

`npm run build && npm start` for production.

### Database

Requires PostgreSQL with the `pgcrypto` and `citext` extensions. The migration
script enables them automatically.

### Storage (photos & chat images)

Configure AWS S3 / Cloudflare R2 via the `S3_*` env vars. If credentials are
not set, photos and chat images are written to local `uploads/` and served
under `/uploads` — useful for development without a cloud bucket.

### Push notifications

Set `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` (the
service-account credentials). If unset, notifications are silently skipped.

### Google Play purchase validation

Place the service-account JSON in `GOOGLE_SERVICE_ACCOUNT_JSON`. In dev (no
credentials), the validator grants a 30/365-day Premium grant per plan to make
end-to-end testing of the gated chat possible.

## Core API surface

| Method | Path                                                | Auth     | Purpose                                  |
| ------ | --------------------------------------------------- | -------- | ---------------------------------------- |
| POST   | `/api/auth/register`                                | public   | Create account (GDPR consent required)   |
| POST   | `/api/auth/login`                                   | public   | Login → access + refresh                 |
| POST   | `/api/auth/refresh`                                 | public   | Rotate tokens                            |
| POST   | `/api/auth/logout`                                  | public   | Revoke refresh token                     |
| POST   | `/api/auth/forgot-password`                         | public   | Send reset email                         |
| POST   | `/api/auth/reset-password`                          | public   | Consume reset token                      |
| GET    | `/api/users/me`                                     | auth     | My profile                               |
| PATCH  | `/api/users/me`                                     | auth     | Update profile (name, prefs, languages…) |
| DELETE | `/api/users/me`                                     | auth     | GDPR account deletion                    |
| GET    | `/api/users/me/export`                              | auth     | GDPR data export                         |
| POST   | `/api/users/me/photos`                              | auth     | Upload one photo (multipart `photo`)     |
| DELETE | `/api/users/me/photos/:id`                          | auth     | Delete photo                             |
| PATCH  | `/api/users/me/photos/order`                        | auth     | Reorder photos                           |
| PUT    | `/api/users/me/fcm-token`                           | auth     | Register device for pushes               |
| PATCH  | `/api/users/me/notification-settings`               | auth     | Toggle notification preferences          |
| GET    | `/api/discovery/feed?limit=20`                      | auth     | Reciprocal-compatible swipe deck         |
| POST   | `/api/discovery/like/:id`                           | auth     | Like (returns `{matched, matchId?}`)     |
| POST   | `/api/discovery/pass/:id`                           | auth     | Pass                                     |
| GET    | `/api/matches`                                      | auth     | All matches w/ last message              |
| DELETE | `/api/matches/:id`                                  | auth     | Unmatch                                  |
| POST   | `/api/chat/matches/:matchId/conversation`           | auth     | Ensure conversation exists               |
| GET    | `/api/chat/conversations/:id/messages`              | auth     | Paginated message history                |
| POST   | `/api/chat/conversations/:id/messages`              | auth*    | Send message (*premium for first msg)    |
| POST   | `/api/chat/conversations/:id/images`                | auth     | Upload chat image (returns `{url}`)      |
| POST   | `/api/chat/conversations/:id/read`                  | auth     | Mark conversation as read                |
| GET    | `/api/subscriptions/plans`                          | public   | Plan catalog                             |
| GET    | `/api/subscriptions/status`                         | auth     | My premium status                        |
| POST   | `/api/subscriptions/validate`                       | auth     | Validate a Play purchase token           |
| GET    | `/api/moderation/blocks`                            | auth     | List blocked users                       |
| POST   | `/api/moderation/blocks/:id`                        | auth     | Block user                               |
| DELETE | `/api/moderation/blocks/:id`                        | auth     | Unblock user                             |
| POST   | `/api/moderation/reports/:id`                       | auth     | Report user                              |
| GET    | `/api/admin/reports`                                | admin    | All reports                              |
| POST   | `/api/admin/reports/:id/resolve`                    | admin    | Mark report resolved                     |
| POST   | `/api/admin/users/:id/{suspend\|ban\|reinstate}`    | admin    | User moderation                          |

`auth` = `Authorization: Bearer <access token>`.

## Socket.io events (after JWT handshake)

Client connects with `io(url, { auth: { token } })`.

- `conversation:join` `(conversationId)` – join room & mark delivered
- `conversation:leave` `(conversationId)`
- `typing` `({conversationId, typing})` – broadcasts `typing` to the other party
- `message:read` `({conversationId})` – marks read & broadcasts

Server-emitted:

- `message:new` – broadcast to both participants on send
- `message:read` – emitted when peer reads
- `typing` – peer typing indicator

## Reciprocal matching (the core business rule)

A user only sees a candidate if **and only if**:

- `candidate.gender` is in `viewer.interestedIn` (`men`/`women`/`both`); AND
- `viewer.gender` is in `candidate.interestedIn`; AND
- both users are within each other's age range; AND
- viewer hasn't already liked/passed/matched/blocked/reported them.

`POST /api/discovery/like/:id` creates a match only if **both** conditions are
true at the moment of liking (re-checked in the same transaction so a stale
swipe cannot bypass it).

## Premium gating

Only Premium users may send the **first** message in a conversation:

```
ctx.messageCount === 0 && !sender.isPremium  =>  HTTP 403
```

After the first message exists, both users can reply freely.

## Security

- Bcrypt 12 rounds, strong password policy (8+ chars, upper/lower/digit)
- JWT access (15m) + refresh (30d, rotation + DB tracking + revocation)
- Helmet, CORS, rate limit (auth endpoints throttled to 20/15min)
- Zod input validation on every route
- All DB calls parameterised (no SQL injection surface)
- Multipart uploads capped at 8 MB, MIME whitelisted

## Deploy

The app is platform-agnostic and runs unchanged on Railway, Render,
DigitalOcean App Platform, ECS, Fly.io, or bare-metal:

```
npm install --omit=dev
npm run build
NODE_ENV=production node dist/index.js
```

`Dockerfile` example:

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
ENV NODE_ENV=production
EXPOSE 4000
CMD ["node", "dist/index.js"]
```

Set the env vars listed in `.env.example` in your platform's secrets manager,
then run `npm run migrate` once as a release step.
