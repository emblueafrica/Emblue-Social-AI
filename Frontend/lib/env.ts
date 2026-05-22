export const env = {
  apiUrl: process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ?? "",
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabasePublishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
};

export function getMissingClientEnv() {
  return [
    ["NEXT_PUBLIC_API_URL", env.apiUrl],
    ["NEXT_PUBLIC_SUPABASE_URL", env.supabaseUrl],
    ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", env.supabasePublishableKey],
  ]
    .filter(([, value]) => !value)
    .map(([key]) => key);
}
