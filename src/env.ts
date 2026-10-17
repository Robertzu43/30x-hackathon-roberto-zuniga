export interface Env {
  AI: Ai;
  // public vars (wrangler.toml)
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  WORKERS_AI_MODEL: string;
  WORKERS_AI_VISION_MODEL: string;
  SES_REGION: string;
  DEMO_EMAIL: string;
  APP_URL?: string;
  PORTAL_URL: string; // the facturas Worker's origin (AC-86)
  // secrets (wrangler secret put)
  AWS_SES_ACCESS_KEY_ID: string;
  AWS_SES_SECRET_ACCESS_KEY: string;
  SES_FROM_EMAIL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  APPROVAL_HMAC_SECRET: string;
}
