import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import pg from 'pg';
import { generateToken, authenticate } from '../middleware/auth.js';
import {
    generateOTP,
    sendSignupOTP,
    sendPasswordResetOTP,
    sendInvitationEmail,
    sendWelcomeEmail,
} from '../services/emailService.js';
import { createOrgTables } from '../services/orgTables.js';

const router = Router();
const prisma = new PrismaClient();

// Helper: generate an 8-char alphanumeric join code
const generateJoinCode = (): string => {
    return crypto.randomBytes(4).toString('hex').toUpperCase(); // e.g. "A1B2C3D4"
};

// Helper: store OTP in DB
const storeOTP = async (email: string, code: string, type: string) => {
    // Invalidate old OTPs for this email+type
    await prisma.otpCode.updateMany({
        where: { email, type, used: false },
        data: { used: true },
    });
    // Create new OTP (10 min expiry)
    return prisma.otpCode.create({
        data: {
            email,
            code,
            type,
            expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        },
    });
};

// Helper: verify OTP from DB
const verifyOTP = async (email: string, code: string, type: string): Promise<boolean> => {
    const otp = await prisma.otpCode.findFirst({
        where: {
            email,
            code,
            type,
            used: false,
            expiresAt: { gt: new Date() },
        },
        orderBy: { createdAt: 'desc' },
    });
    if (!otp) return false;
    await prisma.otpCode.update({ where: { id: otp.id }, data: { used: true } });
    return true;
};

