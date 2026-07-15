# Infinite CRM — Public API v1

REST API for external automations (Kam, n8n, Make, etc.) to create and update leads in Infinite CRM without driving the browser UI.

**Base URL:** `https://api.infinite-crm.net/api/v1`

**Auth:** every request sends a per-user API key in either header:

```
X-API-Key: ic_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```
or
```
Authorization: Bearer ic_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

The user who owns the key generates it in **Infinite CRM → Settings → Infinite API keys** and shares it with the automation. If a key leaks, the owner revokes it in the same panel; the key stops working instantly. Every operation is scoped to the owner's user_id — the automation physically cannot see or touch anyone else's data.

**Rate limit:** 30 requests / second per key. Cloudflare returns HTTP 429 when exceeded.

**Response format:** JSON in, JSON out. Field names in requests/responses are **camelCase**; the API maps them to the CRM's internal snake_case columns for you.

**Errors:** every non-2xx response has a JSON body with `{ "error": "message" }` and, where useful, a `code` string like `"duplicate"`.

---

## Endpoints

### 1. Find a lead by phone or email (dedup)

```
GET /leads?phone=+18325550101
GET /leads?email=jane%40example.com
```

Response:
```json
{ "found": true, "lead": { "id": "...", "firstName": "Jane", "phone": "+18325550101", "stage": "interested", ... } }
```
or when nothing matches:
```json
{ "found": false, "lead": null }
```

Phone matching normalizes to E.164 (`+1XXXXXXXXXX`) before lookup, so you can send any US format.

**Use this before creating.** Kam should always dedupe before POST /leads.

### 2. Create a lead (with optional upsert-by-phone)

```
POST /leads
POST /leads?upsert=true
```

Body (all fields optional except phone OR email):
```json
{
  "firstName": "Jane",
  "lastName": "Doe",
  "phone": "832-555-0101",
  "email": "jane@example.com",
  "state": "TX",
  "zip": "77008",
  "dob": "1985-06-15",
  "ageBand": "40-54",
  "gender": "F",
  "householdSize": "2",
  "income": "$75,000 - $125,000/yr",
  "campaign": "America Choice Network",
  "source": "Kam booking",
  "cost": 22,
  "stage": "apt",
  "plan": "159.06 pa p1 saph 07/01 eff",
  "premium": 159,
  "effectiveDate": "2026-07-01",
  "notesRaw": "husband self-employed, prev USHA, wants dental",
  "notesStatus": "booked appt for Wed 2pm",
  "externalId": "kam-booking-12345"
}
```

- Phone is normalized to E.164 automatically.
- `effectiveDate` accepts `YYYY-MM-DD` or a full ISO datetime (date portion is used).
- **Setting `stage` auto-appends an activity log row** — same as when the CRM UI does it.

**Upsert:** append `?upsert=true`. If a lead with the same phone (or email, if no phone) already exists, the existing row is patched instead of a duplicate being created. Response includes `"action": "updated"` or `"action": "created"`. This is the single most important robustness feature — retries are safe.

Response (201 Created):
```json
{
  "lead": { "id": "uuid-here", "firstName": "Jane", "phone": "+18325550101", ... },
  "action": "created",
  "upserted": false
}
```

Duplicate without upsert returns 409 with `{ "error": "Lead already exists", "code": "duplicate" }`.

### 3. Update a lead

```
PATCH /leads/{id}
```

Body — any subset of the fields listed in "Create a lead":
```json
{
  "stage": "sold",
  "plan": "159.06 pa p1 saph 07/01 eff",
  "premium": 159,
  "effectiveDate": "2026-07-01"
}
```

Special note behavior:
- `notesRaw` **appends** to existing notes by default (accumulate facts over a conversation). Set `"notesMode": "replace"` to overwrite instead.
- `notesStatus` **replaces** the current status summary each time.

Stage changes are automatically written to the activity log ("Stage → sold (via API)").

Response: the updated lead as `{ "lead": {...} }`.

### 4. Add / remove tags (maps to stage)

```
POST /leads/{id}/tags
```
```json
{ "add": ["#appointment"], "remove": [] }
```

Infinite CRM uses a single **stage** per lead, not multiple free-form tags. The API accepts tag-style input for Kam's convenience and resolves each tag against the user's stage catalog (case-insensitive, `#` prefix stripped). The last successful `add` wins as the new stage; a `remove` matching the current stage clears it.

Get the exact tag/stage names from `GET /tags` or `GET /stages`.

Response: `{ "lead": {...}, "stage": "apt" }` or `{ "stage": "apt", "changed": false }` if no change.

### 5. Append an activity entry (activity log / counters)

```
POST /leads/{id}/activity
```
```json
{ "type": "call", "note": "Left voicemail" }
```

Valid `type` values match the CRM's activity kinds: `call`, `text`, `email`, `note`, `status`, `apt`.

Response: `{ "ok": true }` (201).

### 6. Push a contact to Nic's Warm Bucket

```
POST /warm-bucket
```

Use this when Kam has decided a contact is high-priority and needs a human callback. The contact shows up in Nic's Warm Bucket page with a "High priority" badge, sorted above the PitchPrfct auto-scan results. Nic can then call, promote to a CRM stage, or dismiss.

