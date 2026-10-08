const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const jwt = require('jsonwebtoken');

process.env.DB_DIALECT = 'sqlite';
process.env.ADMIN_JWT_SECRET = 'test-only-shared-secret';
process.env.ADMIN_JWT_AUDIENCE = 'sp3-appointment-admin-test';
process.env.APPOINTMENT_SERVICE_INTERNAL_TOKEN = 'test-internal-service-token';
delete process.env.PROVIDER_SERVICE_URL;

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';

const tokenFor = (tenantUuid) =>
  jwt.sign({ tenant_uuid: tenantUuid, user_id: 9, permissions: ['ALL_PERMISSIONS'] }, process.env.ADMIN_JWT_SECRET, {
    audience: process.env.ADMIN_JWT_AUDIENCE,
    expiresIn: '5m',
  });
const adminA = tokenFor(TENANT_A);
const adminB = tokenFor(TENANT_B);

// What provider-admin-service would answer for GET /affiliations/:id.
const provider = (over = {}) => ({ providerId: 1, displayName: 'Dr. Asha Verma', providerType: 'DOCTOR', status: 'ACTIVE', verificationStatus: 'VERIFIED', ...over });
const affiliation = (over = {}) => ({
  providerId: 1, organizationId: 1, facilityId: 10, availabilityType: 'PHYSICAL', status: 'ACTIVE',
  facilityServiceIds: [100, 101], effectiveFrom: null, effectiveTo: null, provider: provider(), ...over,
});
const AFFILIATIONS = {
  1: affiliation({ affiliationId: 1 }),
  2: affiliation({ affiliationId: 2, provider: provider({ displayName: 'Dr. Unverified', verificationStatus: 'PENDING' }) }),
  3: affiliation({ affiliationId: 3, availabilityType: 'OTHER' }),
  4: affiliation({ affiliationId: 4, facilityId: 11 }),
  5: affiliation({ affiliationId: 5, effectiveTo: '2027-03-31' }),
  6: affiliation({ affiliationId: 6, status: 'ENDED' }),
  7: affiliation({ affiliationId: 7, provider: provider({ providerId: 2, displayName: 'Dr. Meera Rao' }), providerId: 2 }),
  8: affiliation({ affiliationId: 8, facilityId: null }),
  // tenant B's own doctor, invisible to tenant A (404 below)
};

let providerService;
let providerRequests = [];
let server;
let baseUrl;

test.before(async () => {
  providerService = http.createServer((req, res) => {
    providerRequests.push({ url: req.url, authorization: req.headers.authorization });
    const match = req.url.match(/^\/affiliations\/(\d+)$/);
    const found = match && AFFILIATIONS[match[1]];
    // tenant B sees nothing — mimics the provider service's own tenant scoping
    if (match && match[1] === '77') {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: { code: 'FORBIDDEN' } }));
    }
    if (!found || req.headers.authorization === `Bearer ${adminB}`) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: { code: 'AFFILIATION_NOT_FOUND' } }));
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(found));
  });
  await new Promise((resolve) => providerService.listen(0, resolve));
  process.env.PROVIDER_SERVICE_URL = `http://127.0.0.1:${providerService.address().port}`;

  const app = require('../src/app');
  const db = require('../src/models');
  await db.sequelize.sync({ force: true });
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await new Promise((resolve) => providerService.close(resolve));
});

