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

// CREATE — TENANT_USER and TENANT_ADMIN both hold this permission.
// A TENANT_USER's submission lands PENDING_APPROVAL; a TENANT_ADMIN's is
// auto-approved (see appointmentSlotConfigService.create()).
router.post('/', authorize(SLOT_CONFIG_PERMISSIONS.CREATE), validate(createSchema), controller.create);

// LIST / GET — TENANT_USER and TENANT_ADMIN both hold this permission.
router.get('/', authorize(SLOT_CONFIG_PERMISSIONS.READ), validate(listQuerySchema, 'query'), controller.getList);
router.get('/:id', authorize(SLOT_CONFIG_PERMISSIONS.READ), validate(idParam, 'params'), controller.getById);

// EDIT — TENANT_ADMIN only. A TENANT_USER's token has no grant for this
// permission, so authorize() 403s them before the controller ever runs.
router.patch('/:id', authorize(SLOT_CONFIG_PERMISSIONS.UPDATE), validate(idParam, 'params'), validate(updateSchema), controller.update);

// APPROVE / REJECT — TENANT_ADMIN only, same reasoning as EDIT above.
router.post('/:id/approve', authorize(SLOT_CONFIG_PERMISSIONS.APPROVE), validate(idParam, 'params'), controller.approve);
router.post('/:id/reject', authorize(SLOT_CONFIG_PERMISSIONS.APPROVE), validate(idParam, 'params'), validate(rejectSchema), controller.reject);

module.exports = router;
