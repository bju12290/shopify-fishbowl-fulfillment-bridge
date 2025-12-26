import { z } from 'zod';

const emptyToUndefined = (v) => {
  if (v === undefined || v === null) return undefined;
  if (typeof v === 'string' && v.trim() === '') return undefined;
  return v;
};

const optionalPositiveInt = z.preprocess(
  (v) => {
    const vv = emptyToUndefined(v);
    if (vv === undefined) return undefined;
    const n = typeof vv === 'number' ? vv : Number(vv);
    return Number.isFinite(n) ? n : vv;
  },
  z.number().int().positive().optional()
);

const envSchema = z
  .object({
    // App
    PORT: z.coerce.number().int().positive().default(3000),
    APP_VERSION: z.string().default('dev'),
    LOG_LEVEL: z.string().default('info'),
    DATA_DIR: z.string().default('./data'),

    // Shopify
    SHOPIFY_SHOP_DOMAIN: z.string().min(1),
    SHOPIFY_ACCESS_TOKEN: z.string().min(1),
    SHOPIFY_WEBHOOK_SECRET: z.string().min(1),
    SHOPIFY_API_VERSION: z.string().default('2025-10'),
    SHOPIFY_MODE: z.enum(['real', 'mock']).default('real'),
    // Demo/testing only: what fulfillment status the mock should return
    SHOPIFY_MOCK_DEFAULT_FULFILLMENT_STATUS: z.string().default('FULFILLED'),

    // Fishbowl Advanced
    FISHBOWL_BASE_URL: z.string().min(1),
    FISHBOWL_USERNAME: z.string().min(1),
    FISHBOWL_PASSWORD: z.string().min(1),

    FISHBOWL_APP_NAME: z.string().default('Shopify Fishbowl Fulfillment Bridge'),
    FISHBOWL_APP_DESCRIPTION: z
      .string()
      .default('Bridges Shopify fulfillment events to Fishbowl Advanced.'),
    FISHBOWL_APP_ID: z.coerce.number().int().default(9001),

    // Fishbowl fulfillment via Import endpoint
    FISHBOWL_FULFILLMENT_IMPORT_NAME: z.string().min(1),
    FISHBOWL_IMPORT_HEADERS: z.string().min(1),
    FISHBOWL_IMPORT_ROW_TEMPLATE: z.string().min(1),

    // Email (optional)
    SMTP_HOST: z.preprocess(emptyToUndefined, z.string().optional()),
    SMTP_PORT: optionalPositiveInt,
    SMTP_USER: z.preprocess(emptyToUndefined, z.string().optional()),
    SMTP_PASS: z.preprocess(emptyToUndefined, z.string().optional()),
    ALERT_TO_EMAIL: z.preprocess(emptyToUndefined, z.string().email().optional()),
    ALERT_FROM_EMAIL: z.preprocess(emptyToUndefined, z.string().email().optional()),
  });

export function loadConfig(env = process.env) {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const pretty = parsed.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('\n');
    const err = new Error(`Invalid environment configuration:\n${pretty}`);
    err.cause = parsed.error;
    throw err;
  }
  return parsed.data;
}
