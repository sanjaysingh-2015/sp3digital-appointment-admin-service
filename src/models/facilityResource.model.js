module.exports = (sequelize, DataTypes) => {
  const FacilityResource = sequelize.define(
    'FacilityResource',
    {
      resourceId: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true, field: 'resource_id' },
      resourceUuid: { type: DataTypes.UUID, allowNull: false, unique: true, defaultValue: DataTypes.UUIDV4, field: 'resource_uuid' },
      // Cross-database references — organization-admin-service owns
      // facilities/facility_services, identity-admin-service owns tenants.
      // No FK possible or desired (see database/complete_db_script's
      // header comment); validated at the application layer instead.
      tenantUuid: { type: DataTypes.UUID, allowNull: false, field: 'tenant_uuid' },
      facilityId: { type: DataTypes.BIGINT, allowNull: false, field: 'facility_id' },
      facilityServiceId: { type: DataTypes.BIGINT, allowNull: false, field: 'facility_service_id' },
      resourceType: { type: DataTypes.STRING(30), allowNull: false, field: 'resource_type' },
      resourceName: { type: DataTypes.STRING(150), allowNull: false, field: 'resource_name' },
      externalUserId: { type: DataTypes.BIGINT, allowNull: true, field: 'external_user_id' },
      status: { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'ACTIVE', field: 'status' },
      createdBy: { type: DataTypes.BIGINT, allowNull: true, field: 'created_by' },
      createdOn: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'created_on' },
      modifiedBy: { type: DataTypes.BIGINT, allowNull: true, field: 'modified_by' },
      modifiedOn: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'modified_on' },
    },
    {
      tableName: 'facility_resources',
      freezeTableName: true,
      timestamps: false,
      indexes: [
        { fields: ['tenant_uuid'] },
        { fields: ['facility_id'] },
        { fields: ['facility_service_id'] },
      ],
    },
  );

  return FacilityResource;
};
