# ElderCare — API Contract

**Version:** 0.5 — Phase 0 (authentication) + Phase 1 steps 1-4 (SOS button, alert record, GPS capture, notification fanout and escalation, family link invitations)
**Base URL (development):** `http://localhost:5000`

This document is the agreement between the backend and the mobile app. Every endpoint the app is allowed to call is listed here. If you add an endpoint, add it to this file in the same Pull Request. If you need an endpoint that does not exist yet, raise it in the group rather than working around it.

The authentication endpoints, the emergency alert endpoints, GPS capture, notification fanout and broadcast, family link invitations, emergency contact management, and geofencing exist today. Caregiver profile/search/booking are documented below; the rest of the caregiver module (scheduling, attendance, care plans, tasks, activity reports, reviews) exists in the code but is not yet documented here — it arrives with its own screens.

---

## Conventions

### Content type

Every request that has a body sends `Content-Type: application/json`. Every response is JSON.

### Success shape

Successful responses always carry `"status": "ok"` plus the fields documented for that endpoint.

```json
{ "status": "ok", "user": { "...": "..." } }
```

### Error shape

Failures always carry `"status": "error"`, a stable machine-readable `code`, and a human-readable `error`. The app should branch on `code`, never on the text of `error` — the wording may change, the code will not.

```json
{
  "status": "error",
  "code": "invalid_credentials",
  "error": "Phone/email or password is incorrect."
}
```

Validation failures add a `details` array so a form can highlight every bad field at once instead of one at a time:

```json
{
  "status": "error",
  "code": "validation_failed",
  "error": "One or more fields are invalid.",
  "details": [
    { "field": "phone", "message": "Phone or email is required." },
    { "field": "password", "message": "Password must be at least 8 characters." }
  ]
}
```

### Authentication

Protected endpoints expect the access token in the `Authorization` header:

```
Authorization: Bearer <accessToken>
```

Two kinds of token are issued together, and they are not interchangeable:

| Token | Lifetime | Where it goes | Can it be revoked? |
|---|---|---|---|
| `accessToken` | 15 minutes | `Authorization` header on every request | No — that is why it is short |
| `refreshToken` | 30 days | Body of `POST /auth/refresh` and `/auth/logout` only | Yes — it is stored server-side |

**The app must store both securely** (Expo `SecureStore`, not `AsyncStorage`). The refresh token is a long-lived credential; treat it like a password.

**Token expiry handling.** When any endpoint returns `401` with code `token_expired`, call `POST /auth/refresh` once and retry the original request with the new access token. Only send the user back to the login screen if the refresh itself fails.

**Rotation.** Every call to `/auth/refresh` returns a *new* refresh token and invalidates the one you sent. Always overwrite the stored token with the one you just received. Presenting a refresh token that was already exchanged is treated as theft: every session for that account is ended and the response is `401 refresh_token_reused`.

### Identity

**Phone is the login identity.** Email is optional — an account can be registered without one, and many elderly users will not have one. Login accepts either a phone number or an email address; if both are sent, phone is used.

#### Phone number format

**Stored form: E.164** — a `+`, the country code, then the national number, digits only, no spaces or punctuation. For example `+919876543210`. This is what `user.phone` contains in every response, and what the screens should display.

**Sent form: whatever the user typed.** The backend normalises the number before it looks anything up, so the app does not have to. All of these reach the same account:

| Sent | Normalised to |
|---|---|
| `9876543210` | `+919876543210` |
| `09876543210` | `+919876543210` |
| `919876543210` | `+919876543210` |
| `+919876543210` | `+919876543210` |
| `+91 98765 43210` | `+919876543210` |
| `+91-98765-43210` | `+919876543210` |
| `0091 9876543210` | `+919876543210` |

The rules, in the order they are applied:

1. Spaces, hyphens, brackets and dots are stripped.
2. A leading `00` is treated as `+`.
3. A number starting with `+` is taken at its word, whatever country it belongs to — `+14155552671` and `+442071838750` are both accepted.
4. A number with no country code is assumed to be Indian: exactly 10 digits, or 11 with the leading `0` trunk prefix, gets `+91`.
5. Twelve digits beginning `91` get a `+`.
6. Anything else is rejected with `validation_failed`.

The default country is configuration (`DEFAULT_CALLING_CODE`, `DEFAULT_NATIONAL_DIGITS`), not a constant, so serving another country later does not need a code change.

**What the registration screen should do:** show the country code as a fixed `+91` prefix beside a 10-digit field rather than leaving the user to type it. The backend accepts the other formats as a safety net for numbers pasted from a contacts list or typed by someone used to writing them differently — not as an invitation to leave the field free-form.

**Do not normalise in the app as well.** One implementation, on the server, is what keeps the two ends from ever disagreeing about which account a number belongs to.

### Roles

`elderly`, `family`, `caregiver`, `admin`. The role decides which home screen the app opens after login and which endpoints are permitted.

`admin` **cannot** be chosen at registration — attempting it returns `403 role_not_self_assignable`. Admins are promoted directly in the database.

