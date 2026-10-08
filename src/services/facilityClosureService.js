const { FacilityClosure, FacilityResource } = require('../models');
const { toSequelizePage, buildEnvelope } = require('../utils/pagination');
const { validateRecurrenceFields } = require('../validations/facilityClosure.validation');
const { resolveProviderResource } = require('./providerResourceService');
const { httpError } = require('../utils/errors');

function notFound(message = 'Facility closure not found') {
  const error = new Error(message);
  error.statusCode = 404;
  error.code = 'FACILITY_CLOSURE_NOT_FOUND';
  error.expose = true;
  return error;
}

function invalidRecurrence(message) {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = 'INVALID_RECURRENCE_FIELDS';
  error.expose = true;
  return error;
}

const RESOURCE_INCLUDE = [{ model: FacilityResource, as: 'resource', attributes: ['resourceId', 'resourceName', 'providerId', 'providerAffiliationId'] }];

function toResponse(closure) {
  if (!closure) return null;
  const plain = closure.get ? closure.get({ plain: true }) : closure;
  return {
    closureId: plain.closureId,
    closureUuid: plain.closureUuid,
    tenantUuid: plain.tenantUuid,
    facilityId: plain.facilityId,
    facilityServiceId: plain.facilityServiceId,
    resourceId: plain.resourceId,
    resourceName: plain.resource?.resourceName ?? null,
    providerId: plain.resource?.providerId ?? null,
    providerAffiliationId: plain.resource?.providerAffiliationId ?? null,
    closureType: plain.closureType,
    recurrenceType: plain.recurrenceType,
    closureDate: plain.closureDate,
    dayOfWeek: plain.dayOfWeek,
    closureName: plain.closureName,
    reason: plain.reason,
    status: plain.status,
    createdBy: plain.createdBy,
    createdOn: plain.createdOn,
    modifiedBy: plain.modifiedBy,
    modifiedOn: plain.modifiedOn,
  };
}

class FacilityClosureService {
  async create(payload, { tenantUuid, userId, token }) {
    let facilityId = payload.facilityId ?? null;
    let resourceId = payload.resourceId ?? null;
    if (payload.providerAffiliationId) {
      // A doctor's leave belongs to one of their services (their slots are per service).
      if (!payload.facilityServiceId) {
        throw httpError(400, 'PROVIDER_CLOSURE_NEEDS_SERVICE', 'Choose the service the doctor is on leave from');
      }
      const { resource, affiliation } = await resolveProviderResource({
        providerAffiliationId: payload.providerAffiliationId,
        facilityId,
        facilityServiceId: payload.facilityServiceId,
        tenantUuid,
        userId,
        token,
      });
      resourceId = resource.resourceId;
      facilityId = facilityId ?? affiliation.facilityId;
    }

    const closure = await FacilityClosure.create({
      tenantUuid,
      facilityId,
      facilityServiceId: payload.facilityServiceId ?? null,
      resourceId,
      closureType: payload.closureType,
      recurrenceType: payload.recurrenceType,
      closureDate: payload.closureDate ?? null,
      dayOfWeek: payload.dayOfWeek ?? null,
      closureName: payload.closureName,
      reason: payload.reason ?? null,
      status: 'ACTIVE',
      createdBy: userId || null,
      modifiedBy: userId || null,
    });

    await closure.reload({ include: RESOURCE_INCLUDE });
    return toResponse(closure);
  }

  async getList({ page, limit, tenantUuid, facilityId, facilityServiceId, providerId, closureType, recurrenceType, status }) {
    const { limit: safeLimit, offset, page: safePage } = toSequelizePage({ page, limit });

    const where = { tenant_uuid: tenantUuid };
    if (facilityId) where.facility_id = facilityId;
    if (facilityServiceId) where.facility_service_id = facilityServiceId;
    if (closureType) where.closure_type = closureType;
    if (recurrenceType) where.recurrence_type = recurrenceType;
    if (status) where.status = status;

    const include = [{ ...RESOURCE_INCLUDE[0] }];
    if (providerId) {
      include[0].required = true;
      include[0].where = { provider_id: providerId };
    }

    const result = await FacilityClosure.findAndCountAll({
      where,
      limit: safeLimit,
      offset,
      order: [['createdOn', 'DESC']],
      include,
    });

    return buildEnvelope(
      { rows: result.rows.map(toResponse), count: result.count },
      { page: safePage, limit: safeLimit },
    );
  }

