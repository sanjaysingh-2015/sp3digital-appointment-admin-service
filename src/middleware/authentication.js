const axios = require('axios');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

let jwksCache;

function authError(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.expose = true;
  return error;
}

function getBearerToken(header) {
  if (!header || !header.startsWith('Bearer ')) return null;
  return header.slice(7).trim();
}

/**
 * Constant-time check for the shared service-to-service secret, so a
 * naive `===` timing side-channel can't be used to brute-force it.
 * Deliberately returns false (rather than throwing) on any length
 * mismatch, since timingSafeEqual requires equal-length buffers.
 */
function isInternalServiceToken(token) {
  const expected = process.env.APPOINTMENT_SERVICE_INTERNAL_TOKEN;
  if (!expected || !token) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

async function getJwks(url) {
  if (jwksCache?.url === url && jwksCache.expiresAt > Date.now()) return jwksCache.keys;
  const response = await axios.get(url, { timeout: 5_000 });
  if (!Array.isArray(response.data?.keys)) {
    throw authError(503, 'AUTH_CONFIGURATION_ERROR', 'JWKS endpoint returned an invalid response');
  }
  jwksCache = { url, keys: response.data.keys, expiresAt: Date.now() + 10 * 60 * 1000 };
  return jwksCache.keys;
}

/**
 * Byte-for-byte the same verification logic as identity-admin-service's
 * and organization-admin-service's authentication.js. This MUST stay in
 * sync: these are not this service's own keys, they're identity-admin
 * -service's — this service only ever verifies tokens minted there, never
 * signs its own.
 */
async function verifyToken(token) {
  const options = {
    issuer: process.env.ADMIN_JWT_ISSUER || undefined,
    audience: process.env.ADMIN_JWT_AUDIENCE || undefined,
  };

  if (process.env.ADMIN_JWT_SECRET) {
    return jwt.verify(token, process.env.ADMIN_JWT_SECRET, {
      ...options,
      algorithms: ['HS256', 'HS384', 'HS512'],
    });
  }

  if (!process.env.ADMIN_JWKS_URL) {
    throw authError(503, 'AUTH_CONFIGURATION_ERROR', 'No admin JWT verifier is configured');
  }

  const decoded = jwt.decode(token, { complete: true });
  if (!decoded?.header?.kid) {
    throw authError(401, 'INVALID_TOKEN', 'JWT header does not include a key identifier');
  }

  const keys = await getJwks(process.env.ADMIN_JWKS_URL);
  const jwk = keys.find((key) => key.kid === decoded.header.kid);
  if (!jwk) throw authError(401, 'INVALID_TOKEN', 'JWT signing key is not recognized');

  return jwt.verify(token, crypto.createPublicKey({ key: jwk, format: 'jwk' }), {
    ...options,
    algorithms: ['RS256', 'RS384', 'RS512'],
  });
}

function scopesFromClaims(claims) {
  if (Array.isArray(claims.permissions)) return new Set(claims.permissions);
  if (Array.isArray(claims.scp)) return new Set(claims.scp);
  if (typeof claims.scope === 'string') return new Set(claims.scope.split(' ').filter(Boolean));
  return new Set();
}

/**
 * Two ways to authenticate against this service:
 *
 * 1. A real end-user bearer JWT minted by identity-admin-service — the
 *    normal path. tenantUuid comes from the token's tenant_uuid claim,
 *    userId from its user_id claim (used to stamp createdBy/reviewedBy).
 *
 * 2. The shared APPOINTMENT_SERVICE_INTERNAL_TOKEN as the bearer token,
 *    reserved for trusted server-to-server callers (e.g. a future slot-
 *    generation batch job) that have no end-user JWT of their own. The
 *    caller supplies the tenant via the X-Tenant-Uuid header instead of a
 *    token claim, same convention as organization-admin-service.
 */
async function authenticate(req, res, next) {
  try {
    const token = getBearerToken(req.headers.authorization);
    if (!token) throw authError(401, 'UNAUTHENTICATED', 'A bearer token is required');

    if (isInternalServiceToken(token)) {
      const tenantUuid = req.headers['x-tenant-uuid'];
      if (!tenantUuid || typeof tenantUuid !== 'string') {
        throw authError(400, 'TENANT_HEADER_REQUIRED', 'X-Tenant-Uuid header is required for service-to-service calls');
      }
      req.auth = {
        tenantUuid,
        userId: null,
        isInternalService: true,
        scopes: new Set(['ALL_PERMISSIONS']),
      };
      return next();
    }

    const claims = await verifyToken(token);
    const tenantUuid = claims.tenant_uuid || claims.tenantUuid || claims.tid;
    if (!tenantUuid || typeof tenantUuid !== 'string') {
      throw authError(403, 'TENANT_CLAIM_REQUIRED', 'JWT must include a tenant UUID claim');
    }

    req.auth = {
      claims,
      tenantUuid,
      userId: claims.user_id ?? claims.userId ?? null,
      isInternalService: false,
      scopes: scopesFromClaims(claims),
    };
    return next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) {
      return next(authError(401, 'INVALID_TOKEN', 'Bearer token is invalid or expired'));
    }
    return next(error);
  }
}

/**
 * Matches a fine-grained `appointment-admin:<resource>:<action>` scope
 * case-insensitively, or the `appointment-admin:*` wildcard.
 */
function hasPermission(scopes, requiredPermission) {
  if (scopes.has('ALL_PERMISSIONS')) return true;
  if (scopes.has(requiredPermission)) return true;

  const required = requiredPermission.toUpperCase();
  const requiredService = required.split(':')[0];

  return [...scopes].some((code) => {
    const upper = code.toUpperCase();
    if (upper === `${requiredService}:*`) return true;
    return upper === required;
  });
}

/**
 * Enforced on every slot-config route (see routes/appointmentSlotConfigRoutes.js)
 * — unlike organization-admin-service's still-dormant authorize(), this one
 * is live from day one: the whole point of this service is the
 * TENANT_ADMIN-vs-TENANT_USER split (create+read for both, update+approve
 * for TENANT_ADMIN only), and that split doesn't exist unless this gate
 * actually runs.
 */
function authorize(requiredPermission) {
  return (req, res, next) => {
    if (req.auth?.isInternalService) return next();

    const scopes = req.auth?.scopes || new Set();
    if (!hasPermission(scopes, requiredPermission)) {
      return next(authError(403, 'INSUFFICIENT_PERMISSION', `Permission ${requiredPermission} is required`));
    }
    return next();
  };
}

module.exports = { authenticate, authorize, hasPermission };
