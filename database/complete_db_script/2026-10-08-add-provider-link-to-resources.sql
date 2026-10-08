-- Lets a slot rule / closure point at a doctor registered in
-- sp3digital-provider-admin-service. Run once on an existing database.
-- Nothing else changes: slot rules, slots, closures and appointments already
-- point at facility_resources via resource_id.
USE `sp3digital_appointments`;

ALTER TABLE `facility_resources`
  ADD COLUMN `provider_id` bigint unsigned DEFAULT NULL AFTER `resource_name`,
  ADD COLUMN `provider_affiliation_id` bigint unsigned DEFAULT NULL AFTER `provider_id`,
  ADD UNIQUE KEY `uk_resources_provider_service` (`provider_affiliation_id`,`facility_service_id`),
  ADD KEY `idx_resources_provider` (`provider_id`);
