-- =============================================================
-- sp3digital_appointments — full schema creation script
--
-- This is a SEPARATE database from sp3digital_organization and the
-- identity-admin-service database. Because of that, the following
-- columns are cross-database logical references, NOT real foreign keys:
--   - tenant_uuid            -> identity-admin-service's tenants
--   - facility_id            -> sp3digital_organization.facilities
--   - facility_service_id    -> sp3digital_organization.facility_services
--   - created_by / modified_by / cancelled_by / changed_by
--                             -> identity-admin-service's users
--
-- MySQL cannot enforce a FOREIGN KEY across two different databases in a
-- microservice-per-database setup (and shouldn't, even if the two
-- happened to sit on the same physical server — it would couple this
-- service's schema migrations to organization-admin-service's). These
-- columns are still indexed for query performance, and are validated at
-- the application layer instead (the same pattern organization-admin
-- -service itself already uses for tenant_uuid, which it never FKs to
-- anything either).
--
-- Every FK *within* this script (e.g. appointment_slots -> facility
-- _resources, appointments -> appointment_slots) IS a real, enforced
-- constraint, since both sides live in this same database.
-- =============================================================

CREATE DATABASE IF NOT EXISTS `sp3digital_appointments`
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_0900_ai_ci;

USE `sp3digital_appointments`;

-- =============================================================
-- 1. facility_resources
-- The bookable unit within a service — a doctor, a counter, a piece of
-- equipment. Slots/configs/closures can be scoped at the service level
-- (resource_id NULL) or down to one specific resource.
-- =============================================================

