const express = require('express');
const router = express.Router();

const controller = require('../controllers/appointmentController');
const { validate, id } = require('../middleware/validate');
const { authorize } = require('../middleware/authentication');
const { APPOINTMENT_PERMISSIONS } = require('../utils/permissions');
const { listQuerySchema, idParam } = require('../validations/appointment.validation');

// Route paths are relative to /api/v1/appointment-admin/appointments (see
// app.js). Read-only — there's no create/update route here yet, since the
// booking flow (POST /appointments from a patient-facing or front-desk
// client) is a separate, not-yet-built feature. This is the admin
// visibility layer ahead of that: SUPERADMIN sees every tenant's
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
