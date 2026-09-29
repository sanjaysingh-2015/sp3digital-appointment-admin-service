const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

process.env.DB_DIALECT = 'sqlite';
process.env.ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET || 'test-only-shared-secret';
process.env.ADMIN_JWT_AUDIENCE = process.env.ADMIN_JWT_AUDIENCE || 'sp3-appointment-admin-test';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';

function tokenFor(tenantUuid, userId, permissions) {
  return jwt.sign(
    { tenant_uuid: tenantUuid, user_id: userId, permissions },
    process.env.ADMIN_JWT_SECRET,
    { audience: process.env.ADMIN_JWT_AUDIENCE, expiresIn: '5m' },
  );
}

const TENANT_ADMIN_PERMISSIONS = [
  'appointment-admin:facility-closure:create',
  'appointment-admin:facility-closure:read',
  'appointment-admin:facility-closure:update',
];
const TENANT_USER_PERMISSIONS = ['appointment-admin:facility-closure:read'];

let app;
let server;
let baseUrl;

test.before(async () => {
  app = require('../src/app');
  const db = require('../src/models');
  await db.sequelize.sync({ force: true });

  await new Promise((resolve) => { server = app.listen(0, resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => { await new Promise((resolve) => server.close(resolve)); });

async function call(method, path, { token, body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  return { status: response.status, json: text ? JSON.parse(text) : null };
}

const BASE = '/api/v1/appointment-admin/facility-closures';

test('rejects requests with no bearer token', async () => {
  const { status } = await call('GET', BASE);
  assert.equal(status, 401);
});

test('TENANT_USER cannot create a closure (read-only, no maker-checker here)', async () => {
  const token = tokenFor(TENANT_A, 101, TENANT_USER_PERMISSIONS);
  const { status, json } = await call('POST', BASE, {
    token,
    body: { closureType: 'HOLIDAY', recurrenceType: 'ANNUAL', closureDate: '2027-01-26', closureName: 'Republic Day' },
  });
  assert.equal(status, 403);
  assert.equal(json.error.code, 'INSUFFICIENT_PERMISSION');
});

test('TENANT_ADMIN creates an ANNUAL holiday', async () => {
  const token = tokenFor(TENANT_A, 201, TENANT_ADMIN_PERMISSIONS);
  const { status, json } = await call('POST', BASE, {
    token,
    body: { closureType: 'HOLIDAY', recurrenceType: 'ANNUAL', closureDate: '2027-01-26', closureName: 'Republic Day' },
  });
  assert.equal(status, 201);
  assert.equal(json.recurrenceType, 'ANNUAL');
  assert.equal(json.closureDate, '2027-01-26');
  assert.equal(json.dayOfWeek, null);
  assert.equal(json.status, 'ACTIVE');
});

test('TENANT_ADMIN creates a WEEKLY off (every Sunday) with no closureDate', async () => {
  const token = tokenFor(TENANT_A, 201, TENANT_ADMIN_PERMISSIONS);
  const { status, json } = await call('POST', BASE, {
    token,
    body: { facilityId: 1, closureType: 'WEEKLY_OFF', recurrenceType: 'WEEKLY', dayOfWeek: 7, closureName: 'Sunday off' },
  });
  assert.equal(status, 201);
  assert.equal(json.recurrenceType, 'WEEKLY');
  assert.equal(json.dayOfWeek, 7);
  assert.equal(json.closureDate, null);
});

test('WEEKLY without dayOfWeek is rejected', async () => {
  const token = tokenFor(TENANT_A, 201, TENANT_ADMIN_PERMISSIONS);
  const { status, json } = await call('POST', BASE, {
    token,
    body: { closureType: 'WEEKLY_OFF', recurrenceType: 'WEEKLY', closureName: 'Missing day' },
  });
  assert.equal(status, 400);
  assert.equal(json.error.code, 'VALIDATION_ERROR');
});

test('ONE_TIME without closureDate is rejected', async () => {
  const token = tokenFor(TENANT_A, 201, TENANT_ADMIN_PERMISSIONS);
  const { status, json } = await call('POST', BASE, {
    token,
    body: { closureType: 'EMERGENCY', recurrenceType: 'ONE_TIME', closureName: 'Missing date' },
  });
  assert.equal(status, 400);
});

test('creates a ONE_TIME emergency closure scoped to a single facility', async () => {
  const token = tokenFor(TENANT_A, 201, TENANT_ADMIN_PERMISSIONS);
  const { status, json } = await call('POST', BASE, {
    token,
    body: { facilityId: 1, closureType: 'EMERGENCY', recurrenceType: 'ONE_TIME', closureDate: '2026-11-05', closureName: 'Water supply outage', reason: 'No water supply for the day' },
  });
  assert.equal(status, 201);
  assert.equal(json.facilityId, 1);
  assert.equal(json.reason, 'No water supply for the day');
});

test('TENANT_USER can list closures (read-only)', async () => {
  const token = tokenFor(TENANT_A, 101, TENANT_USER_PERMISSIONS);
  const { status, json } = await call('GET', BASE, { token });
  assert.equal(status, 200);
  assert.ok(json.data.length >= 3);
});

test('a different tenant cannot see this tenant\'s closures', async () => {
  const token = tokenFor(TENANT_B, 301, TENANT_ADMIN_PERMISSIONS);
  const { status, json } = await call('GET', BASE, { token });
  assert.equal(status, 200);
  assert.equal(json.data.length, 0);
});

test('filters by closureType and recurrenceType', async () => {
  const token = tokenFor(TENANT_A, 201, TENANT_ADMIN_PERMISSIONS);
  const { json } = await call('GET', `${BASE}?closureType=WEEKLY_OFF`, { token });
  assert.equal(json.data.length, 1);
  assert.equal(json.data[0].recurrenceType, 'WEEKLY');
});

test('TENANT_USER cannot edit a closure', async () => {
  const adminToken = tokenFor(TENANT_A, 201, TENANT_ADMIN_PERMISSIONS);
  const created = await call('GET', BASE, { token: adminToken });
  const targetId = created.json.data[0].closureId;

  const userToken = tokenFor(TENANT_A, 101, TENANT_USER_PERMISSIONS);
  const { status } = await call('PATCH', `${BASE}/${targetId}`, { token: userToken, body: { closureName: 'Hacked' } });
  assert.equal(status, 403);
});

test('switching recurrenceType from WEEKLY to ONE_TIME via PATCH requires closureDate in the same request', async () => {
  const token = tokenFor(TENANT_A, 201, TENANT_ADMIN_PERMISSIONS);
  const created = await call('POST', BASE, {
    token,
    body: { closureType: 'WEEKLY_OFF', recurrenceType: 'WEEKLY', dayOfWeek: 6, closureName: 'Saturday off' },
  });
  assert.equal(created.status, 201);

  const badSwitch = await call('PATCH', `${BASE}/${created.json.closureId}`, {
    token,
    body: { recurrenceType: 'ONE_TIME' },
  });
  assert.equal(badSwitch.status, 400);
  assert.equal(badSwitch.json.error.code, 'INVALID_RECURRENCE_FIELDS');

  const goodSwitch = await call('PATCH', `${BASE}/${created.json.closureId}`, {
    token,
    body: { recurrenceType: 'ONE_TIME', closureDate: '2026-12-25' },
  });
  assert.equal(goodSwitch.status, 200);
  assert.equal(goodSwitch.json.recurrenceType, 'ONE_TIME');
  assert.equal(goodSwitch.json.closureDate, '2026-12-25');
  assert.equal(goodSwitch.json.dayOfWeek, null);
});

test('TENANT_ADMIN cancels a closure (soft delete)', async () => {
  const token = tokenFor(TENANT_A, 201, TENANT_ADMIN_PERMISSIONS);
  const created = await call('POST', BASE, {
    token,
    body: { closureType: 'OTHER', recurrenceType: 'ONE_TIME', closureDate: '2026-12-31', closureName: 'To be cancelled' },
  });
  assert.equal(created.status, 201);

  const { status, json } = await call('POST', `${BASE}/${created.json.closureId}/cancel`, { token });
  assert.equal(status, 200);
  assert.equal(json.status, 'CANCELLED');

  // Row still exists (soft delete), fetchable by id.
  const getResult = await call('GET', `${BASE}/${created.json.closureId}`, { token });
  assert.equal(getResult.status, 200);
  assert.equal(getResult.json.status, 'CANCELLED');
});

test('TENANT_USER cannot cancel a closure', async () => {
  const adminToken = tokenFor(TENANT_A, 201, TENANT_ADMIN_PERMISSIONS);
  const list = await call('GET', BASE, { token: adminToken });
  const targetId = list.json.data[0].closureId;

  const userToken = tokenFor(TENANT_A, 101, TENANT_USER_PERMISSIONS);
  const { status } = await call('POST', `${BASE}/${targetId}/cancel`, { token: userToken });
  assert.equal(status, 403);
});
