const appointmentSlotConfigService = require('../services/appointmentSlotConfigService');

class AppointmentSlotConfigController {
  create = async (req, res, next) => {
    try {
      const slotConfig = await appointmentSlotConfigService.create(req.body, {
        tenantUuid: req.auth.tenantUuid,
        userId: req.auth.userId,
        scopes: req.auth.scopes,
      });
      return res.status(201).json(slotConfig);
    } catch (error) {
      return next(error);
    }
  };

  getList = async (req, res, next) => {
    try {
      const { page, limit, facilityId, facilityServiceId, approvalStatus, status } = req.query;
      const result = await appointmentSlotConfigService.getList({
        page,
        limit,
        facilityId,
        facilityServiceId,
        approvalStatus,
        status,
        tenantUuid: req.auth.tenantUuid,
      });
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  };

  getById = async (req, res, next) => {
    try {
      const slotConfig = await appointmentSlotConfigService.getById(req.params.id, {
        tenantUuid: req.auth.tenantUuid,
      });
      return res.status(200).json(slotConfig);
    } catch (error) {
      return next(error);
    }
  };

  update = async (req, res, next) => {
    try {
      const slotConfig = await appointmentSlotConfigService.update(req.params.id, req.body, {
        tenantUuid: req.auth.tenantUuid,
        userId: req.auth.userId,
      });
      return res.status(200).json(slotConfig);
    } catch (error) {
      return next(error);
    }
  };

  approve = async (req, res, next) => {
    try {
      const slotConfig = await appointmentSlotConfigService.approve(req.params.id, {
        tenantUuid: req.auth.tenantUuid,
        userId: req.auth.userId,
      });
      return res.status(200).json(slotConfig);
    } catch (error) {
      return next(error);
    }
  };

  reject = async (req, res, next) => {
    try {
      const slotConfig = await appointmentSlotConfigService.reject(req.params.id, req.body.rejectionReason, {
        tenantUuid: req.auth.tenantUuid,
        userId: req.auth.userId,
      });
      return res.status(200).json(slotConfig);
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = new AppointmentSlotConfigController();
