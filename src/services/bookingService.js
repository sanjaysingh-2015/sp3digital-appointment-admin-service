const { Op, literal } = require('sequelize');
const {
  sequelize, Appointment, AppointmentSlot, AppointmentCancellationReason, AppointmentStatusHistory, AppointmentTokenCounter, FacilityResource,
} = require('../models');
const { httpError } = require('../utils/errors');
const { isPast, localNow } = require('../utils/clock');
const { getPatient } = require('../clients/patientDirectory');
const { assertProviderBookable } = require('./providerResourceService');
const appointmentService = require('./appointmentService');

// A patient holds one of these places; the others have ended or never will be used.
const ACTIVE_STATUSES = ['BOOKED', 'CONFIRMED', 'CHECKED_IN'];
const CHANGEABLE_STATUSES = ['BOOKED', 'CONFIRMED']; // can still be cancelled or moved

const lockOption = (transaction) => (sequelize.getDialect() === 'mysql' ? { lock: transaction.LOCK.UPDATE } : {});

async function history(appointmentId, fromStatus, toStatus, remarks, userId, transaction) {
  await AppointmentStatusHistory.create({ appointmentId, fromStatus, toStatus, remarks: remarks || null, changedBy: userId || null }, { transaction });
}

/** Each doctor (or service, when there is no doctor) numbers their own tokens per day: T001, T002 … */
async function nextToken({ tenantUuid, facilityServiceId, resourceId, date }, transaction) {
  const where = { tenant_uuid: tenantUuid, facility_service_id: facilityServiceId, resource_key: resourceId || 0, token_date: date };
  const lookup = { where, transaction, ...lockOption(transaction) };
  let counter = await AppointmentTokenCounter.findOne(lookup);
  if (!counter) {
    try {
      counter = await AppointmentTokenCounter.create({ tenantUuid, facilityServiceId, resourceKey: resourceId || 0, tokenDate: date, lastNumber: 0 }, { transaction });
    } catch (error) {
      if (error.name !== 'SequelizeUniqueConstraintError') throw error;
      counter = await AppointmentTokenCounter.findOne(lookup);
    }
  }
  const next = counter.lastNumber + 1;
  await counter.update({ lastNumber: next }, { transaction });
  return `T${String(next).padStart(3, '0')}`;
}

/**
 * Takes one place in a slot. The slot row is locked by the caller, and on top of that the
 * count is raised by ONE conditional UPDATE ("... WHERE booked_count < capacity"), so even a
 * stale read can never hand out more places than the slot has: if another booking got there
 * first the update matches no row and this one is refused.
 * (status is set before booked_count on purpose: MySQL evaluates SET left to right.)
 */
async function takePlace(slot, userId, transaction) {
  if (slot.status === 'CLOSED') throw httpError(409, 'SLOT_UNAVAILABLE', 'This slot is no longer available');
  if (slot.status === 'FULL' || slot.bookedCount >= slot.capacity) throw httpError(409, 'SLOT_FULL', 'This slot is full');
  if (isPast(slot.slotDate, slot.startTime)) throw httpError(400, 'SLOT_IN_PAST', 'This slot has already started or passed');

  const [affected] = await AppointmentSlot.update(
    {
      status: literal("CASE WHEN booked_count + 1 >= capacity THEN 'FULL' ELSE 'OPEN' END"),
      bookedCount: literal('booked_count + 1'),
      modifiedBy: userId || null,
      modifiedOn: new Date(),
    },
    { where: { slot_id: slot.slotId, status: 'OPEN', booked_count: { [Op.lt]: sequelize.col('capacity') } }, transaction },
  );
  if (affected !== 1) throw httpError(409, 'SLOT_FULL', 'This slot is full');
  await slot.reload({ transaction });
}

/** Gives a place back (cancellation / move). A full slot opens up again; a closed one stays closed. */
async function releasePlace(slot, userId, transaction) {
  const booked = Math.max(slot.bookedCount - 1, 0);
  await slot.update(
    { bookedCount: booked, status: slot.status === 'FULL' ? 'OPEN' : slot.status, modifiedBy: userId || null, modifiedOn: new Date() },
    { transaction },
  );
}

async function lockSlots(ids, tenantUuid, transaction) {
  // always in ascending id order, so two requests touching the same slots can never deadlock
  const sorted = [...new Set(ids)].sort((a, b) => Number(a) - Number(b));
  const slots = new Map();
  for (const id of sorted) {
    const slot = await AppointmentSlot.findOne({ where: { slot_id: id, tenant_uuid: tenantUuid }, transaction, ...lockOption(transaction) });
    if (!slot) throw httpError(404, 'SLOT_NOT_FOUND', 'Slot not found');
    slots.set(Number(id), slot);
  }
  return slots;
}

