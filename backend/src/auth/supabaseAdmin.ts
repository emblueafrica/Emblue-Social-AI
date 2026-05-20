type CreateSupabaseUserInput = {
  email: string;
  password: string;
  fullName?: string | null;
  emailConfirm?: boolean;
};

type SupabaseUserResponse = {
  id: string;
  email?: string;
};

function getSupabaseAdminConfig(): { url: string; serviceRoleKey: string } | null {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) return null;
  return { url, serviceRoleKey };
}

export async function createSupabaseUser(input: CreateSupabaseUserInput): Promise<SupabaseUserResponse> {
  const config = getSupabaseAdminConfig();
  if (!config) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required to create auth users');
  }

  const response = await fetch(`${config.url}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: input.email,
      password: input.password,
      email_confirm: input.emailConfirm ?? true,
      user_metadata: input.fullName ? { full_name: input.fullName } : undefined,
    }),
  });

  const payload = await response.json().catch(() => null) as SupabaseUserResponse & { msg?: string; error?: string } | null;
  if (!response.ok || !payload?.id) {
    throw new Error(payload?.msg ?? payload?.error ?? `Supabase user creation failed with ${response.status}`);
  }

  return { id: payload.id, email: payload.email ?? input.email };
}
