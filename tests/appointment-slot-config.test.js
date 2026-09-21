const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

process.env.DB_DIALECT = 'sqlite';
process.env.ADMIN_JWT_SECRET = 'test-only-shared-secret';
process.env.ADMIN_JWT_AUDIENCE = 'sp3-appointment-admin-test';
process.env.APPOINTMENT_SERVICE_INTERNAL_TOKEN = 'test-internal-service-token';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';

// Mirrors what identity-admin-service actually grants (see that repo's
// database/seeds/appointment-slot-config-rbac.sql): TENANT_USER gets
// create+read only, TENANT_ADMIN gets all four.
const TENANT_USER_PERMISSIONS = [
  'appointment-admin:slot-config:create',
  'appointment-admin:slot-config:read',
];
const TENANT_ADMIN_PERMISSIONS = [
  'appointment-admin:slot-config:create',
  'appointment-admin:slot-config:read',
  'appointment-admin:slot-config:update',
  'appointment-admin:slot-config:approve',
];

function tokenFor(tenantUuid, userId, permissions) {
  return jwt.sign(
    { tenant_uuid: tenantUuid, user_id: userId, permissions },
    process.env.ADMIN_JWT_SECRET,
    { audience: process.env.ADMIN_JWT_AUDIENCE, expiresIn: '5m' },
  );
}

let app;
let server;
let baseUrl;

