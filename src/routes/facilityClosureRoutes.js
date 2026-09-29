const express = require('express');
const router = express.Router();

const controller = require('../controllers/facilityClosureController');
const { validate, id } = require('../middleware/validate');
const { authorize } = require('../middleware/authentication');
const { FACILITY_CLOSURE_PERMISSIONS } = require('../utils/permissions');
const { createSchema, updateSchema, listQuerySchema, idParam } = require('../validations/facilityClosure.validation');

// Route paths are relative to /api/v1/appointment-admin/facility-closures
// (see app.js). No maker-checker workflow here (unlike slot configs) —
// closing a facility is treated as an administrative decision, so
// create/update/cancel are TENANT_ADMIN-only; TENANT_USER holds READ only.

/**
 * @openapi
 * /facility-closures:
 *   post:
 *     tags: [Facility Closures]
 *     summary: Create a holiday, weekly off, or other closure
 *     description: TENANT_ADMIN only.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/FacilityClosureCreateRequest' }
 *     responses:
 *       201:
 *         description: Closure created.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/FacilityClosure' }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       401: { $ref: '#/components/responses/Unauthenticated' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *   get:
 *     tags: [Facility Closures]
 *     summary: Paginated, filterable list of facility closures
 *     parameters:
 *       - $ref: '#/components/parameters/PageParam'
 *       - $ref: '#/components/parameters/LimitParam'
 *       - $ref: '#/components/parameters/SortByParam'
 *       - $ref: '#/components/parameters/SortDirParam'
 *       - $ref: '#/components/parameters/FacilityIdParam'
 *       - $ref: '#/components/parameters/FacilityServiceIdParam'
 *       - name: closureType
 *         in: query
 *         schema: { type: string, enum: [HOLIDAY, WEEKLY_OFF, EMERGENCY, MAINTENANCE, OTHER] }
 *       - name: recurrenceType
 *         in: query
 *         schema: { type: string, enum: [ONE_TIME, WEEKLY, ANNUAL] }
 *       - name: status
 *         in: query
 *         schema: { type: string, enum: [ACTIVE, CANCELLED] }
 *     responses:
 *       200:
 *         description: Paginated facility closures.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/FacilityClosure' }
 *                 pagination: { $ref: '#/components/schemas/Pagination' }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       401: { $ref: '#/components/responses/Unauthenticated' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.post('/', authorize(FACILITY_CLOSURE_PERMISSIONS.CREATE), validate(createSchema), controller.create);
router.get('/', authorize(FACILITY_CLOSURE_PERMISSIONS.READ), validate(listQuerySchema, 'query'), controller.getList);

/**
 * @openapi
 * /facility-closures/{id}:
 *   get:
 *     tags: [Facility Closures]
 *     summary: Get a single facility closure by id
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: The facility closure.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/FacilityClosure' }
 *       401: { $ref: '#/components/responses/Unauthenticated' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *   patch:
 *     tags: [Facility Closures]
 *     summary: Edit a facility closure
 *     description: TENANT_ADMIN only.
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/FacilityClosureUpdateRequest' }
 *     responses:
 *       200:
 *         description: Updated facility closure.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/FacilityClosure' }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       401: { $ref: '#/components/responses/Unauthenticated' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get('/:id', authorize(FACILITY_CLOSURE_PERMISSIONS.READ), validate(idParam, 'params'), controller.getById);
router.patch('/:id', authorize(FACILITY_CLOSURE_PERMISSIONS.UPDATE), validate(idParam, 'params'), validate(updateSchema), controller.update);

/**
 * @openapi
 * /facility-closures/{id}/cancel:
 *   post:
 *     tags: [Facility Closures]
 *     summary: Cancel a facility closure (soft delete — sets status to CANCELLED)
 *     description: TENANT_ADMIN only.
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Cancelled facility closure.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/FacilityClosure' }
 *       401: { $ref: '#/components/responses/Unauthenticated' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.post('/:id/cancel', authorize(FACILITY_CLOSURE_PERMISSIONS.UPDATE), validate(idParam, 'params'), controller.cancel);

module.exports = router;
