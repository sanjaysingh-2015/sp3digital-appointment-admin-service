const axios = require('axios');
const { httpError } = require('../utils/errors');

/**
 * Looks an affiliation up in sp3digital-provider-admin-service — the single
 * source of truth for who a doctor is, where they practise and how.
 *
 * The caller's own bearer token is forwarded, so the provider service's
 * tenant scoping decides whether the affiliation is visible: another tenant's
 * affiliation answers 404, exactly like one that doesn't exist.
 */
async function getAffiliation(affiliationId, token) {
  const base = (process.env.PROVIDER_SERVICE_URL || '').replace(/\/+$/, '');
  if (!base) {
    throw httpError(503, 'PROVIDER_SERVICE_NOT_CONFIGURED', 'PROVIDER_SERVICE_URL is not set, so doctors cannot be attached');
  }
  if (!token) {
    throw httpError(400, 'USER_TOKEN_REQUIRED', 'Attaching a doctor needs a signed-in user');
  }

  try {
    const response = await axios.get(`${base}/affiliations/${affiliationId}`, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 5000,
    });
    return response.data;
  } catch (error) {
    if (error.response?.status === 404) {
      throw httpError(400, 'INVALID_PROVIDER_AFFILIATION', 'That doctor placement does not exist in this tenant');
    }
    if (error.response?.status === 401 || error.response?.status === 403) {
      throw httpError(403, 'PROVIDER_ACCESS_DENIED', 'You do not have permission to view doctors');
    }
    throw httpError(502, 'PROVIDER_SERVICE_UNAVAILABLE', 'Could not verify the doctor with provider-admin-service');
  }
}

module.exports = { getAffiliation };
