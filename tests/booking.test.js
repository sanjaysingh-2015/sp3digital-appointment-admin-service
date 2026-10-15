const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const jwt = require('jsonwebtoken');

process.env.DB_DIALECT = 'sqlite';
process.env.ADMIN_JWT_SECRET = 'test-only-shared-secret';
process.env.ADMIN_JWT_AUDIENCE = 'sp3-appointment-admin-test';
process.env.APPOINTMENT_SERVICE_INTERNAL_TOKEN = 'test-internal-service-token';
process.env.APPOINTMENT_TIMEZONE = 'Asia/Kolkata';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';

// "Now" is pinned: Wednesday 14 Oct 2026, 10:00 in Kolkata (04:30 UTC).
const NOW = '2026-10-14T04:30:00Z';

const tokenFor = (tenantUuid, permissions, userId = 9) =>
  jwt.sign({ tenant_uuid: tenantUuid, user_id: userId, permissions }, process.env.ADMIN_JWT_SECRET, {
    audience: process.env.ADMIN_JWT_AUDIENCE,
    expiresIn: '5m',
  });

const ADMIN_PERMS = [
  'appointment-admin:appointment:read', 'appointment-admin:appointment:create', 'appointment-admin:appointment:update',
  'appointment-admin:slot:read', 'appointment-admin:slot:generate',
];
const admin = tokenFor(TENANT_A, ADMIN_PERMS);
const adminB = tokenFor(TENANT_B, ADMIN_PERMS);
const frontDesk = tokenFor(TENANT_A, ADMIN_PERMS.filter((p) => !p.includes('generate')));
const basicUser = tokenFor(TENANT_A, ['appointment-admin:appointment:read', 'appointment-admin:appointment:create', 'appointment-admin:slot:read']); // may book, not cancel

// ---- stand-ins for the patient and provider services ----------------------------------
const PATIENTS = {
  'aaaaaaaa-0000-4000-8000-000000000001': { patientId: 1, displayName: 'Asha Verma', phoneCountryCode: '+91', phoneNumber: '9876543210', email: 'asha@example.com', status: 'ACTIVE' },
  'aaaaaaaa-0000-4000-8000-000000000002': { patientId: 2, displayName: 'Ravi Kumar', phoneCountryCode: '+91', phoneNumber: '9000000002', email: null, status: 'ACTIVE' },
  'aaaaaaaa-0000-4000-8000-000000000003': { patientId: 3, displayName: 'Meera Rao', phoneCountryCode: '+91', phoneNumber: '9000000003', email: null, status: 'ACTIVE' },
  'aaaaaaaa-0000-4000-8000-000000000004': { patientId: 4, displayName: 'Old Record', phoneCountryCode: '+91', phoneNumber: '9000000004', email: null, status: 'INACTIVE' },
  'aaaaaaaa-0000-4000-8000-000000000005': { patientId: 5, displayName: 'Kiran Das', phoneCountryCode: '+91', phoneNumber: '9000000005', email: null, status: 'ACTIVE' },
};
const [ASHA, RAVI, MEERA, INACTIVE, KIRAN] = Object.keys(PATIENTS);
const AFFILIATIONS = {
  1: { affiliationId: 1, providerId: 1, facilityId: 1, status: 'ACTIVE', facilityServiceIds: [100], provider: { displayName: 'Dr. Asha Verma', status: 'ACTIVE', verificationStatus: 'VERIFIED' } },
  2: { affiliationId: 2, providerId: 2, facilityId: 1, status: 'ACTIVE', facilityServiceIds: [100], provider: { displayName: 'Dr. Suspended', status: 'SUSPENDED', verificationStatus: 'VERIFIED' } },
};

let server;
let baseUrl;
let stub;
let db;
let clock;

