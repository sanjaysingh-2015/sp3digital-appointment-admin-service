const express = require('express');
const router = express.Router();

const controller = require('../controllers/bookingController');
const { authorize } = require('../middleware/authentication');
const { APPOINTMENT_PERMISSIONS } = require('../utils/permissions');

/**
 * @openapi
 * /cancellation-reasons:
 *   get:
 *     tags: [Appointments]
 *     summary: Reasons to choose from when cancelling an appointment (platform defaults plus the tenant's own)
 *     responses:
 *       200: { description: '{ data: [{ reasonId, reasonCode, reasonLabel }] }' }
 */
router.get('/', authorize(APPOINTMENT_PERMISSIONS.READ), controller.reasons);

module.exports = router;
