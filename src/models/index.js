const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const FacilityResource = require('./facilityResource.model')(sequelize, DataTypes);
const AppointmentSlotConfig = require('./appointmentSlotConfig.model')(sequelize, DataTypes);

// --- Associations ---
// A real, enforced FK (unlike organization-admin-service's geography
// associations) — resourceId has no default value the way countryId does
// there, so there's no risk of a legitimate default-value insert failing
// against unseeded reference data. This also matches the raw
// CONSTRAINT fk_slot_configs_resource in database/complete_db_script's
// SQL exactly.
FacilityResource.hasMany(AppointmentSlotConfig, { foreignKey: 'resourceId' });
AppointmentSlotConfig.belongsTo(FacilityResource, { as: 'resource', foreignKey: 'resourceId' });

module.exports = { sequelize, FacilityResource, AppointmentSlotConfig };