---

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/health` | — | Server and database liveness |
| `POST` | `/auth/register` | — | Create an account |
| `POST` | `/auth/login` | — | Exchange credentials for tokens |
| `POST` | `/auth/refresh` | — | Exchange a refresh token for a new pair |
| `POST` | `/auth/logout` | — | Revoke one refresh token |
| `GET` | `/auth/me` | Bearer | The caller's own record |
| `GET` | `/auth/admin/users` | Bearer + `admin` | List users |
| `POST` | `/emergency/alerts` | Bearer | Press SOS |
| `GET` | `/emergency/alerts` | Bearer | The caller's own alerts |
| `POST` | `/emergency/alerts/:id/cancel` | Bearer | "That was a mistake" — alert owner only |
| `POST` | `/emergency/alerts/:id/resolve` | Bearer | "This is handled" — owner or a permitted family member |
| `POST` | `/emergency/alerts/:id/acknowledge` | Bearer | "I've seen this" — a permitted family member only; stops escalation, does not close the alert |
| `PATCH` | `/emergency/alerts/:id/location` | Bearer | Attach a fresh GPS fix that landed after send — alert owner only, any status |
| `GET` | `/emergency/family/alerts` | Bearer + `family` | Active alerts for elderly users the caller is linked to |
| `GET` | `/emergency/family/alerts/history` | Bearer + `family` | Resolved/cancelled alerts from the last 7 days, same linked users |
| `POST` | `/emergency/locations` | Bearer | Record one GPS reading |
| `GET` | `/emergency/locations/latest` | Bearer | Most recent reading for an elderly user |
| `POST` | `/emergency/device-tokens` | Bearer | Register this device for push notifications |
| `POST` | `/emergency/ambulance/bookings` | Bearer | Request an emergency ambulance |
| `GET` | `/emergency/ambulance/bookings/active` | Bearer | Get current active ambulance booking |
| `GET` | `/emergency/ambulance/bookings/:id` | Bearer | Get details of a specific ambulance booking |
| `GET` | `/emergency/ambulance/bookings` | Bearer | List ambulance booking history |
| `POST` | `/emergency/ambulance/bookings/:id/cancel` | Bearer | Cancel an active ambulance booking |
| `GET` | `/emergency/disaster-alerts` | Bearer | List active disaster alerts & weather warnings |
| `GET` | `/emergency/disaster-alerts/:id` | Bearer | Get details for a specific disaster alert |
| `POST` | `/emergency/alerts/fall` | Bearer | Trigger manual fall emergency alert |
| `POST` | `/family/invites` | Bearer | Invite a registered person as family — self, or an owner-level family member |
| `POST` | `/family/invites/:id/accept` | Bearer | Invitee accepts — activates the link only, nothing else |
| `POST` | `/family/invites/:id/decline` | Bearer | Invitee declines |
| `POST` | `/family/links/:id/revoke` | Bearer | Pull an active link — elderly user, the family member themselves, or an owner-level family member |
| `GET` | `/family/links` | Bearer | The caller's own links, either side, optionally filtered by status |
| `POST` | `/family/links/:id/emergency-contact` | Bearer | Deliberately promote a linked family member to emergency-contact status |
| `PATCH` | `/family/links/:id` | Bearer + elderly | Edit an active link's permission fields — e.g. step someone back down from `manage`/`owner` |
| `POST` | `/emergency/contacts` | Bearer | Add a hand-entered emergency contact |
| `GET` | `/emergency/contacts` | Bearer | The elderly user's contact list, priority order |
| `PATCH` | `/emergency/contacts/:id` | Bearer | Edit a contact, including reordering via `priority` |
| `DELETE` | `/emergency/contacts/:id` | Bearer | Soft-delete a contact |
| `POST` | `/emergency/geofences` | Bearer | Define a safe (or restricted) zone |
| `GET` | `/emergency/geofences` | Bearer | List zones for an elderly user |
| `PATCH` | `/emergency/geofences/:id` | Bearer | Edit a zone |
| `DELETE` | `/emergency/geofences/:id` | Bearer | Soft-delete a zone |
| `GET` | `/emergency/geofences/:id/history` | Bearer | Recent inside/outside tally for one zone |
| `POST` | `/caregiver/profile` | Bearer + `caregiver`/`admin` | Create or update the caller's own caregiver profile (upsert) |
| `GET` | `/caregiver/profile/me` | Bearer + `caregiver`/`admin` | The caller's own caregiver profile |
| `GET` | `/caregiver/search` | Bearer | Search verified, available caregivers |
| `GET` | `/caregiver/:id` | Bearer | One caregiver's full profile |
| `POST` | `/caregiver/bookings` | Bearer + `elderly`/`family`/`admin` | Request a caregiver |
| `GET` | `/caregiver/bookings` | Bearer | The caller's own bookings, scoped by role |
| `GET` | `/caregiver/bookings/:id` | Bearer | One booking, if the caller is entitled to see it |
| `PATCH` | `/caregiver/bookings/:id/status` | Bearer | Confirm, reject, cancel, or mark active/complete — who may make which transition is enforced server-side |

---

### `GET /health`

Liveness plus database reachability. Useful for confirming the backend is up before debugging the app.

**Response `200`**

```json
{
  "status": "ok",
  "uptimeSeconds": 42,
  "db": {
    "connected": true,
    "database": "eldercare",
    "serverVersion": "PostgreSQL 18.4",
    "latencyMs": 2
  }
}
```

**Response `503`** — the server is running but cannot reach PostgreSQL. Deliberately not `200`: a backend that cannot reach its database is not healthy.

```json
{ "status": "error", "db": { "connected": false, "error": "..." } }
```

---

### `POST /auth/register`

Creates an account and logs it in immediately — the response includes tokens, so the app does not need to call `/auth/login` afterwards.

**Request body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `phone` | string | **yes** | Any accepted format — see [Phone number format](#phone-number-format). Stored as E.164 |
| `password` | string | **yes** | At least 8 characters, at most 72 bytes |
| `fullName` | string | **yes** | 1–120 characters |
| `role` | string | **yes** | `elderly`, `family` or `caregiver` |
| `email` | string | no | Valid address, 255 characters or fewer. Omit it entirely rather than sending `""` |
| `preferredLanguage` | string | no | ISO code such as `en`, `hi`, `te`. Defaults to `en` |
| `deviceLabel` | string | no | Shown on the active-sessions screen, e.g. `"Sree's Pixel 7"` |

The 72-byte password ceiling is bcrypt's limit — beyond it the tail is silently ignored, which would let two different passwords open the same account.

```json
{
  "phone": "+919876543210",
  "password": "correct-horse-battery",
  "fullName": "Ramesh Kumar",
  "role": "elderly"
}
```

**Response `201`**

```json
{
  "status": "ok",
  "user": {
    "id": "cc7e3c0f-640b-4a56-ad9c-ea100d4ce851",
    "phone": "+919876543210",
    "email": null,
    "fullName": "Ramesh Kumar",
    "role": "elderly",
    "preferredLanguage": "en",
    "profilePhotoUrl": null,
    "isActive": true,
    "lastLoginAt": null,
    "createdAt": "2026-08-12T13:54:28.604Z"
  },
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "refreshToken": "K3Dvzwd_YqGz6bNogvxQ7G9Vw7BL0yeGK0n9BnLxhmM"
}
```

**Errors**

| Status | Code | When |
|---|---|---|
| `400` | `validation_failed` | A field is missing or malformed — see `details` |
| `403` | `role_not_self_assignable` | `role` was `admin` |
| `409` | `account_exists` | That phone number, or that email, is already registered |

---

### `POST /auth/login`

**Request body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `phone` | string | one of the two | Any accepted format — normalised the same way registration does |
| `email` | string | one of the two | Case-insensitive |
| `password` | string | **yes** | |
| `deviceLabel` | string | no | Shown on the active-sessions screen |

Send `phone` **or** `email`. If both are sent, `phone` is used and `email` is ignored.

```json
{ "phone": "+919876543210", "password": "correct-horse-battery" }
```

**Response `200`** — the same shape as `/auth/register`, with `lastLoginAt` populated.

**Errors**

| Status | Code | When |
|---|---|---|
| `400` | `validation_failed` | Neither identity sent, or the phone is malformed |
| `401` | `invalid_credentials` | No such account, or wrong password |
| `403` | `account_disabled` | The account has been deactivated |

`invalid_credentials` covers both "no such account" and "wrong password" on purpose. Distinguishing them would turn this endpoint into a way to discover which phone numbers are registered.

---

### `POST /auth/refresh`

Exchanges a refresh token for a new access token **and a new refresh token**. Replace both in storage.

**Request body**

| Field | Type | Required |
|---|---|---|
| `refreshToken` | string | **yes** |
| `deviceLabel` | string | no |

**Response `200`**

```json
{
  "status": "ok",
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "refreshToken": "8S0PnWQNTvYyBA6JPXC..."
}
```

**Errors**

| Status | Code | When | What the app should do |
|---|---|---|---|
| `400` | `validation_failed` | `refreshToken` missing | Fix the request |
| `401` | `invalid_refresh_token` | Not a token this server issued | Log the user out |
| `401` | `refresh_token_reused` | Already exchanged — all sessions ended | Log the user out and clear both tokens |
| `401` | `refresh_token_revoked` | The session ended normally | Log the user out |
| `401` | `refresh_token_expired` | Older than 30 days | Log the user out |
| `401` | `user_not_found` | The account was deleted | Log the user out |
| `403` | `account_disabled` | The account was deactivated | Show the deactivated message |

Every one of these means the same thing to the app: this session is over, return to the login screen. They are distinguished for debugging and for support, not because the app should behave differently.

---

### `POST /auth/logout`

Revokes one refresh token — the current device only. Other devices stay logged in.

**Request body**

| Field | Type | Required |
|---|---|---|
| `refreshToken` | string | **yes** |

**Response `200`**

```json
{ "status": "ok", "revoked": true }
```

`revoked` is `false` when the token was already revoked or was never valid. This endpoint returns `200` either way: logging out is not a place to tell an attacker whether the token they hold is real, and a client retrying a logout should not see it fail.

The access token is **not** revoked — it cannot be. It stops working within 15 minutes. The app must delete both tokens from storage itself.

**Errors**

| Status | Code | When |
|---|---|---|
| `400` | `validation_failed` | `refreshToken` missing |

---

### `GET /auth/me`

The caller's own record. Use it on app start to confirm a stored token is still good and to decide which home screen to open.

**Headers:** `Authorization: Bearer <accessToken>`

**Response `200`**

```json
{
  "status": "ok",
  "user": {
    "id": "cc7e3c0f-640b-4a56-ad9c-ea100d4ce851",
    "phone": "+919876543210",
    "email": null,
    "fullName": "Ramesh Kumar",
    "role": "elderly",
    "preferredLanguage": "en",
    "profilePhotoUrl": null,
    "isActive": true,
    "lastLoginAt": "2026-08-12T13:54:39.731Z",
    "createdAt": "2026-08-12T13:54:28.604Z"
  }
}
```

The user is reloaded from the database on every authenticated request, not read from the token. A deactivated account or a changed role therefore takes effect immediately rather than whenever the token happens to expire.

**Errors**

| Status | Code | When |
|---|---|---|
| `401` | `missing_token` | No `Authorization: Bearer` header |
| `401` | `invalid_token` | Signature or issuer does not check out |
| `401` | `token_expired` | Access token older than 15 minutes — call `/auth/refresh` |
| `401` | `user_not_found` | The account no longer exists |
| `403` | `account_disabled` | The account has been deactivated |

These five apply to **every** endpoint that requires a Bearer token, and are not repeated below.

---

### `GET /auth/admin/users`

The 50 most recently created users. Admin only.

**Headers:** `Authorization: Bearer <accessToken>` for a user whose role is `admin`

**Response `200`**

```json
{
  "status": "ok",
  "count": 2,
  "users": [
    {
      "id": "cc7e3c0f-640b-4a56-ad9c-ea100d4ce851",
      "fullName": "Ramesh Kumar",
      "email": null,
      "role": "elderly",
      "isActive": true,
      "createdAt": "2026-08-12T13:54:28.604Z"
    }
  ]
}
```

**Errors**

| Status | Code | When |
|---|---|---|
| `403` | `insufficient_role` | A valid token, but the user is not an admin |

---

## Emergency alerts

Phase 1, steps 1-3: the SOS button, the alert record, GPS capture, and notification fanout with escalation. Every one of these endpoints requires `Authorization: Bearer <accessToken>`; the five error codes listed under [`GET /auth/me`](#get-authme) apply here too and are not repeated below.

**What happens when an SOS fires, beyond creating the row:** the caller's `emergency_contacts` are notified in `priority` order, one contact at a time — contact 1 first, not everyone at once, so nobody assumes someone else is already handling it. If nobody acknowledges within `ESCALATION_INTERVAL_MINUTES` (default 5), the next contact is notified, then the next, until either someone acknowledges or every contact has been tried. **Alerts never auto-expire** — reaching the end of the contact list does not close the alert or stop the family dashboard from showing it; only a human `cancel` or `resolve` does that. See "Notification channels and escalation" below for how fanout actually works, and `POST /emergency/alerts/:id/acknowledge` for what stops it.

### `POST /emergency/alerts`

Presses SOS for the signed-in user. `alertType` is always `sos`, `severity` is always `critical` — this button does not ask the person pressing it to grade their own emergency.

**Request body — entirely optional**

| Field | Type | Required | Rules |
|---|---|---|---|
| `latitude` | number | no | -90 to 90. Must be sent with `longitude` |
| `longitude` | number | no | -180 to 180. Must be sent with `latitude` |
| `accuracyMeters` | number | no | Non-negative |
| `isApproximate` | boolean | no | Defaults `false`. `true` only for a cached `getLastKnownPositionAsync` reading, never a fresh fix |
| `capturedAt` | string | no | ISO 8601. When the device actually took this reading |

Captured on the device at press time and written straight onto the alert — **never a precondition.** An SOS must fire whether or not a location fix was available; the app does not wait on GPS to send this request. Omit both `latitude`/`longitude` entirely if no fix was captured in time; do not send one without the other.

**`isApproximate: true` (Phase 1 step 4) means a fresh fix hadn't landed within the app's send deadline, so a cached position was sent as a floor instead.** `capturedAt` is what makes that useful — it is when the device actually took the cached reading, which can be well before `triggeredAt`, not when the alert was created. See `PATCH /emergency/alerts/:id/location` below for how a fresh fix that lands afterward upgrades this.

**Response `201`**

```json
{
  "status": "ok",
  "alert": {
    "id": "9c0c0c9c-f8de-4f25-9c76-2662e8f9a139",
    "userId": "68e6ca9c-a980-4509-b01d-cdc4c633bf95",
    "alertType": "sos",
    "status": "active",
    "severity": "critical",
    "latitude": null,
    "longitude": null,
    "locationAccuracyMeters": null,
    "locationIsApproximate": false,
    "locationCapturedAt": null,
    "message": null,
    "triggeredAt": "2026-08-15T06:51:50.230Z",
    "acknowledgedAt": null,
    "acknowledgedBy": null,
    "resolvedAt": null,
    "resolvedBy": null,
    "resolutionNotes": null,
    "createdAt": "2026-08-15T06:51:50.230Z",
    "updatedAt": "2026-08-15T06:51:50.230Z"
  }
}
```

**Errors**

| Status | Code | When |
|---|---|---|
| `400` | `validation_failed` | `latitude`/`longitude` out of range, or only one of the pair was sent |
| `409` | `sos_already_active` | The caller already has an active SOS alert. The response carries `alert`, the existing one, in the same shape as above |

**`sos_already_active` is not a failure to show the person pressing the button.** A second press while one alert is already open almost always means the same emergency pressed twice, not a second one — the app should read this as reassurance ("help is already on the way"), never as an error screen. See `ElderlyHomeScreen.js`.

**Notifying contact 1 happens in the background, after the response is sent.** The app never waits on it — same "never a precondition" principle as GPS capture above, just applied to a slower, less reliable dependency (SMS/email/push providers) instead of the device's own GPS. If fanout fails for any reason, it is retried automatically on the next escalation sweep — see below.

---

### `GET /emergency/alerts`

The caller's own alerts, newest first.

**Query parameters**

| Field | Required | Rules |
|---|---|---|
| `status` | no | One of `active`, `acknowledged`, `resolved`, `cancelled`, `false_alarm` |
| `limit` | no | Positive whole number, capped at 50. Defaults to 20 |

**Response `200`**

```json
{ "status": "ok", "count": 1, "alerts": [ { "...": "same shape as POST /emergency/alerts" } ] }
```

**Errors**

| Status | Code | When |
|---|---|---|
| `400` | `validation_failed` | `status` is not a recognised value, or `limit` is not a positive whole number |

---

### `POST /emergency/alerts/:id/cancel`

"That was a mistake" — only the person who triggered the alert may cancel it. A family member who believes it is a false alarm uses `resolve`, not `cancel`; only the person who pressed SOS can say it was pressed by accident.

**Request body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `note` | string | no | Up to 2000 characters, stored as `resolutionNotes` |

**Response `200`** — the updated alert, `status: "cancelled"`, same shape as `POST /emergency/alerts`.

**Errors**

| Status | Code | When |
|---|---|---|
| `400` | `validation_failed` | `id` is not a UUID, or `note` fails validation |
| `403` | `not_alert_owner` | The caller did not trigger this alert |
| `404` | `alert_not_found` | No alert with that id |
| `409` | `alert_not_active` | The alert is already cancelled, resolved, acknowledged or a false alarm |

---

### `POST /emergency/alerts/:id/resolve`

"This is handled/over" — the alert's owner, or a family member with an `active` `family_links` row to that elderly user **and** `can_acknowledge_alerts: true`.

**Request body:** same as `cancel` — optional `note`.

**Response `200`** — the updated alert, `status: "resolved"`.

**Errors**

| Status | Code | When |
|---|---|---|
| `400` | `validation_failed` | `id` is not a UUID, or `note` fails validation |
| `403` | `not_permitted` | The caller neither owns the alert nor has a permitted family link to its owner |
| `404` | `alert_not_found` | No alert with that id |
| `409` | `alert_not_active` | The alert is already closed |

---

### `POST /emergency/alerts/:id/acknowledge`

"I've seen this and I'm responding" — a family member with an `active` `family_links` row to the alert's owner **and** `can_acknowledge_alerts: true`. The alert's own owner cannot acknowledge their own alert — there is no owner branch for this endpoint; a `family_links` row from someone to themselves can never exist (the schema forbids it), so the owner is excluded automatically rather than as a special case.

**Does not close the alert.** `status` stays `active`; only `acknowledged_at`/`acknowledged_by` are set. The only effect is that escalation to the next emergency contact stops — the alert still shows as active everywhere it did before, and still needs a `cancel` or `resolve` to actually end it.

No request body.

**Response `200`** — the updated alert, `acknowledgedAt`/`acknowledgedBy` populated, `status` unchanged.

**Errors**

| Status | Code | When |
|---|---|---|
| `403` | `not_permitted` | The caller isn't a permitted family member for this alert's owner (this includes the owner themselves) |
| `404` | `alert_not_found` | No alert with that id |
| `409` | `alert_not_active` | The alert is already cancelled or resolved |
| `409` | `alert_already_acknowledged` | Someone else already acknowledged it. The response carries `alert`, the current state |

**`alert_already_acknowledged` is not a failure to show the person who tapped it**, same reasoning as `sos_already_active` — a second family member acknowledging means someone else is already on it, which is reassurance, not an error.

**Reachable from the push notification itself, not only from inside the app.** The push sent for a new SOS carries an `sos-alert` notification category with an "Acknowledge" action button; tapping it calls this endpoint directly. See `frontend/src/emergency/notifications/alertNotifications.js`.

---

### `PATCH /emergency/alerts/:id/location`

Attaches a fresh GPS fix to an alert that already sent — Phase 1 step 4. The SOS button never waits past its own send deadline, but the app keeps trying for a fresh fix a while longer in the background; this is how that fix reaches an alert that already went out with `isApproximate: true` or no location at all. Only the alert's owner may call this.

**Not restricted to `status: "active"`.** A fix landing after the alert was cancelled or resolved is still attached, for the record — the family may already be looking at "no location," and a real reading arriving late is still worth having.

**Request body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `latitude` | number | **yes** | -90 to 90 |
| `longitude` | number | **yes** | -180 to 180 |
| `accuracyMeters` | number | no | Non-negative |
| `capturedAt` | string | no | ISO 8601. When the device actually took this reading |

Always a fresh fix — there is no `isApproximate` field here. The server hardcodes `locationIsApproximate` to `false` on write; this endpoint has no way to attach another cached reading.

**Response `200`** — the updated alert, `latitude`/`longitude`/`locationAccuracyMeters`/`locationCapturedAt` set from the request, `locationIsApproximate: false`, same shape as `POST /emergency/alerts` otherwise.

**Errors**

| Status | Code | When |
|---|---|---|
| `400` | `validation_failed` | `id` is not a UUID; `latitude`/`longitude` missing or out of range; `accuracyMeters` or `capturedAt` fail their own rules |
| `403` | `not_alert_owner` | The caller did not trigger this alert |
| `404` | `alert_not_found` | No alert with that id |

---

### `GET /emergency/family/alerts`

Active alerts for every elderly user the caller has an `active` `family_links` row with. Role-gated to `family`.

**Every alert for every actively-linked elderly user is included**, regardless of `can_acknowledge_alerts` — a view-only family member still needs to know an emergency is happening, they just cannot close it out. Each alert carries `canAcknowledge` so the app knows whether to offer a "mark resolved" button; the `resolve` endpoint enforces the same permission server-side regardless of what the app shows.

**`acknowledgedByName` is the acknowledging family member's name, joined in for display** — `null` until someone acknowledges. `acknowledgedAt`/`acknowledgedBy` (raw id) are already part of every alert shape; this adds the name so the screen doesn't have to look it up separately.

**`latitude`/`longitude` are redacted to `null` when the caller's `family_links.can_view_location` is `false`**, regardless of what's actually stored on the alert — enforced in the query, not left to the app to hide. `locationAccuracyMeters`/`locationIsApproximate`/`locationCapturedAt` are redacted the same way, together with the coordinates. Each alert also carries `canViewLocation` so the app can tell "no fix yet" apart from "you don't have permission to see it," though today it doesn't need to: it just renders whatever coordinates it's given.

**`locationIsApproximate: true` is what the family dashboard's amber badge is keyed on** (Phase 1 step 4, see `FamilyHomeScreen.js`) — a cached fix sent as a floor value, not a fresh reading at press time. `locationCapturedAt` drives the badge's wording (how long before the alert the fix was actually taken); a later `PATCH /emergency/alerts/:id/location` clears the flag once a fresh fix lands, which the dashboard picks up on its next poll and shows as a brief "Confirmed location" transition.

**Response `200`**

```json
{
  "status": "ok",
  "count": 1,
  "alerts": [
    {
      "id": "9c0c0c9c-f8de-4f25-9c76-2662e8f9a139",
      "userId": "68e6ca9c-a980-4509-b01d-cdc4c633bf95",
      "alertType": "sos",
      "status": "active",
      "severity": "critical",
      "latitude": "12.971599",
      "longitude": "77.594566",
      "locationAccuracyMeters": "18.20",
      "locationIsApproximate": false,
      "locationCapturedAt": "2026-08-15T06:51:48.900Z",
      "triggeredAt": "2026-08-15T06:51:50.230Z",
      "acknowledgedAt": null,
      "acknowledgedBy": null,
      "acknowledgedByName": null,
      "...": "remaining fields as in POST /emergency/alerts",
      "elderlyUser": { "fullName": "Test Elderly", "phone": "+919000000001" },
      "canAcknowledge": true,
      "canViewLocation": true
    }
  ]
}
```

**Errors**

| Status | Code | When |
|---|---|---|
| `403` | `insufficient_role` | The caller's role is not `family` |

---

### `GET /emergency/family/alerts/history`

Resolved and cancelled alerts from the last 7 days for every elderly user the caller has an `active` `family_links` row with. Role-gated to `family`. Same view-only-still-sees gating as `GET /emergency/family/alerts` — `can_acknowledge_alerts` does not affect what's visible here, only whether an alert could have been resolved by this family member while it was active.

The point of this endpoint is that a cancelled or resolved SOS does not just vanish from `GET /emergency/family/alerts` with no trace — a family member should be able to see that their relative pressed SOS and how it ended, even if they weren't watching at the time.

**Same `can_view_location` redaction as the active list** — `latitude`/`longitude` come back `null` and `canViewLocation` is `false` when the link doesn't grant it. Applied consistently even though the family screen doesn't currently render coordinates on history cards, only active ones — the permission is about the data, not about which screen happens to display it.

**Query parameters**

| Field | Required | Rules |
|---|---|---|
| `limit` | no | Positive whole number, capped at 50. Defaults to 20 |

The 7-day window is fixed and not a query parameter.

**Response `200`**

```json
{
  "status": "ok",
  "count": 1,
  "alerts": [
    {
      "id": "57e364d0-dba2-48b3-9ae3-fd2eae3a239a",
      "userId": "68e6ca9c-a980-4509-b01d-cdc4c633bf95",
      "alertType": "sos",
      "status": "cancelled",
      "severity": "critical",
      "triggeredAt": "2026-08-15T12:41:10.205Z",
      "resolvedAt": "2026-08-15T12:42:02.398Z",
      "resolvedBy": "68e6ca9c-a980-4509-b01d-cdc4c633bf95",
      "...": "remaining fields as in POST /emergency/alerts",
      "elderlyUser": { "fullName": "Test Elderly", "phone": "+919000000001" },
      "resolvedByName": "Test Elderly",
      "resolvedByIsSelf": true,
      "canViewLocation": true
    }
  ]
}
```

`status` is always `resolved` or `cancelled` here — never `active`. `resolvedByName` is whoever closed it; `resolvedByIsSelf` tells you whether that was the alert's own owner. Cancel is always self (only the owner can cancel), but resolve can be either the owner or a permitted family member — that's the distinction the app uses to show "cancelled by them" versus "resolved by family" versus "resolved by them".

**Errors**

| Status | Code | When |
|---|---|---|
| `400` | `validation_failed` | `limit` is not a positive whole number |
| `403` | `insufficient_role` | The caller's role is not `family` |

---

### `POST /emergency/locations`

Records one GPS reading for the caller. Phase 1, step 2: capture and storage only — nothing reads this back yet (no map UI, no geofencing; those are Phase 3). Not role-gated at the API layer, same reasoning as `POST /emergency/alerts`: scoped to the caller's own account, restricted to the elderly screen by the app's UI, not by the server.

**Request body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `latitude` | number | **yes** | -90 to 90 |
| `longitude` | number | **yes** | -180 to 180 |
| `accuracyMeters` | number | no | Non-negative |
| `batteryLevel` | integer | no | 0-100 |
| `recordedAt` | string | no | ISO 8601. When the device took the fix, if different from when this request arrives. Defaults to the time the server receives it |

```json
{ "latitude": 12.971599, "longitude": 77.594566, "accuracyMeters": 12.5, "batteryLevel": 73 }
```

**Response `201`**

```json
{
  "status": "ok",
  "location": {
    "id": "9262f6e5-a169-44d9-9e02-cb794dbc2742",
    "userId": "68e6ca9c-a980-4509-b01d-cdc4c633bf95",
    "latitude": "12.971599",
    "longitude": "77.594566",
    "accuracyMeters": "12.50",
    "batteryLevel": 73,
    "recordedAt": "2026-08-15T13:17:14.552Z",
    "createdAt": "2026-08-15T13:17:14.552Z"
  }
}
```

**Errors**

| Status | Code | When |
|---|---|---|
| `400` | `validation_failed` | `latitude`/`longitude` missing, out of range, or only one of the pair sent; or `accuracyMeters`, `batteryLevel`, `recordedAt` fail their own rules |

**This is unrelated to the location the app may send with `POST /emergency/alerts`.** That request writes straight onto the alert's own `latitude`/`longitude` for durability past the 30-day location purge; it does not create a row here, and this endpoint does not touch `alerts`. Two separate concerns: general location history, and what an alert remembers about itself.

**Phase 3, step 2 adds a second, regular caller: background location tracking.** While an elderly user has turned it on, the app calls this exact endpoint roughly every 90 seconds (subject to a 75-metre minimum-movement filter — see BUILD_LOG.md for the battery reasoning), with no change to the request or response shape above. Readings captured while the device is offline are queued on the device and sent once connectivity returns, each still carrying its own `recordedAt` from when it was actually taken rather than when it was finally delivered — the same offline-arrival case `SCHEMA_DESIGN.md` §2.7 already designed `recorded_at` for.

---

### `POST /emergency/device-tokens`

Registers this device's Expo push token so the caller can be reached by push — including as the `contact_user_id` on someone else's `emergency_contacts` row. Not role-gated: anyone signed in can register a device, since anyone could end up listed as a contact.

**Request body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `expoPushToken` | string | **yes** | 255 characters or fewer |
| `platform` | string | **yes** | `ios`, `android` or `web` |
| `deviceName` | string | no | 120 characters or fewer |
| `deviceModel` | string | no | 120 characters or fewer |
| `appVersion` | string | no | 20 characters or fewer |
| `osVersion` | string | no | 40 characters or fewer |

**Upserts on the token itself**, not on `(user, device)` — the same physical token can only ever belong to one user, so re-registering (a reinstall, or a different account signing in on the same device) correctly reassigns it rather than creating a duplicate row.

**Response `201`**

```json
{
  "status": "ok",
  "deviceToken": {
    "id": "308bfc91-a6e8-4005-83f7-111fe61d4c0a",
    "userId": "43d2e8c5-82cd-4307-a673-3a84d411bd7e",
    "platform": "android",
    "deviceName": "Test Pixel",
    "isActive": true,
    "lastSeenAt": "2026-08-15T14:55:01.003Z",
    "createdAt": "2026-08-15T14:55:01.003Z"
  }
}
```

**Errors**

| Status | Code | When |
|---|---|---|
| `400` | `validation_failed` | `expoPushToken` missing, `platform` not one of the three values, or another field fails its own length rule |

---

## Notification channels and escalation

How `POST /emergency/alerts` actually reaches someone, for anyone extending this later.

**Channels — one module per provider, each with `isConfigured()` and `send()`:** `backend/emergency/notifications/providers/{push,email,sms,voice}.js`.

| Channel | Provider | Configured via | Status |
|---|---|---|---|
| Push | Expo | nothing — works immediately | Live |
| Email | Resend | `RESEND_API_KEY` in `.env` | Live once set |
| SMS | Twilio | `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN`/`TWILIO_FROM_NUMBER` | Wired, inactive until set |
| Voice call | Twilio | same three variables | Wired, inactive until set |

**An unconfigured channel still records an attempt.** `isConfigured()` isn't a gate that skips the channel — a contact who opted into SMS still gets a `notifications` row with `status: 'failed'` and an `error_message` naming exactly which `.env` variable is missing. That row is both the audit trail and the "how do I turn this on" documentation, together.

**India: DLT.** SMS to a real Indian mobile number will not be delivered in production until DLT (Distributed Ledger Technology) registration is complete with the telecom regulator — an entity registration, a sender header, and a message template, each needing approval. The client is arranging this; it takes on the order of weeks. It does not block anything here — Twilio credentials alone are enough to develop and test against a verified number — only real delivery to real Indian numbers once live. See `.env.example`.

**Which channels are tried, per contact:**

- **Push** — only if the contact's `contact_user_id` resolves to at least one active `device_tokens` row. No token means no attempt at all, not a failure — there's nothing to record a destination for.
- **Email** — attempted whenever the contact has an `email` address. The schema has no `notify_by_email` column, so unlike the other three channels there's no way for a contact to opt out of email specifically while keeping the others on.
- **SMS / voice call** — gated by `notify_by_sms` / `notify_by_call`. Always attempted when enabled, whether or not Twilio is configured — see "unconfigured channel" above.

A contact reachable on more than one channel is notified on all of them at once, in parallel — the goal for one contact is reaching that one person by whatever means work, not spacing channels out.

**Escalation — one contact at a time, not everyone at once.** `POST /emergency/alerts` notifies contact 1 (lowest `priority`) immediately, in the background, without delaying the response. A scheduler (`backend/emergency/notifications/scheduler.js`, a plain interval, checked every 60 seconds) escalates to the next contact once `ESCALATION_INTERVAL_MINUTES` (default 5) has passed since the last one was notified with no acknowledgement. This continues until someone acknowledges (`POST /emergency/alerts/:id/acknowledge`) or every contact has been tried — reaching the end of the list does not close the alert or stop trying to reach people some other way (a phone call, checking in person); it just means the automated fanout has done everything it can.

**No new column tracks escalation progress.** "Who was notified, and when" is derived from the `notifications` table joined to `emergency_contacts.priority`, not stored on `alerts`. Since escalation only ever moves forward, the most recently created `notifications` row for an alert always belongs to its current-stage contact.

### Family broadcast tier — separate from the escalation above

**SOS only.** `POST /emergency/alerts` also fires a second, independent notification path: every family member with an **active** `family_links` row to the elderly user gets pushed once, immediately, to every registered device — not phoned, not escalated, not retried on a schedule. This is a different opt-in than `emergency_contacts`: linking a dashboard means "I can see this account," not "call me," but a linked family member should still learn the moment SOS fires rather than finding out from the fanout tier's audit trail after the fact.

**No deduplication with the escalation tier.** A person who is both an active family member and an emergency contact gets two separate `notifications` rows for the same alert — one `channel: 'push'` with `emergencyContactId: null` (broadcast), one however the fanout tier reaches them (`emergencyContactId` set). Deliberate: a duplicate push is a minor annoyance, a missed one is dangerous.

**Runs once, at creation, for SOS alerts only.** Not re-run by the escalation scheduler, and not triggered by `POST /emergency/alerts/fall` — extending it to other alert types is future work.

---

---

## For the login and registration screens

Phase 0 step 5, Teammate C. The app shell already handles tokens, refresh and role-based routing — the screens only have to collect credentials and hand the response over.

**Where the code goes:** `frontend/src/shared/screens/LoginScreen.js`. The comment block at the top of that file repeats all of this next to the code, and the temporary sign-in panel in it is scaffolding to delete once the real screen works.

**The whole handover is two lines:**

```js
import { login, register } from '../api/auth';
import { useAuth } from '../auth/AuthContext';

