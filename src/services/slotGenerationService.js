const { Op } = require('sequelize');
const { AppointmentSlotConfig, AppointmentSlot, FacilityClosure } = require('../models');
const { localNow, addDays, isoDayOfWeek, toMinutes, toTime, normTime, isPast } = require('../utils/clock');

// Slots the generator closes carry this prefix, so it can tell its own closures
// (which it may reopen when the cause goes away) from anything done by hand.
const AUTO = 'AUTO: ';
const MAX_DAYS = 90;
const defaultDays = () => Number(process.env.SLOT_HORIZON_DAYS) || 30;

const keyOf = (serviceId, resourceId, date, time) => `${serviceId}|${resourceId || 0}|${String(date).slice(0, 10)}|${normTime(time)}`;
const same = (a, b) => Number(a) === Number(b);

function dateRange(from, to) {
  const dates = [];
  for (let d = from; d <= to; d = addDays(d, 1)) dates.push(d);
  return dates;
}

function ruleAppliesOn(rule, date) {
  if (String(rule.effectiveFrom).slice(0, 10) > date) return false;
  if (rule.effectiveTo && String(rule.effectiveTo).slice(0, 10) < date) return false;
  switch (rule.recurrenceType) {
    case 'DAILY': return true;
    case 'WEEKLY': return isoDayOfWeek(date) === Number(rule.dayOfWeek);
    case 'MONTHLY': return Number(date.slice(8, 10)) === Number(rule.dayOfMonth); // a 31st rule simply skips short months
    default: return false;
  }
}

/** The closure (holiday, weekly off, emergency, a doctor's leave) that covers this scope on this date, if any. */
function closureFor(scope, date, closures) {
  return closures.find((c) => {
    if (c.facilityId !== null && c.facilityId !== undefined && !same(c.facilityId, scope.facilityId)) return false;
    if (c.facilityServiceId !== null && c.facilityServiceId !== undefined && !same(c.facilityServiceId, scope.facilityServiceId)) return false;
    if (c.resourceId !== null && c.resourceId !== undefined && !same(c.resourceId, scope.resourceId)) return false;
    switch (c.recurrenceType) {
      case 'ONE_TIME': return String(c.closureDate).slice(0, 10) === date;
      case 'WEEKLY': return isoDayOfWeek(date) === Number(c.dayOfWeek);
      case 'ANNUAL': return String(c.closureDate).slice(5, 10) === date.slice(5, 10);
      default: return false;
    }
  });
}

/**
 * Turns approved slot rules into dated, bookable slots for the next N days
 * (default SLOT_HORIZON_DAYS = 30, at most 90). Safe to run repeatedly — it is
 * what the nightly job does:
 *
 *   - creates the slots that do not exist yet (never one that already has bookings changed)
 *   - skips dates covered by a closure, a weekly off, or the doctor's leave
 *   - skips times that have already passed today
 *   - closes still-unbooked slots whose rule was edited, switched off, or whose
 *     date has since become a closure; slots that already have bookings are left
 *     alone and counted as `conflicts` for a person to resolve
 *   - reopens slots it closed itself when the cause goes away
 */
