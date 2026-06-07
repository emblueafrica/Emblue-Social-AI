"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, PlugZap } from "lucide-react";
import { DashHeader, Sidebar } from "@/components/dashboard/Sidebar";
import { useAuth } from "@/hooks/use-auth";
import { env } from "@/lib/env";
import { getConnections, getToolAccess } from "@/lib/api";
import { isB2CClient } from "@/lib/access";

const platforms = [
  { id: "meta", label: "Meta", connectPath: "/api/v1/auth/meta/connect" },
  { id: "x", label: "X", connectPath: "/api/v1/auth/x/connect" },
  { id: "tiktok", label: "TikTok", connectPath: "/api/v1/auth/tiktok/connect" },
];

export default function SettingsPage() {
  const router = useRouter();
  const { activeBrandId, authContext } = useAuth();
  const connectionsQuery = useQuery({
    queryKey: ["connections", activeBrandId],
    queryFn: () => getConnections(activeBrandId!),
    enabled: Boolean(activeBrandId),
    retry: false,
  });
  const accessQuery = useQuery({
    queryKey: ["tool-access", activeBrandId],
    queryFn: getToolAccess,
    enabled: Boolean(activeBrandId),
    retry: false,
  });

  useEffect(() => {
    if (isB2CClient(authContext)) router.replace("/client-portal/settings");
  }, [authContext, router]);

  if (isB2CClient(authContext)) return null;

  return (
    <div className="min-h-screen flex bg-muted/30">
      <Sidebar activeLabel="Settings" />
      <div className="flex-1 flex flex-col min-w-0">
        <DashHeader title="Settings" />
        <main className="flex-1 p-6 md:p-10 space-y-6">
          <section className="rounded-lg bg-card p-6 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Workspace</p>
            <h2 className="mt-2 text-2xl font-bold">{authContext?.active_brand?.name ?? "Account settings"}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {authContext?.active_brand?.account_type?.replace(/_/g, " ") ?? authContext?.platform_role ?? "Authenticated account"}
            </p>
          </section>

          <section className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <Panel title="Platform Connections">
              <div className="space-y-3">
                {platforms.map((platform) => {
                  const connection = connectionsQuery.data?.connections.find((item) => item.platform === platform.id || (platform.id === "meta" && item.platform === "facebook"));
                  const connected = Boolean(connection?.is_active);
                  const url = activeBrandId && env.apiUrl
                    ? `${env.apiUrl}${platform.connectPath}?brand_id=${activeBrandId}`
                    : "#";
                  return (
                    <div key={platform.id} className="flex items-center justify-between gap-4 rounded-lg border p-4">
                      <div className="flex items-center gap-3">
                        <div className="rounded-md bg-muted p-2 text-primary"><PlugZap className="size-5" /></div>
                        <div>
                          <p className="font-semibold">{platform.label}</p>
                          <p className="text-xs text-muted-foreground">
                            {connected ? connection?.account_handle ?? "Connected" : "Not connected"}
                          </p>
                        </div>
                      </div>
                      <a
                        href={url}
                        className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold hover:bg-muted"
                      >
                        <ExternalLink className="size-4" />
                        {connected ? "Reconnect" : "Connect"}
                      </a>
                    </div>
                  );
                })}
              </div>
            </Panel>

            <Panel title="Subscription Access">
              <p className="text-sm text-muted-foreground">
                Plan: <span className="font-semibold text-foreground">{accessQuery.data?.plan ?? "Not assigned"}</span>
              </p>
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
                {(accessQuery.data?.tools ?? []).map((tool) => (
                  <div key={tool.id} className="rounded-md border p-3 text-sm">
                    <p className="font-semibold">{tool.name}</p>
                    <p className={tool.enabled ? "text-success" : "text-muted-foreground"}>
                      {tool.enabled ? "Enabled" : "Locked"}
                    </p>
                  </div>
                ))}
              </div>
            </Panel>
          </section>
        </main>
      </div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg bg-card p-5 shadow-sm">
      <h2 className="mb-4 text-lg font-bold">{title}</h2>
      {children}
    </section>
  );
}