const { signIn } = useAuth();

// logging in
const response = await login({ phone, password });
await signIn(response);

// registering — the response carries tokens, so no second login call
const response = await register({ phone, password, fullName, role });
await signIn(response);
```

`signIn` stores both tokens in SecureStore and switches the navigator to the home screen for that user's role. **Do not navigate by hand and do not read the role yourself** — routing off `user.role` is already built in `src/shared/navigation/AppNavigator.js`.

**Which endpoints to call:** `POST /auth/login` and `POST /auth/register`, both documented above. Nothing else. `/auth/refresh` is handled inside the API client; a screen never calls it.

**Do not reformat the phone number.** Send the field exactly as typed — the backend normalises to E.164 and is the only place that does. Show `+91` as a fixed prefix beside a 10-digit input so most people type ten plain digits, but do not strip, pad or rewrite what they enter.

**Errors** come back as `ApiError` with `.status`, `.code` and `.details`, or `NetworkError` when the request never arrived. Branch on `.code`: `invalid_credentials`, `account_exists`, `account_disabled`, `role_not_self_assignable`, `validation_failed`. On `validation_failed`, `.details` lists every bad field at once — show each message against its own input.

**Roles the form may offer:** `elderly`, `family`, `caregiver`. Not `admin` — the server rejects it with `403 role_not_self_assignable`.

---

---

## Ambulance Bookings (Phase 5)

### `POST /emergency/ambulance/bookings`

Requests an emergency ambulance for the authenticated user. Automatically dispatches the mock provider service layer.

**Headers:** `Authorization: Bearer <accessToken>`

**Request Body:**

| Field | Type | Required | Rules |
|---|---|---|---|
| `pickupAddress` | string | **yes** | Pickup address or location description |
| `destinationHospital` | string | **yes** | Target hospital name |
| `pickupLatitude` | number | no | Optional GPS latitude |
| `pickupLongitude` | number | no | Optional GPS longitude |
| `notes` | string | no | Optional medical or access instructions |

```json
{
  "pickupAddress": "123 Main Street, Apt 4B",
  "destinationHospital": "City General Hospital",
  "notes": "Wheelchair required, difficulty breathing"
}
```

**Response `201`**

```json
{
  "status": "ok",
  "booking": {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "userId": "cc7e3c0f-640b-4a56-ad9c-ea100d4ce851",
    "pickupAddress": "123 Main Street, Apt 4B",
    "destinationHospital": "City General Hospital",
    "status": "dispatched",
    "providerName": "ElderCare Emergency Fleet (Mock)",
    "providerReference": "MOCK-AMB-48192",
    "driverName": "Rajesh Kumar",
    "driverPhone": "+919876543210",
    "vehicleNumber": "KA-01-EQ-9911",
    "etaMinutes": 8,
    "notes": "Wheelchair required, difficulty breathing",
    "requestedAt": "2026-08-19T22:40:00.000Z",
    "dispatchedAt": "2026-08-19T22:40:00.100Z"
  }
}
```

**Errors:**
- `400 validation_failed` - Missing pickup location or destination hospital
- `409 active_booking_exists` - User already has an active ambulance booking

---

### `GET /emergency/ambulance/bookings/active`

Returns the currently active ambulance booking for the authenticated user (`requested`, `dispatched`, `en_route`, `arrived`), or `booking: null` if none exists.

**Headers:** `Authorization: Bearer <accessToken>`

---

### `POST /emergency/ambulance/bookings/:id/cancel`

Cancels an active ambulance booking.

**Headers:** `Authorization: Bearer <accessToken>`

---

## Disaster Alerts (Phase 5)

### `GET /emergency/disaster-alerts`

Returns current active disaster warnings and weather advisories for the user's region.

**Headers:** `Authorization: Bearer <accessToken>`

**Query Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `area` | string | no | Optional filter by area name (e.g. `Hyderabad`) |
| `limit` | number | no | Max records to return (default 20, max 100) |

**Response `200`**

```json
{
  "status": "ok",
  "count": 2,
  "alerts": [
    {
      "id": "b2c3d4e5-f6a7-8901-bcde-f23456789012",
      "title": "Severe Flood Warning",
      "description": "Heavy rainfall has led to severe waterlogging and flash flood risks in low-lying areas. Stay indoors, avoid underpasses, and move to higher ground if instructed.",
      "disasterType": "flood",
      "severity": "critical",
      "areaName": "Hyderabad Central",
      "centerLatitude": null,
      "centerLongitude": null,
      "radiusMeters": null,
      "source": "IMD / Disaster Relief Feed (Mock)",
      "externalId": "MOCK-DIS-001",
      "issuedAt": "2026-08-19T23:00:00.000Z",
      "expiresAt": "2026-08-20T23:00:00.000Z",
      "isActive": true,
      "createdAt": "2026-08-19T23:00:00.000Z",
      "updatedAt": "2026-08-19T23:00:00.000Z"
    }
  ]
}
```

---

### `GET /emergency/disaster-alerts/:id`

Returns detailed information for a specific disaster warning.

**Headers:** `Authorization: Bearer <accessToken>`

**Response `200`**

```json
{
  "status": "ok",
  "alert": {
    "id": "b2c3d4e5-f6a7-8901-bcde-f23456789012",
    "title": "Severe Flood Warning",
    "description": "Heavy rainfall has led to severe waterlogging and flash flood risks in low-lying areas.",
    "disasterType": "flood",
    "severity": "critical",
    "areaName": "Hyderabad Central",
    "source": "IMD / Disaster Relief Feed (Mock)",
    "issuedAt": "2026-08-19T23:00:00.000Z"
  }
}
```

---

## Hybrid Fall Alerts (Phase 5)

### `POST /emergency/alerts/fall`

Triggers a fall alert (`alert_type: 'fall'`) for the authenticated user, supporting both manual "I FELL" button presses and automatic motion-sensor triggered detections (after the 10-second countdown window expires). Automatically invokes emergency contact notification fanout (`advanceFanout`).

**Headers:** `Authorization: Bearer <accessToken>`

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `latitude` | number | no | Optional GPS latitude |
| `longitude` | number | no | Optional GPS longitude |
| `message` | string | no | Optional alert note |

```json
{
  "latitude": 17.385044,
  "longitude": 78.486671,
  "message": "User reported a fall in the living room"
}
```

**Response `201`**

```json
{
  "status": "ok",
  "alert": {
    "id": "c3d4e5f6-a7b8-9012-cdef-345678901234",
    "userId": "cc7e3c0f-640b-4a56-ad9c-ea100d4ce851",
    "alertType": "fall",
    "status": "active",
    "severity": "high",
    "latitude": 17.385044,
    "longitude": 78.486671,
    "message": "User reported a fall in the living room",
    "triggeredAt": "2026-08-20T00:05:00.000Z"
  }
}
```

**Errors:**
- `409 fall_already_active` - User already has an active fall alert

---

## Family Links (Phase 1 step 4)

`family_links` controls dashboard access — who can see and manage whose data. It is deliberately separate from `emergency_contacts` — who gets called during SOS — and **stays** separate: accepting an invite only activates dashboard access, nothing more. Promoting a linked family member to emergency-contact status is a distinct, deliberate action — `POST /family/links/:id/emergency-contact`, documented at the end of this section — never a side effect of accepting.

A link moves through at most: `pending` → `active` → `revoked`, or `pending` → `revoked` if declined. **`revoked` is reused for "declined" — there is no separate `declined` status.** A declined invite and a pulled-access link look identical in the API; both can be re-invited the same way.

### `POST /family/invites`

Invites a **registered** person as family. Either the elderly user invites for their own account, or an existing `owner`-level family member invites on that elderly person's behalf (`'view'`/`'manage'` cannot). The invitee is looked up by phone — **they must already have an account**; see "Known limitations" below.

**Request body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `phone` | string | **yes** | The invitee's phone — any accepted format, see [Phone number format](#phone-number-format). Must belong to an existing account |
| `elderlyUserId` | string (UUID) | required only if the caller is not the elderly user | Ignored/implied when the caller's own role is `elderly` |
| `relationship` | string | no | Free text, e.g. `"daughter"`, 50 characters or fewer |
| `permissionLevel` | string | no | `view` (default), `manage`, or `owner` |
| `canViewLocation` | boolean | no | Default `true` |
| `canManageContacts` | boolean | no | Default `false` |
| `canManageCaregivers` | boolean | no | Default `false`. Accepted and stored, but **nothing checks it yet** — no caregiver-management endpoints exist for it to gate. Left in place intentionally, not dead code left over by mistake |
| `canAcknowledgeAlerts` | boolean | no | Default `true` |

```json
{ "phone": "+919876543211", "relationship": "daughter", "permissionLevel": "owner" }
```

**Response `201`**

```json
{
  "status": "ok",
  "link": {
    "id": "3e31d6e8-a28a-4497-a3af-6b3f47e79523",
    "elderlyUserId": "2e4fe1ff-3d66-4115-a3c1-a22aab445d96",
    "familyUserId": "b0d5f3ab-6718-4410-8784-1f16ad26dbec",
    "relationship": "daughter",
    "permissionLevel": "owner",
    "canViewLocation": true,
    "canManageContacts": false,
    "canManageCaregivers": false,
    "canAcknowledgeAlerts": true,
    "status": "pending",
    "invitedBy": "2e4fe1ff-3d66-4115-a3c1-a22aab445d96",
    "approvedAt": null,
    "revokedAt": null,
    "createdAt": "2026-08-28T04:29:54.468Z",
    "updatedAt": "2026-08-28T04:29:54.468Z"
  }
}
```

**Re-inviting a previously declined or revoked pair reuses the same row** — `(elderlyUserId, familyUserId)` is unique, so this updates that row back to `pending` rather than creating a second one. The returned `id` is the same as the original invite's.

**Errors**

| Status | Code | When |
|---|---|---|
| `400` | `validation_failed` | A field is missing/malformed, `elderlyUserId` missing for a non-elderly caller, or the phone belongs to the elderly user themselves |
| `403` | `not_permitted` | Caller is family but not an `owner`-level, `active` link to that elderly user |
| `404` | `invitee_not_registered` | No account exists for that phone number — see "Known limitations" |
| `409` | `already_linked` | This pair already has an `active` link |
| `409` | `invite_already_pending` | This pair already has a `pending` invite |

---

### `POST /family/invites/:id/accept`

Only the invitee (`family_user_id`) may call this. Activates the link — **nothing else**. It does not add the invitee as an emergency contact; that's `POST /family/links/:id/emergency-contact`, a separate action a permitted caller takes deliberately afterward, documented at the end of this section.

**Response `200`** — the link, now `status: "active"`, `approvedAt` set.

**Errors**

| Status | Code | When |
|---|---|---|
| `403` | `not_invitee` | Caller is not the person this invite was sent to |
| `404` | `invite_not_found` | No invite with that id |
| `409` | `invite_not_pending` | Already accepted, declined, or revoked |

---

### `POST /family/invites/:id/decline`

Only the invitee may call this. Sets `status: "revoked"` — see the note at the top of this section on why decline reuses that value rather than a dedicated one. Does not touch `emergency_contacts` — a declined invite never created a contact row to begin with.

**Response `200`** — the link, now `status: "revoked"`, `revokedAt` set.

**Errors:** same shape as accept — `403 not_invitee`, `404 invite_not_found`, `409 invite_not_pending`.

---

### `POST /family/links/:id/revoke`

Pulls an **active** link. Permitted callers: the elderly user, the family member themselves (leaving), or another `owner`-level family member active on that same elderly account.

**Also deactivates the matching `emergency_contacts` row, if `POST /family/links/:id/emergency-contact` was ever used on this link.** A no-op otherwise — most links never reach that state. Deliberate default when it applies: leaving a phone-escalation path open to someone whose dashboard access was just pulled for cause is the wrong one for an emergency product. It does not touch any other contact — only the row created by this specific link (`emergency_contacts.contact_user_id = this family member's user id`, for this elderly user).

