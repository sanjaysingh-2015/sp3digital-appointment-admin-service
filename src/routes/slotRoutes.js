const express = require('express');
const router = express.Router();

const controller = require('../controllers/bookingController');
const { validate } = require('../middleware/validate');
const { authorize } = require('../middleware/authentication');
const { SLOT_PERMISSIONS } = require('../utils/permissions');
const { slotSearchQuerySchema, generateSchema } = require('../validations/booking.validation');

// Paths are relative to /api/v1/appointment-admin/slots (see app.js).

/**
 * @openapi
 * /slots:
 *   get:
 *     tags: [Slots]
 *     summary: Bookable slots for a facility (never in the past)
 *     description: >
 *       Returns dated slots from today onwards; for today only slots that start after the current time (in the
 *       facility timezone, APPOINTMENT_TIMEZONE). By default only slots with a free place; includeFull=true also lists
 *       full ones. A day (date) or a range (dateFrom/dateTo, at most 31 days).
 *     parameters:
 *       - { name: facilityId, in: query, required: true, schema: { type: integer } }
 *       - { name: facilityServiceId, in: query, schema: { type: integer } }
 *       - { name: providerId, in: query, description: Only this doctor's slots, schema: { type: integer } }
 *       - { name: date, in: query, schema: { type: string, format: date } }
 *       - { name: dateFrom, in: query, schema: { type: string, format: date } }
 *       - { name: dateTo, in: query, schema: { type: string, format: date } }
 *       - { name: includeFull, in: query, schema: { type: boolean } }
 *     responses:
 *       200: { description: '{ data: [slot], window, now }' }
 */
router.get('/', authorize(SLOT_PERMISSIONS.READ), validate(slotSearchQuerySchema, 'query'), controller.searchSlots);

/**
 * @openapi
 * /slots/generate:
 *   post:
 *     tags: [Slots]
 *     summary: Generate dated slots from the approved slot rules
 *     description: >
 *       Idempotent. Creates missing slots for the next N days (default 30, max 90), skips closures and doctor leave and
 *       times already past, closes unbooked slots whose rule changed or whose date became a closure, and reopens ones it
 *       closed itself. Slots that already have bookings are never touched; they are counted as conflicts. dryRun=true
 *       reports without changing anything. The same logic runs nightly via `npm run generate-slots`.
 *     responses:
 *       200: { description: '{ fromDate, toDate, rulesConsidered, created, reopened, closed, conflicts, dryRun }' }
 */
router.post('/generate', authorize(SLOT_PERMISSIONS.GENERATE), validate(generateSchema), controller.generateSlots);

module.exports = router;
