module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'AppointmentTokenCounter',
    {
      tenantUuid: { type: DataTypes.UUID, primaryKey: true, allowNull: false, field: 'tenant_uuid' },
      facilityServiceId: { type: DataTypes.BIGINT, primaryKey: true, allowNull: false, field: 'facility_service_id' },
      // 0 = the service as a whole, otherwise the doctor's resource id: each doctor counts their own tokens.
      resourceKey: { type: DataTypes.BIGINT, primaryKey: true, allowNull: false, defaultValue: 0, field: 'resource_key' },
      tokenDate: { type: DataTypes.DATEONLY, primaryKey: true, allowNull: false, field: 'token_date' },
      lastNumber: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: 'last_number' },
    },
    { tableName: 'appointment_token_counters', freezeTableName: true, timestamps: false },
  );
