require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const swaggerUi = require('swagger-ui-express');

const swaggerSpec = require('./config/swagger');
const db = require('./models');
const { authenticate } = require('./middleware/authentication');
const appointmentSlotConfigRoutes = require('./routes/appointmentSlotConfigRoutes');

const app = express();

// Swagger UI serves its own inline <script>/<style> tags, which the
// strict default CSP set by `app.use(helmet())` below would block.
// Registering this BEFORE the global helmet() means, for requests under
// /docs, this relaxed config runs (and responds) first — the stricter
// global one below never gets a chance to add its CSP header for these
// two routes. Every other route is unaffected and still gets full helmet
// defaults. (Same pattern as organization-admin-service's app.js.)
app.use('/docs', helmet({ contentSecurityPolicy: false }), swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customSiteTitle: 'SP3 Digital — Appointment Admin Service API Docs',
}));
app.get('/docs.json', (req, res) => res.json(swaggerSpec));

// ALLOWED_ORIGINS: comma-separated list, e.g.
//   ALLOWED_ORIGINS=http://localhost:4200,https://identity-admin.sp3digital.com
// Falls back to allowing all origins ONLY when unset, so local dev keeps
// working without extra setup — every real environment must set this.
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(helmet());
app.use(
  cors(
    allowedOrigins.length
      ? { origin: allowedOrigins, credentials: true }
      : undefined, // no ALLOWED_ORIGINS set -> permissive default, dev-only
  ),
);
app.use(express.json());

const apiRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 600,
  standardHeaders: true,
  legacyHeaders: false,
});

const basePath = '/api/v1/appointment-admin';

/**
 * @openapi
 * /health:
 *   get:
 *     tags: [Health]
 *     summary: Liveness check
 *     security: []
 *     responses:
 *       200:
 *         description: Service is up.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: ok }
 */
app.get(`${basePath}/health`, (req, res) => res.status(200).json({ status: 'ok' }));

// Every route past this point requires a valid bearer token — either a
// real identity-admin-service-issued user JWT, or the shared
// APPOINTMENT_SERVICE_INTERNAL_TOKEN (see authentication.js).
app.use(basePath, apiRateLimiter, authenticate);

app.use(`${basePath}/slot-configs`, appointmentSlotConfigRoutes);

// Same error envelope shape as identity-admin-service and
// organization-admin-service, so every UI's error.message handling
// behaves identically regardless of which service answered.
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);

  if (error.isJoi) {
    return res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: error.details.map((detail) => detail.message),
      },
    });
  }

  // A real resourceId that doesn't exist in facility_resources trips the
  // FK constraint at the DB layer (see models/index.js's comment on why
  // this one, unlike the geography FKs elsewhere, IS enforced) — surface
  // it as a clean 400 instead of a raw DB error leaking through.
  if (error.name === 'SequelizeForeignKeyConstraintError') {
    return res.status(400).json({
      error: { code: 'INVALID_REFERENCE', message: 'One of the referenced ids does not exist' },
    });
  }

  // Only log unexpected (5xx) failures — expected 4xx rejections (bad
  // input, missing auth, not-found, tenant mismatch) are normal traffic,
  // not incidents, and logging every one of them buries real errors.
  if (!error.statusCode || error.statusCode >= 500) {
    console.error(error);
  }
  return res.status(error.statusCode || 500).json({
    error: {
      code: error.code || 'INTERNAL_ERROR',
      message: error.expose ? error.message : 'An unexpected error occurred',
    },
  });
});

const PORT = process.env.PORT || 3200;

async function startServer() {
  try {
    await db.sequelize.authenticate();
    console.log('Database connection established successfully.');

    // await db.sequelize.sync({ alter: false });
    // console.log('Sequelize models synchronized with database.');

    app.listen(PORT, () => {
      console.log(`sp3digital-appointment-service running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Unable to start appointment-service:', error);
  }
}

// Only auto-start when run directly (`node src/app.js` / `npm start`).
// When required from a test (`require('../src/app')`), the caller gets
// the configured `app` instance without a live server or DB connection
// being started as a side effect of `require`.
if (require.main === module) {
  startServer();
}

module.exports = app;
