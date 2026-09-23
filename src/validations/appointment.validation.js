const { Joi, id } = require('../middleware/validate');
const { paginationQuerySchema } = require('../utils/pagination');

const STATUSES = ['BOOKED', 'CONFIRMED', 'CHECKED_IN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'RESCHEDULED'];

const listQuerySchema = paginationQuerySchema({
  // Free-text search against patient name, patient phone, or token number
  // — see appointmentService.js#getList for the exact OR clause.
  search: Joi.string().max(200).allow('').optional(),
  facilityId: Joi.number().integer().positive().optional(),
  facilityServiceId: Joi.number().integer().positive().optional(),
  status: Joi.string().valid(...STATUSES, '').optional(),
  dateFrom: Joi.date().iso().optional(),
  dateTo: Joi.date().iso().min(Joi.ref('dateFrom')).optional(),
  // Only honored for a SUPERADMIN caller (ALL_PERMISSIONS scope) — see
  // appointmentController.getList. Ignored/overridden for anyone else.
  tenantUuid: Joi.string().uuid().optional(),
});

module.exports = { listQuerySchema, STATUSES, idParam: Joi.object({ id }) };