// ─────────────────────────────────────────────────────────────
// POST /signup — Step 1: Register + send OTP
// ─────────────────────────────────────────────────────────────
router.post('/signup', async (req: Request, res: Response) => {
    try {
        const { email, password, name, orgName, taxId, companyType, country, city, plan } = req.body;

        if (!email || !password || !orgName || !taxId) {
            return res.status(400).json({ success: false, message: 'Email, password, organization name, and tax ID are required' });
        }

        // Check if email already exists in portal_users only (new users table)
        const existingPortal = await prisma.portalUser.findFirst({
            where: { email },
        });
        if (existingPortal) {
            return res.status(409).json({ success: false, message: 'An account with this email already exists' });
        }

        // Check if tax ID already exists in portal-linked orgs only
        const existingOrg = await prisma.organizations.findFirst({
            where: {
                tax_id: taxId,
                portalUsers: { some: {} },  // Only orgs that have portal users
            },
        });
        if (existingOrg) {
            return res.status(409).json({ success: false, message: 'An organization with this Tax ID already exists' });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Store pending signup data in a temporary way (we don't create the user yet, just send OTP)
        // We store the data encrypted in the OTP details field — or we can use a simpler approach:
        // Create the user as unverified, then verify on OTP confirmation

        // Create or reuse organization (may exist from legacy data)
        const joinCode = generateJoinCode();
        const org = await prisma.organizations.upsert({
            where: { tax_id: taxId },
            update: {
                name: orgName,
                company_type: companyType || 'B',
                org_join_code: joinCode,
                country: country || 'Egypt',
                city: city || null,
                email: email,
                subscription_plan: plan || 'free',
                is_active: true,
            },
            create: {
                name: orgName,
                tax_id: taxId,
                company_type: companyType || 'B',
                org_join_code: joinCode,
                country: country || 'Egypt',
                city: city || null,
                email: email,
                subscription_plan: plan || 'free',
                is_active: true,
            },
        });

        // Create subscription (only if one doesn't already exist for this org)
        const planLimits: Record<string, { max_users: number; max_invoices: number; max_storage: number; price: number }> = {
            free: { max_users: 3, max_invoices: 50, max_storage: 1, price: 0 },
            starter: { max_users: 5, max_invoices: 200, max_storage: 5, price: 29 },
            professional: { max_users: 15, max_invoices: 1000, max_storage: 25, price: 79 },
            enterprise: { max_users: 999, max_invoices: 99999, max_storage: 100, price: 199 },
        };
        const limits = planLimits[plan] || planLimits.free;

        const existingSub = await prisma.organization_subscriptions.findFirst({
            where: { organization_id: org.id, status: 'active' },
        });

        if (!existingSub) {
            await prisma.organization_subscriptions.create({
                data: {
                    organization_id: org.id,
                    plan: plan || 'free',
                    status: 'active',
                    max_users: limits.max_users,
                    max_invoices_per_month: limits.max_invoices,
                    max_storage_gb: limits.max_storage,
                    price_per_month: limits.price,
                },
            });
        }

        // Create user in portal_users (NEW table, separate from legacy credentials)
        const user = await prisma.portalUser.create({
            data: {
                email,
                username: name || email.split('@')[0],
                full_name: name || null,
                password: hashedPassword,
                is_active: true,
                email_verified: false,
                organization_id: org.id,
            },
        });

        // Assign org_admin role
        const orgAdminRole = await prisma.role.findFirst({ where: { name: 'org_admin' } });
        if (orgAdminRole) {
            await prisma.portalUserRole.create({
                data: { userId: user.id, roleId: orgAdminRole.id, assignedBy: user.id },
            });
        }

        // Generate and send OTP
        const otp = generateOTP();
        await storeOTP(email, otp, 'signup_verify');
        await sendSignupOTP(email, otp);

        // Create org tables (documents, lines) in background
        // This ensures tables are ready before first login
        try {
            const pool: pg.Pool = (req as any).app.get('pool');
            if (pool) {
                await createOrgTables(pool, org.id, orgName);
                console.log(`[Signup] ✅ Org tables created for: ${orgName} (ID: ${org.id})`);
            }
        } catch (tableErr: any) {
            // Don't fail signup if table creation fails — can be retried later
            console.error(`[Signup] ⚠️ Org table creation deferred:`, tableErr.message);
        }

        // Create default organization_settings row
        try {
            await prisma.organization_settings.create({
                data: {
                    organization_id: org.id,
                    eta_environment: 'PreProd',
                    eta_sync_status: 'never',
                },
            });
        } catch (settingsErr: any) {
            console.warn(`[Signup] Settings row may already exist:`, settingsErr.message);
        }

        console.log(`[Signup] New signup: ${email}, org: ${orgName}, OTP sent`);

        res.json({
            success: true,
            message: 'Account created. Please verify your email with the OTP sent.',
            userId: Number(user.id),
            orgId: org.id,
            email,
        });
    } catch (err: any) {
        console.error('[Signup Error]', err);
        res.status(500).json({ success: false, message: err.message || 'Signup failed' });
    }
});

// ─────────────────────────────────────────────────────────────
// POST /verify-otp — Verify email with OTP code
// ─────────────────────────────────────────────────────────────
router.post('/verify-otp', async (req: Request, res: Response) => {
    try {
        const { email, code, type } = req.body;
        if (!email || !code) {
            return res.status(400).json({ success: false, message: 'Email and OTP code are required' });
        }

        const otpType = type || 'signup_verify';
        const valid = await verifyOTP(email, code, otpType);
        if (!valid) {
            return res.status(400).json({ success: false, message: 'Invalid or expired OTP code' });
        }

        if (otpType === 'signup_verify') {
            // Mark user as verified — check portal_users first, then legacy credentials
            let user = await prisma.portalUser.findFirst({ where: { email } });
            if (user) {
                await prisma.portalUser.update({
                    where: { id: user.id },
                    data: { email_verified: true },
                });

                // Get org name for welcome email
                if (user.organization_id) {
                    const org = await prisma.organizations.findUnique({ where: { id: user.organization_id } });
                    if (org) {
                        try { await sendWelcomeEmail(email, org.name); } catch (e) { console.warn('[Email] Welcome email failed'); }
                    }
                }

                // Generate token for auto-login
                const userId = Number(user.id);
                const token = generateToken(userId);

                // Get roles and permissions
                const userWithRoles = await prisma.portalUser.findFirst({
                    where: { id: user.id },
                    include: {
                        organizations: true,
                        portalUserRoles: { include: { role: { include: { rolePermissions: { include: { permission: true } } } } } },
                    },
                });

                const roles = userWithRoles?.portalUserRoles?.map(ur => ({
                    id: ur.role.id, name: ur.role.name, displayName: ur.role.displayName
                })) || [];
                // Per-user permission overrides (if present) replace the role-derived set.
                const overrideRows = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
                    `SELECT p.name FROM "otaxdb".portal_user_permissions pup
                       JOIN "otaxdb".permissions p ON p.id = pup.permission_id
                      WHERE pup.user_id = $1`,
                    user.id
                );
                const permissions = overrideRows.length > 0
                    ? overrideRows.map(r => r.name)
                    : (userWithRoles?.portalUserRoles?.flatMap(ur =>
                        ur.role.rolePermissions.map(rp => rp.permission.name)
                      ) || []);
                const isSuperAdmin = roles.some(r => r.name === 'super_admin');
                const isOrgAdmin = roles.some(r => r.name === 'org_admin');

                // Load settings from organization_settings for properties
                let properties: { property_name: string; property_value: string }[] = [];
                if (user.organization_id) {
                    try {
                        const orgSettings = await prisma.organization_settings.findUnique({
                            where: { organization_id: user.organization_id },
                        });
                        const org = await prisma.organizations.findUnique({ where: { id: user.organization_id } });

                        if (orgSettings) {
                            const fieldMap: Record<string, string> = {
                                'eta_environment': 'signer_environment_type',
                                'eta_preprod_client_id': 'signer_preProdClientId',
                                'eta_preprod_client_secret': 'signer_preProdClientSecret',
                                'eta_prod_client_id': 'signer_prodClientId',
                                'eta_prod_client_secret': 'signer_prodClientSecret',
                            };
                            for (const [dbCol, propName] of Object.entries(fieldMap)) {
                                const val = (orgSettings as any)[dbCol];
                                if (val) properties.push({ property_name: propName, property_value: val });
                            }
                        }
                        if (org) {
                            if (org.name) properties.push({ property_name: 'issuer_name', property_value: org.name });
                            if (org.tax_id) properties.push({ property_name: 'issuer_id', property_value: org.tax_id });
                            if (org.company_type) properties.push({ property_name: 'user_type', property_value: org.company_type });
                            if (org.country) properties.push({ property_name: 'issuer_country', property_value: org.country });
                            if (org.city) properties.push({ property_name: 'issuer_governorate', property_value: org.city });
                        }
                    } catch (propsErr: any) {
                        console.warn('[Auth] Could not load org properties:', propsErr.message);
                    }
                }

                return res.json({
                    success: true,
                    message: 'Email verified successfully!',
                    token,
                    user: {
                        id: userId,
                        username: userWithRoles?.username,
                        email: userWithRoles?.email,
                        isDemo: false,
                        isSuperAdmin,
                        isOrgAdmin,
                        roles,
                        permissions: [...new Set(permissions)],
                        properties,
                        organization: userWithRoles?.organizations ? {
                            id: userWithRoles.organizations.id,
                            name: userWithRoles.organizations.name,
                            tax_id: userWithRoles.organizations.tax_id,
                            org_join_code: (userWithRoles.organizations as any).org_join_code,
                            subscription_plan: userWithRoles.organizations.subscription_plan,
                        } : null,
                    },
                });
            }

            // Fallback: check legacy credentials table
            const legacyUser = await prisma.credential.findFirst({ where: { email } });
            if (legacyUser) {
                await prisma.credential.update({
                    where: { id: legacyUser.id },
                    data: { email_verified: true },
                });

                const userId = Number(legacyUser.id);
                const token = generateToken(userId);

                return res.json({
                    success: true,
                    message: 'Email verified successfully!',
                    token,
                    user: {
                        id: userId,
                        username: legacyUser.username,
                        email: legacyUser.email,
                        isDemo: false,
                        isSuperAdmin: false,
                        isOrgAdmin: true,
                        roles: [{ id: 0, name: 'org_admin', displayName: 'Admin' }],
                        permissions: [],
                        organization: null,
                    },
                });
            }
        }

        res.json({ success: true, message: 'OTP verified successfully' });
    } catch (err: any) {
        console.error('[Verify OTP Error]', err);
        res.status(500).json({ success: false, message: 'Verification failed' });
    }
});

// ─────────────────────────────────────────────────────────────
// POST /resend-otp — Resend OTP code
// ─────────────────────────────────────────────────────────────
router.post('/resend-otp', async (req: Request, res: Response) => {
    try {
        const { email, type } = req.body;
        if (!email) return res.status(400).json({ success: false, message: 'Email is required' });

        const otpType = type || 'signup_verify';
        const otp = generateOTP();
        await storeOTP(email, otp, otpType);

        if (otpType === 'signup_verify') {
            await sendSignupOTP(email, otp);
        } else {
            await sendPasswordResetOTP(email, otp);
        }

        res.json({ success: true, message: 'OTP resent to your email' });
    } catch (err: any) {
        console.error('[Resend OTP Error]', err);
        res.status(500).json({ success: false, message: 'Failed to resend OTP' });
    }
});

// ─────────────────────────────────────────────────────────────
// POST /forgot-password — Send password reset OTP
// ─────────────────────────────────────────────────────────────
router.post('/forgot-password', async (req: Request, res: Response) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ success: false, message: 'Email is required' });

        const user = await prisma.credential.findFirst({
            where: { OR: [{ email }, { username: email }] },
        });
        if (!user) {
            // Don't reveal if user exists
            return res.json({ success: true, message: 'If an account exists with this email, you will receive a reset code' });
        }

        const otp = generateOTP();
        const targetEmail = user.email || email;
        await storeOTP(targetEmail, otp, 'password_reset');
        await sendPasswordResetOTP(targetEmail, otp);

        console.log(`[Auth] Password reset OTP sent to ${targetEmail}`);
        res.json({ success: true, message: 'If an account exists with this email, you will receive a reset code' });
    } catch (err: any) {
        console.error('[Forgot Password Error]', err);
        res.status(500).json({ success: false, message: 'Failed to send reset code' });
    }
});

