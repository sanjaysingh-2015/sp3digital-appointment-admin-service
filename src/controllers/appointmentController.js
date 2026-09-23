const appointmentService = require('../services/appointmentService');

/**
 * A caller whose JWT `permissions` claim grants ALL_PERMISSIONS is a
 * SUPERADMIN. Mirrors organization-admin-service's organizationController
 * .js#isSuperAdmin() exactly — same convention, same reasoning: a platform
 * superadmin needs visibility across every tenant, not just the one named
 * in their own JWT.
 */
function isSuperAdmin(req) {
  return !!req.auth?.claims?.permissions.includes('ALL_PERMISSIONS');
}

class AppointmentController {
  getList = async (req, res, next) => {
    try {
      const { page, limit, search, facilityId, facilityServiceId, status, dateFrom, dateTo, tenantUuid } = req.query;
      const result = await appointmentService.getList({
        page,
        limit,
        search,
        facilityId,
        facilityServiceId,
        status,
        dateFrom,
        dateTo,
        // SUPERADMIN: no tenant filter by default (all tenants), or an
        // explicit ?tenantUuid= to narrow to one. Everyone else is always
        // pinned to their own token's tenant.
        tenantUuid: isSuperAdmin(req) ? (tenantUuid || undefined) : req.auth.tenantUuid,
      });
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  };

  getById = async (req, res, next) => {
    try {
      const appointment = await appointmentService.getById(req.params.id, {
        tenantUuid: isSuperAdmin(req) ? undefined : req.auth.tenantUuid,
      });
      return res.status(200).json(appointment);
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = new AppointmentController();
