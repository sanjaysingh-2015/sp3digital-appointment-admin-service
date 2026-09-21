# sp3digital-appointment-service

Appointment slot configuration for the SP3 Digital platform: recurring
weekly slot rules per facility service, with a TENANT_USER/TENANT_ADMIN
maker-checker approval workflow.

## What's here (and what isn't, yet)

This first slice covers **slot configuration** only:
`appointment_slot_configs` (the recurring weekly rule) and
`facility_resources` (the optional doctor/counter/equipment a rule can be
scoped to). The rest of the appointments schema — `appointment_slots`
(generated bookable instances), `facility_closures`, `appointments`,
waitlist, reminders — is defined in `database/complete_db_script/` but has
no service code here yet. Slot generation (turning an APPROVED config into
concrete dated `appointment_slots` rows) is a separate background job,
also not part of this deliverable.

## Role matrix (enforced, not just documented)

| Action | TENANT_USER | TENANT_ADMIN |
|---|---|---|
| Create a slot config | ✅ (lands `PENDING_APPROVAL`) | ✅ (auto-`APPROVED`) |
| List / view | ✅ (tenant-wide, not just their own) | ✅ |
| Edit | ❌ 403 | ✅ |
| Approve / Reject | ❌ 403 | ✅ |

This is enforced by `authorize()` in `src/middleware/authentication.js`
against fine-grained permission codes in the caller's JWT
(`appointment-admin:slot-config:{create,read,update,approve}`) — **not** by
checking a role name. See `src/utils/permissions.js`.

**Before this works end-to-end**, identity-admin-service needs to grant
those four permission codes to the `TENANT_ADMIN` and `TENANT_USER` roles
— see `database/seeds/appointment-slot-config-rbac.sql` in that repo
(delivered alongside this service). Without it, every request 403s with
`INSUFFICIENT_PERMISSION` regardless of who's calling.

## Setup

```bash
npm install
cp .env.example .env   # fill in ADMIN_JWT_SECRET etc. — must match
                        # identity-admin-service's signing config exactly
npm run start           # or: npm run dev
```

Create the database first (or run the app once against MySQL with an
empty DB — `sequelize.sync({ alter: false })` will create tables that
don't exist yet, but won't alter ones that do):

```bash
mysql -u root -p < database/complete_db_script/script-sp3digital_appointments.sql
```

## Tests

```bash
npm test
```

Runs against an in-memory SQLite DB (`DB_DIALECT=sqlite`, set
automatically by the test file) — no external DB needed. 19 tests cover
the auth boundary, the full TENANT_USER/TENANT_ADMIN permission split, the
approval state machine (including rejecting a double-approve), tenant
isolation, and the `resourceId` FK constraint being surfaced as a clean
400 instead of a raw DB error.

## API

Base path: `/api/v1/appointment-admin`

| Method | Path | Permission required |
|---|---|---|
| POST | `/slot-configs` | `slot-config:create` |
| GET | `/slot-configs` | `slot-config:read` (filters: `facilityId`, `facilityServiceId`, `approvalStatus`, `status`, plus pagination) |
| GET | `/slot-configs/:id` | `slot-config:read` |
| PATCH | `/slot-configs/:id` | `slot-config:update` |
| POST | `/slot-configs/:id/approve` | `slot-config:approve` (must currently be `PENDING_APPROVAL`) |
| POST | `/slot-configs/:id/reject` | `slot-config:approve` (body: `{ rejectionReason }`, required) |

## Data ownership / auth boundary

Same pattern as organization-admin-service: `tenant_uuid`, `facility_id`,
and `facility_service_id` are cross-database logical references (owned by
identity-admin-service and organization-admin-service respectively), never
enforced as real FKs here — see the header comment in
`database/complete_db_script/script-sp3digital_appointments.sql`.
`resource_id` **is** a real, enforced FK (`facility_resources` lives in
this same database) — see the comment in `src/models/index.js` for why
that one case is different.

This service never signs its own JWTs — it only verifies tokens minted by
identity-admin-service, using the exact same `ADMIN_JWT_SECRET` /
`ADMIN_JWKS_URL` verification logic as organization-admin-service (kept
byte-for-byte in sync on purpose — see the comment atop
`src/middleware/authentication.js`).
