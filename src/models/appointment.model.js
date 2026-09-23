module.exports = (sequelize, DataTypes) => {
  const Appointment = sequelize.define(
    'Appointment',
    {
      appointmentId: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true, field: 'appointment_id' },
      appointmentUuid: { type: DataTypes.UUID, allowNull: false, unique: true, defaultValue: DataTypes.UUIDV4, field: 'appointment_uuid' },
      // Cross-database references (organization-admin-service) — no FK,
      // same reasoning as appointmentSlotConfig.model.js.
      tenantUuid: { type: DataTypes.UUID, allowNull: false, field: 'tenant_uuid' },
      facilityId: { type: DataTypes.BIGINT, allowNull: false, field: 'facility_id' },
      facilityServiceId: { type: DataTypes.BIGINT, allowNull: false, field: 'facility_service_id' },
      resourceId: { type: DataTypes.BIGINT, allowNull: true, field: 'resource_id' },
      slotId: { type: DataTypes.BIGINT, allowNull: false, field: 'slot_id' },
      // Patient lives in an external patient/EMR service — patientRef is
      // that service's id (no FK possible); the rest is a snapshot taken
      // at booking time, so historical bookings stay accurate even if the
      // patient's contact details change later upstream.
      patientRef: { type: DataTypes.STRING(100), allowNull: false, field: 'patient_ref' },
      patientName: { type: DataTypes.STRING(200), allowNull: false, field: 'patient_name' },
      patientPhone: { type: DataTypes.STRING(20), allowNull: false, field: 'patient_phone' },
      patientEmail: { type: DataTypes.STRING(150), allowNull: true, field: 'patient_email' },
      appointmentDate: { type: DataTypes.DATEONLY, allowNull: false, field: 'appointment_date' },
      startTime: { type: DataTypes.TIME, allowNull: false, field: 'start_time' },
      endTime: { type: DataTypes.TIME, allowNull: false, field: 'end_time' },
      tokenNumber: { type: DataTypes.STRING(20), allowNull: true, field: 'token_number' },
      bookingChannel: { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'ADMIN', field: 'booking_channel' },
      status: { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'BOOKED', field: 'status' },
      cancellationReasonId: { type: DataTypes.BIGINT, allowNull: true, field: 'cancellation_reason_id' },
      cancellationNotes: { type: DataTypes.STRING(500), allowNull: true, field: 'cancellation_notes' },
      cancelledBy: { type: DataTypes.BIGINT, allowNull: true, field: 'cancelled_by' },
      cancelledOn: { type: DataTypes.DATE, allowNull: true, field: 'cancelled_on' },
      rescheduledFromAppointmentId: { type: DataTypes.BIGINT, allowNull: true, field: 'rescheduled_from_appointment_id' },
      notes: { type: DataTypes.STRING(1000), allowNull: true, field: 'notes' },
      createdBy: { type: DataTypes.BIGINT, allowNull: true, field: 'created_by' },
      createdOn: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'created_on' },
      modifiedBy: { type: DataTypes.BIGINT, allowNull: true, field: 'modified_by' },
      modifiedOn: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'modified_on' },
    },
    {
      tableName: 'appointments',
      freezeTableName: true,
      timestamps: false,
      indexes: [
        { fields: ['tenant_uuid'] },
        { fields: ['facility_id', 'appointment_date', 'status'] },
        { fields: ['slot_id'] },
        { fields: ['patient_ref'] },
      ],
    },
  );

  return Appointment;
};