// ─────────────────────────────────────────────────────────────
// POST /reset-password — Verify OTP and set new password
// ─────────────────────────────────────────────────────────────
router.post('/reset-password', async (req: Request, res: Response) => {
    try {
        const { email, code, newPassword } = req.body;
        if (!email || !code || !newPassword) {
            return res.status(400).json({ success: false, message: 'Email, OTP code, and new password are required' });
        }

        const valid = await verifyOTP(email, code, 'password_reset');
        if (!valid) {
            return res.status(400).json({ success: false, message: 'Invalid or expired OTP code' });
        }

        const hashedPassword = await bcrypt.hash(newPassword, 10);
        await prisma.credential.updateMany({
            where: { OR: [{ email }, { username: email }] },
            data: { password: hashedPassword },
        });

        console.log(`[Auth] Password reset for ${email}`);
        res.json({ success: true, message: 'Password reset successfully. You can now log in.' });
    } catch (err: any) {
        console.error('[Reset Password Error]', err);
        res.status(500).json({ success: false, message: 'Password reset failed' });
    }
});

// ─────────────────────────────────────────────────────────────
// POST /join-org — Join existing organization by join code
// ─────────────────────────────────────────────────────────────
router.post('/join-org', async (req: Request, res: Response) => {
    try {
        const { joinCode, email, password, name } = req.body;
        if (!joinCode || !email || !password) {
            return res.status(400).json({ success: false, message: 'Organization code, email, and password are required' });
        }

        // Find organization by join code
        const org = await prisma.organizations.findFirst({
            where: { org_join_code: joinCode, is_active: true },
            include: { organization_subscriptions: { where: { status: 'active' }, orderBy: { created_at: 'desc' }, take: 1 } },
        });
        if (!org) {
            return res.status(404).json({ success: false, message: 'Invalid organization code or organization is inactive' });
        }

        // Check subscription user limit (count from BOTH tables)
        const legacyCount = await prisma.credential.count({ where: { organization_id: org.id } });
        let portalCount = 0;
        try { portalCount = await prisma.portalUser.count({ where: { organization_id: org.id } }); } catch (e) { }
        const currentUsers = legacyCount + portalCount;
        const maxUsers = org.organization_subscriptions[0]?.max_users || 999;
        if (currentUsers >= maxUsers) {
            return res.status(403).json({ success: false, message: 'Organization has reached its maximum user limit' });
        }

        // Check email doesn't already exist in portal_users
        const existingPortal = await prisma.portalUser.findFirst({ where: { email } });
        if (existingPortal) {
            return res.status(409).json({ success: false, message: 'An account with this email already exists' });
        }

        // Create user in portal_users (NEW table)
        const hashedPassword = await bcrypt.hash(password, 10);
        const user = await prisma.portalUser.create({
            data: {
                email,
                username: name || email.split('@')[0],
                full_name: name || null,
                password: hashedPassword,
                is_active: true,
                email_verified: false,
                organization_id: org.id,
            },
        });

        // Assign viewer role by default
        const viewerRole = await prisma.role.findFirst({ where: { name: 'viewer' } });
        if (viewerRole) {
            await prisma.portalUserRole.create({
                data: { userId: user.id, roleId: viewerRole.id },
            });
        }

        // Send OTP for email verification
        const otp = generateOTP();
        await storeOTP(email, otp, 'signup_verify');
        await sendSignupOTP(email, otp);

        console.log(`[Join Org] ${email} joined org "${org.name}" (code: ${joinCode})`);

        res.json({
            success: true,
            message: 'Account created. Please verify your email with the OTP sent.',
            email,
            orgName: org.name,
        });
    } catch (err: any) {
        console.error('[Join Org Error]', err);
        res.status(500).json({ success: false, message: err.message || 'Failed to join organization' });
    }
});

