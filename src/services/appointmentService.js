const { Op } = require("sequelize");
const { Appointment, AppointmentStatusHistory, FacilityResource } = require("../models");
const { toSequelizePage, buildEnvelope } = require("../utils/pagination");

const RESOURCE_INCLUDE = { model: FacilityResource, as: "resource", attributes: ["resourceId", "resourceName", "providerId"] };

function notFound(message = "Appointment not found") {
  const error = new Error(message);
  error.statusCode = 404;
  error.code = "APPOINTMENT_NOT_FOUND";
  error.expose = true;
  return error;
}

function toResponse(appointment) {
  if (!appointment) return null;
  const plain = appointment.get
    ? appointment.get({ plain: true })
    : appointment;
  return {
    appointmentId: plain.appointmentId,
    appointmentUuid: plain.appointmentUuid,
    tenantUuid: plain.tenantUuid,
    facilityId: plain.facilityId,
    facilityServiceId: plain.facilityServiceId,
    resourceId: plain.resourceId,
    slotId: plain.slotId,
    patientRef: plain.patientRef,
    patientName: plain.patientName,
    patientPhone: plain.patientPhone,
    patientEmail: plain.patientEmail,
    appointmentDate: plain.appointmentDate,
    startTime: plain.startTime,
    endTime: plain.endTime,
    tokenNumber: plain.tokenNumber,
    bookingChannel: plain.bookingChannel,
    status: plain.status,
    cancellationReasonId: plain.cancellationReasonId,
    cancellationNotes: plain.cancellationNotes,
    cancelledBy: plain.cancelledBy,
    cancelledOn: plain.cancelledOn,
    rescheduledFromAppointmentId: plain.rescheduledFromAppointmentId,
    notes: plain.notes,
    resourceName: plain.resource?.resourceName ?? null,
    providerId: plain.resource?.providerId ?? null,
    createdOn: plain.createdOn,
    modifiedOn: plain.modifiedOn,
  };
}

class AppointmentService {
  /**
   * tenantUuid: undefined means "every tenant" — only ever passed as
   * undefined for a SUPERADMIN caller (see appointmentController's
   * isSuperAdmin()); every other caller is always pinned to their own
   * token's tenant_uuid regardless of what (if anything) they request.
   */
  async getList({
    page,
    limit,
    tenantUuid,
    search,
    facilityId,
    facilityServiceId,
    status,
    dateFrom,
    dateTo,
  }) {
    const {
      limit: safeLimit,
      offset,
      page: safePage,
    } = toSequelizePage({ page, limit });

    const where = {};
    if (tenantUuid) where.tenant_uuid = tenantUuid;
    if (facilityId) where.facility_id = facilityId;
    if (facilityServiceId) where.facility_service_id = facilityServiceId;
    if (status) where.status = status;
    if (dateFrom || dateTo) {
      where.appointment_date = {};
      if (dateFrom) where.appointment_date[Op.gte] = dateFrom;
      if (dateTo) where.appointment_date[Op.lte] = dateTo;
    }
    if (search) {
      where[Op.or] = [
        { patient_name: { [Op.like]: `%${search}%` } },
        { patient_phone: { [Op.like]: `%${search}%` } },
        { token_number: { [Op.like]: `%${search}%` } },
      ];
    }

    const result = await Appointment.findAndCountAll({
      where,
      include: [RESOURCE_INCLUDE],
      limit: safeLimit,
      offset,
      order: [
        ["appointmentDate", "DESC"],
        ["startTime", "DESC"],
      ],
    });

    return buildEnvelope(
      { rows: result.rows.map(toResponse), count: result.count },
      { page: safePage, limit: safeLimit },
    );
  }

  async getById(appointmentId, { tenantUuid }) {
    const where = { appointment_id: appointmentId };
    // Same "undefined tenantUuid = SUPERADMIN sees any tenant" contract as
    // getList above.
    if (tenantUuid) where.tenant_uuid = tenantUuid;

    const appointment = await Appointment.findOne({ where, include: [RESOURCE_INCLUDE] });
    if (!appointment) throw notFound();
    return toResponse(appointment);
  }

  /** One appointment with its status history, for the booking confirmation and the detail view. */
  async getDetail(appointmentId, { tenantUuid }) {
    const where = { appointment_id: appointmentId };
    if (tenantUuid) where.tenant_uuid = tenantUuid;
    const appointment = await Appointment.findOne({
      where,
      include: [RESOURCE_INCLUDE, { model: AppointmentStatusHistory, as: "history" }],
      order: [[{ model: AppointmentStatusHistory, as: "history" }, "changedOn", "ASC"]],
    });
    if (!appointment) throw notFound();
    const base = toResponse(appointment);
    return {
      ...base,
      history: (appointment.history || []).map((h) => ({ fromStatus: h.fromStatus, toStatus: h.toStatus, remarks: h.remarks, changedBy: h.changedBy, changedOn: h.changedOn })),
    };
  }
}

module.exports = new AppointmentService();
