// src/utils/email.ts — Resend email utility
import { Resend } from "resend";
import { EmailPayload, KpiEmailData } from "../types";

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM   = process.env.EMAIL_FROM ?? "Social Emblue AI <reports@socilemblue.ai>";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function sendEmail(payload: EmailPayload): Promise<boolean> {
  if (!process.env.RESEND_API_KEY) {
    console.warn("[Email] No RESEND_API_KEY — email skipped");
    return false;
  }
  try {
    await resend.emails.send({ from: FROM, to: payload.to, subject: payload.subject, html: payload.html, text: payload.text });
    return true;
  } catch (err) {
    console.error("[Email] Send error:", (err as Error).message);
    return false;
  }
}

export async function sendWeeklyKpiReport(
  to: string, brandName: string, data: KpiEmailData
): Promise<boolean> {
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
      <div style="background:#0D1547;padding:24px;border-radius:8px 8px 0 0">
        <h1 style="color:#fff;margin:0;font-size:22px">Social Emblue AI</h1>
        <p style="color:rgba(255,255,255,.6);margin:4px 0 0">Weekly Performance Report — ${brandName}</p>
      </div>
      <div style="background:#fff;padding:24px;border:1px solid #E2E8F0">
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:24px">
          <div style="background:#F8FAFC;border-radius:8px;padding:16px;text-align:center;border-left:4px solid #2563EB">
            <div style="font-size:28px;font-weight:800;color:#1E293B">${data.listening ?? 0}</div>
            <div style="font-size:11px;color:#6B7280;text-transform:uppercase;letter-spacing:.5px">Listening Score</div>
          </div>
          <div style="background:#F8FAFC;border-radius:8px;padding:16px;text-align:center;border-left:4px solid #16A34A">
            <div style="font-size:28px;font-weight:800;color:#1E293B">${data.reply ?? 0}</div>
            <div style="font-size:11px;color:#6B7280;text-transform:uppercase;letter-spacing:.5px">Reply Score</div>
          </div>
          <div style="background:#F8FAFC;border-radius:8px;padding:16px;text-align:center;border-left:4px solid #EC4899">
            <div style="font-size:28px;font-weight:800;color:#1E293B">${data.funnel ?? 0}</div>
            <div style="font-size:11px;color:#6B7280;text-transform:uppercase;letter-spacing:.5px">Funnel Score</div>
          </div>
        </div>
        ${data.alerts?.length ? `<div style="background:#FEF3C7;border:1px solid #D97706;border-radius:8px;padding:16px;margin-bottom:20px"><strong style="color:#92400E">⚠️ Alerts this week:</strong><ul style="margin:8px 0 0;color:#92400E">${data.alerts.map(a => `<li>${a}</li>`).join("")}</ul></div>` : ""}
        ${data.top_clusters?.length ? `<div><strong style="color:#1E293B">Top Topics:</strong><ul style="margin:8px 0 0">${data.top_clusters.slice(0,3).map(c => `<li style="color:#475569">${c.label} <span style="color:#2563EB;font-weight:600">${c.opportunity_score}/100</span></li>`).join("")}</ul></div>` : ""}
      </div>
      <div style="background:#F8FAFC;padding:16px;border-radius:0 0 8px 8px;text-align:center;border:1px solid #E2E8F0;border-top:none">
        <p style="color:#9CA3AF;font-size:12px;margin:0">Social Emblue AI · Automated Weekly Report</p>
      </div>
    </div>`;

  return sendEmail({ to, subject: `📊 Weekly Report — ${brandName}`, html });
}

export async function sendCrisisAlert(
  to: string, brandName: string, alert: string, severity: string
): Promise<boolean> {
  const colors: Record<string, string> = { critical: "#DC2626", high: "#D97706", medium: "#2563EB" };
  const color = colors[severity] ?? "#2563EB";

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
      <div style="background:${color};padding:20px;border-radius:8px 8px 0 0">
        <h2 style="color:#fff;margin:0">🚨 Crisis Alert — ${brandName}</h2>
      </div>
      <div style="background:#fff;padding:24px;border:1px solid #E2E8F0">
        <p style="font-size:16px;color:#1E293B">${alert}</p>
        <p style="color:#6B7280;font-size:13px">Log in to Social Emblue AI to view the War Room dashboard and take action.</p>
      </div>
    </div>`;

  return sendEmail({ to, subject: `🚨 [${severity.toUpperCase()}] Brand Alert — ${brandName}`, html });
}
export async function sendSignupApprovedEmail(to: string, brandName: string): Promise<boolean> {
  const safeBrandName = escapeHtml(brandName);
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
      <h2>Your Social Emblue AI workspace is ready</h2>
      <p>Your ${safeBrandName} workspace has been approved. You can now sign in and use the tools included in your plan.</p>
    </div>`;

  return sendEmail({ to, subject: 'Your Social Emblue AI workspace is ready', html });
}

export async function sendSignupRejectedEmail(to: string, reason: string): Promise<boolean> {
  const safeReason = escapeHtml(reason);
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
      <h2>Social Emblue AI registration update</h2>
      <p>Your registration request was not approved.</p>
      <p><strong>Reason:</strong> ${safeReason}</p>
    </div>`;

  return sendEmail({ to, subject: 'Social Emblue AI registration update', html });
}

export async function sendPlatformAdminCreatedEmail(to: string, temporaryPassword?: string): Promise<boolean> {
  const safePassword = temporaryPassword ? escapeHtml(temporaryPassword) : '';
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
      <h2>Social Emblue AI admin access</h2>
      <p>You have been granted platform admin access.</p>
      ${temporaryPassword ? `<p>Temporary password: <strong>${safePassword}</strong></p>` : ''}
      <p>Sign in and change your password immediately if a temporary password was provided.</p>
    </div>`;

  return sendEmail({ to, subject: 'Social Emblue AI admin access', html });
}

export async function sendTeamInviteEmail(to: string, brandName: string, inviteUrl: string): Promise<boolean> {
  const safeBrandName = escapeHtml(brandName);
  const safeInviteUrl = escapeHtml(inviteUrl);
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
      <h2>You have been invited to ${safeBrandName}</h2>
      <p>Create or sign in to your Social Emblue AI account, then accept the invitation below.</p>
      <p><a href="${safeInviteUrl}">Accept invitation</a></p>
    </div>`;

  return sendEmail({ to, subject: `Invitation to ${brandName} on Social Emblue AI`, html });
}