// ─────────────────────────────────────────────────────────────
// POST /invite — Org admin sends invitation (requires auth)
// ─────────────────────────────────────────────────────────────
router.post('/invite', authenticate, async (req: Request, res: Response) => {
    try {
        const { email, roleName, roleIds, permissionIds } = req.body as {
            email?: string;
            roleName?: string;
            roleIds?: number[];
            permissionIds?: number[];
        };
        if (!email) {
            return res.status(400).json({ success: false, message: 'Email is required' });
        }

        // Get the user's organization (check portalUser first, then legacy credentials)
        let currentUser: any = null;
        let isPortalUser = false;
        const portalUser = await prisma.portalUser.findUnique({ where: { id: BigInt((req as any).user.id) } });
        if (portalUser) {
            currentUser = portalUser;
            isPortalUser = true;
        } else {
            currentUser = await prisma.credential.findUnique({ where: { id: (req as any).user.id } });
        }
        if (!currentUser?.organization_id) {
            return res.status(400).json({ success: false, message: 'You are not part of an organization' });
        }
        const organizationId = currentUser.organization_id;

        const org = await prisma.organizations.findUnique({ where: { id: organizationId } });
        if (!org) return res.status(404).json({ success: false, message: 'Organization not found' });

        // Resolve role(s): prefer roleIds[] from the new UI; fall back to roleName for older clients.
        let resolvedRoles: { id: number; name: string; displayName: string }[] = [];
        if (Array.isArray(roleIds) && roleIds.length > 0) {
            const found = await prisma.role.findMany({ where: { id: { in: roleIds.map(Number).filter(Number.isFinite) } } });
            // Block org admins from granting super_admin via invitation
            resolvedRoles = found.filter(r => r.name !== 'super_admin');
        } else {
            const role = await prisma.role.findFirst({ where: { name: roleName || 'viewer' } });
            if (role && role.name !== 'super_admin') resolvedRoles = [role];
        }

        if (resolvedRoles.length === 0) {
            return res.status(400).json({ success: false, message: 'Please select at least one role' });
        }

        // Resolve permissionIds (custom permission subset). Only keep ones that actually belong to the
        // selected role(s) — defense against admins granting permissions outside the role's scope.
        let validatedPermissionIds: number[] = [];
        if (Array.isArray(permissionIds) && permissionIds.length > 0) {
            const rolePerms = await prisma.rolePermission.findMany({
                where: { roleId: { in: resolvedRoles.map(r => r.id) } },
                select: { permissionId: true },
            });
            const allowed = new Set(rolePerms.map(rp => rp.permissionId));
            validatedPermissionIds = permissionIds
                .map(Number)
                .filter(id => Number.isFinite(id) && allowed.has(id));
        }

        const primaryRole = resolvedRoles[0];
        const extraRoleIds = resolvedRoles.map(r => r.id);

        // Generate invitation token
        const token = crypto.randomBytes(32).toString('hex');

        // invited_by FK references credentials table — set null for portalUser to avoid FK violation
        const invitation = await prisma.organization_invitations.create({
            data: {
                organization_id: organizationId,
                email,
                role_id: primaryRole.id,
                role_name: primaryRole.name,
                token,
                status: 'pending',
                invited_by: isPortalUser ? null : Number(currentUser.id),
                expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
            } as any,
        });

        // role_ids + permission_ids aren't in the generated Prisma client (added via boot migration),
        // so write them via raw SQL. Otherwise Prisma silently drops them from the INSERT.
        await prisma.$executeRawUnsafe(
            `UPDATE "otaxdb".organization_invitations SET role_ids = $1, permission_ids = $2 WHERE id = $3`,
            JSON.stringify(extraRoleIds),
            validatedPermissionIds.length > 0 ? JSON.stringify(validatedPermissionIds) : null,
            invitation.id
        );

        // Friendlier subject line for the email when several roles are picked
        const emailRoleLabel = resolvedRoles.length === 1
            ? primaryRole.displayName
            : `${primaryRole.displayName} +${resolvedRoles.length - 1}`;

        // Email sending is best-effort — if SMTP fails, the invitation is still saved
        // so the admin can resend later (or copy the link manually). We surface the
        // failure clearly in the response so the UI can show an actionable message.
        let emailStatus: 'sent' | 'failed' = 'sent';
        let emailError: string | undefined;
        try {
            const info: any = await sendInvitationEmail(email, org.name, emailRoleLabel, token);
            console.log(`[Invite] ✉️  Email sent to ${email} (messageId=${info?.messageId || 'n/a'}) — invitation #${invitation.id}`);
        } catch (mailErr: any) {
            emailStatus = 'failed';
            emailError = mailErr?.message || 'Unknown SMTP error';
            console.error(`[Invite] ❌ Email send FAILED for ${email}: ${emailError}`);
        }

        console.log(`[Invite] ${email} invited to "${org.name}" as ${resolvedRoles.map(r => r.name).join(', ')}` +
            (validatedPermissionIds.length > 0 ? ` (custom: ${validatedPermissionIds.length} permissions)` : ''));

        res.json({
            success: true,
            message: emailStatus === 'sent'
                ? `Invitation sent to ${email}`
                : `Invitation saved but email failed to send: ${emailError}. The invitee can still join via the link.`,
            emailStatus,
            roles: resolvedRoles,
            customPermissions: validatedPermissionIds.length,
        });
    } catch (err: any) {
        console.error('[Invite Error]', err);
        res.status(500).json({ success: false, message: 'Failed to send invitation' });
    }
});

