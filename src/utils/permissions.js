/**
 * Fine-grained permission codes for appointment slot configuration.
 *
 * These must match exactly what identity-admin-service seeds into its
 * `permissions` table and grants via `role_permissions` — see that repo's
 * database/seeds/appointment-slot-config-rbac.sql. The intended grants:
 *
 *   TENANT_ADMIN: CREATE, READ, UPDATE, APPROVE  (full control)
 *   TENANT_USER:  CREATE, READ                   (propose + view only —
 *                 no UPDATE, no APPROVE, so those routes 403 for them)
 *
 * A caller whose token carries ALL_PERMISSIONS (SUPERADMIN) or the
 * 'appointment-admin:*' wildcard bypasses all of these — see authorize()
 * in middleware/authentication.js.
 */
const SLOT_CONFIG_PERMISSIONS = {
  CREATE: 'appointment-admin:slot-config:create',
  READ: 'appointment-admin:slot-config:read',
  UPDATE: 'appointment-admin:slot-config:update',
  APPROVE: 'appointment-admin:slot-config:approve',
};

/**
 * Read access to the appointments list/search. Granted to TENANT_ADMIN
 * and TENANT_USER (see identity-admin-service's
 * database/seeds/appointment-slot-config-rbac.sql) — both only ever see
 * their own tenant's appointments (enforced in appointmentService.js).
 * SUPERADMIN's ALL_PERMISSIONS bypasses this entirely and additionally
 * sees every tenant's appointments — see isSuperAdmin() in
 * appointmentController.js, the same pattern organization-admin-service
 * uses for its own SUPERADMIN "list all tenants" capability.
 */
const APPOINTMENT_PERMISSIONS = {
  READ: 'appointment-admin:appointment:read',
};

module.exports = { SLOT_CONFIG_PERMISSIONS, APPOINTMENT_PERMISSIONS };
