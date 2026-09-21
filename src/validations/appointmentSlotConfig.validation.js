const { Joi, id } = require('../middleware/validate');
const { paginationQuerySchema } = require('../utils/pagination');

const STATUSES = ['ACTIVE', 'INACTIVE'];
const APPROVAL_STATUSES = ['PENDING_APPROVAL', 'APPROVED', 'REJECTED'];

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

const createSchema = timeRangeRule(
  Joi.object({
    facilityId: Joi.number().integer().positive().required(),
    facilityServiceId: Joi.number().integer().positive().required(),
    resourceId: Joi.number().integer().positive().optional().allow(null),
    dayOfWeek: Joi.number().integer().min(1).max(7).required(), // 1=Mon ... 7=Sun
    startTime: Joi.string()
      .pattern(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/)
      .required(),
    endTime: Joi.string()
      .pattern(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/)
      .required(),
    slotDurationMinutes: Joi.number().integer().min(1).max(480).required(),
    capacityPerSlot: Joi.number().integer().min(1).default(1),
    effectiveFrom: Joi.date().iso().required(),
    effectiveTo: Joi.date().iso().min(Joi.ref('effectiveFrom')).optional().allow(null),
  }),
);

const updateSchema = timeRangeRule(
  Joi.object({
    resourceId: Joi.number().integer().positive().optional().allow(null),
    dayOfWeek: Joi.number().integer().min(1).max(7).optional(),
    startTime: Joi.string()
      .pattern(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/)
      .optional(),
    endTime: Joi.string()
      .pattern(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/)
      .optional(),
    slotDurationMinutes: Joi.number().integer().min(1).max(480).optional(),
    capacityPerSlot: Joi.number().integer().min(1).optional(),
    effectiveFrom: Joi.date().iso().optional(),
    effectiveTo: Joi.date().iso().optional().allow(null),
    status: Joi.string().valid(...STATUSES).optional(),
  }).min(1),
);

const listQuerySchema = paginationQuerySchema({
  facilityId: Joi.number().integer().positive().optional(),
  facilityServiceId: Joi.number().integer().positive().optional(),
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
  STATUSES,
  APPROVAL_STATUSES,
  idParam: Joi.object({ id }),
};