class BookingService {
  /**
   * Front-desk booking: one patient into one slot. Rules, in order of what staff see:
   *   - only slots that start AFTER the current time (today onwards, never the past)
   *   - the patient must be an active patient of this tenant (looked up in the patient service)
   *   - the doctor behind the slot must still be active, verified and placed there
   *   - the last place can only go to one person: the slot row is locked while it is counted
   *   - the same patient cannot take the same slot twice, nor a second place with the same
   *     service on the same day unless staff confirm (allowSameDay)
   * The appointment keeps a copy of the patient's name, phone and email as they are now.
   */
  async book({ slotId, patientUuid, notes, allowSameDay = false }, { tenantUuid, userId, token }) {
    const patient = await getPatient(patientUuid, token);
    if (patient.status !== 'ACTIVE') throw httpError(409, 'PATIENT_NOT_ACTIVE', 'This patient is not active and cannot be booked');

    const preview = await AppointmentSlot.findOne({
      where: { slot_id: slotId, tenant_uuid: tenantUuid },
      include: [{ model: FacilityResource, as: 'resource' }],
    });
    if (!preview) throw httpError(404, 'SLOT_NOT_FOUND', 'Slot not found');
    await assertProviderBookable(preview.resource, token);

    const appointmentId = await sequelize.transaction(async (transaction) => {
      const slot = (await lockSlots([slotId], tenantUuid, transaction)).get(Number(slotId));
      await this.#assertNoDuplicate({ tenantUuid, patientRef: patient.patientUuid, slot, allowSameDay }, transaction);
      await takePlace(slot, userId, transaction);

      const tokenNumber = await nextToken({ tenantUuid, facilityServiceId: slot.facilityServiceId, resourceId: slot.resourceId, date: slot.slotDate }, transaction);
      const appointment = await Appointment.create(
        {
          tenantUuid,
          facilityId: slot.facilityId,
          facilityServiceId: slot.facilityServiceId,
          resourceId: slot.resourceId,
          slotId: slot.slotId,
          patientRef: patient.patientUuid,
          patientName: String(patient.displayName).slice(0, 200),
          patientPhone: `${patient.phoneCountryCode || ''}${patient.phoneNumber}`.slice(0, 20),
          patientEmail: patient.email ? String(patient.email).slice(0, 150) : null,
          appointmentDate: slot.slotDate,
          startTime: slot.startTime,
          endTime: slot.endTime,
          tokenNumber,
          bookingChannel: 'ADMIN',
          status: 'BOOKED',
          notes: notes || null,
          createdBy: userId || null,
          modifiedBy: userId || null,
        },
        { transaction },
      );
      await history(appointment.appointmentId, null, 'BOOKED', 'Booked at the front desk', userId, transaction);
      return appointment.appointmentId;
    });
    return appointmentService.getDetail(appointmentId, { tenantUuid });
  }

  async #assertNoDuplicate({ tenantUuid, patientRef, slot, allowSameDay, excludeAppointmentId }, transaction) {
    const base = { tenant_uuid: tenantUuid, patient_ref: patientRef, status: { [Op.in]: ACTIVE_STATUSES } };
    if (excludeAppointmentId) base.appointment_id = { [Op.ne]: excludeAppointmentId };

