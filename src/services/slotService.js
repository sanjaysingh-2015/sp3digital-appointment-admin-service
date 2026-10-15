const { Op } = require('sequelize');
const { AppointmentSlot, FacilityResource } = require('../models');
const { localNow, addDays, normTime } = require('../utils/clock');

const MAX_RANGE_DAYS = 31;
const hhmm = (time) => String(time).slice(0, 5);

function toResponse(slot) {
  const s = slot.get ? slot.get({ plain: true }) : slot;
  return {
    slotId: s.slotId,
    slotUuid: s.slotUuid,
    facilityId: s.facilityId,
    facilityServiceId: s.facilityServiceId,
    resourceId: s.resourceId,
    resourceName: s.resource?.resourceName ?? null,
    providerId: s.resource?.providerId ?? null,
    providerAffiliationId: s.resource?.providerAffiliationId ?? null,
    slotDate: s.slotDate,
    startTime: hhmm(s.startTime),
    endTime: hhmm(s.endTime),
    capacity: s.capacity,
    bookedCount: s.bookedCount,
    remaining: Math.max(s.capacity - s.bookedCount, 0),
    status: s.status,
  };
}

class SlotService {
  /**
   * Slots a person could still book: today from the current time onwards, or any
   * later date. Slots whose start time has passed are never returned. By default
   * only slots with a free place; `includeFull` also lists full ones, so the
   * schedule can be seen as it stands.
   */
  async search({ tenantUuid, facilityId, facilityServiceId, resourceId, providerId, date, dateFrom, dateTo, includeFull = false, limit = 300 }) {
    const now = localNow();
    const from = date || dateFrom || now.date;
    const to = date || dateTo || addDays(from, 6);
    const lastAllowed = addDays(from, MAX_RANGE_DAYS - 1);
    const safeTo = to > lastAllowed ? lastAllowed : to;

    const where = {
      tenant_uuid: tenantUuid,
      facility_id: facilityId,
      slot_date: { [Op.between]: [from < now.date ? now.date : from, safeTo] },
      status: includeFull ? { [Op.in]: ['OPEN', 'FULL'] } : 'OPEN',
      // never in the past: later dates, or today with a start time after right now
      [Op.or]: [{ slot_date: { [Op.gt]: now.date } }, { slot_date: now.date, start_time: { [Op.gt]: now.time } }],
    };
    if (facilityServiceId) where.facility_service_id = facilityServiceId;
    if (resourceId) where.resource_id = resourceId;

    const resourceInclude = { model: FacilityResource, as: 'resource', attributes: ['resourceId', 'resourceName', 'providerId', 'providerAffiliationId'] };
    if (providerId) {
      resourceInclude.required = true;
      resourceInclude.where = { provider_id: providerId };
    }

    const rows = await AppointmentSlot.findAll({
      where,
      include: [resourceInclude],
      order: [['slotDate', 'ASC'], ['startTime', 'ASC'], ['slotId', 'ASC']],
      limit: Math.min(Number(limit) || 300, 500),
    });
    const data = rows.map(toResponse).filter((s) => includeFull || s.remaining > 0);
    return { data, window: { from: where.slot_date[Op.between][0], to: safeTo }, now: { date: now.date, time: normTime(now.time) } };
  }
}

module.exports = new SlotService();
module.exports.toResponse = toResponse;