**Response `200`** — the link, now `status: "revoked"`, `revokedAt` set.

**Errors**

| Status | Code | When |
|---|---|---|
| `403` | `not_permitted` | Caller is none of: the elderly user, this family member, or an owner-level active family member for this elderly user |
| `404` | `link_not_found` | No link with that id |
| `409` | `link_not_active` | Link is `pending` or already `revoked` |

---

### `GET /family/links`

The caller's own links, from whichever side they're on: an elderly caller sees who has (or is pending) access to their account; a family caller sees which elderly accounts they're linked to, including invites still awaiting their own response.

**Each link is joined to the other side's current name and phone** — `relationship` is free text set once at invite time (often blank, and useless for telling two family members apart even when set), so this endpoint additionally reads the linked account's `full_name`/`phone` from `users` at request time. An elderly caller's links each carry `familyUser: { fullName, phone }`; a family caller's links each carry `elderlyUser: { fullName, phone }`. Only one of the two is ever present, matching which side the caller is on. **Read live, not copied** — unlike the one-time snapshot `POST /family/links/:id/emergency-contact` writes into `emergency_contacts`, this always reflects the account's current name, so it does not go stale the way that copy can.

This join does not apply to the `link` returned by `POST /family/invites`, `.../accept`, or `.../decline` — those come straight off the row just written, with neither `familyUser` nor `elderlyUser` present. Only `GET /family/links` does the join.

