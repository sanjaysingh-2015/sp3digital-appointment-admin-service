const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

process.env.DB_DIALECT = 'sqlite';
process.env.ADMIN_JWT_SECRET = 'test-only-shared-secret';
process.env.ADMIN_JWT_AUDIENCE = 'sp3-appointment-admin-test';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';

function tokenFor(tenantUuid, userId, permissions) {
  return jwt.sign(
    { tenant_uuid: tenantUuid, user_id: userId, permissions },
    process.env.ADMIN_JWT_SECRET,
    { audience: process.env.ADMIN_JWT_AUDIENCE, expiresIn: '5m' },
  );
}

const TENANT_READ = ['appointment-admin:appointment:read'];
const SUPERADMIN_PERMISSIONS = ['ALL_PERMISSIONS'];

let app;
let server;
let baseUrl;

test.before(async () => {
  app = require('../src/app');
  const db = require('../src/models');
  await db.sequelize.sync({ force: true });

  // Seed directly via the model — there's no create endpoint for
  // appointments yet (read-only admin visibility layer, see
  // routes/appointmentRoutes.js's header comment).
  const { Appointment } = db;
  await Appointment.bulkCreate([
    {
      tenantUuid: TENANT_A, facilityId: 1, facilityServiceId: 1, slotId: 1,
      patientRef: 'PAT-A-1', patientName: 'Ravi Kumar', patientPhone: '9876543210',
      appointmentDate: '2026-10-01', startTime: '09:00:00', endTime: '09:30:00',
      tokenNumber: 'A1', status: 'BOOKED',
    },
    {
      tenantUuid: TENANT_A, facilityId: 1, facilityServiceId: 1, slotId: 2,
      patientRef: 'PAT-A-2', patientName: 'Anita Singh', patientPhone: '9123456780',
      appointmentDate: '2026-10-02', startTime: '10:00:00', endTime: '10:30:00',
      tokenNumber: 'A2', status: 'CANCELLED',
    },
    {
      tenantUuid: TENANT_B, facilityId: 5, facilityServiceId: 5, slotId: 3,
      patientRef: 'PAT-B-1', patientName: 'Priya Sharma', patientPhone: '9988776655',
      appointmentDate: '2026-10-01', startTime: '11:00:00', endTime: '11:30:00',
      tokenNumber: 'B1', status: 'BOOKED',
    },
  ]);

  await new Promise((resolve) => { server = app.listen(0, resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => { await new Promise((resolve) => server.close(resolve)); });

async function call(method, path, { token } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const text = await response.text();
  return { status: response.status, json: text ? JSON.parse(text) : null };
}

const BASE = '/api/v1/appointment-admin/appointments';

test('rejects requests with no bearer token', async () => {
  const { status } = await call('GET', BASE);
  assert.equal(status, 401);
});

test('a caller with no READ permission is rejected', async () => {
  const token = tokenFor(TENANT_A, 1, []);
  const { status, json } = await call('GET', BASE, { token });
  assert.equal(status, 403);
  assert.equal(json.error.code, 'INSUFFICIENT_PERMISSION');
});

test('TENANT_ADMIN/TENANT_USER only ever see their own tenant\'s appointments', async () => {
  const token = tokenFor(TENANT_A, 201, TENANT_READ);
  const { status, json } = await call('GET', BASE, { token });
  assert.equal(status, 200);
  assert.equal(json.data.length, 2);
  assert.ok(json.data.every((row) => row.tenantUuid === TENANT_A));
});

test('a tenant caller cannot see another tenant\'s appointments even via ?tenantUuid=', async () => {
  const token = tokenFor(TENANT_A, 201, TENANT_READ);
  const { status, json } = await call('GET', `${BASE}?tenantUuid=${TENANT_B}`, { token });
  assert.equal(status, 200);
  // tenantUuid query param is silently ignored for a non-SUPERADMIN caller
  // — they still only see their own tenant, not TENANT_B's.
  assert.ok(json.data.every((row) => row.tenantUuid === TENANT_A));
});

test('SUPERADMIN (ALL_PERMISSIONS) sees every tenant\'s appointments by default', async () => {
  const token = tokenFor(TENANT_A, 1, SUPERADMIN_PERMISSIONS);
  const { status, json } = await call('GET', BASE, { token });
  assert.equal(status, 200);
  assert.equal(json.data.length, 3);
  assert.ok(json.data.some((row) => row.tenantUuid === TENANT_A));
  assert.ok(json.data.some((row) => row.tenantUuid === TENANT_B));
});

test('SUPERADMIN can narrow to one tenant with ?tenantUuid=', async () => {
  const token = tokenFor(TENANT_A, 1, SUPERADMIN_PERMISSIONS);
  const { status, json } = await call('GET', `${BASE}?tenantUuid=${TENANT_B}`, { token });
  assert.equal(status, 200);
  assert.equal(json.data.length, 1);
  assert.equal(json.data[0].tenantUuid, TENANT_B);
});

test('search matches patient name', async () => {
  const token = tokenFor(TENANT_A, 201, TENANT_READ);
  const { json } = await call('GET', `${BASE}?search=Anita`, { token });
  assert.equal(json.data.length, 1);
  assert.equal(json.data[0].patientName, 'Anita Singh');
});

test('search matches patient phone', async () => {
  const token = tokenFor(TENANT_A, 201, TENANT_READ);
  const { json } = await call('GET', `${BASE}?search=9876543210`, { token });
  assert.equal(json.data.length, 1);
  assert.equal(json.data[0].patientPhone, '9876543210');
});

test('search matches token number', async () => {
  const token = tokenFor(TENANT_A, 201, TENANT_READ);
  const { json } = await call('GET', `${BASE}?search=A2`, { token });
  assert.equal(json.data.length, 1);
  assert.equal(json.data[0].tokenNumber, 'A2');
});

test('filters by status', async () => {
  const token = tokenFor(TENANT_A, 201, TENANT_READ);
  const { json } = await call('GET', `${BASE}?status=CANCELLED`, { token });
  assert.equal(json.data.length, 1);
  assert.equal(json.data[0].status, 'CANCELLED');
});

test('get by id respects tenant isolation (404 across tenants)', async () => {
  const listToken = tokenFor(TENANT_A, 201, TENANT_READ);
  const { json: list } = await call('GET', BASE, { token: listToken });
  const idInTenantA = list.data[0].appointmentId;

  const otherTenantToken = tokenFor(TENANT_B, 301, TENANT_READ);
  const { status } = await call('GET', `${BASE}/${idInTenantA}`, { token: otherTenantToken });
  assert.equal(status, 404);
});

test('SUPERADMIN can get any tenant\'s appointment by id', async () => {
  const listToken = tokenFor(TENANT_A, 1, SUPERADMIN_PERMISSIONS);
  const { json: list } = await call('GET', BASE, { token: listToken });
  const idInTenantB = list.data.find((row) => row.tenantUuid === TENANT_B).appointmentId;

  const { status, json } = await call('GET', `${BASE}/${idInTenantB}`, { token: listToken });
  assert.equal(status, 200);
  assert.equal(json.appointmentId, idInTenantB);
});
