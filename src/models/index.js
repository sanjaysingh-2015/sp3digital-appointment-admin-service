const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const FacilityResource = require('./facilityResource.model')(sequelize, DataTypes);
const AppointmentSlotConfig = require('./appointmentSlotConfig.model')(sequelize, DataTypes);
const Appointment = require('./appointment.model')(sequelize, DataTypes);
// No association declared for Appointment.slotId -> appointment_slots or
// Appointment.cancellationReasonId -> appointment_cancellation_reasons —
// neither of those tables has a Sequelize model in this codebase yet (only
// slot *configs* do). This is fine for the read-only list/search endpoint
// this model currently backs; revisit once a booking/slot-generation
// feature actually writes to this table and needs those relations.

// --- Associations ---
// A real, enforced FK (unlike organization-admin-service's geography
// associations) — resourceId has no default value the way countryId does
// there, so there's no risk of a legitimate default-value insert failing
// against unseeded reference data. This also matches the raw
// CONSTRAINT fk_slot_configs_resource in database/complete_db_script's
// SQL exactly.
FacilityResource.hasMany(AppointmentSlotConfig, { foreignKey: 'resourceId' });
AppointmentSlotConfig.belongsTo(FacilityResource, { as: 'resource', foreignKey: 'resourceId' });

module.exports = { sequelize, FacilityResource, AppointmentSlotConfig, Appointment };