**Query parameters**

| Field | Required | Rules |
|---|---|---|
| `status` | no | `pending`, `active`, or `revoked`. Omit for every status |

**Response `200`** — elderly caller:

```json
{
  "status": "ok",
  "count": 1,
  "links": [
    {
      "id": "3e31d6e8-a28a-4497-a3af-6b3f47e79523",
      "elderlyUserId": "2e4fe1ff-3d66-4115-a3c1-a22aab445d96",
      "familyUserId": "b0d5f3ab-6718-4410-8784-1f16ad26dbec",
      "relationship": "daughter",
      "permissionLevel": "owner",
      "canViewLocation": true,
      "canManageContacts": false,
      "canManageCaregivers": false,
      "canAcknowledgeAlerts": true,
      "status": "active",
      "invitedBy": "2e4fe1ff-3d66-4115-a3c1-a22aab445d96",
      "approvedAt": "2026-08-28T04:31:02.113Z",
      "revokedAt": null,
      "createdAt": "2026-08-28T04:29:54.468Z",
      "updatedAt": "2026-08-28T04:31:02.113Z",
      "familyUser": { "fullName": "Priya Kumar", "phone": "+919876543211" }
    }
  ]
}
```

A family caller's response is the same shape with `elderlyUser: { fullName, phone }` in place of `familyUser`.

---

### `POST /family/links/:id/emergency-contact`

The deliberate action that promotes an **active** link to emergency-contact status. Separate from accepting the invite on purpose — dashboard access and being phoned during SOS are different permissions (see the intro to this section), so making the second one true has to be its own choice.

Copies `full_name`/`phone`/`email` from the family member's account **at that moment**, sets `contact_user_id` to their user id, and appends after any existing contacts by priority. All three `notify_by_*` flags default `true`.

**This is a one-time copy, not a live reference.** If that family member later changes their phone or email, this row does not update — see "Known limitations" below. `contactUserId` being non-null is the only signal the contacts list has that a given row's details came from a linked account rather than being entered by hand; no separate flag exists for this.

Permitted: the elderly user, or a family member with `can_manage_contacts = true` on an active link to that elderly user (not necessarily *this* link).

**Request body:** none.

**Response `201`** — the new contact, same shape as `POST /emergency/contacts` below.

**Response `200`** — when a row with this family member's phone already exists for the elderly user and is either hand-entered (`contactUserId` null, active or not) or this same family member's row soft-deleted by an earlier `DELETE /emergency/contacts/:id`. That row is reused instead of inserting a second one (`uq_contact_per_user` forbids it): `contactUserId` is set, `isActive` goes back to `true`, and its name, priority and notify flags are kept. This is what lets ManageFamilyScreen's "Also call them in an emergency" toggle turn back on after being turned off.

**Errors**

| Status | Code | When |
|---|---|---|
| `403` | `not_permitted` | Caller lacks `can_manage_contacts` on an active link to this elderly user |
| `404` | `link_not_found` | No link with that id |
| `409` | `link_not_active` | Link is `pending` or `revoked` |
| `409` | `contact_already_exists` | This family member's phone is already an **active** contact linked to them, or a contact linked to a different account |

---

### `PATCH /family/links/:id`

Elderly user only. Edits an **active** link's permission fields without revoking it outright — the surgical undo for granting `manage`/`owner` (needed for `POST /emergency/geofences` below), stepping a family member back down without losing their dashboard access or emergency-contact status along with it.

