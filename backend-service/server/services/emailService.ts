import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
dotenv.config();

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// Verify connection on startup
transporter.verify().then(() => {
  console.log('[Email] SMTP connection verified ✅');
}).catch((err) => {
  console.warn('[Email] SMTP connection failed:', err.message);
});

/**
 * Generate a random 6-digit OTP
 */
export const generateOTP = (): string => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

/**
 * Send OTP email for signup verification
 */
export const sendSignupOTP = async (email: string, otp: string) => {
  const mailOptions = {
    from: process.env.SMTP_FROM || 'OTax Platform <otax.tech@gmail.com>',
    to: email,
    subject: '🔐 OTax — Verify Your Email',
    html: `
      <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 32px; background: #f8fafc; border-radius: 16px;">
        <div style="text-align: center; margin-bottom: 24px;">
          <div style="background: #1e40af; display: inline-block; padding: 12px 20px; border-radius: 12px;">
            <span style="color: white; font-size: 22px; font-weight: bold;">OTax</span>
          </div>
        </div>
        <div style="background: white; padding: 32px; border-radius: 12px; border: 1px solid #e2e8f0;">
          <h2 style="color: #1e293b; margin: 0 0 8px;">Verify Your Email</h2>
          <p style="color: #64748b; font-size: 14px; margin: 0 0 24px;">Enter this code to complete your registration:</p>
          <div style="background: #f1f5f9; padding: 16px; border-radius: 8px; text-align: center; margin-bottom: 24px;">
            <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #1e40af;">${otp}</span>
          </div>
          <p style="color: #94a3b8; font-size: 12px; margin: 0;">This code expires in <strong>10 minutes</strong>. Do not share it with anyone.</p>
        </div>
        <p style="text-align: center; color: #94a3b8; font-size: 11px; margin-top: 16px;">© ${new Date().getFullYear()} OTax Platform</p>
      </div>
    `,
  };
  return transporter.sendMail(mailOptions);
};

/**
 * Send OTP email for password reset
 */
export const sendPasswordResetOTP = async (email: string, otp: string) => {
  const mailOptions = {
    from: process.env.SMTP_FROM || 'OTax Platform <otax.tech@gmail.com>',
    to: email,
    subject: '🔑 OTax — Reset Your Password',
    html: `
      <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 32px; background: #f8fafc; border-radius: 16px;">
        <div style="text-align: center; margin-bottom: 24px;">
          <div style="background: #1e40af; display: inline-block; padding: 12px 20px; border-radius: 12px;">
            <span style="color: white; font-size: 22px; font-weight: bold;">OTax</span>
          </div>
        </div>
        <div style="background: white; padding: 32px; border-radius: 12px; border: 1px solid #e2e8f0;">
          <h2 style="color: #1e293b; margin: 0 0 8px;">Password Reset</h2>
          <p style="color: #64748b; font-size: 14px; margin: 0 0 24px;">Use this code to reset your password:</p>
          <div style="background: #f1f5f9; padding: 16px; border-radius: 8px; text-align: center; margin-bottom: 24px;">
            <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #1e40af;">${otp}</span>
          </div>
          <p style="color: #94a3b8; font-size: 12px; margin: 0;">This code expires in <strong>10 minutes</strong>. If you didn't request this, ignore this email.</p>
        </div>
        <p style="text-align: center; color: #94a3b8; font-size: 11px; margin-top: 16px;">© ${new Date().getFullYear()} OTax Platform</p>
      </div>
    `,
  };
  return transporter.sendMail(mailOptions);
};

/**
 * Send invitation email to join an organization
 */
