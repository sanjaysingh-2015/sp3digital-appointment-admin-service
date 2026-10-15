-- Booking: slot generation, token numbers and cancellation reasons.
-- Run once on an existing sp3digital_appointments database.
USE `sp3digital_appointments`;

-- Each doctor (or service, when slots have no doctor) numbers their own tokens per day: T001, T002 ...
CREATE TABLE IF NOT EXISTS `appointment_token_counters` (
  `tenant_uuid` char(36) NOT NULL,
  `facility_service_id` bigint unsigned NOT NULL,
  `resource_key` bigint unsigned NOT NULL DEFAULT 0,   -- 0 = no doctor / counter
  `token_date` date NOT NULL,
  `last_number` int unsigned NOT NULL DEFAULT 0,
  PRIMARY KEY (`tenant_uuid`,`facility_service_id`,`resource_key`,`token_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Platform-wide cancellation reasons (tenant_uuid NULL = every tenant sees them).
-- Tenants can add their own rows with their tenant_uuid.
INSERT INTO `appointment_cancellation_reasons` (`tenant_uuid`,`reason_code`,`reason_label`,`applicable_to`,`status`)
SELECT NULL, v.code, v.label, v.applicable_to, 'ACTIVE'
FROM (
  SELECT 'PATIENT_REQUEST'    AS code, 'Patient asked to cancel'        AS label, 'ANY' AS applicable_to
  UNION ALL SELECT 'BOOKED_BY_MISTAKE',   'Booked by mistake',                 'ANY'
  UNION ALL SELECT 'DOCTOR_UNAVAILABLE',  'Doctor is unavailable',             'ANY'
  UNION ALL SELECT 'FACILITY_CLOSED',     'Facility closed',                   'ANY'
  UNION ALL SELECT 'PATIENT_UNREACHABLE', 'Could not reach the patient',       'ANY'
  UNION ALL SELECT 'OTHER',               'Other',                             'ANY'
) v
WHERE NOT EXISTS (
  SELECT 1 FROM `appointment_cancellation_reasons` r WHERE r.`tenant_uuid` IS NULL AND r.`reason_code` = v.code
);
