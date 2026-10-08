const { FacilityResource } = require('../models');
const { getAffiliation } = require('../clients/providerDirectory');
const { httpError } = require('../utils/errors');

const isoDay = (value) => (value ? new Date(value).toISOString().slice(0, 10) : null);

/**
 * Turns "this doctor placement (provider affiliation) for this facility
 * service" into the facility_resources row that slot rules, generated slots,
 * closures and appointments already point at — creating it on first use.
 *
 * The doctor stays owned by the provider service; the resource row here is a
 * thin projection (id link + display name) so nothing downstream had to change.
 * The doctor is checked every time, not just when the row is created:
 *
 *   - the provider is ACTIVE and VERIFIED, and the placement is ACTIVE
 *   - the placement is at this very facility, and delivers this service
 *   - slot-based (PHYSICAL / REMOTE) when `slotBased` is set — on-demand /
 *     on-call / home-visit work has no fixed slots
 *   - for slot rules: the rule's dates sit inside the placement's validity dates
 */
async function resolveProviderResource({ providerAffiliationId, facilityId, facilityServiceId, slotBased = false, window = null, tenantUuid, userId, token }) {
  const affiliation = await getAffiliation(providerAffiliationId, token);
  const provider = affiliation.provider || {};
  const name = provider.displayName || `Provider #${affiliation.providerId}`;

  const notBookable = (message) => httpError(409, 'PROVIDER_NOT_BOOKABLE', message);
  if (provider.status !== 'ACTIVE') {
    throw notBookable(`${name} is ${String(provider.status).toLowerCase()} and cannot be given slots`);
  }
  if (provider.verificationStatus !== 'VERIFIED') {
    throw notBookable(`${name} has not been verified yet. Verify the doctor on their page first.`);
  }
  if (affiliation.status !== 'ACTIVE') {
    throw notBookable(`This placement of ${name} is ${String(affiliation.status).toLowerCase()}. Re-activate it on the doctor's page first.`);
  }
  if (slotBased && !['PHYSICAL', 'REMOTE'].includes(affiliation.availabilityType)) {
    throw httpError(400, 'NOT_SLOT_BASED', `${name}'s placement is on-demand / on-call style availability, which does not use fixed slots`);
  }
  if (!affiliation.facilityId) {
    throw httpError(400, 'PROVIDER_NOT_AT_FACILITY', `${name} is registered for the whole organization. Register them at a facility first.`);
  }
  if (facilityId && Number(affiliation.facilityId) !== Number(facilityId)) {
    throw httpError(400, 'PROVIDER_NOT_AT_FACILITY', `${name} is not registered at this facility`);
  }
  if (!(affiliation.facilityServiceIds || []).map(Number).includes(Number(facilityServiceId))) {
    throw httpError(400, 'PROVIDER_SERVICE_MISMATCH', `${name} is not set up to deliver this service at this facility. Add the service to their placement first.`);
  }

  if (window) {
    const from = isoDay(window.from);
    const to = isoDay(window.to);
    if (affiliation.effectiveFrom && from && from < affiliation.effectiveFrom) {
      throw httpError(400, 'OUTSIDE_PLACEMENT_DATES', `${name} starts at this facility on ${affiliation.effectiveFrom}; the slot rule cannot start earlier`);
    }
    if (affiliation.effectiveTo && (!to || to > affiliation.effectiveTo)) {
      throw httpError(400, 'OUTSIDE_PLACEMENT_DATES', `${name}'s placement ends on ${affiliation.effectiveTo}; give the slot rule an end date on or before it`);
    }
  }

  const where = {
    tenant_uuid: tenantUuid,
    provider_affiliation_id: affiliation.affiliationId,
    facility_service_id: facilityServiceId,
  };
  let resource = await FacilityResource.findOne({ where });
  if (!resource) {
    try {
      resource = await FacilityResource.create({
        tenantUuid,
        facilityId: affiliation.facilityId,
        facilityServiceId,
        resourceType: 'PROVIDER',
        resourceName: name,
        providerId: affiliation.providerId,
        providerAffiliationId: affiliation.affiliationId,
        status: 'ACTIVE',
        createdBy: userId || null,
        modifiedBy: userId || null,
      });
    } catch (error) {
      // Two admins attaching the same doctor to the same service at once.
      if (error.name !== 'SequelizeUniqueConstraintError') throw error;
      resource = await FacilityResource.findOne({ where });
    }
  } else if (resource.resourceName !== name || resource.status !== 'ACTIVE') {
    // The doctor was renamed (or the resource had been switched off): keep the copy in step.
    await resource.update({ resourceName: name, status: 'ACTIVE', modifiedBy: userId || null, modifiedOn: new Date() });
  }
  return { resource, affiliation };
}

module.exports = { resolveProviderResource };