test.before(async () => {
  stub = http.createServer((req, res) => {
    const send = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    let m = req.url.match(/^\/patient\/patients\/by-uuid\/([^/]+)$/);
    if (m) return PATIENTS[m[1]] ? send(200, { patientUuid: m[1], ...PATIENTS[m[1]] }) : send(404, {});
    m = req.url.match(/^\/provider\/affiliations\/(\d+)$/);
    if (m) return AFFILIATIONS[m[1]] ? send(200, AFFILIATIONS[m[1]]) : send(404, {});
    return send(404, {});
  });
  await new Promise((resolve) => stub.listen(0, resolve));
  process.env.PATIENT_SERVICE_URL = `http://127.0.0.1:${stub.address().port}/patient`;
  process.env.PROVIDER_SERVICE_URL = `http://127.0.0.1:${stub.address().port}/provider`;

  ({ clock } = require('../src/utils/clock'));
  clock.now = () => new Date(NOW);

  const app = require('../src/app');
  db = require('../src/models');
  await db.sequelize.sync({ force: true });
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await new Promise((resolve) => stub.close(resolve));
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

const generate = (body = {}, token = admin) => call('POST', '/slots/generate', { token, body });
const slotsOn = (date, extra = '', token = admin) => call('GET', `/slots?facilityId=1&date=${date}${extra}`, { token });
const book = (slotId, patientUuid, extra = {}, token = frontDesk) => call('POST', '/appointments', { token, body: { slotId, patientUuid, ...extra } });

// A rule for Wednesdays 09:00–13:00 in 30-minute slots: 8 a day (5 left today, after 10:00).
const wednesdayRule = (over = {}) => ({
  tenantUuid: TENANT_A, facilityId: 1, facilityServiceId: 100, recurrenceType: 'WEEKLY', dayOfWeek: 3,
  startTime: '09:00:00', endTime: '13:00:00', slotDurationMinutes: 30, capacityPerSlot: 1,
  effectiveFrom: '2026-10-01', status: 'ACTIVE', approvalStatus: 'APPROVED', ...over,
});

let rule;

test('the facility clock: "now" is read in the facility timezone', () => {
  const { localNow, isPast } = require('../src/utils/clock');
  assert.deepEqual(localNow(new Date(NOW)), { date: '2026-10-14', time: '10:00:00', isoDow: 3 });
  // 20:00 UTC is already the next morning in Kolkata
  assert.equal(localNow(new Date('2026-10-14T20:00:00Z')).date, '2026-10-15');
  const now = localNow(new Date(NOW));
  assert.equal(isPast('2026-10-14', '10:00', now), true);  // starting right now is not "after the current time"
  assert.equal(isPast('2026-10-14', '10:30', now), false);
  assert.equal(isPast('2026-10-13', '23:59', now), true);
  assert.equal(isPast('2026-10-15', '00:00', now), false);
});

test('generation turns an approved rule into dated slots, skipping times already passed', async () => {
  rule = await db.AppointmentSlotConfig.create(wednesdayRule());
  await db.AppointmentSlotConfig.create(wednesdayRule({ approvalStatus: 'PENDING_APPROVAL', dayOfWeek: 4 })); // not approved: ignored

  const dry = await generate({ dryRun: true });
  assert.equal(dry.status, 200, JSON.stringify(dry.json));
  assert.equal(dry.json.created, 37); // today 10:30..12:30 (5) + four more Wednesdays x 8
  assert.equal(await db.AppointmentSlot.count(), 0); // a dry run changes nothing

  const first = await generate();
  assert.deepEqual([first.json.created, first.json.fromDate, first.json.toDate, first.json.rulesConsidered], [37, '2026-10-14', '2026-11-12', 1]);
  assert.equal((await generate()).json.created, 0); // safe to run again
  assert.equal(await db.AppointmentSlot.count(), 37);
});

test('slot search never returns the past; only free places unless asked', async () => {
  const today = await slotsOn('2026-10-14');
  assert.deepEqual(today.json.data.map((s) => s.startTime), ['10:30', '11:00', '11:30', '12:00', '12:30']); // 10:00 has started, 09:xx are gone
  assert.equal(today.json.data[0].remaining, 1);
  assert.equal((await slotsOn('2026-10-21')).json.data.length, 8);
  assert.equal((await slotsOn('2026-10-13')).json.data.length, 0); // yesterday
  assert.equal((await call('GET', '/slots?date=2026-10-14', { token: admin })).status, 400); // facility is required
  // the same data needs the slot permission
  assert.equal((await call('GET', '/slots?facilityId=1&date=2026-10-14', { token: tokenFor(TENANT_A, ['appointment-admin:appointment:read']) })).status, 403);
  assert.equal((await generate({}, frontDesk)).status, 403); // generating is an admin job
});

test('a closure removes unbooked slots; removing the closure brings them back', async () => {
  const closure = await db.FacilityClosure.create({ tenantUuid: TENANT_A, facilityId: 1, facilityServiceId: null, resourceId: null, closureType: 'HOLIDAY', recurrenceType: 'ONE_TIME', closureDate: '2026-10-21', closureName: 'Festival', status: 'ACTIVE' });
  const closed = await generate();
  assert.equal(closed.json.closed, 8);
  assert.equal((await slotsOn('2026-10-21')).json.data.length, 0);
  const sample = await db.AppointmentSlot.findOne({ where: { slot_date: '2026-10-21' } });
  assert.equal(sample.status, 'CLOSED');
  assert.match(sample.cancelReason, /Festival/);

  await closure.update({ status: 'INACTIVE' });
  assert.equal((await generate()).json.reopened, 8);
  assert.equal((await slotsOn('2026-10-21')).json.data.length, 8);

  // a weekly off and an annual holiday work the same way, and a closed date is never generated
  const weekly = await db.FacilityClosure.create({ tenantUuid: TENANT_A, facilityId: 1, closureType: 'WEEKLY_OFF', recurrenceType: 'WEEKLY', dayOfWeek: 3, closureName: 'Wednesday off', status: 'ACTIVE' });
  assert.equal((await generate()).json.closed, 8 * 4 + 5);
  await weekly.update({ status: 'INACTIVE' });
  assert.equal((await generate()).json.reopened, 8 * 4 + 5);
});

test('booking a slot: patient copy, token number, place counted, the slot fills up', async () => {
  const slot = (await slotsOn('2026-10-14')).json.data.find((s) => s.startTime === '11:00');
  const booked = await book(slot.slotId, ASHA, { notes: 'First visit' });
  assert.equal(booked.status, 201, JSON.stringify(booked.json));
  assert.equal(booked.json.status, 'BOOKED');
  assert.equal(booked.json.tokenNumber, 'T001');
  assert.equal(booked.json.patientRef, ASHA);
  assert.equal(booked.json.patientName, 'Asha Verma');
  assert.equal(booked.json.patientPhone, '+919876543210');
  assert.equal(booked.json.startTime.slice(0, 5), '11:00');
  assert.equal(booked.json.history[0].toStatus, 'BOOKED');

  const row = await db.AppointmentSlot.findByPk(slot.slotId);
  assert.deepEqual([row.bookedCount, row.status], [1, 'FULL']);
  assert.equal((await slotsOn('2026-10-14')).json.data.some((s) => s.slotId === slot.slotId), false); // gone from the open list
  assert.equal((await slotsOn('2026-10-14', '&includeFull=true')).json.data.find((s) => s.slotId === slot.slotId).remaining, 0);

  assert.equal((await book(slot.slotId, RAVI)).json.error.code, 'SLOT_FULL'); // the last place went to one person
  // tokens count on: the next booking that day for the service
  const next = (await slotsOn('2026-10-14')).json.data[0];
  assert.equal((await book(next.slotId, RAVI)).json.tokenNumber, 'T002');
});

test('never the past, never an unusable patient, one place per patient', async () => {
  const past = await db.AppointmentSlot.create({ tenantUuid: TENANT_A, facilityId: 1, facilityServiceId: 100, slotDate: '2026-10-14', startTime: '09:00:00', endTime: '09:30:00', capacity: 1 });
  const yesterday = await db.AppointmentSlot.create({ tenantUuid: TENANT_A, facilityId: 1, facilityServiceId: 100, slotDate: '2026-10-13', startTime: '15:00:00', endTime: '15:30:00', capacity: 1 });
  const started = await db.AppointmentSlot.create({ tenantUuid: TENANT_A, facilityId: 1, facilityServiceId: 100, slotDate: '2026-10-14', startTime: '10:00:00', endTime: '10:30:00', capacity: 1 });
  for (const s of [past, yesterday, started]) {
    const r = await book(s.slotId, MEERA);
    assert.equal(r.status, 400);
    assert.equal(r.json.error.code, 'SLOT_IN_PAST');
  }
  assert.equal((await db.AppointmentSlot.findByPk(past.slotId)).bookedCount, 0);

  const open = (await slotsOn('2026-10-21')).json.data;
  assert.equal((await book(open[0].slotId, INACTIVE)).json.error.code, 'PATIENT_NOT_ACTIVE');
  assert.equal((await book(open[0].slotId, 'aaaaaaaa-0000-4000-8000-0000000000ff')).json.error.code, 'INVALID_PATIENT');
  assert.equal((await book(999999, MEERA)).json.error.code, 'SLOT_NOT_FOUND');

  // the same patient: not twice in one slot, and a second place for the service that day needs confirmation
  assert.equal((await book(open[0].slotId, MEERA)).status, 201);
  const sameDay = await book(open[1].slotId, MEERA);
  assert.equal(sameDay.status, 409);
  assert.equal(sameDay.json.error.code, 'SAME_DAY_DUPLICATE');
  assert.equal((await book(open[1].slotId, MEERA, { allowSameDay: true })).status, 201);
});

test('capacity above one, and the last place can only be won once even under a rush', async () => {
  const group = await db.AppointmentSlot.create({ tenantUuid: TENANT_A, facilityId: 1, facilityServiceId: 200, slotDate: '2026-10-22', startTime: '09:00:00', endTime: '10:00:00', capacity: 2 });
  assert.equal((await book(group.slotId, ASHA)).status, 201);
  assert.equal((await book(group.slotId, RAVI)).status, 201);
  assert.equal((await book(group.slotId, MEERA)).json.error.code, 'SLOT_FULL');

  // the last place goes to exactly one person, however many ask
  const last = await db.AppointmentSlot.create({ tenantUuid: TENANT_A, facilityId: 1, facilityServiceId: 201, slotDate: '2026-10-22', startTime: '09:00:00', endTime: '09:30:00', capacity: 1 });
  const askers = [ASHA, RAVI, MEERA, KIRAN];
  const results = [];
  for (const p of askers) results.push(await book(last.slotId, p));
  assert.equal(results.filter((r) => r.status === 201).length, 1);
  assert.ok(results.filter((r) => r.status !== 201).every((r) => r.status === 409 && r.json.error.code === 'SLOT_FULL'));
  assert.equal((await db.AppointmentSlot.findByPk(last.slotId)).bookedCount, 1);
});

test('even with a stale read, the count can never exceed the capacity (atomic guard)', async () => {
  const { takePlace } = require('../src/services/bookingService');
  const slot = await db.AppointmentSlot.create({ tenantUuid: TENANT_A, facilityId: 1, facilityServiceId: 202, slotDate: '2026-10-22', startTime: '11:00:00', endTime: '11:30:00', capacity: 1 });
  const stale = await db.AppointmentSlot.findByPk(slot.slotId); // this request still sees 0 of 1 booked...
  await db.AppointmentSlot.update({ bookedCount: 1, status: 'FULL' }, { where: { slot_id: slot.slotId } }); // ...but another booking just took it
  await assert.rejects(db.sequelize.transaction((t) => takePlace(stale, 1, t)), (error) => error.code === 'SLOT_FULL');
  assert.equal((await db.AppointmentSlot.findByPk(slot.slotId)).bookedCount, 1); // unchanged, not 2
});

test('a slot for a doctor: the doctor is re-checked at booking time and appears on the appointment', async () => {
  const good = await db.FacilityResource.create({ tenantUuid: TENANT_A, facilityId: 1, facilityServiceId: 100, resourceType: 'PROVIDER', resourceName: 'Dr. Asha Verma', providerId: 1, providerAffiliationId: 1 });
  const bad = await db.FacilityResource.create({ tenantUuid: TENANT_A, facilityId: 1, facilityServiceId: 100, resourceType: 'PROVIDER', resourceName: 'Dr. Suspended', providerId: 2, providerAffiliationId: 2 });
  const mk = (resource, hour) => db.AppointmentSlot.create({ tenantUuid: TENANT_A, facilityId: 1, facilityServiceId: 100, resourceId: resource.resourceId, slotDate: '2026-10-23', startTime: `${hour}:00:00`, endTime: `${hour}:30:00`, capacity: 1 });
  const ok = await mk(good, '09');
  const notOk = await mk(bad, '10');

  const found = await slotsOn('2026-10-23', '&providerId=1');
  assert.deepEqual(found.json.data.map((s) => [s.resourceName, s.providerId]), [['Dr. Asha Verma', 1]]);

  const refused = await book(notOk.slotId, KIRAN);
  assert.equal(refused.status, 409);
  assert.equal(refused.json.error.code, 'PROVIDER_NOT_BOOKABLE');
  const done = await book(ok.slotId, KIRAN);
  assert.equal(done.status, 201, JSON.stringify(done.json));
  assert.equal(done.json.resourceName, 'Dr. Asha Verma');
  // each doctor counts their own tokens
  assert.equal(done.json.tokenNumber, 'T001');

  const listed = await call('GET', '/appointments?search=Kiran', { token: admin });
  assert.equal(listed.json.data[0].resourceName, 'Dr. Asha Verma');
});

test('permissions: ordinary users may book but not cancel; other tenants see nothing', async () => {
  const slot = (await slotsOn('2026-10-28')).json.data[0];
  const viaUser = await book(slot.slotId, RAVI, {}, basicUser);
  assert.equal(viaUser.status, 201);
  const reasons = (await call('GET', '/cancellation-reasons', { token: admin })).json;
  await db.AppointmentCancellationReason.bulkCreate([
    { tenantUuid: null, reasonCode: 'PATIENT_REQUEST', reasonLabel: 'Patient asked to cancel' },
    { tenantUuid: TENANT_A, reasonCode: 'OWN', reasonLabel: 'Our own reason' },
    { tenantUuid: TENANT_B, reasonCode: 'THEIRS', reasonLabel: 'Other tenant' },
  ]);
  assert.equal((await call('PATCH', `/appointments/${viaUser.json.appointmentId}/cancel`, { token: basicUser, body: { reasonId: 1 } })).status, 403);
  assert.equal(reasons.data.length, 0);
  assert.deepEqual((await call('GET', '/cancellation-reasons', { token: admin })).json.data.map((r) => r.reasonCode).sort(), ['OWN', 'PATIENT_REQUEST']);

  assert.equal((await book(slot.slotId, MEERA, {}, tokenFor(TENANT_A, ['appointment-admin:appointment:read']))).status, 403);
  assert.equal((await book(slot.slotId, MEERA, {}, adminB)).json.error.code, 'SLOT_NOT_FOUND');
  assert.equal((await call('GET', '/slots?facilityId=1&date=2026-10-28', { token: adminB })).json.data.length, 0);
});

test('cancelling gives the place back; started, already-cancelled or bad-reason requests are refused', async () => {
  const slot = (await slotsOn('2026-11-04')).json.data[0];
  const a = (await book(slot.slotId, ASHA)).json;
  assert.equal((await db.AppointmentSlot.findByPk(slot.slotId)).status, 'FULL');

  assert.equal((await call('PATCH', `/appointments/${a.appointmentId}/cancel`, { token: frontDesk, body: {} })).status, 400); // a reason is required
  assert.equal((await call('PATCH', `/appointments/${a.appointmentId}/cancel`, { token: frontDesk, body: { reasonId: 9999 } })).json.error.code, 'INVALID_REASON');
  const cancelled = await call('PATCH', `/appointments/${a.appointmentId}/cancel`, { token: frontDesk, body: { reasonId: 1, notes: 'Called to cancel' } });
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.json));
  assert.equal(cancelled.json.status, 'CANCELLED');
  assert.equal(cancelled.json.cancellationNotes, 'Called to cancel');
  assert.equal(cancelled.json.history.at(-1).toStatus, 'CANCELLED');

  const row = await db.AppointmentSlot.findByPk(slot.slotId);
  assert.deepEqual([row.bookedCount, row.status], [0, 'OPEN']); // bookable again
  assert.equal((await book(slot.slotId, RAVI)).status, 201);
  assert.equal((await call('PATCH', `/appointments/${a.appointmentId}/cancel`, { token: frontDesk, body: { reasonId: 1 } })).json.error.code, 'APPOINTMENT_NOT_CHANGEABLE');

  const gone = await db.Appointment.create({ tenantUuid: TENANT_A, facilityId: 1, facilityServiceId: 100, slotId: slot.slotId, patientRef: ASHA, patientName: 'X', patientPhone: '1', appointmentDate: '2026-10-14', startTime: '09:00:00', endTime: '09:30:00', status: 'BOOKED' });
  assert.equal((await call('PATCH', `/appointments/${gone.appointmentId}/cancel`, { token: frontDesk, body: { reasonId: 1 } })).json.error.code, 'APPOINTMENT_STARTED');
});

