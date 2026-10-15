const axios = require('axios');
const { httpError } = require('../utils/errors');

/**
 * Looks a patient up in sp3digital-patient-admin-service by uuid, forwarding the
 * caller's own token (so tenant scoping and the patient read permission apply).
 * The lookup is written to the patient access log as LOOKUP.
 *
 * The appointment stores the patient's uuid as patient_ref and a snapshot of
 * name, phone and email taken now, so history stays accurate if the patient
 * record changes later.
 */
async function getPatient(patientUuid, token) {
  const base = (process.env.PATIENT_SERVICE_URL || '').replace(/\/+$/, '');
  if (!base) throw httpError(503, 'PATIENT_SERVICE_NOT_CONFIGURED', 'PATIENT_SERVICE_URL is not set, so patients cannot be looked up');
  if (!token) throw httpError(400, 'USER_TOKEN_REQUIRED', 'Booking needs a signed-in user');

  try {
    const response = await axios.get(`${base}/patients/by-uuid/${encodeURIComponent(patientUuid)}`, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 5000,
    });
    return response.data;
  } catch (error) {
    if (error.response?.status === 404) throw httpError(400, 'INVALID_PATIENT', 'That patient does not exist in this tenant');
    if (error.response?.status === 401 || error.response?.status === 403) {
      throw httpError(403, 'PATIENT_ACCESS_DENIED', 'You do not have permission to look up patients');
    }
    throw httpError(502, 'PATIENT_SERVICE_UNAVAILABLE', 'Could not verify the patient with patient-admin-service');
  }
}

module.exports = { getPatient };
