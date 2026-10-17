export interface Env {
  AI: Ai;
  // public vars (wrangler.toml)
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  WORKERS_AI_MODEL: string;
  WORKERS_AI_VISION_MODEL: string;
  BEDROCK_MODEL_ID: string; // AC-89: the in-Region id, never a us./global. inference profile
  BEDROCK_REGION: string;
  SES_REGION: string;
  DEMO_EMAIL: string;
  APP_URL?: string;
  PORTAL_URL: string; // the facturas Worker's origin (AC-86)
  INBOUND_EMAIL_DOMAIN?: string; // email intake's domain (AC-87); empty until Roberto adds one (AC-88)
  FX_PROVIDER?: string; // 'yahoo' (default) or 'er-api': the first provider of the FX chain (AC-73)
  // secrets (wrangler secret put)
  AWS_SES_ACCESS_KEY_ID: string;
  AWS_SES_SECRET_ACCESS_KEY: string;
  AWS_BEDROCK_ACCESS_KEY_ID: string;
  AWS_BEDROCK_SECRET_ACCESS_KEY: string;
  SES_FROM_EMAIL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  APPROVAL_HMAC_SECRET: string;
}