test('rescheduling moves the patient to another slot of the same service, all or nothing', async () => {
  const slots = (await slotsOn('2026-11-11')).json.data;
  const a = (await book(slots[0].slotId, ASHA)).json;

  const moved = await call('POST', `/appointments/${a.appointmentId}/reschedule`, { token: frontDesk, body: { slotId: slots[1].slotId } });
  assert.equal(moved.status, 201, JSON.stringify(moved.json));
  assert.equal(moved.json.status, 'BOOKED');
  assert.equal(moved.json.patientRef, ASHA);
  assert.equal(moved.json.rescheduledFromAppointmentId, a.appointmentId);
  assert.equal(moved.json.startTime.slice(0, 5), slots[1].startTime);

  assert.equal((await call('GET', `/appointments?search=Asha&dateFrom=2026-11-11&dateTo=2026-11-11`, { token: admin })).json.data.find((x) => x.appointmentId === a.appointmentId).status, 'RESCHEDULED');
  const [oldSlot, newSlot] = await Promise.all([db.AppointmentSlot.findByPk(slots[0].slotId), db.AppointmentSlot.findByPk(slots[1].slotId)]);
  assert.deepEqual([oldSlot.bookedCount, oldSlot.status, newSlot.bookedCount, newSlot.status], [0, 'OPEN', 1, 'FULL']);

  const again = moved.json.appointmentId;
  assert.equal((await call('POST', `/appointments/${again}/reschedule`, { token: frontDesk, body: { slotId: slots[1].slotId } })).json.error.code, 'SAME_SLOT');
  assert.equal((await call('POST', `/appointments/${a.appointmentId}/reschedule`, { token: frontDesk, body: { slotId: slots[2].slotId } })).json.error.code, 'APPOINTMENT_NOT_CHANGEABLE'); // already moved

  // a full target changes nothing
  assert.equal((await book(slots[3].slotId, RAVI)).status, 201);
  const refused = await call('POST', `/appointments/${again}/reschedule`, { token: frontDesk, body: { slotId: slots[3].slotId } });
  assert.equal(refused.json.error.code, 'SLOT_FULL');
  assert.equal((await db.AppointmentSlot.findByPk(slots[1].slotId)).bookedCount, 1);
  assert.equal((await db.Appointment.findByPk(again)).status, 'BOOKED');

  // another service is a different booking, not a reschedule
  const otherService = await db.AppointmentSlot.create({ tenantUuid: TENANT_A, facilityId: 1, facilityServiceId: 777, slotDate: '2026-11-11', startTime: '09:00:00', endTime: '09:30:00', capacity: 1 });
  assert.equal((await call('POST', `/appointments/${again}/reschedule`, { token: frontDesk, body: { slotId: otherService.slotId } })).json.error.code, 'DIFFERENT_SERVICE');
});

