const express = require('express');
const router = express.Router();

const controller = require('../controllers/appointmentSlotConfigController');
const { validate, id } = require('../middleware/validate');
const { authorize } = require('../middleware/authentication');
const { SLOT_CONFIG_PERMISSIONS } = require('../utils/permissions');
const {
  createSchema,
  updateSchema,
  listQuerySchema,
  rejectSchema,
  idParam,
} = require('../validations/appointmentSlotConfig.validation');

// Route paths are relative to /api/v1/appointment-admin/slot-configs (see
// app.js). Reviewed while adding Swagger below: authorize() gates every
// route (unlike organization-admin-service's still-dormant version of the
// same gate) with no ordering conflicts — GET '/:id' and POST '/:id/approve'
// '/:id/reject' don't collide since Express matches by full path shape,
// not just the leading segment.

/**
 * @openapi
 * /slot-configs:
 *   post:
 *     tags: [Slot Configs]
 *     summary: Propose or create a recurring slot configuration
 *     description: >
 *       TENANT_USER and TENANT_ADMIN both hold the `create` permission.
 *       A TENANT_USER's submission lands `PENDING_APPROVAL`; a
 *       TENANT_ADMIN's is auto-`APPROVED` (they already hold approval
 *       authority, so no self-review step).
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/SlotConfigCreateRequest' }
 *     responses:
 *       201:
 *         description: Slot configuration created.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SlotConfig' }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       401: { $ref: '#/components/responses/Unauthenticated' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *   get:
 *     tags: [Slot Configs]
 *     summary: Paginated, filterable list of slot configurations
 *     description: >
 *       TENANT_USER and TENANT_ADMIN see the same tenant-wide list — there
 *       is no "my submissions only" restriction. Use
 *       `?approvalStatus=PENDING_APPROVAL` for a TENANT_ADMIN's review queue.
 *     parameters:
 *       - $ref: '#/components/parameters/PageParam'
 *       - $ref: '#/components/parameters/LimitParam'
 *       - $ref: '#/components/parameters/SortByParam'
 *       - $ref: '#/components/parameters/SortDirParam'
 *       - $ref: '#/components/parameters/FacilityIdParam'
 *       - $ref: '#/components/parameters/FacilityServiceIdParam'
 *       - $ref: '#/components/parameters/ApprovalStatusFilterParam'
 *       - $ref: '#/components/parameters/StatusFilterParam'
 *     responses:
 *       200:
 *         description: Paginated slot configurations.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/SlotConfig' }
 *                 pagination: { $ref: '#/components/schemas/Pagination' }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       401: { $ref: '#/components/responses/Unauthenticated' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.post('/', authorize(SLOT_CONFIG_PERMISSIONS.CREATE), validate(createSchema), controller.create);
router.get('/', authorize(SLOT_CONFIG_PERMISSIONS.READ), validate(listQuerySchema, 'query'), controller.getList);

/**
 * @openapi
 * /slot-configs/{id}:
 *   get:
 *     tags: [Slot Configs]
 *     summary: Get a single slot configuration by id
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: The slot configuration.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SlotConfig' }
 *       401: { $ref: '#/components/responses/Unauthenticated' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *   patch:
 *     tags: [Slot Configs]
 *     summary: Edit a slot configuration
 *     description: >
 *       TENANT_ADMIN only — a TENANT_USER's token has no `update` grant,
 *       so this 403s for them before the handler runs. Editing does not
 *       itself change `approvalStatus`; approve/reject are separate,
 *       explicit actions.
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/SlotConfigUpdateRequest' }
 *     responses:
 *       200:
 *         description: Updated slot configuration.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SlotConfig' }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       401: { $ref: '#/components/responses/Unauthenticated' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get('/:id', authorize(SLOT_CONFIG_PERMISSIONS.READ), validate(idParam, 'params'), controller.getById);
router.patch('/:id', authorize(SLOT_CONFIG_PERMISSIONS.UPDATE), validate(idParam, 'params'), validate(updateSchema), controller.update);

/**
 * @openapi
 * /slot-configs/{id}/approve:
 *   post:
 *     tags: [Slot Configs]
 *     summary: Approve a pending slot configuration
 *     description: TENANT_ADMIN only. Must currently be `PENDING_APPROVAL`.
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Approved slot configuration.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SlotConfig' }
 *       401: { $ref: '#/components/responses/Unauthenticated' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       409: { $ref: '#/components/responses/InvalidApprovalState' }
 */
router.post('/:id/approve', authorize(SLOT_CONFIG_PERMISSIONS.APPROVE), validate(idParam, 'params'), controller.approve);

/**
 * @openapi
 * /slot-configs/{id}/reject:
 *   post:
 *     tags: [Slot Configs]
 *     summary: Reject a pending slot configuration
 *     description: TENANT_ADMIN only. Must currently be `PENDING_APPROVAL`; a reason is required.
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/SlotConfigRejectRequest' }
 *     responses:
 *       200:
 *         description: Rejected slot configuration.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SlotConfig' }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       401: { $ref: '#/components/responses/Unauthenticated' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       409: { $ref: '#/components/responses/InvalidApprovalState' }
 */
router.post('/:id/reject', authorize(SLOT_CONFIG_PERMISSIONS.APPROVE), validate(idParam, 'params'), validate(rejectSchema), controller.reject);

module.exports = router;