// ─────────────────────────────────────────────────────────────
// GET /invitations — List all invitations for my org
// ─────────────────────────────────────────────────────────────
router.get('/invitations', authenticate, async (req: Request, res: Response) => {
    try {
        let currentUser: any = await prisma.portalUser.findUnique({ where: { id: BigInt((req as any).user.id) } });
        if (!currentUser) {
            currentUser = await prisma.credential.findUnique({ where: { id: (req as any).user.id } });
        }
        if (!currentUser?.organization_id) {
            return res.json({ success: true, invitations: [] });
        }

        const invitations = await prisma.organization_invitations.findMany({
            where: { organization_id: currentUser.organization_id },
            orderBy: { created_at: 'desc' },
        });

        // role_ids isn't in the generated Prisma client — fetch separately via raw SQL
        const ids = invitations.map(i => i.id);
        const rawRows: Array<{ id: number; role_ids: string | null; permission_ids: string | null }> = ids.length > 0
            ? await prisma.$queryRawUnsafe(
                `SELECT id, role_ids, permission_ids FROM "otaxdb".organization_invitations WHERE id = ANY($1::int[])`,
                ids
            )
            : [];
        const extraById: Record<number, { role_ids: string | null; permission_ids: string | null }> = {};
        for (const row of rawRows) extraById[row.id] = { role_ids: row.role_ids, permission_ids: row.permission_ids };

        // Resolve any extra role IDs into names for the listing UI
        const allRoleIds = new Set<number>();
        for (const inv of invitations) {
            const raw = extraById[inv.id]?.role_ids;
            if (raw) {
                try {
                    const parsed = JSON.parse(raw);
                    if (Array.isArray(parsed)) parsed.map(Number).filter(Number.isFinite).forEach(id => allRoleIds.add(id));
                } catch { /* ignore */ }
            }
        }
        const rolesById: Record<number, { name: string; displayName: string }> = {};
        if (allRoleIds.size > 0) {
            const found = await prisma.role.findMany({ where: { id: { in: Array.from(allRoleIds) } } });
            for (const r of found) rolesById[r.id] = { name: r.name, displayName: r.displayName };
        }

        res.json({
            success: true,
            invitations: invitations.map(inv => {
                const raw = extraById[inv.id]?.role_ids;
                let extraNames: string[] = [];
                if (raw) {
                    try {
                        const parsed = JSON.parse(raw);
                        if (Array.isArray(parsed)) {
                            extraNames = parsed
                                .map(Number)
                                .filter(Number.isFinite)
                                .map(id => rolesById[id]?.displayName || rolesById[id]?.name)
                                .filter(Boolean) as string[];
                        }
                    } catch { /* ignore */ }
                }
                const customCount = (() => {
                    const r = extraById[inv.id]?.permission_ids;
                    if (!r) return 0;
                    try { const p = JSON.parse(r); return Array.isArray(p) ? p.length : 0; } catch { return 0; }
                })();
                return {
                    id: Number(inv.id),
                    email: inv.email,
                    role_name: extraNames.length > 0 ? extraNames.join(', ') : ((inv as any).role_name || 'viewer'),
                    custom_permissions: customCount,
                    status: inv.status,
                    expires_at: inv.expires_at,
                    created_at: inv.created_at,
                };
            }),
        });
    } catch (err: any) {
        console.error('[Get Invitations Error]', err);
        res.status(500).json({ success: false, message: 'Failed to load invitations' });
    }
});

