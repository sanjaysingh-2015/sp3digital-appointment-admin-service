const slotService = require('../services/slotService');
const slotGenerationService = require('../services/slotGenerationService');
const bookingService = require('../services/bookingService');

const ctxOf = (req) => ({ tenantUuid: req.auth.tenantUuid, userId: req.auth.userId, token: req.auth.rawToken });

// Thin wrappers only — every rule lives in the services.
const handle = (fn) => async (req, res, next) => {
  try {
    const { status, body } = await fn(req);
    return res.status(status).json(body);
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  searchSlots: handle(async (req) => ({ status: 200, body: await slotService.search({ ...req.query, tenantUuid: req.auth.tenantUuid }) })),
  generateSlots: handle(async (req) => ({
    status: 200,
    body: await slotGenerationService.generate({ ...req.body, tenantUuid: req.auth.tenantUuid, userId: req.auth.userId }),
  })),
  book: handle(async (req) => ({ status: 201, body: await bookingService.book(req.body, ctxOf(req)) })),
  cancel: handle(async (req) => ({ status: 200, body: await bookingService.cancel(req.params.id, req.body, ctxOf(req)) })),
  reschedule: handle(async (req) => ({ status: 201, body: await bookingService.reschedule(req.params.id, req.body, ctxOf(req)) })),
  reasons: handle(async (req) => ({ status: 200, body: await bookingService.listCancellationReasons(ctxOf(req)) })),
};
