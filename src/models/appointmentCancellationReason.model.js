module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'AppointmentCancellationReason',
    {
      reasonId: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true, field: 'reason_id' },
      // NULL = a platform-wide default every tenant sees; set = a tenant's own reason.
      tenantUuid: { type: DataTypes.UUID, allowNull: true, field: 'tenant_uuid' },
      reasonCode: { type: DataTypes.STRING(50), allowNull: false, field: 'reason_code' },
      reasonLabel: { type: DataTypes.STRING(150), allowNull: false, field: 'reason_label' },
      applicableTo: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'ANY', field: 'applicable_to' },
      status: { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'ACTIVE', field: 'status' },
      createdOn: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'created_on' },
      modifiedOn: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'modified_on' },
    },
    { tableName: 'appointment_cancellation_reasons', freezeTableName: true, timestamps: false },
  );