CREATE TABLE `facility_resources` (
  `resource_id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `resource_uuid` char(36) NOT NULL,
  `tenant_uuid` char(36) NOT NULL,
  `facility_id` bigint unsigned NOT NULL,
  `facility_service_id` bigint unsigned NOT NULL,
  `resource_type` varchar(30) NOT NULL,
  `resource_name` varchar(150) NOT NULL,
  `external_user_id` bigint unsigned DEFAULT NULL,
  `status` varchar(30) NOT NULL DEFAULT 'ACTIVE',
  `created_by` bigint unsigned DEFAULT NULL,
  `created_on` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `modified_by` bigint unsigned DEFAULT NULL,
  `modified_on` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`resource_id`),
  UNIQUE KEY `uk_resources_uuid` (`resource_uuid`),
  KEY `idx_resources_tenant` (`tenant_uuid`),
  KEY `idx_resources_facility` (`facility_id`),
  KEY `idx_resources_facility_service` (`facility_service_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =============================================================
-- 2. appointment_slot_configs
-- Recurring weekly availability rule: one row per (service [+ resource],
-- day-of-week, time window). A service open Mon-Fri 9-5 with a lunch
-- break is modeled as two windows per day, i.e. 10 rows.
-- =============================================================

CREATE TABLE `appointment_slot_configs` (
  `slot_config_id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `slot_config_uuid` char(36) NOT NULL,
  `tenant_uuid` char(36) NOT NULL,
  `facility_id` bigint unsigned NOT NULL,
  `facility_service_id` bigint unsigned NOT NULL,
  `resource_id` bigint unsigned DEFAULT NULL,
  `day_of_week` tinyint unsigned NOT NULL,
  `start_time` time NOT NULL,
  `end_time` time NOT NULL,
  `slot_duration_minutes` smallint unsigned NOT NULL,
  `capacity_per_slot` smallint unsigned NOT NULL DEFAULT 1,
  `effective_from` date NOT NULL,
  `effective_to` date DEFAULT NULL,
  `status` varchar(30) NOT NULL DEFAULT 'ACTIVE',
  -- Maker-checker workflow: a TENANT_USER's submission starts here as
  -- PENDING_APPROVAL and isn't picked up by the slot-generation job until
  -- a TENANT_ADMIN approves it (see appointment-service's
  -- appointmentSlotConfigService.js). A TENANT_ADMIN's own submission is
  -- auto-approved at create time, since they already hold approval
  -- authority — no self-review step needed.
  `approval_status` varchar(20) NOT NULL DEFAULT 'PENDING_APPROVAL',
  `reviewed_by` bigint unsigned DEFAULT NULL,
  `reviewed_on` datetime(6) DEFAULT NULL,
  `rejection_reason` varchar(500) DEFAULT NULL,
  `created_by` bigint unsigned DEFAULT NULL,
  `created_on` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `modified_by` bigint unsigned DEFAULT NULL,
  `modified_on` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`slot_config_id`),
  UNIQUE KEY `uk_slot_configs_uuid` (`slot_config_uuid`),
  KEY `idx_slot_configs_tenant` (`tenant_uuid`),
  KEY `idx_slot_configs_facility_service` (`facility_id`,`facility_service_id`,`day_of_week`),
  KEY `idx_slot_configs_resource` (`resource_id`),
  KEY `idx_slot_configs_approval_status` (`tenant_uuid`,`approval_status`),
  CONSTRAINT `fk_slot_configs_resource` FOREIGN KEY (`resource_id`) REFERENCES `facility_resources` (`resource_id`),
  CONSTRAINT `chk_slot_configs_time_order` CHECK (`end_time` > `start_time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =============================================================
-- 3. appointment_slots
-- Generated, concrete bookable instances — what the booking UI/API
-- actually queries and writes booked_count against. resource_key
-- coalesces NULL resource_id to 0 so the uniqueness check catches
-- duplicates for BOTH service-level and resource-level slots (MySQL
-- treats every NULL in a unique key as distinct, which would otherwise
-- silently allow two service-level slots at the same date/time).
-- =============================================================

CREATE TABLE `appointment_slots` (
  `slot_id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `slot_uuid` char(36) NOT NULL,
  `tenant_uuid` char(36) NOT NULL,
  `facility_id` bigint unsigned NOT NULL,
  `facility_service_id` bigint unsigned NOT NULL,
  `resource_id` bigint unsigned DEFAULT NULL,
  `resource_key` bigint unsigned GENERATED ALWAYS AS (COALESCE(`resource_id`, 0)) STORED,
  `slot_config_id` bigint unsigned DEFAULT NULL,
  `slot_date` date NOT NULL,
  `start_time` time NOT NULL,
  `end_time` time NOT NULL,
  `capacity` smallint unsigned NOT NULL DEFAULT 1,
  `booked_count` smallint unsigned NOT NULL DEFAULT 0,
  `status` varchar(30) NOT NULL DEFAULT 'OPEN',
  `cancel_reason` varchar(255) DEFAULT NULL,
  `cancelled_by` bigint unsigned DEFAULT NULL,
  `cancelled_on` datetime(6) DEFAULT NULL,
  `created_by` bigint unsigned DEFAULT NULL,
  `created_on` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `modified_by` bigint unsigned DEFAULT NULL,
  `modified_on` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`slot_id`),
  UNIQUE KEY `uk_slots_uuid` (`slot_uuid`),
  UNIQUE KEY `uk_slots_resource_date_time` (`facility_service_id`,`resource_key`,`slot_date`,`start_time`),
  KEY `idx_slots_tenant` (`tenant_uuid`),
  KEY `idx_slots_facility_date` (`facility_id`,`slot_date`,`status`),
  KEY `idx_slots_config` (`slot_config_id`),
  CONSTRAINT `fk_slots_resource` FOREIGN KEY (`resource_id`) REFERENCES `facility_resources` (`resource_id`),
  CONSTRAINT `fk_slots_config` FOREIGN KEY (`slot_config_id`) REFERENCES `appointment_slot_configs` (`slot_config_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =============================================================
-- 4. facility_closures
-- Holiday calendar (closure_type='HOLIDAY', usually recurrence_type=
-- 'ANNUAL') and emergency/ad-hoc closures (closure_type='EMERGENCY',
-- usually recurrence_type='ONE_TIME') in one table, since both are the
-- same shape: a facility/service/resource unavailable on a date.
-- =============================================================

CREATE TABLE `facility_closures` (
  `closure_id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `closure_uuid` char(36) NOT NULL,
  `tenant_uuid` char(36) NOT NULL,
  `facility_id` bigint unsigned DEFAULT NULL,
  `facility_service_id` bigint unsigned DEFAULT NULL,
  `resource_id` bigint unsigned DEFAULT NULL,
  `closure_type` varchar(30) NOT NULL,
  `recurrence_type` varchar(20) NOT NULL DEFAULT 'ONE_TIME',
  `closure_date` date NOT NULL,
  `closure_name` varchar(150) NOT NULL,
  `reason` varchar(500) DEFAULT NULL,
  `status` varchar(30) NOT NULL DEFAULT 'ACTIVE',
  `created_by` bigint unsigned DEFAULT NULL,
  `created_on` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `modified_by` bigint unsigned DEFAULT NULL,
  `modified_on` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`closure_id`),
  UNIQUE KEY `uk_closures_uuid` (`closure_uuid`),
  KEY `idx_closures_tenant` (`tenant_uuid`),
  KEY `idx_closures_facility_date` (`facility_id`,`closure_date`),
  KEY `idx_closures_type` (`closure_type`),
  CONSTRAINT `fk_closures_resource` FOREIGN KEY (`resource_id`) REFERENCES `facility_resources` (`resource_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =============================================================
-- 5. appointment_cancellation_reasons
-- Lookup master. tenant_uuid NULL = system-wide default reason visible
-- to every tenant; a tenant can also define its own on top.
-- =============================================================

CREATE TABLE `appointment_cancellation_reasons` (
  `reason_id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_uuid` char(36) DEFAULT NULL,
  `reason_code` varchar(50) NOT NULL,
  `reason_label` varchar(150) NOT NULL,
  `applicable_to` varchar(20) NOT NULL DEFAULT 'ANY',
  `status` varchar(30) NOT NULL DEFAULT 'ACTIVE',
  `created_on` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `modified_on` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`reason_id`),
  UNIQUE KEY `uk_reasons_tenant_code` (`tenant_uuid`,`reason_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =============================================================
-- 6. tenant_notification_settings
-- Per-tenant reminder configuration. One row per (tenant, channel,
-- offset) — a tenant wanting "SMS 24h before" + "SMS 1h before" +
-- "Email 24h before" is 3 rows.
-- =============================================================

CREATE TABLE `tenant_notification_settings` (
  `setting_id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_uuid` char(36) NOT NULL,
  `channel` varchar(20) NOT NULL,
  `is_enabled` tinyint(1) NOT NULL DEFAULT 1,
  `reminder_offset_minutes` int NOT NULL,
  `template_code` varchar(100) DEFAULT NULL,
  `status` varchar(30) NOT NULL DEFAULT 'ACTIVE',
  `created_by` bigint unsigned DEFAULT NULL,
  `created_on` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `modified_by` bigint unsigned DEFAULT NULL,
  `modified_on` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`setting_id`),
  UNIQUE KEY `uk_notif_settings_tenant_channel_offset` (`tenant_uuid`,`channel`,`reminder_offset_minutes`),
  KEY `idx_notif_settings_tenant` (`tenant_uuid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =============================================================
-- 7. appointments
-- The core booking record. Patient lives in an external patient/EMR
-- service — patient_ref is that service's id (no FK possible across
-- services); patient_name/phone/email are a snapshot taken at booking
-- time, so historical bookings stay accurate even if the patient's
-- contact details change later upstream, and reminders/lists don't need
-- a live cross-service call on every read.
-- =============================================================

CREATE TABLE `appointments` (
  `appointment_id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `appointment_uuid` char(36) NOT NULL,
  `tenant_uuid` char(36) NOT NULL,
  `facility_id` bigint unsigned NOT NULL,
  `facility_service_id` bigint unsigned NOT NULL,
  `resource_id` bigint unsigned DEFAULT NULL,
  `slot_id` bigint unsigned NOT NULL,
  `patient_ref` varchar(100) NOT NULL,
  `patient_name` varchar(200) NOT NULL,
  `patient_phone` varchar(20) NOT NULL,
  `patient_email` varchar(150) DEFAULT NULL,
  `appointment_date` date NOT NULL,
  `start_time` time NOT NULL,
  `end_time` time NOT NULL,
  `token_number` varchar(20) DEFAULT NULL,
  `booking_channel` varchar(30) NOT NULL DEFAULT 'ADMIN',
  `status` varchar(30) NOT NULL DEFAULT 'BOOKED',
  `cancellation_reason_id` bigint unsigned DEFAULT NULL,
  `cancellation_notes` varchar(500) DEFAULT NULL,
  `cancelled_by` bigint unsigned DEFAULT NULL,
  `cancelled_on` datetime(6) DEFAULT NULL,
  `rescheduled_from_appointment_id` bigint unsigned DEFAULT NULL,
  `notes` varchar(1000) DEFAULT NULL,
  `created_by` bigint unsigned DEFAULT NULL,
  `created_on` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `modified_by` bigint unsigned DEFAULT NULL,
  `modified_on` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`appointment_id`),
  UNIQUE KEY `uk_appointments_uuid` (`appointment_uuid`),
  KEY `idx_appointments_tenant` (`tenant_uuid`),
  KEY `idx_appointments_facility_date` (`facility_id`,`appointment_date`,`status`),
  KEY `idx_appointments_slot` (`slot_id`),
  KEY `idx_appointments_patient_ref` (`patient_ref`),
  CONSTRAINT `fk_appointments_resource` FOREIGN KEY (`resource_id`) REFERENCES `facility_resources` (`resource_id`),
  CONSTRAINT `fk_appointments_slot` FOREIGN KEY (`slot_id`) REFERENCES `appointment_slots` (`slot_id`),
  CONSTRAINT `fk_appointments_reason` FOREIGN KEY (`cancellation_reason_id`) REFERENCES `appointment_cancellation_reasons` (`reason_id`),
  CONSTRAINT `fk_appointments_rescheduled_from` FOREIGN KEY (`rescheduled_from_appointment_id`) REFERENCES `appointments` (`appointment_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =============================================================
-- 8. appointment_status_history
-- Full audit trail of every status transition an appointment goes
-- through (BOOKED -> CONFIRMED -> CHECKED_IN -> ... -> COMPLETED, or
-- any point -> CANCELLED, etc).
-- =============================================================

CREATE TABLE `appointment_status_history` (
  `history_id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `appointment_id` bigint unsigned NOT NULL,
  `from_status` varchar(30) DEFAULT NULL,
  `to_status` varchar(30) NOT NULL,
  `remarks` varchar(500) DEFAULT NULL,
  `changed_by` bigint unsigned DEFAULT NULL,
  `changed_on` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`history_id`),
  KEY `idx_status_history_appointment` (`appointment_id`),
  CONSTRAINT `fk_status_history_appointment` FOREIGN KEY (`appointment_id`) REFERENCES `appointments` (`appointment_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =============================================================
-- 9. appointment_waitlist
-- Queue for a facility/service/date that's fully booked. Same external-
-- patient-reference + snapshot pattern as appointments.
-- =============================================================

CREATE TABLE `appointment_waitlist` (
  `waitlist_id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `waitlist_uuid` char(36) NOT NULL,
  `tenant_uuid` char(36) NOT NULL,
  `facility_id` bigint unsigned NOT NULL,
  `facility_service_id` bigint unsigned NOT NULL,
  `patient_ref` varchar(100) NOT NULL,
  `patient_name` varchar(200) NOT NULL,
  `patient_phone` varchar(20) NOT NULL,
  `preferred_date` date NOT NULL,
  `status` varchar(30) NOT NULL DEFAULT 'WAITING',
  `converted_appointment_id` bigint unsigned DEFAULT NULL,
  `created_on` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `modified_on` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`waitlist_id`),
  UNIQUE KEY `uk_waitlist_uuid` (`waitlist_uuid`),
  KEY `idx_waitlist_tenant` (`tenant_uuid`),
  KEY `idx_waitlist_facility_service_date` (`facility_id`,`facility_service_id`,`preferred_date`),
  KEY `idx_waitlist_patient_ref` (`patient_ref`),
  CONSTRAINT `fk_waitlist_converted_appointment` FOREIGN KEY (`converted_appointment_id`) REFERENCES `appointments` (`appointment_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =============================================================
-- 10. appointment_reminders
-- Outbound reminder delivery log, optionally linked back to the tenant
-- rule (tenant_notification_settings row) that scheduled it.
-- =============================================================

CREATE TABLE `appointment_reminders` (
  `reminder_id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `appointment_id` bigint unsigned NOT NULL,
  `tenant_uuid` char(36) NOT NULL,
  `setting_id` bigint unsigned DEFAULT NULL,
  `channel` varchar(20) NOT NULL,
  `scheduled_at` datetime(6) NOT NULL,
  `sent_at` datetime(6) DEFAULT NULL,
  `status` varchar(30) NOT NULL DEFAULT 'PENDING',
  `failure_reason` varchar(255) DEFAULT NULL,
  `created_on` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`reminder_id`),
  KEY `idx_reminders_appointment` (`appointment_id`),
  KEY `idx_reminders_tenant` (`tenant_uuid`),
  KEY `idx_reminders_scheduled` (`scheduled_at`,`status`),
  CONSTRAINT `fk_reminders_appointment` FOREIGN KEY (`appointment_id`) REFERENCES `appointments` (`appointment_id`),
  CONSTRAINT `fk_reminders_setting` FOREIGN KEY (`setting_id`) REFERENCES `tenant_notification_settings` (`setting_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
