module.exports = (sequelize, DataTypes) => {
  const FacilityClosure = sequelize.define(
    'FacilityClosure',
    {
      closureId: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true, field: 'closure_id' },
      closureUuid: { type: DataTypes.UUID, allowNull: false, unique: true, defaultValue: DataTypes.UUIDV4, field: 'closure_uuid' },
      tenantUuid: { type: DataTypes.UUID, allowNull: false, field: 'tenant_uuid' },
      // NULL facilityId = applies to every facility in the tenant. NULL
      // facilityServiceId = whole facility; set = just this one service/
      // doctor. Cross-database references (organization-admin-service) —
      // no FK, same reasoning as facilityResource.model.js.
      facilityId: { type: DataTypes.BIGINT, allowNull: true, field: 'facility_id' },
      facilityServiceId: { type: DataTypes.BIGINT, allowNull: true, field: 'facility_service_id' },
      resourceId: { type: DataTypes.BIGINT, allowNull: true, field: 'resource_id' },
      closureType: { type: DataTypes.STRING(30), allowNull: false, field: 'closure_type' }, // HOLIDAY / WEEKLY_OFF / EMERGENCY / MAINTENANCE / OTHER
      // ONE_TIME / WEEKLY / ANNUAL — see facilityClosure.validation.js for
      // which of closureDate/dayOfWeek each one requires.
      recurrenceType: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'ONE_TIME', field: 'recurrence_type' },
      closureDate: { type: DataTypes.DATEONLY, allowNull: true, field: 'closure_date' }, // required for ONE_TIME/ANNUAL; for ANNUAL only month+day are reused each year
      dayOfWeek: { type: DataTypes.TINYINT, allowNull: true, field: 'day_of_week' }, // 1=Mon ... 7=Sun — required for WEEKLY
      closureName: { type: DataTypes.STRING(150), allowNull: false, field: 'closure_name' },
      reason: { type: DataTypes.STRING(500), allowNull: true, field: 'reason' },
      status: { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'ACTIVE', field: 'status' }, // ACTIVE / CANCELLED
      createdBy: { type: DataTypes.BIGINT, allowNull: true, field: 'created_by' },
      createdOn: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'created_on' },
      modifiedBy: { type: DataTypes.BIGINT, allowNull: true, field: 'modified_by' },
      modifiedOn: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'modified_on' },
    },
    {
      tableName: 'facility_closures',
      freezeTableName: true,
      timestamps: false,
      indexes: [
        { fields: ['tenant_uuid'] },
        { fields: ['facility_id', 'closure_date'] },
        { fields: ['closure_type'] },
      ],
    },
  );

  return FacilityClosure;
};