  async getById(closureId, { tenantUuid }) {
    const closure = await FacilityClosure.findOne({
      where: { closure_id: closureId, tenant_uuid: tenantUuid },
      include: RESOURCE_INCLUDE,
    });
    if (!closure) throw notFound();
    return toResponse(closure);
  }

  /**
   * Same merge-then-validate approach as appointmentSlotConfigService.js
   * #update — a PATCH body often won't carry recurrenceType/closureDate/
   * dayOfWeek together, so the recurrence-field consistency check has to
   * run against the EFFECTIVE state (existing row + patch merged), not
   * the patch alone.
   */
  async update(closureId, rawPatch, { tenantUuid, userId, token }) {
    const closure = await FacilityClosure.findOne({
      where: { closure_id: closureId, tenant_uuid: tenantUuid },
    });
    if (!closure) throw notFound();
    const patch = { ...rawPatch };

    const effective = {
      recurrenceType: patch.recurrenceType ?? closure.recurrenceType,
      closureDate: 'closureDate' in patch ? patch.closureDate : closure.closureDate,
      dayOfWeek: 'dayOfWeek' in patch ? patch.dayOfWeek : closure.dayOfWeek,
    };
    // Switching recurrenceType clears whichever field no longer applies,
    // so the caller doesn't also have to remember to null it out
    // explicitly in the same request.
    if (patch.recurrenceType && patch.recurrenceType !== closure.recurrenceType) {
      if (patch.recurrenceType !== 'WEEKLY' && !('dayOfWeek' in patch)) effective.dayOfWeek = null;
      if (patch.recurrenceType === 'WEEKLY' && !('closureDate' in patch)) effective.closureDate = null;
    }
    const recurrenceError = validateRecurrenceFields(effective);
    if (recurrenceError) throw invalidRecurrence(recurrenceError);

    // Doctor leave: re-check the doctor when the doctor changes, or when the
    // facility / service the leave applies to moves.
    const providerTouched = 'providerAffiliationId' in patch;
    // Compare with what is stored: the UI resends every field on edit, and an
    // unchanged scope must not trigger a doctor re-check.
    const asId = (value) => (value === null || value === undefined ? null : Number(value));
    const scopeTouched =
      ('facilityId' in patch && asId(patch.facilityId) !== asId(closure.facilityId)) ||
      ('facilityServiceId' in patch && asId(patch.facilityServiceId) !== asId(closure.facilityServiceId));
    let currentAffiliationId = null;
    if (closure.resourceId) {
      const current = await FacilityResource.findByPk(closure.resourceId, { attributes: ['providerAffiliationId'] });
      currentAffiliationId = current?.providerAffiliationId ?? null;
    }
    const targetAffiliationId = providerTouched ? patch.providerAffiliationId : currentAffiliationId;
    if (targetAffiliationId && (providerTouched || scopeTouched)) {
      const facilityServiceId = 'facilityServiceId' in patch ? patch.facilityServiceId : closure.facilityServiceId;
      if (!facilityServiceId) {
        throw httpError(400, 'PROVIDER_CLOSURE_NEEDS_SERVICE', 'Choose the service the doctor is on leave from');
      }
      const { resource, affiliation } = await resolveProviderResource({
        providerAffiliationId: targetAffiliationId,
        facilityId: 'facilityId' in patch ? patch.facilityId : closure.facilityId,
        facilityServiceId,
        tenantUuid,
        userId,
        token,
      });
      patch.resourceId = resource.resourceId;
      if (!('facilityId' in patch) && !closure.facilityId) patch.facilityId = affiliation.facilityId;
    } else if (providerTouched) {
      patch.resourceId = null; // doctor removed from the closure
    }
    delete patch.providerAffiliationId;

    await closure.update({ ...patch, ...effective, modifiedBy: userId || null, modifiedOn: new Date() });
    await closure.reload({ include: RESOURCE_INCLUDE });
    return toResponse(closure);
  }

  /** Soft delete — sets status to CANCELLED rather than removing the row, preserving the audit trail. */
  async cancel(closureId, { tenantUuid, userId }) {
    const closure = await FacilityClosure.findOne({
      where: { closure_id: closureId, tenant_uuid: tenantUuid },
    });
    if (!closure) throw notFound();

    await closure.update({ status: 'CANCELLED', modifiedBy: userId || null, modifiedOn: new Date() });
    await closure.reload({ include: RESOURCE_INCLUDE });
    return toResponse(closure);
  }
}

module.exports = new FacilityClosureService();