// ─────────────────────────────────────────────────────────────
// GET /invite/:token — Get invitation details
// ─────────────────────────────────────────────────────────────
router.get('/invite/:token', async (req: Request, res: Response) => {
    try {
        const { token } = req.params;
        const invitation = await prisma.organization_invitations.findUnique({
            where: { token },
            include: { organizations: true, roles: true },
        });

        if (!invitation) return res.status(404).json({ success: false, message: 'Invitation not found' });
        if (invitation.status !== 'pending') return res.status(400).json({ success: false, message: 'Invitation already used' });
        if (invitation.expires_at && invitation.expires_at < new Date()) {
            return res.status(400).json({ success: false, message: 'Invitation has expired' });
        }

        res.json({
            success: true,
            invitation: {
                email: invitation.email,
                orgName: invitation.organizations.name,
                roleName: invitation.roles?.displayName || 'Team Member',
            },
        });
    } catch (err: any) {
        res.status(500).json({ success: false, message: 'Failed to load invitation' });
    }
});

// ─────────────────────────────────────────────────────────────
// POST /invite/:token/accept — Accept invitation and create account
// ─────────────────────────────────────────────────────────────
router.post('/invite/:token/accept', async (req: Request, res: Response) => {
    try {
        const { token } = req.params;
        const { password, name } = req.body;

        const invitation = await prisma.organization_invitations.findUnique({
            where: { token },
            include: { organizations: true, roles: true },
        });

        if (!invitation) return res.status(404).json({ success: false, message: 'Invitation not found' });
        if (invitation.status !== 'pending') return res.status(400).json({ success: false, message: 'Invitation already used' });
        if (invitation.expires_at && invitation.expires_at < new Date()) {
            return res.status(400).json({ success: false, message: 'Invitation has expired' });
        }

        if (!password) return res.status(400).json({ success: false, message: 'Password is required' });

        // Check if user already exists in portal_users
        const existingPortal = await prisma.portalUser.findFirst({ where: { email: invitation.email } });
        if (existingPortal) {
            return res.status(409).json({ success: false, message: 'An account with this email already exists. Please log in instead.' });
        }

        // Create user in portal_users (NEW table)
        const hashedPassword = await bcrypt.hash(password, 10);
        const user = await prisma.portalUser.create({
            data: {
                email: invitation.email,
                username: name || invitation.email.split('@')[0],
                full_name: name || null,
                password: hashedPassword,
                is_active: true,
                email_verified: true, // Trusted since they received the email
                organization_id: invitation.organizations.id,
            },
        });

        // role_ids and permission_ids aren't in the generated Prisma client — read via raw SQL.
        const extraCols = await prisma.$queryRawUnsafe<Array<{ role_ids: string | null; permission_ids: string | null }>>(
            `SELECT role_ids, permission_ids FROM "otaxdb".organization_invitations WHERE id = $1`,
            invitation.id
        );
        const rawRoleIds = extraCols[0]?.role_ids || null;
        const rawPermissionIds = extraCols[0]?.permission_ids || null;

        // Assign role(s) via portal_user_roles. Prefer the multi-role list saved on invite;
        // fall back to the single role_id (or viewer) for invitations created before role_ids existed.
        let roleIdsToAssign: number[] = [];
        if (rawRoleIds) {
            try {
                const parsed = JSON.parse(rawRoleIds);
                if (Array.isArray(parsed)) roleIdsToAssign = parsed.map(Number).filter(Number.isFinite);
            } catch { /* ignore malformed JSON, fall through */ }
        }
        if (roleIdsToAssign.length === 0) {
            const fallback = invitation.role_id || (await prisma.role.findFirst({ where: { name: 'viewer' } }))?.id;
            if (fallback) roleIdsToAssign = [fallback];
        }
        // Block super_admin escalation through invitation accept (defense-in-depth — invite path already filters)
        if (roleIdsToAssign.length > 0) {
            const superAdmin = await prisma.role.findFirst({ where: { name: 'super_admin' } });
            if (superAdmin) roleIdsToAssign = roleIdsToAssign.filter(id => id !== superAdmin.id);
        }
        await Promise.all(
            roleIdsToAssign.map(roleId =>
                prisma.portalUserRole.create({ data: { userId: user.id, roleId } })
            )
        );

        // Apply per-user permission overrides if the inviter customized the permission set.
        // When present, these REPLACE the role-derived permissions at login resolution time.
        if (rawPermissionIds) {
            try {
                const parsed = JSON.parse(rawPermissionIds);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    const permIds = parsed.map(Number).filter(Number.isFinite);
                    if (permIds.length > 0) {
                        // Raw insert — portal_user_permissions table isn't in the generated Prisma client yet
                        const values = permIds.map((_, i) => `($1, $${i + 2})`).join(', ');
                        await prisma.$executeRawUnsafe(
                            `INSERT INTO "otaxdb".portal_user_permissions (user_id, permission_id) VALUES ${values} ON CONFLICT DO NOTHING`,
                            user.id,
                            ...permIds
                        );
                    }
                }
            } catch (e: any) {
                console.warn('[Invite Accept] Failed to apply permission overrides:', e.message);
            }
        }

        // Mark invitation as accepted
        await prisma.organization_invitations.update({
            where: { id: invitation.id },
            data: { status: 'accepted', accepted_by: Number(user.id), accepted_at: new Date() },
        });

        // Auto-login
        const userId = Number(user.id);
        const jwtToken = generateToken(userId);

        const userWithRoles = await prisma.portalUser.findFirst({
            where: { id: user.id },
            include: {
                organizations: true,
                portalUserRoles: { include: { role: { include: { rolePermissions: { include: { permission: true } } } } } },
            },
        });

        const roles = userWithRoles?.portalUserRoles?.map(ur => ({
            id: ur.role.id, name: ur.role.name, displayName: ur.role.displayName
        })) || [];

        // If this user has per-user permission overrides, use those as the effective set.
        // Otherwise fall back to the union of permissions from their roles.
        const overrideRows = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
            `SELECT p.name FROM "otaxdb".portal_user_permissions pup
               JOIN "otaxdb".permissions p ON p.id = pup.permission_id
              WHERE pup.user_id = $1`,
            user.id
        );
        const permissions = overrideRows.length > 0
            ? overrideRows.map(r => r.name)
            : (userWithRoles?.portalUserRoles?.flatMap(ur =>
                ur.role.rolePermissions.map(rp => rp.permission.name)
              ) || []);

        console.log(`[Invite Accept] ${invitation.email} accepted invitation to "${invitation.organizations.name}"`);

        res.json({
            success: true,
            message: 'Welcome! Your account has been created.',
            token: jwtToken,
            user: {
                id: userId,
                username: userWithRoles?.username,
                email: userWithRoles?.email,
                isSuperAdmin: false,
                isOrgAdmin: false,
                roles,
                permissions: [...new Set(permissions)],
                organization: {
                    id: invitation.organizations.id,
                    name: invitation.organizations.name,
                    tax_id: invitation.organizations.tax_id,
                    subscription_plan: invitation.organizations.subscription_plan,
                },
            },
        });
    } catch (err: any) {
        console.error('[Accept Invite Error]', err);
        res.status(500).json({ success: false, message: 'Failed to accept invitation' });
    }
});

