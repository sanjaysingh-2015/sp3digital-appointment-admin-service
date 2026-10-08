const facilityClosureService = require('../services/facilityClosureService');

class FacilityClosureController {
  create = async (req, res, next) => {
    try {
      const closure = await facilityClosureService.create(req.body, {
        tenantUuid: req.auth.tenantUuid,
        userId: req.auth.userId,
        token: req.auth.rawToken,
      });
      return res.status(201).json(closure);
    } catch (error) {
      return next(error);
    }
  };

  getList = async (req, res, next) => {
    try {
      const { page, limit, facilityId, facilityServiceId, providerId, closureType, recurrenceType, status } = req.query;
      const result = await facilityClosureService.getList({
        page,
        limit,
        facilityId,
        facilityServiceId,
        providerId,
        closureType,
        recurrenceType,
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
      const closure = await facilityClosureService.getById(req.params.id, {
        tenantUuid: req.auth.tenantUuid,
      });
      return res.status(200).json(closure);
    } catch (error) {
      return next(error);
    }
  };

  update = async (req, res, next) => {
    try {
      const closure = await facilityClosureService.update(req.params.id, req.body, {
        tenantUuid: req.auth.tenantUuid,
        userId: req.auth.userId,
        token: req.auth.rawToken,
      });
      return res.status(200).json(closure);
    } catch (error) {
      return next(error);
    }
  };

  cancel = async (req, res, next) => {
    try {
      const closure = await facilityClosureService.cancel(req.params.id, {
        tenantUuid: req.auth.tenantUuid,
        userId: req.auth.userId,
      });
      return res.status(200).json(closure);
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = new FacilityClosureController();
