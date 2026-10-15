const { Joi } = require('../middleware/validate');

const positiveId = Joi.number().integer().positive();
const dateOnly = Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).message('must be a date in YYYY-MM-DD format');

// A day or a range; at most 31 days at a time (the service clamps it).
const slotSearchQuerySchema = Joi.object({
  facilityId: positiveId.required(),
  facilityServiceId: positiveId.optional(),
  resourceId: positiveId.optional(),
  providerId: positiveId.optional(),
  date: dateOnly.optional(),
  dateFrom: dateOnly.optional(),
  dateTo: dateOnly.optional(),
  includeFull: Joi.boolean().default(false),
  limit: Joi.number().integer().min(1).max(500).default(300),
});

const generateSchema = Joi.object({
  facilityId: positiveId.optional(),
  fromDate: dateOnly.optional(),
  days: Joi.number().integer().min(1).max(90).optional(),
  dryRun: Joi.boolean().default(false),
});

const bookSchema = Joi.object({
  slotId: positiveId.required(),
  patientUuid: Joi.string().guid().required(),
  notes: Joi.string().trim().max(1000).allow('', null),
  // Staff confirm that this patient really should have a second place for the same service that day.
  allowSameDay: Joi.boolean().default(false),
});

const cancelSchema = Joi.object({
  reasonId: positiveId.required(),
  notes: Joi.string().trim().max(500).allow('', null),
});

const rescheduleSchema = Joi.object({
  slotId: positiveId.required(),
  notes: Joi.string().trim().max(1000).allow('', null),
});

module.exports = { slotSearchQuerySchema, generateSchema, bookSchema, cancelSchema, rescheduleSchema };