export const sendInvitationEmail = async (email: string, orgName: string, roleName: string, inviteToken: string) => {
  const baseUrl = process.env.FRONTEND_URL || 'https://otax.onrender.com';
  const inviteLink = `${baseUrl}/invite/${inviteToken}`;

  const mailOptions = {
    from: process.env.SMTP_FROM || 'OTax Platform <otax.tech@gmail.com>',
    to: email,
    subject: `📩 You're invited to join ${orgName} on OTax`,
    html: `
      <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 32px; background: #f8fafc; border-radius: 16px;">
        <div style="text-align: center; margin-bottom: 24px;">
          <div style="background: #1e40af; display: inline-block; padding: 12px 20px; border-radius: 12px;">
            <span style="color: white; font-size: 22px; font-weight: bold;">OTax</span>
          </div>
        </div>
        <div style="background: white; padding: 32px; border-radius: 12px; border: 1px solid #e2e8f0;">
          <h2 style="color: #1e293b; margin: 0 0 8px;">You're Invited!</h2>
          <p style="color: #64748b; font-size: 14px; margin: 0 0 16px;">
            You've been invited to join <strong>${orgName}</strong> as <strong>${roleName}</strong>.
          </p>
          <a href="${inviteLink}" style="display: block; background: #1e40af; color: white; text-align: center; padding: 14px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 15px; margin-bottom: 16px;">
            Accept Invitation →
          </a>
          <p style="color: #94a3b8; font-size: 12px; margin: 0;">This invitation expires in <strong>7 days</strong>.</p>
        </div>
        <p style="text-align: center; color: #94a3b8; font-size: 11px; margin-top: 16px;">© ${new Date().getFullYear()} OTax Platform</p>
      </div>
    `,
  };
  return transporter.sendMail(mailOptions);
};

// ═══════════════════════════════════════════════════════════════════════
// Operational notification templates — used by the notifications worker
// and event hooks (autoSync failure, rejected invoices, late submissions).
// All of them return a Promise, so callers can `.catch()` to avoid
// crashing the caller on SMTP hiccups.
// ═══════════════════════════════════════════════════════════════════════

/** Base template — shared header/footer so all notification mails look
 *  consistent. CTA button intentionally omitted: customers asked for emails
 *  without "Open X →" buttons — every alert email already carries the data
 *  the recipient needs inline (or as an XLSX attachment). The
 *  `ctaHref` / `ctaLabel` params remain in the signature so existing callers
 *  don't need to change, but they're never rendered. */
const notifTemplate = (title: string, intro: string, body: string, _ctaHref?: string, _ctaLabel?: string, accent: string = '#1e40af') => `
  <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 32px; background: #f8fafc; border-radius: 16px;">
    <div style="text-align: center; margin-bottom: 24px;">
      <div style="background: ${accent}; display: inline-block; padding: 12px 20px; border-radius: 12px;">
        <span style="color: white; font-size: 22px; font-weight: bold;">OTax</span>
      </div>
    </div>
    <div style="background: white; padding: 32px; border-radius: 12px; border: 1px solid #e2e8f0;">
      <h2 style="color: #1e293b; margin: 0 0 8px;">${title}</h2>
      <p style="color: #64748b; font-size: 14px; margin: 0 0 20px;">${intro}</p>
      ${body}
    </div>
    <p style="text-align: center; color: #94a3b8; font-size: 11px; margin-top: 16px;">© ${new Date().getFullYear()} OTax Platform</p>
  </div>
`;

/** Sent when the auto-sync scheduler fails to fire a run (e.g. ETA down, creds expired). */
export const sendSyncFailureEmail = async (
  email: string,
  orgName: string,
  errorMessage: string,
  syncMode: string
) => {
  const baseUrl = process.env.FRONTEND_URL || 'https://otax.onrender.com';
  const body = `
    <div style="background: #fef2f2; border: 1px solid #fecaca; padding: 14px 16px; border-radius: 10px; margin-bottom: 16px;">
      <div style="font-weight: bold; color: #991b1b; margin-bottom: 6px;">⚠️ Auto-Sync Failed</div>
      <div style="color: #7f1d1d; font-size: 13px; font-family: monospace; word-break: break-word;">${errorMessage}</div>
    </div>
    <p style="color: #475569; font-size: 13px; line-height: 1.6;">
      Organization: <strong>${orgName}</strong><br>
      Mode: <strong>${syncMode}</strong><br>
      Time: <strong>${new Date().toLocaleString()}</strong>
    </p>
    <p style="color: #64748b; font-size: 13px;">Typical causes: expired ETA credentials, ETA portal downtime, or network outage. The next scheduled run will retry automatically.</p>
  `;
  return transporter.sendMail({
    from: process.env.SMTP_FROM || 'OTax Platform <otax.tech@gmail.com>',
    to: email,
    subject: `⚠️ Auto-Sync Failed — ${orgName}`,
    html: notifTemplate('Auto-Sync Failure', `Your scheduled ETA sync did not complete successfully.`, body, `${baseUrl}/settings/autosync`, 'Open Auto Sync', '#dc2626'),
  });
};

/**
 * Daily digest email — sent by the notifications worker when a user has
 * new rejected invoices or late submissions in the last 24 hours.
 */
