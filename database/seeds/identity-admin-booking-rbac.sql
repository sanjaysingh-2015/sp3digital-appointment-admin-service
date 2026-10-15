-- Booking RBAC — run against the sp3digital_identity database
-- (copy into identity-admin-service's database/seeds/ next to appointment-slot-config-rbac.sql).
--
-- Who can do what:
--   TENANT_ADMIN : everything below
--   FRONT_DESK   : see the schedule, book, cancel and reschedule  (role created by identity-admin-patient-rbac.sql)
--   TENANT_USER  : see the schedule and book a slot               (no cancel / reschedule)
--
-- Permission codes must match src/utils/permissions.js in sp3digital-appointment-admin-service.

INSERT INTO permissions (permission_uuid, permission_code, permission_name, resource, action, description, status, created_on, modified_on)
SELECT UUID(), 'appointment-admin:appointment:create', 'Book appointment', 'appointment-admin', 'create', 'Book a patient into a slot', 'ACTIVE', NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE permission_code = 'appointment-admin:appointment:create');

INSERT INTO permissions (permission_uuid, permission_code, permission_name, resource, action, description, status, created_on, modified_on)
SELECT UUID(), 'appointment-admin:appointment:update', 'Cancel or reschedule appointment', 'appointment-admin', 'update', 'Cancel an appointment or move it to another slot', 'ACTIVE', NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE permission_code = 'appointment-admin:appointment:update');

INSERT INTO permissions (permission_uuid, permission_code, permission_name, resource, action, description, status, created_on, modified_on)
SELECT UUID(), 'appointment-admin:slot:read', 'View slots', 'appointment-admin', 'read', 'See the schedule and search open slots', 'ACTIVE', NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE permission_code = 'appointment-admin:slot:read');

INSERT INTO permissions (permission_uuid, permission_code, permission_name, resource, action, description, status, created_on, modified_on)
SELECT UUID(), 'appointment-admin:slot:generate', 'Generate slots', 'appointment-admin', 'generate', 'Run slot generation from the approved slot rules', 'ACTIVE', NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE permission_code = 'appointment-admin:slot:generate');

-- The Front Desk role (also created by the patient seed; safe to run in either order).
INSERT INTO roles (role_uuid, role_code, role_name, description, role_type, status, created_on, modified_on)
SELECT UUID(), 'FRONT_DESK', 'Front Desk', 'Registers and edits patients and books appointments for them', 'APPLICATION', 'ACTIVE', NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE role_code = 'FRONT_DESK');

-- TENANT_ADMIN: all four
INSERT INTO role_permissions (role_id, permission_id, status, created_on, modified_on)
SELECT roles.role_id, permissions.permission_id, 'ACTIVE', NOW(), NOW()
FROM roles
JOIN permissions ON permissions.permission_code IN (
  'appointment-admin:appointment:create', 'appointment-admin:appointment:update',
  'appointment-admin:slot:read', 'appointment-admin:slot:generate'
)
LEFT JOIN role_permissions ON role_permissions.role_id = roles.role_id AND role_permissions.permission_id = permissions.permission_id AND role_permissions.status = 'ACTIVE'
WHERE roles.role_code = 'TENANT_ADMIN' AND role_permissions.role_permission_id IS NULL;

-- FRONT_DESK: book, cancel / reschedule, see slots; plus the read access it needs to view the schedule
INSERT INTO role_permissions (role_id, permission_id, status, created_on, modified_on)
SELECT roles.role_id, permissions.permission_id, 'ACTIVE', NOW(), NOW()
FROM roles
JOIN permissions ON permissions.permission_code IN (
  'appointment-admin:appointment:create', 'appointment-admin:appointment:update', 'appointment-admin:slot:read',
  'appointment-admin:appointment:read', 'appointment-admin:slot-config:read', 'appointment-admin:facility-closure:read'
)
LEFT JOIN role_permissions ON role_permissions.role_id = roles.role_id AND role_permissions.permission_id = permissions.permission_id AND role_permissions.status = 'ACTIVE'
WHERE roles.role_code = 'FRONT_DESK' AND role_permissions.role_permission_id IS NULL;

-- TENANT_USER: see the schedule and book (their existing read access stays as it was)
INSERT INTO role_permissions (role_id, permission_id, status, created_on, modified_on)
SELECT roles.role_id, permissions.permission_id, 'ACTIVE', NOW(), NOW()
FROM roles
JOIN permissions ON permissions.permission_code IN ('appointment-admin:appointment:create', 'appointment-admin:slot:read')
LEFT JOIN role_permissions ON role_permissions.role_id = roles.role_id AND role_permissions.permission_id = permissions.permission_id AND role_permissions.status = 'ACTIVE'
WHERE roles.role_code = 'TENANT_USER' AND role_permissions.role_permission_id IS NULL;