test('an edited rule closes the unbooked slots it no longer produces; booked ones are reported, never removed', async () => {
  // someone holds a place on 2026-11-04 10:00 (nothing there is a closure or edit yet)
  const heldSlot = await db.AppointmentSlot.findOne({ where: { slot_date: '2026-11-04', start_time: '10:00:00' } });
  await book(heldSlot.slotId, KIRAN);

  await rule.update({ endTime: '10:30:00' }); // the doctor now works 09:00-10:30 only
  const result = await generate();
  assert.ok(result.json.closed > 0);
  assert.ok(result.json.conflicts >= 0);
  const stillThere = await db.AppointmentSlot.findByPk(heldSlot.slotId);
  assert.equal(stillThere.bookedCount, 1); // a booked slot is never taken away from the patient
  assert.notEqual(stillThere.status, 'CLOSED');

  // a closure added later over a booked day is reported as a conflict, not silently removed
  await db.FacilityClosure.create({ tenantUuid: TENANT_A, facilityId: 1, closureType: 'EMERGENCY', recurrenceType: 'ONE_TIME', closureDate: '2026-11-04', closureName: 'Emergency', status: 'ACTIVE' });
  const withClosure = await generate();
  assert.ok(withClosure.json.conflicts >= 1);
  assert.equal((await db.AppointmentSlot.findByPk(heldSlot.slotId)).bookedCount, 1);
});

test('without PATIENT_SERVICE_URL a booking cannot be made (503)', async () => {
  const saved = process.env.PATIENT_SERVICE_URL;
  delete process.env.PATIENT_SERVICE_URL;
  try {
    const slot = (await slotsOn('2026-11-11')).json.data[0] || (await db.AppointmentSlot.findOne({ where: { status: 'OPEN', slot_date: '2026-11-11' } }));
    const r = await book(slot.slotId, ASHA);
    assert.equal(r.status, 503);
    assert.equal(r.json.error.code, 'PATIENT_SERVICE_NOT_CONFIGURED');
  } finally {
    process.env.PATIENT_SERVICE_URL = saved;
  }
});