async function call(method, path, { token, body } = {}) {
  const response = await fetch(`${baseUrl}/api/v1/appointment-admin${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  return { status: response.status, json: text ? JSON.parse(text) : null };
}

const rule = (over = {}) => ({
  facilityId: 10, facilityServiceId: 100, recurrenceType: 'WEEKLY', dayOfWeek: 1,
  startTime: '09:00', endTime: '13:00', slotDurationMinutes: 15, capacityPerSlot: 1,
  effectiveFrom: '2026-11-01', ...over,
});
const create = (over, token = adminA) => call('POST', '/slot-configs', { token, body: rule(over) });

let firstRule;

test('a slot rule can be given to a doctor; the resource is created on first use', async () => {
  const { status, json } = await create({ providerAffiliationId: 1 });
  assert.equal(status, 201, JSON.stringify(json));
  firstRule = json;
  assert.equal(json.resourceName, 'Dr. Asha Verma');
  assert.equal(json.providerId, 1);
  assert.equal(json.providerAffiliationId, 1);
  assert.ok(json.resourceId);
  // the caller's own token is what reaches the provider service
  assert.equal(providerRequests.at(-1).authorization, `Bearer ${adminA}`);
});

test('a second rule for the same doctor and service reuses the same resource', async () => {
  const { status, json } = await create({ providerAffiliationId: 1, dayOfWeek: 3 });
  assert.equal(status, 201);
  assert.equal(json.resourceId, firstRule.resourceId);
  // ...while another service of the same placement gets its own resource
  const other = await create({ providerAffiliationId: 1, facilityServiceId: 101 });
  assert.equal(other.status, 201);
  assert.notEqual(other.json.resourceId, firstRule.resourceId);
});

test('the doctor must be set up for exactly this facility and service', async () => {
  const wrongFacility = await create({ providerAffiliationId: 4 });
  assert.equal(wrongFacility.status, 400);
  assert.equal(wrongFacility.json.error.code, 'PROVIDER_NOT_AT_FACILITY');

  const wrongService = await create({ providerAffiliationId: 1, facilityServiceId: 999 });
  assert.equal(wrongService.status, 400);
  assert.equal(wrongService.json.error.code, 'PROVIDER_SERVICE_MISMATCH');

  const wholeOrg = await create({ providerAffiliationId: 8 });
  assert.equal(wholeOrg.status, 400);
  assert.equal(wholeOrg.json.error.code, 'PROVIDER_NOT_AT_FACILITY');
});

test('an unverified doctor, an ended placement, or on-demand availability cannot get slots', async () => {
  const unverified = await create({ providerAffiliationId: 2 });
  assert.equal(unverified.status, 409);
  assert.equal(unverified.json.error.code, 'PROVIDER_NOT_BOOKABLE');
  assert.match(unverified.json.error.message, /not been verified/);

  const ended = await create({ providerAffiliationId: 6 });
  assert.equal(ended.status, 409);

  const onDemand = await create({ providerAffiliationId: 3 });
  assert.equal(onDemand.status, 400);
  assert.equal(onDemand.json.error.code, 'NOT_SLOT_BASED');
});

test('the rule must stay inside the doctor placement dates', async () => {
  const noEnd = await create({ providerAffiliationId: 5 });
  assert.equal(noEnd.status, 400);
  assert.equal(noEnd.json.error.code, 'OUTSIDE_PLACEMENT_DATES');
  assert.equal((await create({ providerAffiliationId: 5, effectiveTo: '2027-06-30' })).status, 400);
  assert.equal((await create({ providerAffiliationId: 5, effectiveTo: '2027-03-31' })).status, 201);
});

test('an unknown or another tenant\'s placement is a clean 400; resourceId and providerAffiliationId are exclusive', async () => {
  const unknown = await create({ providerAffiliationId: 99 });
  assert.equal(unknown.status, 400);
  assert.equal(unknown.json.error.code, 'INVALID_PROVIDER_AFFILIATION');
  assert.equal((await create({ providerAffiliationId: 1 }, adminB)).json.error.code, 'INVALID_PROVIDER_AFFILIATION');
  assert.equal((await create({ providerAffiliationId: 1, resourceId: 5 })).status, 400);
});

test('a user who may not read doctors gets a clear 403, not a generic failure', async () => {
  const denied = await create({ providerAffiliationId: 77 });
  assert.equal(denied.status, 403);
  assert.equal(denied.json.error.code, 'PROVIDER_ACCESS_DENIED');
});

test('list can be filtered by doctor', async () => {
  await create({ providerAffiliationId: 7, dayOfWeek: 2 });
  await create({ dayOfWeek: 4 }); // a rule with no doctor
  const all = await call('GET', '/slot-configs?limit=100', { token: adminA });
  const mine = await call('GET', '/slot-configs?providerId=2', { token: adminA });
  assert.ok(all.json.data.some((r) => r.providerId === null));
  assert.equal(mine.json.data.length, 1);
  assert.equal(mine.json.data[0].resourceName, 'Dr. Meera Rao');
  assert.equal((await call('GET', '/slot-configs?providerAffiliationId=1', { token: adminA })).json.data.every((r) => r.providerAffiliationId === 1), true);
});

test('editing: swap the doctor, move dates (re-checked), then remove the doctor', async () => {
  const plain = await create({ dayOfWeek: 5 });
  const withDoctor = await call('PATCH', `/slot-configs/${plain.json.slotConfigId}`, { token: adminA, body: { providerAffiliationId: 1 } });
  assert.equal(withDoctor.status, 200, JSON.stringify(withDoctor.json));
  assert.equal(withDoctor.json.resourceName, 'Dr. Asha Verma');

  const swapped = await call('PATCH', `/slot-configs/${plain.json.slotConfigId}`, { token: adminA, body: { providerAffiliationId: 7 } });
  assert.equal(swapped.json.resourceName, 'Dr. Meera Rao');

  // moving the dates re-checks the doctor's placement window
  const limited = await create({ providerAffiliationId: 5, effectiveTo: '2027-03-31', dayOfWeek: 6 });
  const tooLate = await call('PATCH', `/slot-configs/${limited.json.slotConfigId}`, { token: adminA, body: { effectiveTo: '2027-12-31' } });
  assert.equal(tooLate.status, 400);
  assert.equal(tooLate.json.error.code, 'OUTSIDE_PLACEMENT_DATES');

  const removed = await call('PATCH', `/slot-configs/${plain.json.slotConfigId}`, { token: adminA, body: { providerAffiliationId: null } });
  assert.equal(removed.status, 200);
  assert.equal(removed.json.resourceId, null);
  assert.equal(removed.json.providerId, null);

  // changing something unrelated does not call the provider service at all — even when the
  // client resends the unchanged dates, as the admin UI does on every edit
  const before = providerRequests.length;
  await call('PATCH', `/slot-configs/${limited.json.slotConfigId}`, { token: adminA, body: { capacityPerSlot: 2 } });
  const resent = await call('PATCH', `/slot-configs/${limited.json.slotConfigId}`, {
    token: adminA,
    body: { capacityPerSlot: 3, effectiveFrom: limited.json.effectiveFrom, effectiveTo: limited.json.effectiveTo },
  });
  assert.equal(resent.status, 200, JSON.stringify(resent.json));
  assert.equal(providerRequests.length, before);
});

test('doctor leave: a closure can be scoped to one doctor and service', async () => {
  const closure = (over = {}) => call('POST', '/facility-closures', {
    token: adminA,
    body: { facilityServiceId: 100, closureType: 'HOLIDAY', recurrenceType: 'ONE_TIME', closureDate: '2026-12-25', closureName: 'Doctor on leave', ...over },
  });

  const noService = await closure({ facilityServiceId: null, providerAffiliationId: 1 });
  assert.equal(noService.status, 400);
  assert.equal(noService.json.error.code, 'PROVIDER_CLOSURE_NEEDS_SERVICE');

  const ok = await closure({ providerAffiliationId: 1 });
  assert.equal(ok.status, 201, JSON.stringify(ok.json));
  assert.equal(ok.json.resourceName, 'Dr. Asha Verma');
  assert.equal(ok.json.providerAffiliationId, 1);
  assert.equal(ok.json.facilityId, 10); // defaulted from the doctor's placement
  assert.equal(ok.json.resourceId, firstRule.resourceId); // same resource the slot rules use

  // naming a facility the doctor isn't placed at is rejected
  assert.equal((await closure({ facilityId: 10, providerAffiliationId: 4 })).json.error.code, 'PROVIDER_NOT_AT_FACILITY');

  const filtered = await call('GET', '/facility-closures?providerId=1', { token: adminA });
  assert.equal(filtered.json.data.length, 1);

  // editing the name while resending the unchanged scope does not re-check the doctor
  const before = providerRequests.length;
  const renamed = await call('PATCH', `/facility-closures/${ok.json.closureId}`, {
    token: adminA,
    body: { closureName: 'Annual leave', facilityId: ok.json.facilityId, facilityServiceId: ok.json.facilityServiceId },
  });
  assert.equal(renamed.status, 200, JSON.stringify(renamed.json));
  assert.equal(renamed.json.resourceName, 'Dr. Asha Verma');
  assert.equal(providerRequests.length, before);

  const removed = await call('PATCH', `/facility-closures/${ok.json.closureId}`, { token: adminA, body: { providerAffiliationId: null } });
  assert.equal(removed.json.resourceId, null);
});

test('without PROVIDER_SERVICE_URL a doctor cannot be attached (503), but rules without a doctor still work', async () => {
  const saved = process.env.PROVIDER_SERVICE_URL;
  delete process.env.PROVIDER_SERVICE_URL;
  try {
    const withDoctor = await create({ providerAffiliationId: 1, dayOfWeek: 7 });
    assert.equal(withDoctor.status, 503);
    assert.equal(withDoctor.json.error.code, 'PROVIDER_SERVICE_NOT_CONFIGURED');
    assert.equal((await create({ dayOfWeek: 7 })).status, 201);
  } finally {
    process.env.PROVIDER_SERVICE_URL = saved;
  }
});