// ─────────────────────────────────────────────────────────────
// GET /org-info/:joinCode — Get org info for join page
// ─────────────────────────────────────────────────────────────
router.get('/org-info/:joinCode', async (req: Request, res: Response) => {
    try {
        const { joinCode } = req.params;
        const org = await prisma.organizations.findFirst({
            where: { org_join_code: joinCode, is_active: true },
        });
        if (!org) return res.status(404).json({ success: false, message: 'Organization not found' });
        res.json({ success: true, org: { name: org.name, id: org.id } });
    } catch (err: any) {
        res.status(500).json({ success: false, message: 'Failed to load organization info' });
    }
});

// ─────────────────────────────────────────────────────────────
// PUT /change-password — Update password for currently logged-in user
// ─────────────────────────────────────────────────────────────
router.put('/change-password', authenticate, async (req: Request, res: Response) => {
    try {
        const { password } = req.body;
        if (!password) {
            return res.status(400).json({ success: false, message: 'Password is required' });
        }

        const userId = Number(req.user!.id);

        const cred = await prisma.credential.findUnique({
            where: { id: userId },
        });

        if (!cred) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        if (cred.isDemo) {
            return res.status(403).json({ success: false, message: 'Demo users cannot change passwords' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        await prisma.credential.update({
            where: { id: userId },
            data: { password: hashedPassword },
        });

        res.json({ success: true, message: 'Password updated successfully' });
    } catch (err: any) {
        console.error('[Change Password Error]', err);
        res.status(500).json({ success: false, message: 'Failed to update password' });
    }
});

export default router;