Body:
```json
{
  "phone": "+18325550101",
  "firstName": "Jane",
  "lastName": "Doe",
  "email": "jane@example.com",
  "state": "TX",
  "zip": "77008",
  "reason": "Asked about family plan with dental, mentioned husband self-employed",
  "note": "She wants callback after 6pm CT",
  "priority": 4,
  "externalId": "kam-warmbucket-9421"
}
```

- `phone` is required. Everything else is optional.
- `priority` is 1–5 (default 3). Higher = more urgent; the bucket sorts by priority.
- `reason` and `note` both show up in the focus view — use `reason` for the AI's short summary ("why this one matters") and `note` for detail Nic will want in front of him when calling.
- `externalId` is your own identifier; used for idempotency, so retrying the same POST won't duplicate.

Response (201 Created):
```json
{ "ok": true, "entry": { "id": 42, "phone": "+18325550101", ... }, "action": "queued" }
```

Idempotent — resending with the same phone updates the same entry instead of duplicating.

### 7. List available stages / tags

```
GET /stages
GET /tags
```

Both return the same list — the user's stage catalog. Use `id` when writing (POST/PATCH `stage`); use `label` for display.

```json
{
  "stages": [
    { "id": "not-started", "label": "Not Started", "color": "#8899AA" },
    { "id": "interested",  "label": "Interested",  "color": "#3B82F6" },
    { "id": "apt",         "label": "Appointment", "color": "#F59E0B" },
    { "id": "quoted",      "label": "Quoted",      "color": "#A78BFA" },
    { "id": "sold",        "label": "Sold",        "color": "#00E5C3" },
    { "id": "ghosted",     "label": "Ghosted",     "color": "#5A6A7A" }
  ]
}
```

---

## Field reference

| API field (camelCase) | DB column | Notes |
|---|---|---|
| `firstName`, `lastName` | `first_name`, `last_name` | |
| `phone` | `phone` | Normalized to E.164 on write |
| `email` | `email` | Lowercased on write |
| `state`, `zip`, `city`, `address` | same | |
| `dob` | `dob` | `YYYY-MM-DD` |
| `ageBand` | `age_range` | e.g. `"25-64"` |
| `age` | `age` | numeric |
| `gender`, `smoker` | same | |
| `householdSize` | `household` | |
| `income` | `income` | Free text — the CRM UI accepts both a number and a range like `"$75,000 - $125,000/yr"` |
| `campaign`, `source` | same | |
| `cost` | `price` | numeric (what you paid for the lead) |
| `stage` | `stage` | Must match a `GET /stages` id |
| `plan`, `planChoice` | `plan_choice` | free text — Kam's shorthand accepted |
| `premium` | `premium` | monthly $ |
| `carrier` | `carrier` | |
| `effectiveDate` | `effective_date` | `YYYY-MM-DD` |
| `notesRaw` | `notes` | Left box — facts. Appends by default |
| `notesStatus` | `notes_b` | Right box — status summary. Replaces |
| `comments` | `comments` | Marketplace/vendor comments |
| `bestContactTime` | `best_contact_time` | |
| `monthlyBudget` | `monthly_budget` | |
| `externalId` | `external_id` | Your automation's own ID (idempotency) |
| `receivedAt` (read-only) | `created_at` | When the lead entered the CRM |
| `respondedStatus` (read-only) | `pp_response_status` | `"awaiting"` or `"responded"` (PitchPrfct) |

---

## curl examples

Dedupe:
```bash
curl -H "X-API-Key: ic_XXX..." \
  "https://api.infinite-crm.net/api/v1/leads?phone=+18325550101"
```

Create with upsert:
```bash
curl -X POST \
  -H "X-API-Key: ic_XXX..." \
  -H "Content-Type: application/json" \
  -d '{"firstName":"Jane","phone":"+18325550101","stage":"apt","plan":"159.06 pa p1 saph 07/01 eff"}' \
  "https://api.infinite-crm.net/api/v1/leads?upsert=true"
```

Patch stage:
```bash
curl -X PATCH \
  -H "X-API-Key: ic_XXX..." \
  -H "Content-Type: application/json" \
  -d '{"stage":"sold","premium":159,"effectiveDate":"2026-07-01"}' \
  "https://api.infinite-crm.net/api/v1/leads/UUID_HERE"
```

Append notes:
```bash
curl -X PATCH \
  -H "X-API-Key: ic_XXX..." \
  -H "Content-Type: application/json" \
  -d '{"notesRaw":"husband asked about vision — mentioned $50 deductible"}' \
  "https://api.infinite-crm.net/api/v1/leads/UUID_HERE"
```

Get stage catalog:
```bash
curl -H "X-API-Key: ic_XXX..." \
  "https://api.infinite-crm.net/api/v1/stages"
```

Add tag (= set stage):
```bash
curl -X POST \
  -H "X-API-Key: ic_XXX..." \
  -H "Content-Type: application/json" \
  -d '{"add":["#appointment"]}' \
  "https://api.infinite-crm.net/api/v1/leads/UUID_HERE/tags"
```

---

## What's NOT supported (by design)

- No delete endpoints
- No bulk-delete
- No auth/user management
- No admin operations
- No cross-user data access (a key can only see its owner's data)

Keys are scoped to `leads:read`, `leads:write`, `tags:read`, `tags:write`, `stages:read`, `activity:write` by default. Nothing dangerous is exposed.

---

## Support

Questions or bug reports → Nic (`murrayhealthadvising@gmail.com`).
