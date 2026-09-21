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

module.exports = { SLOT_CONFIG_PERMISSIONS };