The elderly user can already see who holds which tier via `GET /family/links` (`permissionLevel`, joined with `familyUser`'s name and phone — see above); this is the other half, being able to act on what they see.

**Request body** — every field optional, at least one required:

| Field | Type |
|---|---|
| `permissionLevel` | `view`, `manage`, or `owner` |
| `canViewLocation` | boolean |
| `canManageContacts` | boolean |
| `canManageCaregivers` | boolean |
| `canAcknowledgeAlerts` | boolean |

```json
{ "permissionLevel": "view" }
```

**Response `200`** — the updated link, same shape as `POST /family/invites`.

**Errors**

| Status | Code | When |
|---|---|---|
| `400` | `validation_failed` | No fields sent, or a sent field is malformed |
| `403` | `not_permitted` | The caller is not the elderly user this link belongs to — not even an `owner`-level family member may use this on someone else's behalf |
| `404` | `link_not_found` | No link with that id |
| `409` | `link_not_active` | The link is `pending` or `revoked` |

---

## Emergency Contacts (Phase 1 step 4)

Hand-entered contact CRUD — the escalate-a-linked-account action above is the only other way a row reaches this table. `contact_user_id` is always `null` here: a neighbour or doctor with no account is the normal case.

Permitted on every endpoint below: the owning elderly user, or a family member with an active `family_links` row to them and `can_manage_contacts = true`.

### `POST /emergency/contacts`

**Request body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `fullName` | string | **yes** | 1–120 characters |
| `phone` | string | **yes** | Any accepted format, see [Phone number format](#phone-number-format) |
| `elderlyUserId` | string (UUID) | required only if the caller is not the elderly user | Whose contact list this is |
| `email` | string | no | Valid address, 255 characters or fewer |
| `relationship` | string | no | Free text, e.g. `"neighbour"`, 50 characters or fewer |
| `priority` | integer | no | 1–10. Omit to append after the current highest priority |
| `notifyBySms` | boolean | no | Default `true` |
| `notifyByCall` | boolean | no | Default `true` |
| `notifyByPush` | boolean | no | Default `true` — has no effect without a linked account, since there's no `contact_user_id` to find a device token for |

**Response `201`**

```json
{
  "status": "ok",
  "contact": {
    "id": "958d6991-a0de-4fe7-98e5-13d8c25d71ce",
    "userId": "7521db3a-3527-4201-a489-164f4fa39bb5",
    "contactUserId": null,
    "fullName": "Neighbour Norm",
    "phone": "+919812345000",
    "email": null,
    "relationship": "neighbour",
    "priority": 2,
    "notifyBySms": true,
    "notifyByCall": true,
    "notifyByPush": true,
    "isActive": true,
    "createdAt": "2026-08-28T04:44:48.200Z",
    "updatedAt": "2026-08-28T04:44:48.200Z"
  }
}
```

**Errors**

| Status | Code | When |
|---|---|---|
| `400` | `validation_failed` | A field is missing/malformed, or `elderlyUserId` missing for a non-elderly caller |
| `403` | `not_permitted` | Caller lacks `can_manage_contacts` for this elderly user |
| `409` | `contact_already_exists` | This elderly user already has a contact with this phone number |

---

### `GET /emergency/contacts`

The owning elderly user's contact list, active contacts only, in priority order.

**Query parameters**

| Field | Required | Rules |
|---|---|---|
| `elderlyUserId` | required only if the caller is not the elderly user | |

**Response `200`**

```json
{ "status": "ok", "count": 1, "contacts": [ { "...": "one contact, same shape as above" } ] }
```

**Errors:** `400 validation_failed` (missing `elderlyUserId` for a non-elderly caller), `403 not_permitted`.

---

### `PATCH /emergency/contacts/:id`

Any of `POST`'s content fields, including `priority` on its own — **there is no separate reorder endpoint.** At least one field is required.

**Response `200`** — the updated contact.

**Errors**

| Status | Code | When |
|---|---|---|
| `400` | `validation_failed` | No fields sent, or a sent field is malformed |
| `403` | `not_permitted` | Caller lacks `can_manage_contacts` for this contact's elderly user |
| `404` | `contact_not_found` | No such contact, or it has been deleted |
| `409` | `contact_already_exists` | The new phone number collides with another contact for the same elderly user |

---

### `DELETE /emergency/contacts/:id`

**Soft delete** — sets `isActive: false`. Never a hard delete: `notifications.emergency_contact_id` references this table, and past notification history needs a real row to point back at. **There is no undelete through this API** — re-adding the same phone number collides with the still-present deleted row.

**Response `200`** — the contact, now `isActive: false`.

**Errors:** `403 not_permitted`, `404 contact_not_found` (including a contact already deleted).

---

## Geofencing (Phase 3 step 3)

A safe zone (or restricted zone) is a circle: a centre point and a radius, stored on `geofences` — no PostGIS, that is deliberate on the table itself. A breach is a real `alerts` row (`alertType: "geofence_breach"`), not a lighter-weight notification — it goes through the same `advanceFanout` escalation a fall alert does (full `emergency_contacts` list, every channel a contact opted into), just at `severity: "high"` rather than SOS's `"critical"`. It does **not** go through the family broadcast push tier — that stays SOS-only, same as it already was for fall alerts.

**Where the check happens: the server, not the phone.** Every `POST /emergency/locations` write (background tracking's ~90s/75m-movement cadence, or a foreground mount) is compared against the caller's active zones right after it's stored. Detection latency is therefore bounded by however often a location reading arrives, not instant — the trade for not needing to sync zone definitions to the device or reach for OS-level geofencing.

**Hysteresis.** A reading only counts as a transition if it disagrees with the *previous* stored `locations` row for that zone (sitting still near the boundary produces two identical classifications in a row, not a re-fire each time), and only if it clears the boundary by more than its own `accuracyMeters` (or 20m, if the reading has none). This absorbs ordinary GPS jitter at the edge of a zone without needing a state column on `geofences` itself — the same "derive, don't store" approach escalation progress already uses.

**Auto-resolve on return.** A zone alerts in one direction (`alertOnExit` and/or `alertOnEnter`) and auto-resolves the opposite: leaving a zone you were alerted for *entering*, or returning to a zone you were alerted for *leaving*, both close out whatever active `geofence_breach` alert exists for that zone — `resolvedBy: null`, since nobody had to act. For the common safe-zone case (`alertOnExit: true`, the default) this means coming home closes the alert automatically.

**Permission — reused from `family_links`, no new column.** Read (`GET`): the elderly user, or a family member with an active link and `canViewLocation: true` — a zone is location data, gated like any other. Write (`POST`/`PATCH`/`DELETE`): the same, plus `permissionLevel` `manage` or `owner` — the first real use of the `manage` tier, which existed in the enum but gated nothing until now. The elderly user can see who holds `manage`/`owner` via `GET /family/links` and step it back down via `PATCH /family/links/:id` without revoking the relationship outright — see above.

### `POST /emergency/geofences`

**Request body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `name` | string | **yes** | 1–100 characters |
| `centerLatitude` | number | **yes** | -90 to 90 |
| `centerLongitude` | number | **yes** | -180 to 180 |
| `radiusMeters` | integer | **yes** | Positive whole number |
| `elderlyUserId` | string (UUID) | required only if the caller is not the elderly user | Whose zone this is |
| `alertOnExit` | boolean | no | Default `true` |
| `alertOnEnter` | boolean | no | Default `false` |

```json
{ "name": "Home", "centerLatitude": 12.9716, "centerLongitude": 77.5946, "radiusMeters": 150 }
```

**Response `201`**

```json
{
  "status": "ok",
  "geofence": {
    "id": "7c9e6f3a-1234-4d5e-8f9a-0b1c2d3e4f5a",
    "userId": "2e4fe1ff-3d66-4115-a3c1-a22aab445d96",
    "name": "Home",
    "centerLatitude": "12.971600",
    "centerLongitude": "77.594600",
    "radiusMeters": 150,
    "fenceType": "safe_zone",
    "alertOnExit": true,
    "alertOnEnter": false,
    "isActive": true,
    "createdBy": "2e4fe1ff-3d66-4115-a3c1-a22aab445d96",
    "createdAt": "2026-08-28T10:00:00.000Z",
    "updatedAt": "2026-08-28T10:00:00.000Z"
  }
}
```

`createdBy` is separate from `userId` — a family member with `manage`/`owner` can create a zone for the elderly user, and `createdBy` is who actually did it. `fenceType` is always `"safe_zone"` — the column allows other values but nothing in this API defines what they'd mean yet, so it isn't a caller option.

**Errors**

| Status | Code | When |
|---|---|---|
| `400` | `validation_failed` | A field is missing/malformed, or `elderlyUserId` missing for a non-elderly caller |
| `403` | `not_permitted` | Caller lacks `canViewLocation` + `manage`/`owner` on an active link to this elderly user |

---

### `GET /emergency/geofences`

Active zones only, newest first.

**Query parameters**

| Field | Required | Rules |
|---|---|---|
| `elderlyUserId` | required only if the caller is not the elderly user | |

**Response `200`**

```json
{ "status": "ok", "count": 1, "geofences": [ { "...": "one zone, same shape as above" } ] }
```

**Errors:** `400 validation_failed` (missing `elderlyUserId` for a non-elderly caller), `403 not_permitted` (lacks `canViewLocation` on an active link).

---

### `PATCH /emergency/geofences/:id`

Any of `POST`'s content fields, any subset — at least one required.

**Response `200`** — the updated zone.

**Errors**

| Status | Code | When |
|---|---|---|
| `400` | `validation_failed` | No fields sent, or a sent field is malformed |
| `403` | `not_permitted` | Caller lacks `canViewLocation` + `manage`/`owner` for this zone's elderly user |
| `404` | `geofence_not_found` | No such zone, or it has been deleted |

---

### `DELETE /emergency/geofences/:id`

**Soft delete** — sets `isActive: false`. Never a hard delete: `alerts.geofenceId` references this table, and a past breach alert needs a real row to say which zone it was about — a hard delete would `SET NULL` there and lose that. There is no undelete through this API, same as emergency contacts.

**Response `200`** — the zone, now `isActive: false`.

**Errors:** `403 not_permitted`, `404 geofence_not_found` (including a zone already deleted).

---

### `GET /emergency/geofences/:id/history`

Recent inside/outside tally for one zone — the sanity check shown right after creating a zone ("you've been inside this zone for the last 3 days"), and reachable again later. Aggregated server-side from `locations` rows against this zone's circle; never returns the raw location trail itself.

**Query parameters**

| Field | Required | Rules |
|---|---|---|
| `days` | no | Positive whole number, capped at 30. Default `3` |

**Response `200`**

```json
{
  "status": "ok",
  "history": {
    "days": 3,
    "sampleCount": 42,
    "insideCount": 39,
    "percentInside": 93,
    "currentlyInside": true,
    "oldestSampleAt": "2026-08-26T09:00:00.000Z",
    "newestSampleAt": "2026-08-29T08:45:00.000Z"
  }
}
```

`sampleCount: 0` means no `locations` rows exist in the requested window — `percentInside` and `currentlyInside` are both `null` in that case, not `0`/`false`; the client shows "not enough recent location data yet," not a false reading of "never inside."

**Errors:** `400 validation_failed` (`days` malformed), `403 not_permitted` (same gate as reading the zone itself), `404 geofence_not_found`.

---

### `GET /emergency/locations/latest`

Most recent `locations` row for an elderly user, or `null` if they have none yet. Same permission gate as reading their geofences — a family member's own device position is never a stand-in for the elderly user's, so this is how the "use their last known location" zone-centre flow (Phase 3 step 3) gets a real point to work from instead of the caller's own GPS.

**Query parameters**

| Field | Required | Rules |
|---|---|---|
| `elderlyUserId` | required only if the caller is not the elderly user | |

**Response `200`**

```json
{
  "status": "ok",
  "location": {
    "id": "9b2e6f3a-...",
    "userId": "2e4fe1ff-...",
    "latitude": "12.971600",
    "longitude": "77.594600",
    "accuracyMeters": "11.00",
    "batteryLevel": 82,
    "source": "background_task",
    "recordedAt": "2026-08-29T08:45:00.000Z",
    "createdAt": "2026-08-29T08:45:03.000Z"
  }
}
```

`location: null` when nothing has been recorded for that user yet — the client blocks zone creation from this path rather than guessing a centre.

**Errors:** `400 validation_failed` (missing `elderlyUserId` for a non-elderly caller), `403 not_permitted` (lacks `canViewLocation` on an active link).

---

## Caregiver Profiles, Search & Booking (Phase 2)

A `caregivers` row is one-to-one with a `users` row of role `caregiver` (`caregivers.user_id UNIQUE`). Profile fields live on `caregivers`; name/email/phone are read live from the joined `users` row, not copied.

**Permission model.** Booking write access (create a booking on someone's behalf) is gated the same way geofences and safe zones are: the elderly user themselves, or a family member with an active `family_links` row and `canManageCaregivers: true` (`hasManageCaregiversPermission`, `family/links.js`) — the same field `PATCH /family/links/:id` already grants/revokes, see "Family Links" above. Reading a specific booking is permitted for its elderly user, whoever booked it, the assigned caregiver, a `canManageCaregivers` family member, or admin. Confirming, rejecting, or marking a booking active/complete is caregiver/admin-only; cancelling is permitted for the elderly owner, whoever booked it, the assigned caregiver, or admin — not every linked family member, only the one who made that specific booking.

### `POST /caregiver/profile`

Creates the caller's profile if none exists, otherwise updates it (upsert) — every field is optional and omitting one leaves the existing value untouched.

**Request body**

| Field | Type | Rules |
|---|---|---|
| `bio` | string | |
| `experienceYears` | integer | 0-70 |
| `qualifications` | string | |
| `specializations` | string[] | |
| `languages` | string[] | |
| `hourlyRate` | number | ≥ 0 |
| `serviceAreaCity` | string | |
| `isAvailable` | boolean | |

`currency` is not a caller input — always `'INR'` server-side.

**Response `200`**

```json
{
  "status": "ok",
  "caregiver": {
    "id": "7c9e6f3a-...",
    "userId": "2e4fe1ff-...",
    "fullName": "Asha Devi",
    "email": null,
    "phone": "+919876543210",
    "profilePhotoUrl": null,
    "bio": "10 years caring for elderly patients.",
    "experienceYears": 10,
    "qualifications": "Certified nursing assistant",
    "specializations": ["Dementia care", "Post-surgery care"],
    "languages": ["Hindi", "English"],
    "hourlyRate": 250,
    "currency": "INR",
    "serviceAreaCity": "Bengaluru",
    "idProofType": null,
    "idVerified": false,
    "verificationStatus": "pending",
    "verifiedAt": null,
    "verifiedBy": null,
    "isAvailable": true,
    "averageRating": 0,
    "totalReviews": 0,
    "createdAt": "2026-08-29T10:00:00.000Z",
    "updatedAt": "2026-08-29T10:00:00.000Z"
  }
}
```

**Errors:** `400 validation_failed`.

---

### `GET /caregiver/profile/me`

**Response `200`** — `{ "status": "ok", "caregiver": { "...": "same shape as above" } }`, or `"caregiver": null` before the caller has ever saved one.

---

### `GET /caregiver/search`

Verified + available caregivers by default.

**Query parameters**

| Field | Rules |
|---|---|
| `city` | Substring match, case-insensitive |
| `language` | Exact match against one entry in `languages`, case-insensitive |
| `specialization` | Exact match against one entry in `specializations`, case-insensitive |
| `minRating` | Number |
| `verifiedOnly` | Default `true`; pass `false` to include unverified |
| `availableOnly` | Default `true`; pass `false` to include unavailable |
| `page` | Default `1` |
| `limit` | Default `20` |

**Response `200`**

```json
{ "status": "ok", "total": 1, "page": 1, "limit": 20, "caregivers": [ { "...": "same shape as POST /caregiver/profile" } ] }
```

---

### `GET /caregiver/:id`

One caregiver's full profile — no restriction beyond being signed in.

**Response `200`** — `{ "status": "ok", "caregiver": { "..." } }`. **Errors:** `404 caregiver_not_found`.

---

### `POST /caregiver/bookings`

**Request body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `elderlyUserId` | UUID | **yes** | Who the booking is for |
| `caregiverId` | UUID | **yes** | Must exist |
| `startDate` | string | **yes** | `YYYY-MM-DD` |
| `endDate` | string | no | `YYYY-MM-DD`, not before `startDate` |
| `recurrence` | string | no | `one_time` (default) \| `daily` \| `weekly` \| `monthly` |
| `hoursPerVisit` | number | no | 0-24 |
| `agreedRate` | number | no | ≥ 0 |
| `specialInstructions` | string | no | |

**Response `201`**

```json
{
  "status": "ok",
  "booking": {
    "id": "9b2e6f3a-...",
    "elderlyUserId": "2e4fe1ff-...",
    "elderlyName": "Ramesh Kumar",
    "elderlyPhone": "+919876543210",
    "caregiverId": "7c9e6f3a-...",
    "caregiverName": "Asha Devi",
    "caregiverPhone": "+919876500000",
    "bookedByUserId": "2e4fe1ff-...",
    "bookedByName": "Ramesh Kumar",
    "status": "requested",
    "startDate": "2026-09-15",
    "endDate": null,
    "recurrence": "weekly",
    "hoursPerVisit": 4,
    "agreedRate": null,
    "currency": "INR",
    "specialInstructions": null,
    "cancellationReason": null,
    "cancelledBy": null,
    "createdAt": "2026-08-29T10:00:00.000Z",
    "updatedAt": "2026-08-29T10:00:00.000Z"
  }
}
```

Permitted: the elderly user themselves, admin, or **any** family member with an active link to `elderlyUserId`. `canManageCaregivers` is not required — there is no in-app payment, a booking only requests the caregiver and payment is arranged offline. Viewing someone else's booking (`GET /caregiver/bookings/:id`) and the rest of the caregiver module still require it.

**Errors:** `400 validation_failed`, `403 not_permitted` (caller has no active family link to `elderlyUserId`), `404 caregiver_not_found`.

---

### `GET /caregiver/bookings`

The caller's own bookings — elderly sees their own, family sees ones they booked plus every active linked elderly user's, caregiver sees ones assigned to them, admin sees all.

**Query parameters:** `status` (optional, one of `requested`/`confirmed`/`active`/`completed`/`cancelled`/`rejected`).

**Response `200`** — `{ "status": "ok", "count": 1, "bookings": [ { "...": "same shape as above" } ] }`.

---

### `GET /caregiver/bookings/:id`

**Response `200`** — the booking. **Errors:** `403 not_permitted`, `404 booking_not_found`.

---

### `PATCH /caregiver/bookings/:id/status`

**Request body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `status` | string | **yes** | `requested` \| `confirmed` \| `active` \| `completed` \| `cancelled` \| `rejected` |
| `cancellationReason` | string | no | Only meaningful when `status: "cancelled"` |

**Who may make which transition:**

| Transition | Permitted |
|---|---|
| → `confirmed` / `rejected` | Assigned caregiver, or admin |
| → `active` / `completed` | Assigned caregiver, or admin |
| → `cancelled` | Elderly owner, whoever booked it, the assigned caregiver, or admin |

**Response `200`** — the updated booking.

**Errors:** `400 validation_failed`, `403 not_authorized` (wrong actor for this transition), `404 booking_not_found`.

---

## Caregiver Scheduling & Attendance (Phase 2)

A `schedules` row is one visit slot, created from a confirmed booking; an `attendance` row is one-to-one with it (`attendance.schedule_id UNIQUE`), auto-created in `pending` status the moment the schedule is. `GET /caregiver/schedules` and `GET /caregiver/schedules/:id` embed that linked attendance row's `id`/`status`/`check_in_at`/`check_out_at` directly on the schedule response (`attendanceId`, `attendanceStatus`, `checkInAt`, `checkOutAt`) — a schedule list gives both in one fetch; there is no need to also call `GET /caregiver/attendance` just to show attendance state next to a list of visits.

**`POST /caregiver/schedules` does not check that the booking it's created from is `confirmed`.** Nothing server-side stops a schedule being created against a `requested`, `cancelled`, or `rejected` booking — the only gate is client-side: the app only offers "Schedule Visit" on a booking whose `status` is `confirmed`. Treat this as a real gap if a second client integrates against this endpoint directly.

**Permission model — schedules.** Create and read/write access are the same set: the elderly user themselves, the assigned caregiver (`isAssignedCaregiver`, `caregiver/services/authorize.js`), a family member with `hasManageCaregiversPermission`, or admin.

**Permission model — attendance.** Check-in/check-out: the assigned caregiver, or admin — nobody else, not even the elderly user or family, can record attendance on a caregiver's behalf. Verify (`PATCH /caregiver/attendance/:id/verify`): the elderly user themselves, a family member with `hasManageCaregiversPermission`, or admin — **the assigned caregiver is deliberately excluded**, since a caregiver verifying their own attendance defeats the point of an independent confirmation.

**Known gap: no accuracy field, no distance validation on check-in/out.** Unlike `POST /emergency/locations`, the attendance endpoints accept `latitude`/`longitude` with no `accuracyMeters` and do nothing to confirm the coordinates are anywhere near the elderly user's address — whatever is sent is stored as-is. A caregiver could in principle check in from anywhere. Not fixed here; see `BUILD_LOG.md`, 2026-08-29.

### `POST /caregiver/schedules`

**Request body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `bookingId` | UUID | **yes** | |
| `caregiverId` | UUID | **yes** | |
| `elderlyUserId` | UUID | **yes** | |
| `visitDate` | string | **yes** | `YYYY-MM-DD` |
| `startTime` | string | **yes** | `HH:MM` or `HH:MM:SS` |
| `endTime` | string | **yes** | `HH:MM` or `HH:MM:SS`, must be after `startTime` — same calendar day only, a visit cannot span midnight today |
| `notes` | string | no | |

**Response `201`**

```json
{
  "status": "ok",
  "schedule": {
    "id": "3f1e2a9b-...",
    "bookingId": "9b2e6f3a-...",
    "caregiverId": "7c9e6f3a-...",
    "caregiverName": "Asha Devi",
    "caregiverPhone": "+919876500000",
    "elderlyUserId": "2e4fe1ff-...",
    "elderlyName": "Ramesh Kumar",
    "elderlyPhone": "+919876543210",
    "visitDate": "2026-09-15",
    "startTime": "09:00:00",
    "endTime": "11:00:00",
    "status": "scheduled",
    "notes": null,
    "attendanceId": "8a4c1d2e-...",
    "attendanceStatus": "pending",
    "checkInAt": null,
    "checkOutAt": null,
    "createdAt": "2026-08-29T10:00:00.000Z",
    "updatedAt": "2026-08-29T10:00:00.000Z"
  }
}
```

**Errors:** `400 validation_failed`, `403 not_permitted`, `409 schedule_conflict` (this caregiver already has a slot the same day whose time range overlaps the requested one — checked per caregiver, not per elderly user, so the same caregiver cannot be double-booked even across two different families).

---

### `GET /caregiver/schedules`

Scoped server-side same as bookings: elderly sees their own, family sees their own plus every active linked elderly user's, caregiver sees their own assigned slots, admin sees all.

**Query parameters (all optional):** `caregiverId`, `elderlyUserId`, `startDate`, `endDate` (both `YYYY-MM-DD`), `status` (`scheduled`/`completed`/`missed`/`cancelled`/`rescheduled`).

**Response `200`** — `{ "status": "ok", "count": 1, "schedules": [ { "...": "same shape as above" } ] }`, ordered by `visitDate` then `startTime` ascending.

---

### `GET /caregiver/schedules/:id`

**Response `200`** — the schedule. **Errors:** `403 not_permitted`, `404 schedule_not_found`.

---

### `PATCH /caregiver/schedules/:id`

Changes a slot's own status directly (e.g. `missed`, `cancelled`, `rescheduled`) — not how a visit gets marked `completed` day-to-day, which happens automatically the moment check-out is recorded (see below).

**Request body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `status` | string | **yes** | `scheduled` \| `completed` \| `missed` \| `cancelled` \| `rescheduled` |
| `notes` | string | no | |

**Response `200`** — the updated schedule. **Errors:** `400 validation_failed`, `403 not_permitted`, `404 schedule_not_found`.

---

### `POST /caregiver/attendance/schedules/:scheduleId/check-in`

Assigned caregiver or admin only. Upserts the schedule's attendance row to `checked_in` with the current timestamp — safe to call again before checking out (a re-check-in just overwrites the time and coordinates).

**Request body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `latitude` | number | no | -90 to 90 |
| `longitude` | number | no | -180 to 180 |
| `notes` | string | no | |

**Response `200`**

```json
{
  "status": "ok",
  "attendance": {
    "id": "8a4c1d2e-...",
    "scheduleId": "3f1e2a9b-...",
    "caregiverId": "7c9e6f3a-...",
    "caregiverName": "Asha Devi",
    "caregiverPhone": "+919876500000",
    "elderlyUserId": "2e4fe1ff-...",
    "elderlyName": "Ramesh Kumar",
    "visitDate": "2026-09-15",
    "startTime": "09:00:00",
    "endTime": "11:00:00",
    "checkInAt": "2026-09-15T09:02:11.000Z",
    "checkInLatitude": 12.971599,
    "checkInLongitude": 77.594566,
    "checkOutAt": null,
    "checkOutLatitude": null,
    "checkOutLongitude": null,
    "durationMinutes": null,
    "status": "checked_in",
    "verifiedByFamily": false,
    "notes": null,
    "createdAt": "2026-08-29T10:00:00.000Z",
    "updatedAt": "2026-09-15T09:02:11.000Z"
  }
}
```

**Errors:** `400 validation_failed`, `403 not_authorized` (caller is not the assigned caregiver), `404 schedule_not_found`.

---

### `POST /caregiver/attendance/schedules/:scheduleId/check-out`

Assigned caregiver or admin only. Sets `checkOutAt`, computes `durationMinutes` from the stored `checkInAt` (minimum 1), sets attendance `status: "checked_out"`, and — as a side effect — sets the schedule's own `status` to `"completed"`.

**Request body** — same shape as check-in.

**Response `200`** — the attendance record, same shape as check-in's response with `checkOutAt`/`checkOutLatitude`/`checkOutLongitude`/`durationMinutes` populated and `status: "checked_out"`.

**Errors:** `400 validation_failed`, `400 not_checked_in` (no check-in recorded yet for this schedule), `403 not_authorized`, `404 schedule_not_found`.

---

### `PATCH /caregiver/attendance/:id/verify`

Sets `verifiedByFamily: true`. Elderly self, family with `hasManageCaregiversPermission`, or admin — never the caregiver themselves. Idempotent: verifying an already-verified record re-sets the same flag, no error.

**Response `200`** — the attendance record. **Errors:** `403 not_permitted`, `404 attendance_not_found`.

---

### `GET /caregiver/attendance`

Scoped server-side the same way as `GET /caregiver/schedules`.

**Query parameters (all optional):** `caregiverId`, `elderlyUserId`, `status` (`pending`/`checked_in`/`checked_out`/`absent`/`late`).

**Response `200`** — `{ "status": "ok", "count": 1, "attendance": [ { "...": "same shape as check-in's response" } ] }`, newest-created first.

---

### `GET /caregiver/attendance/:id`

**Response `200`** — the attendance record. **Errors:** `403 not_permitted`, `404 attendance_not_found`.

---

## Care Plans (Phase 4)

A `care_plans` row is medical information for one elderly user: conditions, allergies, medications, mobility/dietary notes, emergency instructions. An elderly user can have more than one — `status` (`draft`/`active`/`archived`) makes this a history, not a single record; `GET /caregiver/care-plans/elderly/:elderlyUserId` returns all of them, newest first.

**Permission model — and there is no view-only tier.** Write (create/update) is the elderly user themselves, a family member with `hasManageCaregiversPermission` (`family/links.js`), or admin. Read is that same set, **plus** a caregiver with a real assignment to the elderly user (`caregiverHasAssignmentWith`, `caregiver/services/authorize.js` — a confirmed/active/completed booking, or a schedule; being findable in search alone grants nothing). Unlike geofences, there is no separate "can view but not manage" split for family here: `hasManageCaregiversPermission` is one flag that gates both read and write identically, so a family member who can see a care plan can always also edit it. The only viewer who is genuinely read-only is a caregiver — `POST`/`PATCH` both exclude that role at the route's `requireRole` gate, not just at the permission-function level. A family member without `can_manage_caregivers` gets `403` on read too, same as write — there is no way today to grant "can see the allergy list, can't change it" to a family member. Worth revisiting; not attempted here. See `BUILD_LOG.md`.

### `POST /caregiver/care-plans`

**Request body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `elderlyUserId` | UUID | **yes** | |
| `title` | string | **yes** | 1-150 chars |
| `description` | string | no | |
| `medicalConditions` | string | no | |
| `allergies` | string | no | |
| `medications` | string | no | |
| `dietaryNotes` | string | no | |
| `mobilityNotes` | string | no | |
| `emergencyInstructions` | string | no | |
| `startDate` | string | no | `YYYY-MM-DD` |
| `endDate` | string | no | `YYYY-MM-DD`, not before `startDate` |
| `status` | string | no | `draft` \| `active` \| `archived`, defaults to `active` |

**Response `201`**

```json
{
  "status": "ok",
  "carePlan": {
    "id": "6e2a1f3c-...",
    "elderlyUserId": "2e4fe1ff-...",
    "elderlyName": "Ramesh Kumar",
    "createdByUserId": "2e4fe1ff-...",
    "createdByName": "Ramesh Kumar",
    "title": "Ramesh's ongoing care plan",
    "description": null,
    "medicalConditions": "Type 2 diabetes, hypertension",
    "allergies": "Penicillin",
    "medications": "Metformin 500mg twice daily",
    "dietaryNotes": "Low sodium",
    "mobilityNotes": "Uses a walker",
    "emergencyInstructions": "Call daughter first, then 108",
    "startDate": null,
    "endDate": null,
    "status": "active",
    "createdAt": "2026-08-29T10:00:00.000Z",
    "updatedAt": "2026-08-29T10:00:00.000Z"
  }
}
```

**Errors:** `400 validation_failed`, `403 not_permitted`.

---

### `GET /caregiver/care-plans/elderly/:elderlyUserId`

**Query parameters:** `status` (optional, one of `draft`/`active`/`archived`).

**Response `200`** — `{ "status": "ok", "count": 1, "carePlans": [ { "...": "same shape as above" } ] }`, newest-created first. **Errors:** `403 not_permitted`.

---

### `GET /caregiver/care-plans/:id`

**Response `200`** — the care plan. **Errors:** `403 not_permitted`, `404 care_plan_not_found`.

---

### `PATCH /caregiver/care-plans/:id`

Every field optional, at least one required. Same shape and rules as create, minus `elderlyUserId` (not editable — a care plan does not change whose it is).

**Response `200`** — the updated care plan. **Errors:** `400 validation_failed` (including a bad `status` value — the enum cast is caught by the validator, not left to surface as a raw database error), `403 not_permitted`, `404 care_plan_not_found`.

---

## Tasks (Phase 4)

A `tasks` row is one to-do item for an elderly user, optionally assigned to a caregiver and/or tied to a `carePlanId` / `scheduleId`.

**Permission model.** Create: the elderly user themselves, a family member with `hasManageCaregiversPermission`, admin, **or the caregiver being assigned to it, self-assigning only** — `assignedToCaregiverId` must resolve to the caller's own caregiver profile (`isAssignedCaregiver`, checked against the caller). A caregiver cannot assign a task to a different caregiver, or create one with no `assignedToCaregiverId` at all (that branch of `requireTaskCreatePermission` only fires when `assignedToCaregiverId` is present). Read and status updates share one permission function: the elderly user, the assigned caregiver, `hasManageCaregiversPermission` family, or admin.

### `POST /caregiver/tasks`

**Request body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `elderlyUserId` | UUID | **yes** | |
| `carePlanId` | UUID | no | |
| `assignedToCaregiverId` | UUID | no | |
| `scheduleId` | UUID | no | |
| `title` | string | **yes** | 1-150 chars |
| `description` | string | no | |
| `category` | string | no | |
| `priority` | string | no | `low` \| `normal` \| `high`, defaults to `normal` |
| `dueDate` | string | no | `YYYY-MM-DD` |
| `dueTime` | string | no | `HH:MM` or `HH:MM:SS` |

**Response `201`**

```json
{
  "status": "ok",
  "task": {
    "id": "4c7a1e2b-...",
    "carePlanId": null,
    "carePlanTitle": null,
    "elderlyUserId": "2e4fe1ff-...",
    "elderlyName": "Ramesh Kumar",
    "assignedToCaregiverId": "7c9e6f3a-...",
    "caregiverName": "Asha Devi",
    "assignedByUserId": "2e4fe1ff-...",
    "assignedByName": "Ramesh Kumar",
    "scheduleId": "3f1e2a9b-...",
    "title": "Give afternoon medication",
    "description": null,
    "category": null,
    "priority": "normal",
    "dueDate": null,
    "dueTime": null,
    "recurrence": "none",
    "status": "pending",
    "completedAt": null,
    "completedBy": null,
    "completedByName": null,
    "completionNotes": null,
    "createdAt": "2026-08-29T10:00:00.000Z",
    "updatedAt": "2026-08-29T10:00:00.000Z"
  }
}
```

**Errors:** `400 validation_failed`, `403 not_permitted`.

---

### `GET /caregiver/tasks`

**Query parameters (all optional):** `caregiverId`, `elderlyUserId`, `carePlanId`, `scheduleId`, `status` (`pending`/`in_progress`/`completed`/`skipped`/`cancelled`), `dueDate`.

**Response `200`** — `{ "status": "ok", "count": 1, "tasks": [ { "...": "same shape as above" } ] }`, ordered by due date/time ascending (nulls last), then newest-created first.

---

### `GET /caregiver/tasks/:id`

**Response `200`** — the task. **Errors:** `403 not_permitted`, `404 task_not_found`.

---

### `PATCH /caregiver/tasks/:id/status`

**Request body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `status` | string | **yes** | `pending` \| `in_progress` \| `completed` \| `skipped` \| `cancelled` |
| `completionNotes` | string | no | |

Setting `status: "completed"` stamps `completedAt`/`completedBy` server-side; any other status leaves those columns as they were.

**Response `200`** — the updated task. **Errors:** `400 validation_failed`, `403 not_permitted`, `404 task_not_found`.

---

## Activity Reports (Phase 4)

An `activity_reports` row is one caregiver's account of one visit: a required `summary`, plus optional meals/medications/mood/sleep/concerns. **`vitals` (JSONB) and `photoUrls` (array of URLs) exist as columns but have no client anywhere in this app that can populate them** — no vitals-entry UI and no file upload exist. Every report created through this app is qualitative text only. Flagged for whoever owns the product spec next; not attempted here. See `BUILD_LOG.md`.

**One report per caregiver, per elderly user, per calendar day** — `uq_report_per_day UNIQUE (caregiver_id, elderly_user_id, report_date)`. This is a real data-model limitation, not a client-side rule: if the same caregiver has two separate visits with the same elderly user on the same day, the second `POST` 409s as `duplicate_report` regardless of which `scheduleId` it names. There is also no `scheduleId` filter on `GET /caregiver/reports` — a report is looked up by `caregiverId` + `elderlyUserId` + date range, the same key the uniqueness constraint uses, not by which visit it came from.

**Permission model.** Create: the caregiver named in `caregiverId` must be the caller's own profile, or admin — never on another caregiver's behalf. Read: the elderly user, the reporting caregiver, `hasManageCaregiversPermission` family, or admin.

### `POST /caregiver/reports`

**Request body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `caregiverId` | UUID | **yes** | Must be the caller's own caregiver profile |
| `elderlyUserId` | UUID | **yes** | |
| `scheduleId` | UUID | no | |
| `carePlanId` | UUID | no | |
| `reportDate` | string | **yes** | `YYYY-MM-DD` |
| `summary` | string | **yes** | |
| `mealsTaken` | string | no | |
| `medicationsGiven` | string | no | |
| `mood` | string | no | |
| `sleepHours` | number | no | 0-24 |
| `concerns` | string | no | |

**Response `201`**

```json
{
  "status": "ok",
  "report": {
    "id": "9d3f2c1a-...",
    "scheduleId": "3f1e2a9b-...",
    "caregiverId": "7c9e6f3a-...",
    "caregiverName": "Asha Devi",
    "caregiverPhone": "+919876500000",
    "elderlyUserId": "2e4fe1ff-...",
    "elderlyName": "Ramesh Kumar",
    "carePlanId": null,
    "carePlanTitle": null,
    "reportDate": "2026-09-15",
    "summary": "Pleasant afternoon, took a short walk, ate well.",
    "mealsTaken": "Lunch and a snack",
    "medicationsGiven": "Metformin at 2pm",
    "mood": "Cheerful",
    "sleepHours": null,
    "vitals": null,
    "concerns": null,
    "photoUrls": [],
    "createdAt": "2026-09-15T14:30:00.000Z",
    "updatedAt": "2026-09-15T14:30:00.000Z"
  }
}
```

**Errors:** `400 validation_failed`, `403 not_permitted`, `409 duplicate_report`.

---

### `GET /caregiver/reports`

**Query parameters (all optional):** `elderlyUserId`, `caregiverId`, `startDate`, `endDate`.

**Response `200`** — `{ "status": "ok", "count": 1, "reports": [ { "...": "same shape as above" } ] }`, newest report-date first.

---

### `GET /caregiver/reports/:id`

**Response `200`** — the report. **Errors:** `403 not_permitted`, `404 report_not_found`.

---

## Reviews (Phase 4)

A `reviews` row is a 1-5 star rating (plus optional punctuality/care-quality/communication sub-ratings and a comment) tied to one completed booking. **There is no `PATCH` endpoint** — `uq_review_per_booking UNIQUE (booking_id, reviewer_user_id)` makes a review create-once by design, not an editable draft.

**Permission model.** The booking named by `bookingId` is looked up server-side (never trusted from the client) and must belong to the `caregiverId` being reviewed and have `status: "completed"` — a review cannot be left about a caregiver with no completed history, and `elderlyUserId` is derived from that booking, not accepted from the request body. Permitted reviewers: the booking's elderly user, whoever made the booking, a family member with `hasManageCaregiversPermission` for that elderly user, or admin.

Submitting a review also recalculates `caregivers.average_rating`/`total_reviews` from all `is_visible = true` reviews for that caregiver, in the same request.

### `POST /caregiver/reviews`

**Request body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `caregiverId` | UUID | **yes** | |
| `bookingId` | UUID | **yes** | Must be `completed`, and with this caregiver |
| `rating` | integer | **yes** | 1-5 |
| `punctualityRating` | integer | no | 1-5 |
| `careQualityRating` | integer | no | 1-5 |
| `communicationRating` | integer | no | 1-5 |
| `comment` | string | no | |

**Response `201`**

```json
{
  "status": "ok",
  "review": {
    "id": "5b8e0d3f-...",
    "caregiverId": "7c9e6f3a-...",
    "caregiverName": "Asha Devi",
    "bookingId": "9b2e6f3a-...",
    "reviewerUserId": "2e4fe1ff-...",
    "reviewerName": "Ramesh Kumar",
    "elderlyUserId": "2e4fe1ff-...",
    "rating": 5,
    "punctualityRating": 5,
    "careQualityRating": 5,
    "communicationRating": 4,
    "comment": "Very attentive and punctual.",
    "isVisible": true,
    "createdAt": "2026-09-20T09:00:00.000Z",
    "updatedAt": "2026-09-20T09:00:00.000Z"
  }
}
```

**Errors:** `400 validation_failed`, `403 not_permitted`, `404 booking_not_found`, `409 booking_not_eligible` (wrong caregiver, or not `completed`), `409 duplicate_review`.

---

### `GET /caregiver/reviews/caregiver/:caregiverId`

**Response `200`** — `{ "status": "ok", "count": 1, "reviews": [ { "...": "same shape as above" } ] }`, visible reviews only, newest first.

---

### `GET /caregiver/reviews/:id`

**Response `200`** — the review. **Errors:** `404 review_not_found`.

---

## Known limitations

**Pre-registration invites do not work.** `POST /family/invites` can only invite someone who has already registered an account — the invitee is looked up by phone, and an unregistered number returns `404 invitee_not_registered`. For real users this is the common case, not an edge case: a daughter installs the app for her mother, then wants to invite a brother who has nothing installed yet. Today he has to register first, then be invited. Building pre-registration invites (an invite record keyed on a phone number rather than a user id, resolved and turned into a real `family_links` row the moment that phone number registers) is a real feature, not a quick fix — it needs its own table or a nullable `family_user_id`, a way to notify the inviter once the invite resolves, and a decision on how long an unclaimed invite stays valid. Not attempted here.

**The emergency-contact copy goes stale silently.** `POST /family/links/:id/emergency-contact` copies `fullName`/`phone`/`email` once, at that moment, and never refreshes them. If that family member later changes their phone number, the elderly user's emergency contact list keeps calling the old one — and nobody finds out until an actual emergency exposes it. This is a safety failure mode, not untidy data. **Wherever a contacts list is displayed, it should surface that a `contactUserId`-linked row's details came from a linked account and may be out of date** — `contactUserId !== null` is the signal to key that off of. Keeping the copy fresh (a trigger on `users`, or resolving `contact_user_id` at read time instead of copying) is future work, not attempted here.

**Deleted contacts cannot be undeleted through the API.** `DELETE /emergency/contacts/:id` is soft (`isActive: false`), but nothing PATCHes `isActive` back to `true` — re-adding the same phone number through `POST /emergency/contacts` hits `uq_contact_per_user` and fails as `contact_already_exists`. The one exception is `POST /family/links/:id/emergency-contact`, which reactivates the existing row for a linked family member's phone (see that endpoint). A hand-entered contact deleted by mistake can still only be revived with direct database access.

---

## Not yet built

Everything below is planned but does not exist. Do not code against it — it will be specified here first.

| Area | Phase | Owner |
|---|---|---|
| Caregiver profiles, search, booking, scheduling, attendance | 2 | [Teammate B] |
| Live location over WebSockets, map UI for zones and breaches | 3 | Sree |
| Care plans, activity reports, tasks, reviews | 4 | [Teammate B] |
| Ambulance booking, disaster alerts, response centre, fall trigger | 5 | [Teammate C] |
| Pre-registration invites (invite someone with no account yet) | 1 | Sree |
| Keeping the emergency-contact copy fresh after a linked account changes | 1 | Sree |
| Undeleting a soft-deleted emergency contact | 1 | Sree |
| Owner-tier family member editing another family member's permissions (`PATCH /family/links/:id` is elderly-only today) | 1 | Sree |
| On-device (OS-level) geofencing for instant detection — today's check runs server-side on each location write, bounded by tracking cadence | 3 | Sree |

**Done as of this version:** `POST /emergency/alerts`, `GET /emergency/alerts`, `POST /emergency/alerts/:id/cancel`, `POST /emergency/alerts/:id/resolve`, `POST /emergency/alerts/:id/acknowledge`, `PATCH /emergency/alerts/:id/location`, `GET /emergency/family/alerts`, `GET /emergency/family/alerts/history`, `POST /emergency/locations`, `POST /emergency/device-tokens` — see the "Emergency alerts" and "Notification channels and escalation" sections above. `POST /family/invites`, `POST /family/invites/:id/accept`, `POST /family/invites/:id/decline`, `POST /family/links/:id/revoke`, `GET /family/links`, `POST /family/links/:id/emergency-contact`, `PATCH /family/links/:id` — see "Family Links" above. `POST /emergency/contacts`, `GET /emergency/contacts`, `PATCH /emergency/contacts/:id`, `DELETE /emergency/contacts/:id` — see "Emergency Contacts" above. `POST /emergency/geofences`, `GET /emergency/geofences`, `PATCH /emergency/geofences/:id`, `DELETE /emergency/geofences/:id`, `GET /emergency/geofences/:id/history`, `GET /emergency/locations/latest`, and server-side breach detection with auto-resolve-on-return — see "Geofencing" above. The family broadcast push tier — see "Notification channels and escalation" above.

`family_links` and `emergency_contacts` rows both must still be created directly (no management endpoints for either yet) — same situation, same reason: nothing in this step needed one, so nothing was built ahead of being asked for. See `backend/scripts/seed-test-users.js` for how development data gets in either table today.