export const sendDailyDigestEmail = async (
  email: string,
  orgName: string,
  stats: {
    rejectedCount: number;
    rejectedTotal: number;
    lateCount: number;
    lateTotal: number;
    newValidCount: number;
    newValidTotal: number;
  }
) => {
  const baseUrl = process.env.FRONTEND_URL || 'https://otax.onrender.com';
  const fmt = (n: number) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const card = (title: string, value: string, subtitle: string, color: string) => `
    <div style="background: ${color}15; border: 1px solid ${color}40; padding: 14px; border-radius: 10px; text-align: center; min-width: 140px;">
      <div style="color: ${color}; font-size: 11px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px;">${title}</div>
      <div style="color: #1e293b; font-size: 24px; font-weight: 900; margin: 6px 0 2px;">${value}</div>
      <div style="color: #64748b; font-size: 11px;">${subtitle}</div>
    </div>
  `;
  const body = `
    <div style="display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 20px;">
      ${card('New Valid', String(stats.newValidCount), `${fmt(stats.newValidTotal)} EGP`, '#059669')}
      ${card('Rejected', String(stats.rejectedCount), `${fmt(stats.rejectedTotal)} EGP`, '#dc2626')}
      ${card('Late (>48h)', String(stats.lateCount), `${fmt(stats.lateTotal)} EGP`, '#ea580c')}
    </div>
    <p style="color: #475569; font-size: 13px; line-height: 1.6;">
      ${stats.rejectedCount > 0 ? `<strong>${stats.rejectedCount}</strong> invoice(s) were rejected by ETA. ` : ''}
      ${stats.lateCount > 0 ? `<strong>${stats.lateCount}</strong> invoice(s) were submitted more than 48 hours after issuance. ` : ''}
    </p>
  `;
  return transporter.sendMail({
    from: process.env.SMTP_FROM || 'OTax Platform <otax.tech@gmail.com>',
    to: email,
    subject: `📊 OTax Daily Digest — ${orgName}`,
    html: notifTemplate(`Daily Digest — ${orgName}`, `Here's what happened in the last 24 hours.`, body, `${baseUrl}/dashboard`, 'Open Dashboard', '#1e40af'),
  });
};

/**
 * VAT filing reminder — fires at the start of each month for the previous month's
 * net VAT payable. Configurable via org settings (notify_vat_filing).
 */
export const sendVatFilingReminder = async (
  email: string,
  orgName: string,
  month: string,
  netPayable: number,
  outputVat: number,
  inputVat: number
) => {
  const baseUrl = process.env.FRONTEND_URL || 'https://otax.onrender.com';
  const fmt = (n: number) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const payableColor = netPayable >= 0 ? '#dc2626' : '#059669';
  const body = `
    <div style="background: #eff6ff; border: 1px solid #bfdbfe; padding: 18px; border-radius: 10px; text-align: center; margin-bottom: 16px;">
      <div style="font-size: 11px; font-weight: bold; color: #1e40af; text-transform: uppercase;">${month} — Net VAT Payable</div>
      <div style="font-size: 34px; font-weight: 900; color: ${payableColor}; margin: 8px 0;">${fmt(Math.abs(netPayable))} EGP</div>
      <div style="font-size: 12px; color: #64748b;">${netPayable >= 0 ? 'Amount owed to ETA' : 'Amount refundable'}</div>
    </div>
    <table style="width: 100%; font-size: 13px; color: #475569; border-collapse: collapse;">
      <tr><td style="padding: 6px 0;">Output VAT (Sent)</td><td style="padding: 6px 0; text-align: right; font-family: monospace; font-weight: bold;">${fmt(outputVat)} EGP</td></tr>
      <tr><td style="padding: 6px 0;">Input VAT (Received)</td><td style="padding: 6px 0; text-align: right; font-family: monospace; font-weight: bold;">${fmt(inputVat)} EGP</td></tr>
      <tr><td style="padding: 6px 0; border-top: 1px solid #e2e8f0;"><strong>Net</strong></td><td style="padding: 6px 0; text-align: right; font-family: monospace; font-weight: bold; border-top: 1px solid #e2e8f0; color: ${payableColor};">${fmt(netPayable)} EGP</td></tr>
    </table>
    <p style="color: #64748b; font-size: 12px; margin-top: 16px;">Filing deadline is typically the <strong>last day of the following month</strong>. Consult your tax advisor.</p>
  `;
  return transporter.sendMail({
    from: process.env.SMTP_FROM || 'OTax Platform <otax.tech@gmail.com>',
    to: email,
    subject: `📅 VAT Filing Reminder — ${month}`,
    html: notifTemplate('VAT Filing Reminder', `Your ${month} VAT summary is ready for review.`, body, `${baseUrl}/reports`, 'Open VAT Summary', '#1e40af'),
  });
};

