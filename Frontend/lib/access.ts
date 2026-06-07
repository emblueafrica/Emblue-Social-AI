import type { AuthMeResponse } from "@/lib/api";

export function isPlatformAdmin(authContext: AuthMeResponse | null) {
  return authContext?.platform_role === "super_admin" || authContext?.platform_role === "platform_admin";
}

export function isB2CClient(authContext: AuthMeResponse | null) {
  return authContext?.active_brand?.account_type === "b2c_managed";
}

export function isB2BClient(authContext: AuthMeResponse | null) {
  return authContext?.active_brand?.account_type === "b2b_licensed";
}

export function getDefaultAuthenticatedRoute(authContext: AuthMeResponse | null) {
  if (isPlatformAdmin(authContext)) return "/admin";
  if (isB2CClient(authContext)) return "/client-portal";
  return "/dashboard";
}

export function hasTool(enabled: string[] | undefined, toolId: string) {
  return Boolean(enabled?.includes(toolId));
}
