module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'AppointmentStatusHistory',
    {
      historyId: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true, field: 'history_id' },
      appointmentId: { type: DataTypes.BIGINT, allowNull: false, field: 'appointment_id' },
      fromStatus: { type: DataTypes.STRING(30), allowNull: true, field: 'from_status' },
      toStatus: { type: DataTypes.STRING(30), allowNull: false, field: 'to_status' },
      remarks: { type: DataTypes.STRING(500), allowNull: true, field: 'remarks' },
      changedBy: { type: DataTypes.BIGINT, allowNull: true, field: 'changed_by' },
      changedOn: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'changed_on' },
    },
    { tableName: 'appointment_status_history', freezeTableName: true, timestamps: false },
  );