class SlotGenerationService {
  async generate({ tenantUuid, facilityId, fromDate, days, dryRun = false, userId = null } = {}) {
    const now = localNow();
    const start = fromDate && fromDate > now.date ? fromDate : now.date;
    const horizon = Math.min(Math.max(Number(days) || defaultDays(), 1), MAX_DAYS);
    const end = addDays(start, horizon - 1);

    const scope = {};
    if (tenantUuid) scope.tenant_uuid = tenantUuid;
    if (facilityId) scope.facility_id = facilityId;

    const rules = await AppointmentSlotConfig.findAll({
      where: {
        ...scope,
        status: 'ACTIVE',
        approval_status: 'APPROVED',
        effective_from: { [Op.lte]: end },
        [Op.or]: [{ effective_to: null }, { effective_to: { [Op.gte]: start } }],
      },
    });
    const closures = await FacilityClosure.findAll({ where: { ...(tenantUuid ? { tenant_uuid: tenantUuid } : {}), status: 'ACTIVE' } });
    const existing = await AppointmentSlot.findAll({ where: { ...scope, slot_date: { [Op.between]: [start, end] } } });

    const closuresOf = (tenant) => closures.filter((c) => c.tenantUuid === tenant);
    const existingByKey = new Map(existing.map((s) => [keyOf(s.facilityServiceId, s.resourceId, s.slotDate, s.startTime), s]));

    // What should exist, from today's rules.
    const desired = new Map();
    for (const rule of rules) {
      const ruleClosures = closuresOf(rule.tenantUuid);
      const step = Number(rule.slotDurationMinutes);
      const from = toMinutes(rule.startTime);
      const to = toMinutes(rule.endTime);
      for (const date of dateRange(start, end)) {
        if (!ruleAppliesOn(rule, date) || closureFor(rule, date, ruleClosures)) continue;
        for (let t = from; t + step <= to; t += step) {
          if (isPast(date, toTime(t), now)) continue;
          const key = keyOf(rule.facilityServiceId, rule.resourceId, date, toTime(t));
          if (desired.has(key)) continue; // overlapping rules: the first one wins
          desired.set(key, {
            tenantUuid: rule.tenantUuid,
            facilityId: rule.facilityId,
            facilityServiceId: rule.facilityServiceId,
            resourceId: rule.resourceId ?? null,
            slotConfigId: rule.slotConfigId,
            slotDate: date,
            startTime: toTime(t),
            endTime: toTime(t + step),
            capacity: rule.capacityPerSlot,
            bookedCount: 0,
            status: 'OPEN',
            createdBy: userId,
          });
        }
      }
    }

    const toCreate = [];
    const toReopen = [];
    for (const [key, slot] of desired) {
      const found = existingByKey.get(key);
      if (!found) toCreate.push(slot);
      else if (found.status === 'CLOSED' && String(found.cancelReason || '').startsWith(AUTO)) toReopen.push(found);
    }

    // What exists but should not any more (rule edited / switched off / a closure was added).
    const toClose = [];
    const conflicts = [];
    for (const slot of existing) {
      if (!slot.slotConfigId || slot.status === 'CLOSED') continue; // hand-made or already closed: not ours to touch
      if (desired.has(keyOf(slot.facilityServiceId, slot.resourceId, slot.slotDate, slot.startTime))) continue;
      if (isPast(slot.slotDate, slot.startTime, now)) continue;
      if (slot.bookedCount > 0) conflicts.push(slot);
      else toClose.push(slot);
    }

    const summary = {
      fromDate: start,
      toDate: end,
      rulesConsidered: rules.length,
      created: toCreate.length,
      reopened: toReopen.length,
      closed: toClose.length,
      conflicts: conflicts.length,
      dryRun,
    };
    if (dryRun) return summary;

    for (let i = 0; i < toCreate.length; i += 500) {
      await AppointmentSlot.bulkCreate(toCreate.slice(i, i + 500), { ignoreDuplicates: true });
    }
    if (toReopen.length) {
      await AppointmentSlot.update(
        { status: 'OPEN', cancelReason: null, cancelledOn: null, modifiedOn: new Date() },
        { where: { slot_id: { [Op.in]: toReopen.map((s) => s.slotId) } } },
      );
    }
    for (const slot of toClose) {
      const closure = closureFor(slot, String(slot.slotDate).slice(0, 10), closuresOf(slot.tenantUuid));
      await slot.update({
        status: 'CLOSED',
        cancelReason: `${AUTO}${closure ? `Closed: ${closure.closureName}` : 'Rule changed or switched off'}`.slice(0, 255),
        cancelledOn: new Date(),
        modifiedOn: new Date(),
      });
    }
    return summary;
  }
}

module.exports = new SlotGenerationService();
module.exports.AUTO = AUTO;
