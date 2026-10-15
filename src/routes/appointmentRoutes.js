const express = require('express');
const router = express.Router();

const controller = require('../controllers/appointmentController');
const { validate, id } = require('../middleware/validate');
const { authorize } = require('../middleware/authentication');
const { APPOINTMENT_PERMISSIONS } = require('../utils/permissions');
const { listQuerySchema, idParam } = require('../validations/appointment.validation');
const { bookSchema, cancelSchema, rescheduleSchema } = require('../validations/booking.validation');
const bookingController = require('../controllers/bookingController');

// Route paths are relative to /api/v1/appointment-admin/appointments (see
// app.js). The list is the admin visibility layer: SUPERADMIN sees every tenant's
// appointments, everyone else (TENANT_ADMIN/TENANT_USER) sees only their
// own tenant's — enforced in appointmentController.js/appointmentService.js,
// not by anything route-level here.

/**
 * @openapi
 * /appointments:
 *   get:
 *     tags: [Appointments]
 *     summary: Paginated, searchable list of appointments
 *     description: >
 *       SUPERADMIN (ALL_PERMISSIONS) sees every tenant's appointments by
 *       default, optionally narrowed with `?tenantUuid=`. TENANT_ADMIN and
 *       TENANT_USER always see only their own tenant's, regardless of any
 *       `tenantUuid` they pass.
 *     parameters:
 *       - $ref: '#/components/parameters/PageParam'
 *       - $ref: '#/components/parameters/LimitParam'
 *       - $ref: '#/components/parameters/SortByParam'
 *       - $ref: '#/components/parameters/SortDirParam'
 *       - name: search
 *         in: query
 *         description: Matches patient name, patient phone, or token number.
 *         schema: { type: string }
 *       - $ref: '#/components/parameters/FacilityIdParam'
 *       - $ref: '#/components/parameters/FacilityServiceIdParam'
 *       - name: status
 *         in: query
 *         schema: { type: string, enum: [BOOKED, CONFIRMED, CHECKED_IN, IN_PROGRESS, COMPLETED, CANCELLED, NO_SHOW, RESCHEDULED] }
 *       - name: dateFrom
 *         in: query
 *         schema: { type: string, format: date }
 *       - name: dateTo
 *         in: query
 *         schema: { type: string, format: date }
 *       - name: tenantUuid
 *         in: query
 *         description: SUPERADMIN only — narrows the all-tenant default to one tenant. Ignored for everyone else.
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Paginated appointments.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/Appointment' }
 *                 pagination: { $ref: '#/components/schemas/Pagination' }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       401: { $ref: '#/components/responses/Unauthenticated' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get('/', authorize(APPOINTMENT_PERMISSIONS.READ), validate(listQuerySchema, 'query'), controller.getList);

/**
 * @openapi
 * /appointments:
 *   post:
 *     tags: [Appointments]
 *     summary: Book a patient into a slot (front desk)
 *     description: >
 *       Only slots that start after the current time can be booked. The patient is looked up in the patient service and
 *       must be active; the doctor behind the slot must still be active, verified and placed there. The last place goes
 *       to exactly one person. A token number is issued per doctor (or service) per day. 409 ALREADY_BOOKED / SLOT_FULL /
 *       SAME_DAY_DUPLICATE (repeat with allowSameDay=true to confirm) / PROVIDER_NOT_BOOKABLE; 400 SLOT_IN_PAST.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [slotId, patientUuid]
 *             properties:
 *               slotId: { type: integer }
 *               patientUuid: { type: string, format: uuid }
 *               notes: { type: string }
 *               allowSameDay: { type: boolean }
 *     responses:
 *       201: { description: The booked appointment with token number and history }
 */
router.post('/', authorize(APPOINTMENT_PERMISSIONS.CREATE), validate(bookSchema), bookingController.book);

/**
 * @openapi
 * /appointments/{id}/cancel:
 *   patch:
 *     tags: [Appointments]
 *     summary: Cancel a booked appointment that has not started
 *     description: Needs a cancellation reason (see /cancellation-reasons). Gives the place back; a full slot opens up again.
 *     parameters:
 *       - { name: id, in: path, required: true, schema: { type: integer } }
 *     responses:
 *       200: { description: The cancelled appointment }
 * /appointments/{id}/reschedule:
 *   post:
 *     tags: [Appointments]
 *     summary: Move an appointment to another slot of the same service
 *     description: The old appointment becomes RESCHEDULED and the new one points back to it; both slots change together or not at all.
 *     parameters:
 *       - { name: id, in: path, required: true, schema: { type: integer } }
 *     responses:
 *       201: { description: The new appointment }
 */
router.patch('/:id/cancel', authorize(APPOINTMENT_PERMISSIONS.UPDATE), validate(idParam, 'params'), validate(cancelSchema), bookingController.cancel);
router.post('/:id/reschedule', authorize(APPOINTMENT_PERMISSIONS.UPDATE), validate(idParam, 'params'), validate(rescheduleSchema), bookingController.reschedule);

/**
 * @openapi
 * /appointments/{id}:
 *   get:
 *     tags: [Appointments]
 *     summary: Get a single appointment by id
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: The appointment.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Appointment' }
 *       401: { $ref: '#/components/responses/Unauthenticated' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get('/:id', authorize(APPOINTMENT_PERMISSIONS.READ), validate(idParam, 'params'), controller.getById);

module.exports = router;
