"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ShieldCheck, UserCheck, UserX, X } from "lucide-react";
import { DashHeader, Sidebar } from "@/components/dashboard/Sidebar";
import {
  activateUser,
  approveSignupRequest,
  getAdminBrands,
  getAdminPlans,
  getAdminUsers,
  getAuditLogs,
  getSignupRequests,
  rejectSignupRequest,
  updateBrandAccess,
  type AdminBrand,
  type SignupRequest,
} from "@/lib/api";
import { isPlatformAdmin } from "@/lib/access";
import { useAuth } from "@/hooks/use-auth";

type PlanId = "starter" | "growth" | "enterprise";
type AccountType = "b2b_licensed" | "b2c_managed" | "internal";

export default function AdminPage() {
  const { authContext } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [selectedPlans, setSelectedPlans] = useState<Record<number, PlanId>>({});
  const [selectedAccountTypes, setSelectedAccountTypes] = useState<Record<number, AccountType>>({});

  useEffect(() => {
    if (authContext && !isPlatformAdmin(authContext)) router.replace("/dashboard");
  }, [authContext, router]);

  const plansQuery = useQuery({ queryKey: ["admin-plans"], queryFn: getAdminPlans, retry: false });
  const requestsQuery = useQuery({ queryKey: ["admin-signup-requests"], queryFn: () => getSignupRequests("pending"), retry: false });
  const brandsQuery = useQuery({ queryKey: ["admin-brands"], queryFn: getAdminBrands, retry: false });
  const usersQuery = useQuery({ queryKey: ["admin-users"], queryFn: getAdminUsers, retry: false });
  const auditQuery = useQuery({ queryKey: ["admin-audit"], queryFn: getAuditLogs, retry: false });

  const invalidateAdmin = () => {
    void queryClient.invalidateQueries({ queryKey: ["admin-signup-requests"] });
    void queryClient.invalidateQueries({ queryKey: ["admin-brands"] });
    void queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    void queryClient.invalidateQueries({ queryKey: ["admin-audit"] });
  };

  const approveMutation = useMutation({
    mutationFn: (request: SignupRequest) =>
      approveSignupRequest(request.request_id, {
        account_type: selectedAccountTypes[request.request_id] === "b2c_managed" ? "b2c_managed" : "b2b_licensed",
        plan_id: selectedPlans[request.request_id] ?? "starter",
      }),
    onSuccess: invalidateAdmin,
  });

  const rejectMutation = useMutation({
    mutationFn: (request: SignupRequest) => rejectSignupRequest(request.request_id, "Rejected from admin console"),
    onSuccess: invalidateAdmin,
  });

  const accessMutation = useMutation({
    mutationFn: (brand: AdminBrand) =>
      updateBrandAccess(brand.brand_id, {
        account_type: selectedAccountTypes[brand.brand_id] ?? brand.account_type,
        plan_id: selectedPlans[brand.brand_id] ?? (normalizePlan(brand.plan) ?? "starter"),
      }),
    onSuccess: invalidateAdmin,
  });

  const activePlans = plansQuery.data?.plans ?? [];
  const brands = brandsQuery.data?.brands ?? [];
  const requests = requestsQuery.data?.requests ?? [];
  const users = usersQuery.data?.users ?? [];
  const auditLogs = auditQuery.data?.audit_logs ?? [];

  const status = useMemo(() => {
    if (approveMutation.isPending || rejectMutation.isPending || accessMutation.isPending) return "Saving changes...";
    if (approveMutation.isError || rejectMutation.isError || accessMutation.isError) return "One action failed. Check the row and retry.";
    return null;
  }, [accessMutation.isError, accessMutation.isPending, approveMutation.isError, approveMutation.isPending, rejectMutation.isError, rejectMutation.isPending]);

  if (!authContext || !isPlatformAdmin(authContext)) return null;

  return (
    <div className="min-h-screen flex bg-muted/30">
      <Sidebar activeLabel="Admin Console" />
      <div className="flex-1 flex flex-col min-w-0">
        <DashHeader title="Admin Console" />
        <main className="flex-1 p-6 md:p-10 space-y-6">
          {status && <Notice>{status}</Notice>}

          <section className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <AdminStat label="Pending approvals" value={requests.length} />
            <AdminStat label="Brands" value={brands.length} />
            <AdminStat label="Users" value={users.length} />
            <AdminStat label="Plans" value={activePlans.length} />
          </section>

          <Panel title="Pending Client Approvals">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-3 pr-4">Company</th>
                    <th className="py-3 pr-4">Contact</th>
                    <th className="py-3 pr-4">Account</th>
                    <th className="py-3 pr-4">Plan</th>
                    <th className="py-3 pr-4">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map((request) => (
                    <tr key={request.request_id} className="border-b last:border-0">
                      <td className="py-3 pr-4 font-semibold">{request.company_name}</td>
                      <td className="py-3 pr-4 text-muted-foreground">{request.email}</td>
                      <td className="py-3 pr-4">
                        <AccountTypeSelect
                          value={selectedAccountTypes[request.request_id] ?? request.requested_account_type}
                          onChange={(value) => setSelectedAccountTypes((current) => ({ ...current, [request.request_id]: value }))}
                        />
                      </td>
                      <td className="py-3 pr-4">
                        <PlanSelect
                          plans={activePlans}
                          value={selectedPlans[request.request_id] ?? normalizePlan(request.requested_plan) ?? "starter"}
                          onChange={(value) => setSelectedPlans((current) => ({ ...current, [request.request_id]: value }))}
                        />
                      </td>
                      <td className="py-3 pr-4">
                        <div className="flex gap-2">
                          <IconButton label="Approve" onClick={() => approveMutation.mutate(request)} icon={<Check className="size-4" />} />
                          <IconButton label="Reject" onClick={() => rejectMutation.mutate(request)} icon={<X className="size-4" />} />
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!requests.length && <EmptyRow colSpan={5} label="No pending signup requests." />}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel title="Brand Access">
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              {brands.map((brand) => (
                <div key={brand.brand_id} className="rounded-lg border p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-semibold">{brand.name}</p>
                      <p className="text-xs text-muted-foreground">{brand.slug}</p>
                    </div>
                    <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold capitalize">
                      {brand.account_type.replace(/_/g, " ")}
                    </span>
                  </div>
                  <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <AccountTypeSelect
                      value={selectedAccountTypes[brand.brand_id] ?? brand.account_type}
                      onChange={(value) => setSelectedAccountTypes((current) => ({ ...current, [brand.brand_id]: value }))}
                    />
                    <PlanSelect
                      plans={activePlans}
                      value={selectedPlans[brand.brand_id] ?? normalizePlan(brand.plan) ?? "starter"}
                      onChange={(value) => setSelectedPlans((current) => ({ ...current, [brand.brand_id]: value }))}
                    />
                  </div>
                  <p className="mt-3 text-xs text-muted-foreground">
                    Enabled tools: {brand.enabled_tools.length ? brand.enabled_tools.join(", ") : "none"}
                  </p>
                  <button
                    onClick={() => accessMutation.mutate(brand)}
                    className="mt-4 inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground"
                  >
                    <ShieldCheck className="size-4" />
                    Save access
                  </button>
                </div>
              ))}
            </div>
          </Panel>

          <section className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <Panel title="Users">
              <div className="space-y-3">
                {users.slice(0, 12).map((user) => (
                  <div key={user.user_id} className="flex items-center justify-between gap-4 rounded-lg border p-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{user.email}</p>
                      <p className="text-xs text-muted-foreground capitalize">{user.status}</p>
                    </div>
                    <div className="flex gap-2">
                      <IconButton label="Activate" onClick={() => void activateUser(user.user_id).then(invalidateAdmin)} icon={<UserCheck className="size-4" />} />
                      <IconButton label="Suspend" onClick={() => void import("@/lib/api").then(({ suspendUser }) => suspendUser(user.user_id)).then(invalidateAdmin)} icon={<UserX className="size-4" />} />
                    </div>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel title="Audit Trail">
              <div className="space-y-3">
                {auditLogs.slice(0, 12).map((log) => (
                  <div key={log.audit_id} className="rounded-lg border p-3">
                    <p className="text-sm font-semibold">{log.action}</p>
                    <p className="text-xs text-muted-foreground">
                      {log.resource_type} {log.brand_id ? `Brand ${log.brand_id}` : ""}
                    </p>
                  </div>
                ))}
                {!auditLogs.length && <p className="text-sm text-muted-foreground">No audit events returned.</p>}
              </div>
            </Panel>
          </section>
        </main>
      </div>
    </div>
  );
}

function normalizePlan(value: string | null | undefined): PlanId | null {
  return value === "starter" || value === "growth" || value === "enterprise" ? value : null;
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg bg-card p-5 shadow-sm">
      <h2 className="mb-4 text-lg font-bold">{title}</h2>
      {children}
    </section>
  );
}

function AdminStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-card p-5 shadow-sm">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-2 text-3xl font-bold">{value}</p>
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border bg-card p-4 text-sm font-medium">{children}</div>;
}

function PlanSelect({
  plans,
  value,
  onChange,
}: {
  plans: { id: PlanId; name: string }[];
  value: PlanId;
  onChange: (value: PlanId) => void;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value as PlanId)}
      className="w-full rounded-md border bg-background px-3 py-2 text-sm"
    >
      {(plans.length ? plans : [{ id: "starter" as const, name: "Starter" }]).map((plan) => (
        <option key={plan.id} value={plan.id}>{plan.name}</option>
      ))}
    </select>
  );
}

function AccountTypeSelect({
  value,
  onChange,
}: {
  value: AccountType;
  onChange: (value: AccountType) => void;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value as AccountType)}
      className="w-full rounded-md border bg-background px-3 py-2 text-sm"
    >
      <option value="b2b_licensed">B2B licensed</option>
      <option value="b2c_managed">B2C managed</option>
      <option value="internal">Internal</option>
    </select>
  );
}

function IconButton({ label, icon, onClick }: { label: string; icon: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="inline-flex size-9 items-center justify-center rounded-md border bg-background hover:bg-muted"
    >
      {icon}
    </button>
  );
}

function EmptyRow({ colSpan, label }: { colSpan: number; label: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="py-6 text-center text-sm text-muted-foreground">{label}</td>
    </tr>
  );
}
