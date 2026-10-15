const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const FacilityResource = require('./facilityResource.model')(sequelize, DataTypes);
const AppointmentSlotConfig = require('./appointmentSlotConfig.model')(sequelize, DataTypes);
const Appointment = require('./appointment.model')(sequelize, DataTypes);
const FacilityClosure = require('./facilityClosure.model')(sequelize, DataTypes);
const AppointmentSlot = require('./appointmentSlot.model')(sequelize, DataTypes);
const AppointmentCancellationReason = require('./appointmentCancellationReason.model')(sequelize, DataTypes);
const AppointmentStatusHistory = require('./appointmentStatusHistory.model')(sequelize, DataTypes);
const AppointmentTokenCounter = require('./appointmentTokenCounter.model')(sequelize, DataTypes);
// --- Associations ---
// A real, enforced FK (unlike organization-admin-service's geography
// associations) — resourceId has no default value the way countryId does
// there, so there's no risk of a legitimate default-value insert failing
// against unseeded reference data. This also matches the raw
// CONSTRAINT fk_slot_configs_resource in database/complete_db_script's
// SQL exactly.
FacilityResource.hasMany(AppointmentSlotConfig, { foreignKey: 'resourceId' });
AppointmentSlotConfig.belongsTo(FacilityResource, { as: 'resource', foreignKey: 'resourceId' });

// Same reasoning for FacilityClosure's resourceId — matches
// fk_closures_resource in the raw SQL exactly.
FacilityResource.hasMany(FacilityClosure, { foreignKey: 'resourceId' });
FacilityClosure.belongsTo(FacilityResource, { as: 'resource', foreignKey: 'resourceId' });

// Slots, appointments and their history: real, enforced FKs (match the raw SQL).
FacilityResource.hasMany(AppointmentSlot, { foreignKey: 'resourceId' });
AppointmentSlot.belongsTo(FacilityResource, { as: 'resource', foreignKey: 'resourceId' });
AppointmentSlotConfig.hasMany(AppointmentSlot, { foreignKey: 'slotConfigId' });
AppointmentSlot.belongsTo(AppointmentSlotConfig, { as: 'slotConfig', foreignKey: 'slotConfigId' });
AppointmentSlot.hasMany(Appointment, { as: 'appointments', foreignKey: 'slotId' });
Appointment.belongsTo(AppointmentSlot, { as: 'slot', foreignKey: 'slotId' });
Appointment.belongsTo(FacilityResource, { as: 'resource', foreignKey: 'resourceId' });
Appointment.belongsTo(AppointmentCancellationReason, { as: 'cancellationReason', foreignKey: 'cancellationReasonId' });
Appointment.hasMany(AppointmentStatusHistory, { as: 'history', foreignKey: 'appointmentId' });
AppointmentStatusHistory.belongsTo(Appointment, { as: 'appointment', foreignKey: 'appointmentId' });

module.exports = {
  sequelize,
  FacilityResource,
  AppointmentSlotConfig,
  Appointment,
  FacilityClosure,
  AppointmentSlot,
  AppointmentCancellationReason,
  AppointmentStatusHistory,
  AppointmentTokenCounter,
};
