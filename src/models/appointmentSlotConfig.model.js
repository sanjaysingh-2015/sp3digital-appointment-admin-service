module.exports = (sequelize, DataTypes) => {
  const AppointmentSlotConfig = sequelize.define(
    'AppointmentSlotConfig',
    {
      slotConfigId: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true, field: 'slot_config_id' },
      slotConfigUuid: { type: DataTypes.UUID, allowNull: false, unique: true, defaultValue: DataTypes.UUIDV4, field: 'slot_config_uuid' },
      // Cross-database references (organization-admin-service /
      // identity-admin-service) — no FK, see model comment pattern
      // established in facilityResource.model.js above.
      tenantUuid: { type: DataTypes.UUID, allowNull: false, field: 'tenant_uuid' },
      facilityId: { type: DataTypes.BIGINT, allowNull: false, field: 'facility_id' },
      facilityServiceId: { type: DataTypes.BIGINT, allowNull: false, field: 'facility_service_id' },
      resourceId: { type: DataTypes.BIGINT, allowNull: true, field: 'resource_id' },
      dayOfWeek: { type: DataTypes.TINYINT, allowNull: false, field: 'day_of_week' }, // 1=Mon ... 7=Sun (ISO-8601)
      startTime: { type: DataTypes.TIME, allowNull: false, field: 'start_time' },
      endTime: { type: DataTypes.TIME, allowNull: false, field: 'end_time' },
      slotDurationMinutes: { type: DataTypes.SMALLINT, allowNull: false, field: 'slot_duration_minutes' },
      capacityPerSlot: { type: DataTypes.SMALLINT, allowNull: false, defaultValue: 1, field: 'capacity_per_slot' },
      effectiveFrom: { type: DataTypes.DATEONLY, allowNull: false, field: 'effective_from' },
      effectiveTo: { type: DataTypes.DATEONLY, allowNull: true, field: 'effective_to' },
      // Whether the rule itself is switched on — independent of approval;
      // a TENANT_ADMIN can deactivate an already-approved rule without
      // deleting it.
      status: { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'ACTIVE', field: 'status' },
      // Maker-checker workflow — see appointmentSlotConfigService.js for
      // the transition rules (who can move it between these states).
      approvalStatus: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'PENDING_APPROVAL', field: 'approval_status' },
      reviewedBy: { type: DataTypes.BIGINT, allowNull: true, field: 'reviewed_by' },
      reviewedOn: { type: DataTypes.DATE, allowNull: true, field: 'reviewed_on' },
      rejectionReason: { type: DataTypes.STRING(500), allowNull: true, field: 'rejection_reason' },
      createdBy: { type: DataTypes.BIGINT, allowNull: true, field: 'created_by' },
      createdOn: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'created_on' },
      modifiedBy: { type: DataTypes.BIGINT, allowNull: true, field: 'modified_by' },
      modifiedOn: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'modified_on' },
    },
    {
      tableName: 'appointment_slot_configs',
      freezeTableName: true,
      timestamps: false,
      indexes: [
        { fields: ['tenant_uuid'] },
        { fields: ['facility_id', 'facility_service_id', 'day_of_week'] },
        { fields: ['resource_id'] },
        { fields: ['tenant_uuid', 'approval_status'] },
      ],
    },
  );

  return AppointmentSlotConfig;
};
