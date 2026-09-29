const { AppointmentSlotConfig, FacilityResource } = require('../models');
const { toSequelizePage, buildEnvelope } = require('../utils/pagination');
const { SLOT_CONFIG_PERMISSIONS } = require('../utils/permissions');
const { hasPermission } = require('../middleware/authentication');
const { validateRecurrenceFields } = require('../validations/appointmentSlotConfig.validation');

function notFound(message = 'Slot configuration not found') {
  const error = new Error(message);
  error.statusCode = 404;
  error.code = 'SLOT_CONFIG_NOT_FOUND';
  error.expose = true;
  return error;
}

function badState(message) {
  const error = new Error(message);
  error.statusCode = 409;
  error.code = 'INVALID_APPROVAL_STATE';
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

function toResponse(slotConfig) {
  if (!slotConfig) return null;
  const plain = slotConfig.get ? slotConfig.get({ plain: true }) : slotConfig;
  return {
    slotConfigId: plain.slotConfigId,
    slotConfigUuid: plain.slotConfigUuid,
    tenantUuid: plain.tenantUuid,
    facilityId: plain.facilityId,
    facilityServiceId: plain.facilityServiceId,
    resourceId: plain.resourceId,
    resourceName: plain.resource?.resourceName ?? null,
    recurrenceType: plain.recurrenceType,
    dayOfWeek: plain.dayOfWeek,
    dayOfMonth: plain.dayOfMonth,
    startTime: plain.startTime,
    endTime: plain.endTime,
    slotDurationMinutes: plain.slotDurationMinutes,
    capacityPerSlot: plain.capacityPerSlot,
    effectiveFrom: plain.effectiveFrom,
    effectiveTo: plain.effectiveTo,
    status: plain.status,
    approvalStatus: plain.approvalStatus,
    reviewedBy: plain.reviewedBy,
    reviewedOn: plain.reviewedOn,
    rejectionReason: plain.rejectionReason,
    createdBy: plain.createdBy,
    createdOn: plain.createdOn,
    modifiedBy: plain.modifiedBy,
    modifiedOn: plain.modifiedOn,
  };
}

const RESOURCE_INCLUDE = [{ model: FacilityResource, as: 'resource', attributes: ['resourceId', 'resourceName'] }];

class AppointmentSlotConfigService {
  /**
   * A TENANT_USER (who can CREATE but not APPROVE) always lands in
   * PENDING_APPROVAL. A TENANT_ADMIN (who holds APPROVE) is auto-approved
   * at create time — they already have the authority to approve it a
   * moment later anyway, so a self-review step adds friction with no
   * actual safety benefit.
   */
  async create(payload, { tenantUuid, userId, scopes }) {
    const canApprove = hasPermission(scopes, SLOT_CONFIG_PERMISSIONS.APPROVE);
    const now = new Date();

    const slotConfig = await AppointmentSlotConfig.create({
      tenantUuid,
      facilityId: payload.facilityId,
      facilityServiceId: payload.facilityServiceId,
      resourceId: payload.resourceId ?? null,
      recurrenceType: payload.recurrenceType,
      dayOfWeek: payload.dayOfWeek ?? null,
      dayOfMonth: payload.dayOfMonth ?? null,
      startTime: payload.startTime,
      endTime: payload.endTime,
      slotDurationMinutes: payload.slotDurationMinutes,
      capacityPerSlot: payload.capacityPerSlot || 1,
      effectiveFrom: payload.effectiveFrom,
      effectiveTo: payload.effectiveTo ?? null,
      status: 'ACTIVE',
      approvalStatus: canApprove ? 'APPROVED' : 'PENDING_APPROVAL',
      reviewedBy: canApprove ? userId : null,
      reviewedOn: canApprove ? now : null,
      createdBy: userId || null,
      modifiedBy: userId || null,
    });

    await slotConfig.reload({ include: RESOURCE_INCLUDE });
    return toResponse(slotConfig);
  }

  /**
   * Both TENANT_ADMIN and TENANT_USER see the same tenant-wide list —
   * there's no "my submissions only" restriction for TENANT_USER here.
   * `approvalStatus` filter lets a TENANT_ADMIN pull just their review
   * queue with ?approvalStatus=PENDING_APPROVAL.
   */
  async getList({ page, limit, tenantUuid, facilityId, facilityServiceId, recurrenceType, approvalStatus, status }) {
    const { limit: safeLimit, offset, page: safePage } = toSequelizePage({ page, limit });

    const where = { tenant_uuid: tenantUuid };
    if (facilityId) where.facility_id = facilityId;
    if (facilityServiceId) where.facility_service_id = facilityServiceId;
    if (recurrenceType) where.recurrence_type = recurrenceType;
    if (approvalStatus) where.approval_status = approvalStatus;
    if (status) where.status = status;

    const result = await AppointmentSlotConfig.findAndCountAll({
      where,
      limit: safeLimit,
      offset,
      order: [['createdOn', 'DESC']],
      include: RESOURCE_INCLUDE,
    });

    return buildEnvelope(
      { rows: result.rows.map(toResponse), count: result.count },
      { page: safePage, limit: safeLimit },
    );
  }

  async getById(slotConfigId, { tenantUuid }) {
    const slotConfig = await AppointmentSlotConfig.findOne({
      where: { slot_config_id: slotConfigId, tenant_uuid: tenantUuid },
      include: RESOURCE_INCLUDE,
    });
    if (!slotConfig) throw notFound();
    return toResponse(slotConfig);
  }

  /**
   * Route-gated to SLOT_CONFIG_PERMISSIONS.UPDATE (TENANT_ADMIN only).
   *
   * A PATCH body often won't carry recurrenceType/dayOfWeek/dayOfMonth
   * together (e.g. "just change the capacity"), so appointmentSlotConfig
   * .validation.js's Joi schemas can't check the recurrence fields are
   * mutually consistent in isolation — that's done here instead, against
   * the EFFECTIVE state (existing row + patch merged), so switching
   * recurrenceType from WEEKLY to MONTHLY without also clearing the old
   * dayOfWeek (or vice versa) is rejected rather than silently leaving
   * stale, contradictory fields set.
   */
  async update(slotConfigId, patch, { tenantUuid, userId }) {
    const slotConfig = await AppointmentSlotConfig.findOne({
      where: { slot_config_id: slotConfigId, tenant_uuid: tenantUuid },
    });
    if (!slotConfig) throw notFound();

    const effective = {
      recurrenceType: patch.recurrenceType ?? slotConfig.recurrenceType,
      dayOfWeek: 'dayOfWeek' in patch ? patch.dayOfWeek : slotConfig.dayOfWeek,
      dayOfMonth: 'dayOfMonth' in patch ? patch.dayOfMonth : slotConfig.dayOfMonth,
    };
    // Switching recurrenceType clears whichever day field no longer
    // applies, so the caller doesn't also have to remember to null it out
    // explicitly in the same request.
    if (patch.recurrenceType && patch.recurrenceType !== slotConfig.recurrenceType) {
      if (patch.recurrenceType !== 'WEEKLY' && !('dayOfWeek' in patch)) effective.dayOfWeek = null;
      if (patch.recurrenceType !== 'MONTHLY' && !('dayOfMonth' in patch)) effective.dayOfMonth = null;
    }
    const recurrenceError = validateRecurrenceFields(effective);
    if (recurrenceError) throw invalidRecurrence(recurrenceError);

    await slotConfig.update({ ...patch, ...effective, modifiedBy: userId || null, modifiedOn: new Date() });
    await slotConfig.reload({ include: RESOURCE_INCLUDE });
    return toResponse(slotConfig);
  }

  /** Route-gated to SLOT_CONFIG_PERMISSIONS.APPROVE (TENANT_ADMIN only). */
  async approve(slotConfigId, { tenantUuid, userId }) {
    const slotConfig = await AppointmentSlotConfig.findOne({
      where: { slot_config_id: slotConfigId, tenant_uuid: tenantUuid },
    });
    if (!slotConfig) throw notFound();
    if (slotConfig.approvalStatus !== 'PENDING_APPROVAL') {
      throw badState(`Cannot approve a slot configuration in ${slotConfig.approvalStatus} state`);
    }

    await slotConfig.update({
      approvalStatus: 'APPROVED',
      reviewedBy: userId || null,
      reviewedOn: new Date(),
      rejectionReason: null,
      modifiedBy: userId || null,
      modifiedOn: new Date(),
    });
    await slotConfig.reload({ include: RESOURCE_INCLUDE });
    return toResponse(slotConfig);
  }

  /** Route-gated to SLOT_CONFIG_PERMISSIONS.APPROVE (TENANT_ADMIN only). */
  async reject(slotConfigId, rejectionReason, { tenantUuid, userId }) {
    const slotConfig = await AppointmentSlotConfig.findOne({
      where: { slot_config_id: slotConfigId, tenant_uuid: tenantUuid },
    });
    if (!slotConfig) throw notFound();
    if (slotConfig.approvalStatus !== 'PENDING_APPROVAL') {
      throw badState(`Cannot reject a slot configuration in ${slotConfig.approvalStatus} state`);
    }

    await slotConfig.update({
      approvalStatus: 'REJECTED',
      reviewedBy: userId || null,
      reviewedOn: new Date(),
      rejectionReason,
      modifiedBy: userId || null,
      modifiedOn: new Date(),
    });
    await slotConfig.reload({ include: RESOURCE_INCLUDE });
    return toResponse(slotConfig);
  }
}

module.exports = new AppointmentSlotConfigService();