    if (await Appointment.findOne({ where: { ...base, slot_id: slot.slotId }, transaction })) {
      throw httpError(409, 'ALREADY_BOOKED', 'This patient already has an appointment in this slot');
    }
    if (!allowSameDay) {
      const sameDay = await Appointment.findOne({
        where: { ...base, facility_service_id: slot.facilityServiceId, appointment_date: slot.slotDate },
        transaction,
      });
      if (sameDay) {
        throw httpError(409, 'SAME_DAY_DUPLICATE', 'This patient already has an appointment for this service on that day. Confirm to book another.');
      }
    }
  }

  async cancel(appointmentId, { reasonId, notes }, { tenantUuid, userId }) {
    const reason = await AppointmentCancellationReason.findOne({
      where: {
        reason_id: reasonId,
        status: 'ACTIVE',
        [Op.or]: [{ tenant_uuid: null }, { tenant_uuid: tenantUuid }],
      },
    });
    if (!reason) throw httpError(400, 'INVALID_REASON', 'Choose a valid cancellation reason');

    await sequelize.transaction(async (transaction) => {
      const appointment = await Appointment.findOne({ where: { appointment_id: appointmentId, tenant_uuid: tenantUuid }, transaction, ...lockOption(transaction) });
      if (!appointment) throw httpError(404, 'APPOINTMENT_NOT_FOUND', 'Appointment not found');
      this.#assertChangeable(appointment, 'cancelled');

      const slot = (await lockSlots([appointment.slotId], tenantUuid, transaction)).get(Number(appointment.slotId));
      await releasePlace(slot, userId, transaction);
      await appointment.update(
        {
          status: 'CANCELLED',
          cancellationReasonId: reason.reasonId,
          cancellationNotes: notes || null,
          cancelledBy: userId || null,
          cancelledOn: new Date(),
          modifiedBy: userId || null,
          modifiedOn: new Date(),
        },
        { transaction },
      );
      await history(appointment.appointmentId, 'BOOKED', 'CANCELLED', `${reason.reasonLabel}${notes ? ` — ${notes}` : ''}`, userId, transaction);
    });
    return appointmentService.getDetail(appointmentId, { tenantUuid });
  }

  /**
   * Moves a booking to another slot of the same service, keeping the patient. The old
   * appointment becomes RESCHEDULED, the new one points back to it, and both slots'
   * counts change together or not at all.
   */
  async reschedule(appointmentId, { slotId, notes }, { tenantUuid, userId, token }) {
    const preview = await AppointmentSlot.findOne({
      where: { slot_id: slotId, tenant_uuid: tenantUuid },
      include: [{ model: FacilityResource, as: 'resource' }],
    });
    if (!preview) throw httpError(404, 'SLOT_NOT_FOUND', 'Slot not found');
    await assertProviderBookable(preview.resource, token);

    const newId = await sequelize.transaction(async (transaction) => {
      const old = await Appointment.findOne({ where: { appointment_id: appointmentId, tenant_uuid: tenantUuid }, transaction, ...lockOption(transaction) });
      if (!old) throw httpError(404, 'APPOINTMENT_NOT_FOUND', 'Appointment not found');
      this.#assertChangeable(old, 'rescheduled');
      if (Number(old.slotId) === Number(slotId)) throw httpError(400, 'SAME_SLOT', 'Choose a different slot');

      const slots = await lockSlots([old.slotId, slotId], tenantUuid, transaction);
      const target = slots.get(Number(slotId));
      if (Number(target.facilityServiceId) !== Number(old.facilityServiceId)) {
        throw httpError(400, 'DIFFERENT_SERVICE', 'Choose a slot for the same service');
      }
      await this.#assertNoDuplicate({ tenantUuid, patientRef: old.patientRef, slot: target, allowSameDay: true, excludeAppointmentId: old.appointmentId }, transaction);

      await takePlace(target, userId, transaction);
      await releasePlace(slots.get(Number(old.slotId)), userId, transaction);

      const tokenNumber = await nextToken({ tenantUuid, facilityServiceId: target.facilityServiceId, resourceId: target.resourceId, date: target.slotDate }, transaction);
      const fresh = await Appointment.create(
        {
          tenantUuid,
          facilityId: target.facilityId,
          facilityServiceId: target.facilityServiceId,
          resourceId: target.resourceId,
          slotId: target.slotId,
          patientRef: old.patientRef,
          patientName: old.patientName,
          patientPhone: old.patientPhone,
          patientEmail: old.patientEmail,
          appointmentDate: target.slotDate,
          startTime: target.startTime,
          endTime: target.endTime,
          tokenNumber,
          bookingChannel: 'ADMIN',
          status: 'BOOKED',
          rescheduledFromAppointmentId: old.appointmentId,
          notes: notes || old.notes,
          createdBy: userId || null,
          modifiedBy: userId || null,
        },
        { transaction },
      );
      await old.update({ status: 'RESCHEDULED', modifiedBy: userId || null, modifiedOn: new Date() }, { transaction });
      await history(old.appointmentId, old.status, 'RESCHEDULED', `Moved to ${target.slotDate} ${String(target.startTime).slice(0, 5)}`, userId, transaction);
      await history(fresh.appointmentId, null, 'BOOKED', `Rescheduled from appointment ${old.appointmentId}`, userId, transaction);
      return fresh.appointmentId;
    });
    return appointmentService.getDetail(newId, { tenantUuid });
  }

  #assertChangeable(appointment, verb) {
    if (!CHANGEABLE_STATUSES.includes(appointment.status)) {
      throw httpError(409, 'APPOINTMENT_NOT_CHANGEABLE', `A ${String(appointment.status).toLowerCase().replace('_', ' ')} appointment cannot be ${verb}`);
    }
    if (isPast(appointment.appointmentDate, appointment.startTime, localNow())) {
      throw httpError(409, 'APPOINTMENT_STARTED', `This appointment has already started, so it cannot be ${verb}`);
    }
  }

  async listCancellationReasons({ tenantUuid }) {
    const rows = await AppointmentCancellationReason.findAll({
      where: { status: 'ACTIVE', [Op.or]: [{ tenant_uuid: null }, { tenant_uuid: tenantUuid }] },
      order: [['reasonLabel', 'ASC']],
    });
    return { data: rows.map((r) => ({ reasonId: r.reasonId, reasonCode: r.reasonCode, reasonLabel: r.reasonLabel, applicableTo: r.applicableTo })) };
  }
}

module.exports = new BookingService();
module.exports.takePlace = takePlace; // exposed for the tests that prove the guard