test.before(async () => {
  app = require('../src/app');
  const db = require('../src/models');
  await db.sequelize.sync({ force: true }); // fresh in-memory schema per run

  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

async function call(method, path, { token, body, headers } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  const json = text ? JSON.parse(text) : null;
  return { status: response.status, json };
}

const BASE = '/api/v1/appointment-admin/slot-configs';

function validPayload(overrides = {}) {
  return {
    facilityId: 1,
    facilityServiceId: 1,
    dayOfWeek: 1,
    startTime: '09:00',
    endTime: '13:00',
    slotDurationMinutes: 30,
    capacityPerSlot: 1,
    effectiveFrom: '2026-10-01',
    ...overrides,
  };
}

// ---------------------------------------------------------------------
// Auth boundary
// ---------------------------------------------------------------------

test('rejects requests with no bearer token', async () => {
  const { status, json } = await call('GET', BASE);
  assert.equal(status, 401);
  assert.equal(json.error.code, 'UNAUTHENTICATED');
});

test('rejects a JWT with no tenant_uuid claim', async () => {
  const badToken = jwt.sign({ user_id: 1 }, process.env.ADMIN_JWT_SECRET, {
    audience: process.env.ADMIN_JWT_AUDIENCE,
    expiresIn: '5m',
  });
  const { status, json } = await call('GET', BASE, { token: badToken });
  assert.equal(status, 403);
  assert.equal(json.error.code, 'TENANT_CLAIM_REQUIRED');
});

// ---------------------------------------------------------------------
// CREATE — TENANT_USER lands PENDING_APPROVAL, TENANT_ADMIN auto-approves
// ---------------------------------------------------------------------

let userCreatedId;
let adminCreatedId;

test('TENANT_USER creates a slot config -> PENDING_APPROVAL', async () => {
  const token = tokenFor(TENANT_A, 101, TENANT_USER_PERMISSIONS);
  const { status, json } = await call('POST', BASE, { token, body: validPayload() });
  assert.equal(status, 201);
  assert.equal(json.approvalStatus, 'PENDING_APPROVAL');
  assert.equal(json.reviewedBy, null);
  assert.equal(json.createdBy, 101);
  userCreatedId = json.slotConfigId;
});

test('TENANT_ADMIN creates a slot config -> auto-APPROVED', async () => {
  const token = tokenFor(TENANT_A, 201, TENANT_ADMIN_PERMISSIONS);
  const { status, json } = await call('POST', BASE, {
    token,
    body: validPayload({ dayOfWeek: 2 }),
  });
  assert.equal(status, 201);
  assert.equal(json.approvalStatus, 'APPROVED');
  assert.equal(json.reviewedBy, 201);
  assert.ok(json.reviewedOn);
  adminCreatedId = json.slotConfigId;
});

test('rejects endTime <= startTime', async () => {
  const token = tokenFor(TENANT_A, 101, TENANT_USER_PERMISSIONS);
  const { status, json } = await call('POST', BASE, {
    token,
    body: validPayload({ startTime: '13:00', endTime: '09:00' }),
  });
  assert.equal(status, 400);
  assert.equal(json.error.code, 'VALIDATION_ERROR');
});

test('a caller with no CREATE permission is rejected', async () => {
  const token = tokenFor(TENANT_A, 999, ['appointment-admin:slot-config:read']);
  const { status, json } = await call('POST', BASE, { token, body: validPayload() });
  assert.equal(status, 403);
  assert.equal(json.error.code, 'INSUFFICIENT_PERMISSION');
});

// ---------------------------------------------------------------------
// EDIT — TENANT_ADMIN only
// ---------------------------------------------------------------------

test('TENANT_USER cannot edit a slot config (403)', async () => {
  const token = tokenFor(TENANT_A, 101, TENANT_USER_PERMISSIONS);
  const { status, json } = await call('PATCH', `${BASE}/${userCreatedId}`, {
    token,
    body: { capacityPerSlot: 2 },
  });
  assert.equal(status, 403);
  assert.equal(json.error.code, 'INSUFFICIENT_PERMISSION');
});

test('TENANT_ADMIN can edit any slot config, including one a TENANT_USER created', async () => {
  const token = tokenFor(TENANT_A, 201, TENANT_ADMIN_PERMISSIONS);
  const { status, json } = await call('PATCH', `${BASE}/${userCreatedId}`, {
    token,
    body: { capacityPerSlot: 3 },
  });
  assert.equal(status, 200);
  assert.equal(json.capacityPerSlot, 3);
  assert.equal(json.modifiedBy, 201);
  // Editing does not itself change approval state — approve/reject are
  // separate, explicit actions.
  assert.equal(json.approvalStatus, 'PENDING_APPROVAL');
});

// ---------------------------------------------------------------------
// APPROVE / REJECT — TENANT_ADMIN only, state-machine guarded
// ---------------------------------------------------------------------

test('TENANT_USER cannot approve a slot config (403)', async () => {
  const token = tokenFor(TENANT_A, 101, TENANT_USER_PERMISSIONS);
  const { status, json } = await call('POST', `${BASE}/${userCreatedId}/approve`, { token });
  assert.equal(status, 403);
  assert.equal(json.error.code, 'INSUFFICIENT_PERMISSION');
});

test('TENANT_ADMIN approves a TENANT_USER-created slot config', async () => {
  const token = tokenFor(TENANT_A, 201, TENANT_ADMIN_PERMISSIONS);
  const { status, json } = await call('POST', `${BASE}/${userCreatedId}/approve`, { token });
  assert.equal(status, 200);
  assert.equal(json.approvalStatus, 'APPROVED');
  assert.equal(json.reviewedBy, 201);
});

test('approving an already-approved slot config is rejected (409)', async () => {
  const token = tokenFor(TENANT_A, 201, TENANT_ADMIN_PERMISSIONS);
  const { status, json } = await call('POST', `${BASE}/${userCreatedId}/approve`, { token });
  assert.equal(status, 409);
  assert.equal(json.error.code, 'INVALID_APPROVAL_STATE');
});

test('TENANT_ADMIN rejects a PENDING_APPROVAL slot config with a reason', async () => {
  const userToken = tokenFor(TENANT_A, 101, TENANT_USER_PERMISSIONS);
  const created = await call('POST', BASE, { token: userToken, body: validPayload({ dayOfWeek: 3 }) });
  assert.equal(created.status, 201);

  const adminToken = tokenFor(TENANT_A, 201, TENANT_ADMIN_PERMISSIONS);
  const { status, json } = await call('POST', `${BASE}/${created.json.slotConfigId}/reject`, {
    token: adminToken,
    body: { rejectionReason: 'Overlaps with an existing approved schedule' },
  });
  assert.equal(status, 200);
  assert.equal(json.approvalStatus, 'REJECTED');
  assert.equal(json.rejectionReason, 'Overlaps with an existing approved schedule');
});

test('rejecting without a reason fails validation', async () => {
  const userToken = tokenFor(TENANT_A, 101, TENANT_USER_PERMISSIONS);
  const created = await call('POST', BASE, { token: userToken, body: validPayload({ dayOfWeek: 4 }) });

  const adminToken = tokenFor(TENANT_A, 201, TENANT_ADMIN_PERMISSIONS);
  const { status, json } = await call('POST', `${BASE}/${created.json.slotConfigId}/reject`, {
    token: adminToken,
    body: {},
  });
  assert.equal(status, 400);
  assert.equal(json.error.code, 'VALIDATION_ERROR');
});

// ---------------------------------------------------------------------
// LIST — both roles see the same tenant-wide list; filterable
// ---------------------------------------------------------------------

test('TENANT_USER can list slot configs (sees admin-created ones too)', async () => {
  const token = tokenFor(TENANT_A, 101, TENANT_USER_PERMISSIONS);
  const { status, json } = await call('GET', BASE, { token });
  assert.equal(status, 200);
  assert.ok(json.data.length >= 2);
  assert.ok(json.data.some((row) => row.slotConfigId === adminCreatedId));
});

test('filters the list by approvalStatus', async () => {
  const token = tokenFor(TENANT_A, 201, TENANT_ADMIN_PERMISSIONS);
  const { status, json } = await call('GET', `${BASE}?approvalStatus=REJECTED`, { token });
  assert.equal(status, 200);
  assert.ok(json.data.length >= 1);
  assert.ok(json.data.every((row) => row.approvalStatus === 'REJECTED'));
});

// ---------------------------------------------------------------------
// Tenant isolation
// ---------------------------------------------------------------------

test('a different tenant cannot see or act on tenant A\'s slot config', async () => {
  const tenantBAdmin = tokenFor(TENANT_B, 301, TENANT_ADMIN_PERMISSIONS);

  const getResult = await call('GET', `${BASE}/${adminCreatedId}`, { token: tenantBAdmin });
  assert.equal(getResult.status, 404);
  assert.equal(getResult.json.error.code, 'SLOT_CONFIG_NOT_FOUND');

  const approveResult = await call('POST', `${BASE}/${adminCreatedId}/approve`, { token: tenantBAdmin });
  assert.equal(approveResult.status, 404);

  const listResult = await call('GET', BASE, { token: tenantBAdmin });
  assert.equal(listResult.status, 200);
  assert.equal(listResult.json.data.length, 0);
});

// ---------------------------------------------------------------------
// Referential integrity
// ---------------------------------------------------------------------

test('an invalid resourceId is rejected as a clean 400, not a raw DB error', async () => {
  const token = tokenFor(TENANT_A, 201, TENANT_ADMIN_PERMISSIONS);
  const { status, json } = await call('POST', BASE, {
    token,
    body: validPayload({ dayOfWeek: 5, resourceId: 999999 }),
  });
  assert.equal(status, 400);
  assert.equal(json.error.code, 'INVALID_REFERENCE');
});

// ---------------------------------------------------------------------
// Internal service token path
// ---------------------------------------------------------------------

test('internal service token requires X-Tenant-Uuid header', async () => {
  const { status, json } = await call('GET', BASE, {
    token: process.env.APPOINTMENT_SERVICE_INTERNAL_TOKEN,
  });
  assert.equal(status, 400);
  assert.equal(json.error.code, 'TENANT_HEADER_REQUIRED');
});

test('internal service token with tenant header can list (ALL_PERMISSIONS bypass)', async () => {
  const { status, json } = await call('GET', BASE, {
    token: process.env.APPOINTMENT_SERVICE_INTERNAL_TOKEN,
    headers: { 'X-Tenant-Uuid': TENANT_A },
  });
  assert.equal(status, 200);
  assert.ok(json.data.length > 0);
});
