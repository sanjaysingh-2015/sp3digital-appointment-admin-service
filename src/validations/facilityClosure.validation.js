const { Joi, id } = require('../middleware/validate');
const { paginationQuerySchema } = require('../utils/pagination');

const CLOSURE_TYPES = ['HOLIDAY', 'WEEKLY_OFF', 'EMERGENCY', 'MAINTENANCE', 'OTHER'];
const RECURRENCE_TYPES = ['ONE_TIME', 'WEEKLY', 'ANNUAL'];
const STATUSES = ['ACTIVE', 'CANCELLED'];

/**
 * ONE_TIME / ANNUAL need closureDate (for ANNUAL, only month+day are
 * reused each year — the application layer that expands closures into
 * concrete blocked dates is responsible for that, not this validation).
 * WEEKLY needs dayOfWeek (a standing weekly off, e.g. "closed every
 * Sunday", recurring indefinitely — no end date). Shared by create (full
 * object) and update (called after facilityClosureService.js merges the
 * patch onto the existing row), same pattern as
 * appointmentSlotConfig.validation.js#validateRecurrenceFields.
 */
function validateRecurrenceFields({ recurrenceType, closureDate, dayOfWeek }) {
  if (recurrenceType === 'WEEKLY') {
    if (dayOfWeek === null || dayOfWeek === undefined) return 'dayOfWeek is required when recurrenceType is WEEKLY';
    if (closureDate !== null && closureDate !== undefined) return 'closureDate must not be set when recurrenceType is WEEKLY';
  } else if (recurrenceType === 'ONE_TIME' || recurrenceType === 'ANNUAL') {
    if (closureDate === null || closureDate === undefined) return `closureDate is required when recurrenceType is ${recurrenceType}`;
    if (dayOfWeek !== null && dayOfWeek !== undefined) return 'dayOfWeek must not be set when recurrenceType is ONE_TIME or ANNUAL';
  }
  return null;
}

const createSchema = Joi.object({
  facilityId: Joi.number().integer().positive().optional().allow(null), // NULL = every facility in the tenant
  facilityServiceId: Joi.number().integer().positive().optional().allow(null), // NULL = whole facility
  resourceId: Joi.number().integer().positive().optional().allow(null),
  // Doctor leave: a doctor placement in provider-admin-service (needs facilityServiceId too).
  providerAffiliationId: Joi.number().integer().positive().optional().allow(null),
  closureType: Joi.string().valid(...CLOSURE_TYPES).required(),
  recurrenceType: Joi.string().valid(...RECURRENCE_TYPES).required(),
  closureDate: Joi.date().iso().optional().allow(null),
  dayOfWeek: Joi.number().integer().min(1).max(7).optional().allow(null),
  closureName: Joi.string().max(150).required(),
  reason: Joi.string().max(500).optional().allow('', null),
}).custom((value, helpers) => {
  const error = validateRecurrenceFields(value);
  if (error) return helpers.message(error);
  if (value.resourceId && value.providerAffiliationId) return helpers.message('Send either resourceId or providerAffiliationId, not both');
  return value;
});

const updateSchema = Joi.object({
  facilityId: Joi.number().integer().positive().optional().allow(null),
  facilityServiceId: Joi.number().integer().positive().optional().allow(null),
  resourceId: Joi.number().integer().positive().optional().allow(null),
  providerAffiliationId: Joi.number().integer().positive().optional().allow(null), // null = remove the doctor
  closureType: Joi.string().valid(...CLOSURE_TYPES).optional(),
  recurrenceType: Joi.string().valid(...RECURRENCE_TYPES).optional(),
  closureDate: Joi.date().iso().optional().allow(null),
  dayOfWeek: Joi.number().integer().min(1).max(7).optional().allow(null),
  closureName: Joi.string().max(150).optional(),
  reason: Joi.string().max(500).optional().allow('', null),
  status: Joi.string().valid(...STATUSES).optional(),
}).min(1).custom((value, helpers) => (
  value.resourceId && value.providerAffiliationId ? helpers.message('Send either resourceId or providerAffiliationId, not both') : value
));

const listQuerySchema = paginationQuerySchema({
  facilityId: Joi.number().integer().positive().optional(),
  facilityServiceId: Joi.number().integer().positive().optional(),
  providerId: Joi.number().integer().positive().optional(),
  closureType: Joi.string().valid(...CLOSURE_TYPES, '').optional(),
  recurrenceType: Joi.string().valid(...RECURRENCE_TYPES, '').optional(),
  status: Joi.string().valid(...STATUSES, '').optional(),
});

module.exports = {
  createSchema,
  updateSchema,
  listQuerySchema,
  validateRecurrenceFields,
  CLOSURE_TYPES,
  RECURRENCE_TYPES,
  STATUSES,
  idParam: Joi.object({ id }),
};
