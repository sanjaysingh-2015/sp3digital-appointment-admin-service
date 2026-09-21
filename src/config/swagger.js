const swaggerJsdoc = require('swagger-jsdoc');

// Shared enum lists, kept in sync with appointmentSlotConfig.validation.js
// so the docs never drift from what the API actually accepts.
const { STATUSES, APPROVAL_STATUSES } = require('../validations/appointmentSlotConfig.validation');

const basePath = '/api/v1/appointment-admin';

const paginationSchema = {
  type: 'object',
  properties: {
    page: { type: 'integer', example: 1 },
    limit: { type: 'integer', example: 20 },
    totalItems: { type: 'integer', example: 42 },
    totalPages: { type: 'integer', example: 3 },
  },
};

const errorSchema = {
  type: 'object',
  properties: {
    error: {
      type: 'object',
      properties: {
        code: { type: 'string', example: 'VALIDATION_ERROR' },
        message: { type: 'string', example: 'Request validation failed' },
        details: {
          type: 'array',
          items: { type: 'string' },
          example: ['"facilityId" is required'],
        },
      },
    },
  },
};

const auditFields = {
  createdOn: { type: 'string', format: 'date-time' },
  modifiedOn: { type: 'string', format: 'date-time' },
};

const options = {
  definition: {
    openapi: '3.0.3',
    info: {
      title: 'SP3 Digital — Appointment Admin Service API',
      version: '1.0.0',
      description:
        'Appointment slot configuration for the SP3 Digital healthcare platform: recurring ' +
        'weekly slot rules per facility service, with a TENANT_USER/TENANT_ADMIN maker-checker ' +
        'approval workflow.\n\n' +
        'Every route below `' +
        basePath +
        '` (other than `/health`) requires a bearer ' +
        'token: either an end-user JWT issued by sp3digital-identity-admin-service, or ' +
        'the shared internal-service token for service-to-service calls.\n\n' +
        'Fine-grained permissions (checked against the JWT\'s `permissions` claim, not a role ' +
        'name — see src/middleware/authentication.js#authorize): ' +
        '`appointment-admin:slot-config:create`, `:read`, `:update`, `:approve`. ' +
        'TENANT_USER holds create+read only; TENANT_ADMIN holds all four — see ' +
        'identity-admin-service\'s database/seeds/appointment-slot-config-rbac.sql.',
    },
    servers: [{ url: basePath, description: 'Base path for all resource routes' }],
    tags: [
      { name: 'Health', description: 'Service liveness check (no auth required)' },
      {
        name: 'Slot Configs',
        description:
          'Recurring weekly appointment slot rules for a facility service, with the ' +
          'TENANT_USER (create+read) / TENANT_ADMIN (create+read+update+approve) approval workflow',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description:
            'Either a JWT issued by identity-admin-service, or the shared ' +
            'APPOINTMENT_SERVICE_INTERNAL_TOKEN. Internal-service calls must also send ' +
            'an `X-Tenant-Uuid` header.',
        },
      },
      parameters: {
        XTenantUuid: {
          name: 'X-Tenant-Uuid',
          in: 'header',
          required: false,
          description: 'Required only when authenticating with the shared internal-service token.',
          schema: { type: 'string', format: 'uuid' },
        },
        PageParam: {
          name: 'page',
          in: 'query',
          schema: { type: 'integer', minimum: 1, default: 1 },
        },
        LimitParam: {
          name: 'limit',
          in: 'query',
          schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
        },
        SortByParam: {
          name: 'sortBy',
          in: 'query',
          schema: { type: 'string', maxLength: 100 },
        },
        SortDirParam: {
          name: 'sortDir',
          in: 'query',
          schema: { type: 'string', enum: ['ASC', 'DESC'], default: 'DESC' },
        },
        FacilityIdParam: {
          name: 'facilityId',
          in: 'query',
          schema: { type: 'integer' },
        },
        FacilityServiceIdParam: {
          name: 'facilityServiceId',
          in: 'query',
          schema: { type: 'integer' },
        },
        ApprovalStatusFilterParam: {
          name: 'approvalStatus',
          in: 'query',
          description: 'Filter to a TENANT_ADMIN\'s review queue with ?approvalStatus=PENDING_APPROVAL.',
          schema: { type: 'string', enum: [...APPROVAL_STATUSES] },
        },
        StatusFilterParam: {
          name: 'status',
          in: 'query',
          schema: { type: 'string', enum: [...STATUSES] },
        },
      },
      schemas: {
        Error: errorSchema,
        Pagination: paginationSchema,
        SlotConfig: {
          type: 'object',
          properties: {
            slotConfigId: { type: 'integer', example: 501 },
            slotConfigUuid: { type: 'string', format: 'uuid' },
            tenantUuid: { type: 'string', format: 'uuid' },
            facilityId: { type: 'integer' },
            facilityServiceId: { type: 'integer' },
            resourceId: { type: 'integer', nullable: true },
            resourceName: { type: 'string', nullable: true, example: 'Dr. A. Sharma' },
            dayOfWeek: { type: 'integer', minimum: 1, maximum: 7, description: '1=Monday ... 7=Sunday (ISO-8601)' },
            startTime: { type: 'string', example: '09:00' },
            endTime: { type: 'string', example: '13:00' },
            slotDurationMinutes: { type: 'integer', example: 30 },
            capacityPerSlot: { type: 'integer', example: 1 },
            effectiveFrom: { type: 'string', format: 'date' },
            effectiveTo: { type: 'string', format: 'date', nullable: true },
            status: { type: 'string', enum: [...STATUSES] },
            approvalStatus: { type: 'string', enum: [...APPROVAL_STATUSES] },
            reviewedBy: { type: 'integer', nullable: true },
            reviewedOn: { type: 'string', format: 'date-time', nullable: true },
            rejectionReason: { type: 'string', nullable: true },
            createdBy: { type: 'integer', nullable: true },
            modifiedBy: { type: 'integer', nullable: true },
            ...auditFields,
          },
        },
        SlotConfigCreateRequest: {
          type: 'object',
          required: ['facilityId', 'facilityServiceId', 'dayOfWeek', 'startTime', 'endTime', 'slotDurationMinutes', 'effectiveFrom'],
          properties: {
            facilityId: { type: 'integer' },
            facilityServiceId: { type: 'integer' },
            resourceId: { type: 'integer', nullable: true, description: 'Optional — omit for a service-level rule with no specific doctor/counter/equipment.' },
            dayOfWeek: { type: 'integer', minimum: 1, maximum: 7 },
            startTime: { type: 'string', example: '09:00' },
            endTime: { type: 'string', example: '13:00' },
            slotDurationMinutes: { type: 'integer', minimum: 1, maximum: 480 },
            capacityPerSlot: { type: 'integer', minimum: 1, default: 1 },
            effectiveFrom: { type: 'string', format: 'date' },
            effectiveTo: { type: 'string', format: 'date', nullable: true },
          },
        },
        SlotConfigUpdateRequest: {
          type: 'object',
          minProperties: 1,
          properties: {
            resourceId: { type: 'integer', nullable: true },
            dayOfWeek: { type: 'integer', minimum: 1, maximum: 7 },
            startTime: { type: 'string', example: '09:00' },
            endTime: { type: 'string', example: '13:00' },
            slotDurationMinutes: { type: 'integer', minimum: 1, maximum: 480 },
            capacityPerSlot: { type: 'integer', minimum: 1 },
            effectiveFrom: { type: 'string', format: 'date' },
            effectiveTo: { type: 'string', format: 'date', nullable: true },
            status: { type: 'string', enum: [...STATUSES] },
          },
        },
        SlotConfigRejectRequest: {
          type: 'object',
          required: ['rejectionReason'],
          properties: {
            rejectionReason: { type: 'string', maxLength: 500, example: 'Overlaps with an existing approved schedule' },
          },
        },
      },
      responses: {
        ValidationError: {
          description: 'Request body or query failed Joi validation.',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
        Unauthenticated: {
          description: 'Missing, malformed, or expired bearer token.',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
        Forbidden: {
          description:
            'Caller is authenticated but lacks the required permission — e.g. a TENANT_USER ' +
            'calling PATCH/approve/reject, which only TENANT_ADMIN holds.',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
        NotFound: {
          description: 'No slot configuration with that id exists for the caller\u2019s tenant.',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
        InvalidApprovalState: {
          description: 'The slot configuration is not currently PENDING_APPROVAL (e.g. approving twice).',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
      },
    },
    security: [{ bearerAuth: [] }],
  },
  apis: ['./src/routes/*.js', './src/app.js'], // Path to files containing JSDoc @openapi annotations
};

module.exports = swaggerJsdoc(options);
