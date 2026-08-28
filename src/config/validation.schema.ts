import * as Joi from 'joi';

export const validationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  PORT: Joi.number().port().default(3000),
  DB_HOST: Joi.string().required(),
  DB_PORT: Joi.number().port().required(),
  DB_USER: Joi.string().required(),
  DB_PASSWORD: Joi.string().required(),
  DB_NAME: Joi.string().required(),
  CORS_ORIGIN: Joi.string().uri().default('http://localhost:3001'),
  // The browser-facing issuer: what Keycloak stamps into every token's `iss`
  // claim, and what token issuer validation must match.
  KEYCLOAK_ISSUER: Joi.string().uri().required(),
  // Server-to-server reachability address for JWKS/health probes. Only differs
  // from KEYCLOAK_ISSUER behind Docker/a reverse proxy, where the container
  // can't resolve the browser-facing hostname; falls back to KEYCLOAK_ISSUER.
  KEYCLOAK_INTERNAL_ISSUER: Joi.string().uri().optional(),
  KEYCLOAK_AUDIENCE: Joi.string().trim().required(),
  MINIO_ENDPOINT: Joi.string().uri().required(),
  MINIO_ACCESS_KEY: Joi.string().required(),
  MINIO_SECRET_KEY: Joi.string().min(12).required(),
  MINIO_BUCKET: Joi.string()
    .pattern(/^[a-z0-9][a-z0-9.-]{2,62}$/)
    .required(),
  CLAMAV_HOST: Joi.string().required(),
  CLAMAV_PORT: Joi.number().port().required(),
});
