module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'AppointmentSlot',
    {
      slotId: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true, field: 'slot_id' },
      slotUuid: { type: DataTypes.UUID, allowNull: false, unique: true, defaultValue: DataTypes.UUIDV4, field: 'slot_uuid' },
      tenantUuid: { type: DataTypes.UUID, allowNull: false, field: 'tenant_uuid' },
      facilityId: { type: DataTypes.BIGINT, allowNull: false, field: 'facility_id' },
      facilityServiceId: { type: DataTypes.BIGINT, allowNull: false, field: 'facility_service_id' },
      // NULL = the service as a whole; set when the slot belongs to a doctor / counter.
      // (The database also keeps a generated resource_key column so "no resource"
      // takes part in the unique key — it is not mapped here.)
      resourceId: { type: DataTypes.BIGINT, allowNull: true, field: 'resource_id' },
      slotConfigId: { type: DataTypes.BIGINT, allowNull: true, field: 'slot_config_id' },
      slotDate: { type: DataTypes.DATEONLY, allowNull: false, field: 'slot_date' },
      startTime: { type: DataTypes.TIME, allowNull: false, field: 'start_time' },
      endTime: { type: DataTypes.TIME, allowNull: false, field: 'end_time' },
      capacity: { type: DataTypes.SMALLINT, allowNull: false, defaultValue: 1, field: 'capacity' },
      bookedCount: { type: DataTypes.SMALLINT, allowNull: false, defaultValue: 0, field: 'booked_count' },
      // OPEN -> FULL when bookedCount reaches capacity (and back when a booking is cancelled);
      // CLOSED when the generator takes an unbooked slot out (closure, rule changed or switched off).
      status: { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'OPEN', field: 'status' },
      cancelReason: { type: DataTypes.STRING(255), allowNull: true, field: 'cancel_reason' },
      cancelledBy: { type: DataTypes.BIGINT, allowNull: true, field: 'cancelled_by' },
      cancelledOn: { type: DataTypes.DATE, allowNull: true, field: 'cancelled_on' },
      createdBy: { type: DataTypes.BIGINT, allowNull: true, field: 'created_by' },
      createdOn: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'created_on' },
      modifiedBy: { type: DataTypes.BIGINT, allowNull: true, field: 'modified_by' },
      modifiedOn: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'modified_on' },
    },
    {
      tableName: 'appointment_slots',
      freezeTableName: true,
      timestamps: false,
      indexes: [
        { unique: true, fields: ['facility_service_id', 'resource_id', 'slot_date', 'start_time'] },
        { fields: ['facility_id', 'slot_date', 'status'] },
        { fields: ['tenant_uuid'] },
      ],
    },
  );
