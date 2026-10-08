const { Joi, id } = require('../middleware/validate');
const { paginationQuerySchema } = require('../utils/pagination');

const STATUSES = ['ACTIVE', 'INACTIVE'];
const APPROVAL_STATUSES = ['PENDING_APPROVAL', 'APPROVED', 'REJECTED'];
const RECURRENCE_TYPES = ['DAILY', 'WEEKLY', 'MONTHLY'];

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

// end_time > start_time is also enforced at the DB layer (a real CHECK
// constraint in database/complete_db_script's SQL) — this is the
// friendlier, earlier rejection point so the caller gets a clear 400
// instead of a raw DB error.
const timeRangeRule = (schema) =>
  schema.custom((value, helpers) => {
    if (value.startTime && value.endTime && value.endTime <= value.startTime) {
      return helpers.message('endTime must be after startTime');
    }
    return value;
  });

/**
 * Cross-field recurrence validation shared by create (full object, always
 * present) and update (called after appointmentSlotConfigService.js merges
 * the patch onto the existing row, since a PATCH body alone often doesn't
 * carry recurrenceType and can't be validated in isolation by Joi).
 *
 * DAILY: neither dayOfWeek nor dayOfMonth apply — applies every day in the
 *        effective range.
 * WEEKLY: dayOfWeek required, dayOfMonth must be absent.
 * MONTHLY: dayOfMonth required, dayOfWeek must be absent.
 */
function validateRecurrenceFields({ recurrenceType, dayOfWeek, dayOfMonth }) {
  if (recurrenceType === 'WEEKLY') {
    if (dayOfWeek === null || dayOfWeek === undefined) return 'dayOfWeek is required when recurrenceType is WEEKLY';
    if (dayOfMonth !== null && dayOfMonth !== undefined) return 'dayOfMonth must not be set when recurrenceType is WEEKLY';
  } else if (recurrenceType === 'MONTHLY') {
    if (dayOfMonth === null || dayOfMonth === undefined) return 'dayOfMonth is required when recurrenceType is MONTHLY';
    if (dayOfWeek !== null && dayOfWeek !== undefined) return 'dayOfWeek must not be set when recurrenceType is MONTHLY';
  } else if (recurrenceType === 'DAILY') {
    if (dayOfWeek !== null && dayOfWeek !== undefined) return 'dayOfWeek must not be set when recurrenceType is DAILY';
    if (dayOfMonth !== null && dayOfMonth !== undefined) return 'dayOfMonth must not be set when recurrenceType is DAILY';
  }
  return null;
}

const createSchema = timeRangeRule(
  Joi.object({
    facilityId: Joi.number().integer().positive().required(),
    facilityServiceId: Joi.number().integer().positive().required(),
    resourceId: Joi.number().integer().positive().optional().allow(null),
    // A doctor placement in provider-admin-service; the matching resource is created on demand.
    providerAffiliationId: Joi.number().integer().positive().optional().allow(null),
    recurrenceType: Joi.string().valid(...RECURRENCE_TYPES).required(),
    dayOfWeek: Joi.number().integer().min(1).max(7).optional().allow(null), // 1=Mon ... 7=Sun — required when recurrenceType=WEEKLY
    dayOfMonth: Joi.number().integer().min(1).max(31).optional().allow(null), // required when recurrenceType=MONTHLY
    startTime: Joi.string().pattern(TIME_PATTERN).required(),
    endTime: Joi.string().pattern(TIME_PATTERN).required(),
    slotDurationMinutes: Joi.number().integer().min(1).max(480).required(),
    capacityPerSlot: Joi.number().integer().min(1).default(1),
    effectiveFrom: Joi.date().iso().required(),
    effectiveTo: Joi.date().iso().min(Joi.ref('effectiveFrom')).optional().allow(null),
  }).custom((value, helpers) => {
    const error = validateRecurrenceFields(value);
    if (error) return helpers.message(error);
    if (value.resourceId && value.providerAffiliationId) return helpers.message('Send either resourceId or providerAffiliationId, not both');
    return value;
  }),
);

const updateSchema = timeRangeRule(
  Joi.object({
    resourceId: Joi.number().integer().positive().optional().allow(null),
    providerAffiliationId: Joi.number().integer().positive().optional().allow(null), // null = remove the doctor
    recurrenceType: Joi.string().valid(...RECURRENCE_TYPES).optional(),
    dayOfWeek: Joi.number().integer().min(1).max(7).optional().allow(null),
    dayOfMonth: Joi.number().integer().min(1).max(31).optional().allow(null),
    startTime: Joi.string().pattern(TIME_PATTERN).optional(),
    endTime: Joi.string().pattern(TIME_PATTERN).optional(),
    slotDurationMinutes: Joi.number().integer().min(1).max(480).optional(),
    capacityPerSlot: Joi.number().integer().min(1).optional(),
    effectiveFrom: Joi.date().iso().optional(),
    effectiveTo: Joi.date().iso().optional().allow(null),
    status: Joi.string().valid(...STATUSES).optional(),
  }).min(1).custom((value, helpers) => (
    value.resourceId && value.providerAffiliationId ? helpers.message('Send either resourceId or providerAffiliationId, not both') : value
  )),
);

const listQuerySchema = paginationQuerySchema({
  facilityId: Joi.number().integer().positive().optional(),
  facilityServiceId: Joi.number().integer().positive().optional(),
  providerId: Joi.number().integer().positive().optional(),
  providerAffiliationId: Joi.number().integer().positive().optional(),
  recurrenceType: Joi.string().valid(...RECURRENCE_TYPES, '').optional(),
  approvalStatus: Joi.string().valid(...APPROVAL_STATUSES, '').optional(),
  status: Joi.string().valid(...STATUSES, '').optional(),
});

const rejectSchema = Joi.object({
  rejectionReason: Joi.string().max(500).required(),
});

module.exports = {
  createSchema,
  updateSchema,
  listQuerySchema,
  rejectSchema,
  validateRecurrenceFields,
  STATUSES,
  APPROVAL_STATUSES,
  RECURRENCE_TYPES,
  idParam: Joi.object({ id }),
};