/**
 * Verify SMTP transport (used by the "Test SMTP" button in Settings).
 * Returns { ok: true } when the handshake succeeds, otherwise { ok: false, message }.
 */
export const verifySmtp = async (): Promise<{ ok: boolean; message?: string }> => {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    return { ok: false, message: 'SMTP_USER / SMTP_PASS not configured in environment' };
  }
  try {
    await transporter.verify();
    return { ok: true };
  } catch (err: any) {
    return { ok: false, message: err.message || 'SMTP handshake failed' };
  }
};

/**
 * Send a one-shot test email to confirm the user's SMTP setup works end-to-end.
 * Triggered from Settings → Notifications → "Test SMTP".
 */
export const sendTestEmail = async (email: string, orgName: string = 'OTax') => {
  return transporter.sendMail({
    from: process.env.SMTP_FROM || 'OTax Platform <otax.tech@gmail.com>',
    to: email,
    subject: '✅ OTax — Test Email',
    html: notifTemplate(
      'SMTP Test Successful',
      `If you're seeing this, your email notifications are wired up correctly for <strong>${orgName}</strong>.`,
      `<p style="color:#475569;font-size:13px;line-height:1.6;">Sent at <strong>${new Date().toLocaleString()}</strong>. You can now safely enable the Daily Digest, VAT reminders, and auto-sync failure alerts.</p>`,
      undefined,
      undefined,
      '#059669'
    ),
  });
};

/**
 * Send a scheduled report email — supports an optional XLSX attachment for
 * the bulk reports (Invalid invoices, VAT pack, late submissions, etc.).
 *
 * Caller builds the HTML body + XLSX buffer; this just wires it into
 * nodemailer. Returns whatever `transporter.sendMail` returns so failures
 * surface to the worker for the audit log.
 */
export const sendReportEmail = async (opts: {
  to: string;
  subject: string;
  html: string;
  attachment?: { filename: string; content: Buffer; contentType?: string };
}): Promise<any> => {
  const mailOptions: any = {
    from: process.env.SMTP_FROM || 'OTax Platform <otax.tech@gmail.com>',
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
  };
  if (opts.attachment) {
    mailOptions.attachments = [{
      filename:    opts.attachment.filename,
      content:     opts.attachment.content,
      contentType: opts.attachment.contentType || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }];
  }
  return transporter.sendMail(mailOptions);
};

/**
 * Send welcome email after successful signup
 */
export const sendWelcomeEmail = async (email: string, orgName: string) => {
  const mailOptions = {
    from: process.env.SMTP_FROM || 'OTax Platform <otax.tech@gmail.com>',
    to: email,
    subject: `🎉 Welcome to OTax — ${orgName} is ready!`,
    html: `
      <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 32px; background: #f8fafc; border-radius: 16px;">
        <div style="text-align: center; margin-bottom: 24px;">
          <div style="background: #1e40af; display: inline-block; padding: 12px 20px; border-radius: 12px;">
            <span style="color: white; font-size: 22px; font-weight: bold;">OTax</span>
          </div>
        </div>
        <div style="background: white; padding: 32px; border-radius: 12px; border: 1px solid #e2e8f0;">
          <h2 style="color: #1e293b; margin: 0 0 8px;">Welcome aboard! 🚀</h2>
          <p style="color: #64748b; font-size: 14px; margin: 0 0 16px;">
            Your organization <strong>${orgName}</strong> has been created successfully. You're now the Organization Admin.
          </p>
          <ul style="color: #475569; font-size: 14px; line-height: 2;">
            <li>Invite your team members</li>
            <li>Configure your ETA settings</li>
            <li>Start managing e-invoices</li>
          </ul>
        </div>
        <p style="text-align: center; color: #94a3b8; font-size: 11px; margin-top: 16px;">© ${new Date().getFullYear()} OTax Platform</p>
      </div>
    `,
  };
  return transporter.sendMail(mailOptions);
};
