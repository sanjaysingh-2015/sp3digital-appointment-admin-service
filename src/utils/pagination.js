const { Joi } = require('../middleware/validate');

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * Joi schema for list-endpoint query strings. Individual routes can extend
 * this with entity-specific filters (status, search, facilityId, ...).
 *
 * Kept byte-for-byte in sync with organization-admin-service's (and
 * identity-admin-service's) version of this file on purpose: every list
 * page across the platform already assumes the exact same
 * { data, pagination: { page, limit, totalItems, totalPages } } envelope.
 */
function paginationQuerySchema(extra = {}) {
  return Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
    sortBy: Joi.string().max(100),
    sortDir: Joi.string().valid('ASC', 'DESC').default('DESC'),
    ...extra
  });
}

function toSequelizePage({ page = 1, limit = DEFAULT_LIMIT } = {}) {
  const safeLimit = Math.min(Number(limit) || DEFAULT_LIMIT, MAX_LIMIT);
  const safePage = Math.max(Number(page) || 1, 1);
  return { limit: safeLimit, offset: (safePage - 1) * safeLimit, page: safePage };
}

function buildEnvelope({ rows, count }, { page, limit }) {
  return {
    data: rows,
    pagination: {
      page,
      limit,
      totalItems: count,
      totalPages: limit > 0 ? Math.ceil(count / limit) : 0
    }
  };
}

module.exports = { paginationQuerySchema, toSequelizePage, buildEnvelope, DEFAULT_LIMIT, MAX_LIMIT };
