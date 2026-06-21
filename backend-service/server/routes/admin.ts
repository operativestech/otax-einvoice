import express from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../prisma';
import { verifySmtp, sendTestEmail } from '../services/emailService';
import { runAutoSyncNow } from '../services/autoSyncScheduler';
import { runNotificationsNow } from '../services/notificationsWorker';
import {
    authenticate,
    authorize,
    adminOnly,
    requireOrgAdmin,
    getScopedOrgId,
    checkSubscriptionLimit,
    generateToken,
    logActivity,
    logLogin,
    blockDemo,
} from '../middleware/auth';

const router = express.Router();

// Helper: resolve org ID with fallback for legacy users
async function resolveOrgId(req: express.Request): Promise<number | null> {
    const orgId = getScopedOrgId(req) || (req as any).user?.organizationId || null;
    if (orgId) return orgId;
    try {
        const org = await prisma.organizations.findFirst({ where: { is_active: true }, orderBy: { id: 'asc' } });
        return org?.id || null;
    } catch { return null; }
}

// ============================================
// AUTHENTICATION ENDPOINTS
// ============================================

/**
 * Login with Prisma-based authentication
 * POST /api/auth/login
 */
router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ success: false, message: 'Email/username and password required' });
        }

        // Use pool (raw SQL) to query otaxdb — Prisma may point to different DB
        const pool = req.app.get('pool');
        if (!pool) {
            console.error('[Login] Database pool not available');
            return res.status(500).json({ success: false, message: 'Database not configured' });
        }

        // ── Step 0: Check super_admins table FIRST (platform-level admins) ──
        try {
            const superResult = await pool.query(
                `SELECT id, username, email, password, full_name, is_active
                 FROM "otaxdb".super_admins
                 WHERE email = $1 OR username = $1
                 LIMIT 1`,
                [username]
            );

            if (superResult.rows.length > 0) {
                const superUser = superResult.rows[0];

                if (!superUser.is_active) {
                    return res.status(403).json({ success: false, message: 'Super admin account is disabled' });
                }

                const isMatch = await bcrypt.compare(password, superUser.password);
                if (!isMatch) {
                    return res.status(401).json({ success: false, message: 'Invalid credentials' });
                }

                const token = generateToken(superUser.id);

                // Update last login
                pool.query(
                    `UPDATE "otaxdb".super_admins SET last_login_at = NOW() WHERE id = $1`,
                    [superUser.id]
                ).catch(() => { });

                console.log(`[Login] ✅ Super Admin login: ${superUser.username}`);

                return res.json({
                    success: true,
                    user: {
                        id: superUser.id,
                        username: superUser.username,
                        email: superUser.email,
                        fullName: superUser.full_name,
                        token,
                        isSuperAdmin: true,
                        isOrgAdmin: true,
                        roles: [{ id: 0, name: 'super_admin', displayName: 'Super Admin' }],
                        permissions: [
                            'dashboard.view',
                            'invoices.view', 'invoices.create', 'invoices.edit', 'invoices.delete', 'invoices.submit', 'invoices.cancel',
                            'reports.view', 'reports.export',
                            'settings.view', 'settings.edit',
                            'users.view', 'users.create', 'users.edit', 'users.delete',
                            'roles.view', 'roles.manage',
                            'organization.view', 'organization.edit',
                            'eta.sync', 'eta.configure',
                            'audit.view',
                            'masterdata.view', 'masterdata.edit',
                            'erp.view', 'erp.configure',
                            'org_users.view', 'org_users.create', 'org_users.edit', 'org_users.delete',
                            'super_admin.access',
                        ],
                        properties: [],
                        organization: null,
                    },
                });
            }
        } catch (superErr: any) {
            console.warn('[Login] super_admins table not available:', superErr.message);
        }

        // ── Step 1: Check portal_users table (new portal signups) ──
        let portalResult;
        try {
            portalResult = await pool.query(
                `SELECT id, email, username, password, full_name, is_active, email_verified, organization_id
                 FROM "otaxdb".portal_users
                 WHERE email = $1 OR username = $1
                 LIMIT 1`,
                [username]
            );
        } catch (portalErr: any) {
            // Table may not exist yet — skip
            console.warn('[Login] portal_users table not available:', portalErr.message);
            portalResult = { rows: [] };
        }

        if (portalResult.rows.length > 0) {
            const portalUser = portalResult.rows[0];

            // Check if user is active
            if (!portalUser.is_active) {
                return res.status(403).json({ success: false, message: 'Account is disabled' });
            }

            // Verify password (always bcrypt for portal users)
            const isValidPassword = await bcrypt.compare(password, portalUser.password);
            if (!isValidPassword) {
                return res.status(401).json({ success: false, message: 'Invalid credentials' });
            }

            // ── 2FA enforcement ──
            // If the user has TOTP enabled, the password alone isn't enough.
            // Lazy-import to keep this route's startup cost flat for users
            // who don't have 2FA configured.
            try {
                const { verifyTotpForLogin } = await import('./twoFactorRoutes.js');
                const totpCode = String(req.body?.totpCode || '').trim();
                const totp = await verifyTotpForLogin(pool, Number(portalUser.id), totpCode);
                if (!totp.ok) {
                    if (totp.required) {
                        return res.status(401).json({ success: false, message: 'Two-factor code required.', twoFactorRequired: true });
                    }
                    return res.status(401).json({ success: false, message: 'Invalid two-factor code.', twoFactorRequired: true });
                }
            } catch (e: any) {
                // Don't lock users out on infrastructure errors during 2FA check.
                console.warn('[Login][2FA] check failed (allowing login):', e.message);
            }

            // Generate JWT token
            const userId = Number(portalUser.id);
            const token = generateToken(userId);

            // Default roles and permissions
            const roles = [{ id: 0, name: 'org_admin', displayName: 'Admin' }];
            const permissions: string[] = [
                'dashboard.view',
                'invoices.view', 'invoices.create', 'invoices.edit', 'invoices.delete', 'invoices.cancel',
                'reports.view', 'reports.export',
                'settings.view', 'settings.edit',
                'masterdata.view', 'masterdata.edit',
                'erp.view', 'erp.configure',
                'org_users.view', 'org_users.create', 'org_users.edit', 'org_users.delete',
            ];

            // Try to load RBAC roles from portal_user_roles
            try {
                const rolesResult = await pool.query(
                    `SELECT r.id, r.name, r.display_name as "displayName"
                     FROM "otaxdb".portal_user_roles pur
                     JOIN "otaxdb".roles r ON r.id = pur.role_id
                     WHERE pur.user_id = $1`,
                    [userId]
                );
                if (rolesResult.rows.length > 0) {
                    roles.length = 0;
                    roles.push(...rolesResult.rows);

                    // Per-user permission override takes precedence — if rows exist in
                    // portal_user_permissions for this user, that set defines their access.
                    let usedOverrides = false;
                    try {
                        const overrideResult = await pool.query(
                            `SELECT DISTINCT p.name
                             FROM "otaxdb".portal_user_permissions pup
                             JOIN "otaxdb".permissions p ON p.id = pup.permission_id
                             WHERE pup.user_id = $1`,
                            [userId]
                        );
                        if (overrideResult.rows.length > 0) {
                            permissions.length = 0;
                            permissions.push(...overrideResult.rows.map(r => r.name));
                            usedOverrides = true;
                        }
                    } catch (e: any) {
                        // table may not exist yet on older deployments — fall through to role-based
                    }

                    if (!usedOverrides) {
                        const roleIds = rolesResult.rows.map(r => r.id);
                        const permsResult = await pool.query(
                            `SELECT DISTINCT p.name
                             FROM "otaxdb".role_permissions rp
                             JOIN "otaxdb".permissions p ON p.id = rp.permission_id
                             WHERE rp.role_id = ANY($1)`,
                            [roleIds]
                        );
                        if (permsResult.rows.length > 0) {
                            permissions.length = 0;
                            permissions.push(...permsResult.rows.map(r => r.name));
                        }
                    }
                }
            } catch (rbacErr: any) {
                console.warn('[Login] RBAC tables not available for portal user:', rbacErr.message);
            }

            const roleNames = roles.map(r => r.name);
            const isSuperAdmin = roleNames.includes('super_admin');
            const isOrgAdmin = roleNames.includes('org_admin') || roleNames.includes('admin');

            // Load organization info + settings as properties for portal users
            let properties: any[] = [];
            let organization: any = null;
            if (portalUser.organization_id) {
                try {
                    const orgResult = await pool.query(
                        `SELECT id, name, tax_id, company_type, org_join_code, subscription_plan, country, city
                         FROM "otaxdb".organizations WHERE id = $1`,
                        [portalUser.organization_id]
                    );
                    if (orgResult.rows.length > 0) {
                        organization = orgResult.rows[0];
                    }

                    // Load org settings as properties (ETA credentials etc.)
                    const settingsResult = await pool.query(
                        `SELECT * FROM "otaxdb".organization_settings WHERE organization_id = $1`,
                        [portalUser.organization_id]
                    );
                    if (settingsResult.rows.length > 0) {
                        const s = settingsResult.rows[0];
                        // Map org settings to the properties format the frontend expects
                        const settingsMap: Record<string, string | null> = {
                            'signer_environment_type': s.eta_environment,
                            'signer_preProdClientId': s.eta_preprod_client_id,
                            'signer_preProdClientSecret': s.eta_preprod_client_secret,
                            'signer_prodClientId': s.eta_prod_client_id,
                            'signer_prodClientSecret': s.eta_prod_client_secret,
                            'eta_submit_format': s.eta_submit_format,
                        };
                        properties = Object.entries(settingsMap)
                            .filter(([_, v]) => v != null)
                            .map(([k, v]) => ({ property_name: k, property_value: v }));
                    }

                    // Add company info from organizations table
                    if (organization) {
                        if (organization.name) properties.push({ property_name: 'issuer_name', property_value: organization.name });
                        if (organization.tax_id) properties.push({ property_name: 'issuer_id', property_value: organization.tax_id });
                        if (organization.company_type) properties.push({ property_name: 'user_type', property_value: organization.company_type });
                        if (organization.country) properties.push({ property_name: 'issuer_country', property_value: organization.country });
                        if (organization.city) properties.push({ property_name: 'issuer_governorate', property_value: organization.city });
                    }
                } catch (orgErr: any) {
                    console.warn('[Login] Org info load failed for portal user:', orgErr.message);
                }
            }

            // Update last login
            try {
                await pool.query(
                    `UPDATE "otaxdb".portal_users SET last_login_at = NOW() WHERE id = $1`,
                    [userId]
                );
            } catch (e) { /* non-critical */ }

            // Log login (non-critical)
            try {
                await logLogin(userId, portalUser.username || portalUser.email, req);
                await logActivity(userId, portalUser.username || portalUser.email, 'login', 'auth', undefined, undefined, undefined, req);
            } catch (logErr) {
                console.warn('[Login] Activity logging failed:', logErr);
            }

            console.log(`[Login] ✅ Portal user: ${portalUser.email} (id: ${userId}), org: ${organization?.name || 'none'}`);

            return res.json({
                success: true,
                token,
                user: {
                    id: userId,
                    username: portalUser.username || portalUser.email,
                    email: portalUser.email,
                    isDemo: false,
                    isSuperAdmin,
                    isOrgAdmin,
                    roles,
                    permissions: [...new Set(permissions)],
                    properties,
                    organization,
                },
            });
        }

        // ── Step 2: Fallback to legacy credentials table ──
        const result = await pool.query(
            `SELECT id, username, password, hwid, "isValid", "isDemo", "registerDate", "expiryDate", "configHash", organization_id, email, email_verified
             FROM "otaxdb".credentials
             WHERE username = $1 OR email = $1
             LIMIT 1`,
            [username]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }

        const user = result.rows[0];

        // Check if user is active
        if (user.isValid === false) {
            return res.status(403).json({ success: false, message: 'Account is disabled' });
        }

        // Verify password — support both bcrypt (new) and plain text (old users)
        let isValidPassword = false;
        if (user.password && user.password.startsWith('$2')) {
            isValidPassword = await bcrypt.compare(password, user.password);
        } else {
            isValidPassword = user.password === password;
        }
        if (!isValidPassword) {
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }

        // Generate JWT token
        const userId = Number(user.id);
        const token = generateToken(userId);

        // Default roles and permissions (dot notation — matches Sidebar requirements)
        const roles = [{ id: 0, name: 'org_admin', displayName: 'Admin' }];
        const permissions: string[] = [
            'dashboard.view',
            'invoices.view', 'invoices.create', 'invoices.edit', 'invoices.delete', 'invoices.cancel',
            'reports.view', 'reports.export',
            'settings.view', 'settings.edit',
            'masterdata.view', 'masterdata.edit',
            'erp.view', 'erp.configure',
            'org_users.view', 'org_users.create', 'org_users.edit', 'org_users.delete',
        ];

        // Try to load RBAC roles if tables exist
        try {
            const rolesResult = await pool.query(
                `SELECT r.id, r.name, r.display_name as "displayName"
                 FROM "otaxdb".user_roles ur
                 JOIN "otaxdb".roles r ON r.id = ur.role_id
                 WHERE ur.user_id = $1`,
                [userId]
            );
            if (rolesResult.rows.length > 0) {
                roles.length = 0;
                roles.push(...rolesResult.rows);

                // Per-user permission override takes precedence — if rows exist in
                // user_permissions for this user, that set defines their access.
                let usedOverrides = false;
                try {
                    const overrideResult = await pool.query(
                        `SELECT DISTINCT p.name
                         FROM "otaxdb".user_permissions up
                         JOIN "otaxdb".permissions p ON p.id = up.permission_id
                         WHERE up.user_id = $1`,
                        [userId]
                    );
                    if (overrideResult.rows.length > 0) {
                        permissions.length = 0;
                        permissions.push(...overrideResult.rows.map(r => r.name));
                        usedOverrides = true;
                    }
                } catch (e: any) {
                    // table may not exist yet on older deployments — fall through
                }

                if (!usedOverrides) {
                    // Load permissions for these roles
                    const roleIds = rolesResult.rows.map(r => r.id);
                    const permsResult = await pool.query(
                        `SELECT DISTINCT p.name
                         FROM "otaxdb".role_permissions rp
                         JOIN "otaxdb".permissions p ON p.id = rp.permission_id
                         WHERE rp.role_id = ANY($1)`,
                        [roleIds]
                    );
                    if (permsResult.rows.length > 0) {
                        permissions.length = 0;
                        permissions.push(...permsResult.rows.map(r => r.name));
                    }
                }
            }
        } catch (rbacErr: any) {
            console.warn('[Login] RBAC tables not available, using defaults:', rbacErr.message);
        }

        const roleNames = roles.map(r => r.name);
        const isSuperAdmin = roleNames.includes('super_admin');
        const isOrgAdmin = roleNames.includes('org_admin') || roleNames.includes('admin');

        // Load company properties from clients_info_new (LEGACY table — untouched)
        let properties: any[] = [];
        try {
            const propsResult = await pool.query(
                `SELECT property_name, property_value, "nonAdminEdit", modify_date
                 FROM "otaxdb".clients_info_new WHERE uid = $1`,
                [userId]
            );
            properties = propsResult.rows;
        } catch (propsErr: any) {
            console.warn('[Login] clients_info_new not available:', propsErr.message);
        }

        // ── Resolve organization for legacy users ──
        let organization: any = null;
        let resolvedOrgId = user.organization_id || null;
        if (!resolvedOrgId) {
            try {
                const orgResult = await pool.query(
                    `SELECT id, name FROM "otaxdb".organizations WHERE is_active = true ORDER BY id ASC LIMIT 1`
                );
                if (orgResult.rows.length > 0) {
                    resolvedOrgId = orgResult.rows[0].id;
                    organization = { id: orgResult.rows[0].id, name: orgResult.rows[0].name };
                    // Link the credential to this org
                    await pool.query(
                        `UPDATE "otaxdb".credentials SET organization_id = $1 WHERE id = $2 AND (organization_id IS NULL)`,
                        [resolvedOrgId, userId]
                    ).catch(() => { });
                    console.log(`[Login] Auto-linked legacy user ${user.username} to org ${resolvedOrgId}`);
                }
            } catch { }
        } else {
            try {
                const orgResult = await pool.query(
                    `SELECT id, name FROM "otaxdb".organizations WHERE id = $1`, [resolvedOrgId]
                );
                if (orgResult.rows.length > 0) {
                    organization = { id: orgResult.rows[0].id, name: orgResult.rows[0].name };
                }
            } catch { }
        }

        // Log login (non-critical)
        try {
            await logLogin(userId, user.username, req);
            await logActivity(userId, user.username, 'login', 'auth', undefined, undefined, undefined, req);
        } catch (logErr) {
            console.warn('[Login] Activity logging failed:', logErr);
        }

        console.log(`[Login] ✅ Legacy user: ${user.username} (id: ${userId}), properties: ${properties.length}, org: ${resolvedOrgId || 'none'}`);

        res.json({
            success: true,
            token,
            user: {
                id: userId,
                username: user.username,
                email: user.email || null,
                isDemo: user.isDemo,
                isSuperAdmin,
                isOrgAdmin,
                roles,
                permissions: [...new Set(permissions)],
                properties,
                organization,
            },
        });
    } catch (error: any) {
        console.error('Login error:', error);
        res.status(500).json({ success: false, message: 'Login failed', error: error.message });
    }
});


/**
 * Get current user info
 * GET /api/auth/me
 */
router.get('/me', authenticate, async (req, res) => {
    try {
        // Try portal_users first, then legacy credentials
        let user: any = null;
        let isPortalUser = false;

        try {
            user = await prisma.portalUser.findUnique({
                where: { id: req.user!.id },
                include: {
                    organizations: true,
                    portalUserRoles: {
                        include: {
                            role: {
                                include: {
                                    rolePermissions: {
                                        include: {
                                            permission: true,
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            });
            if (user) isPortalUser = true;
        } catch (e) {
            // portal_users table may not exist yet
        }

        if (!user) {
            user = await prisma.credential.findUnique({
                where: { id: req.user!.id },
                include: {
                    organizations: true,
                    userRoles: {
                        include: {
                            role: {
                                include: {
                                    rolePermissions: {
                                        include: {
                                            permission: true,
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            });
        }

        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        const userRolesArray = isPortalUser ? user.portalUserRoles : user.userRoles;
        const roles = (userRolesArray || []).map(ur => ({
            id: ur.role.id,
            name: ur.role.name,
            displayName: ur.role.displayName,
        }));

        // If this user has per-user permission overrides, use them; else fall back to role-derived.
        const overrideTable = isPortalUser ? 'portal_user_permissions' : 'user_permissions';
        let permissions: string[] = [];
        try {
            const overrideRows = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
                `SELECT DISTINCT p.name FROM "otaxdb".${overrideTable} ovp
                   JOIN "otaxdb".permissions p ON p.id = ovp.permission_id
                  WHERE ovp.user_id = $1`,
                BigInt(user.id)
            );
            if (overrideRows.length > 0) {
                permissions = overrideRows.map(r => r.name);
            }
        } catch (e: any) {
            // override table may not exist yet — fall through to role-based
        }
        if (permissions.length === 0) {
            permissions = (userRolesArray || []).flatMap(ur =>
                ur.role.rolePermissions.map(rp => rp.permission.name)
            );
        }

        const roleNames = roles.map(r => r.name);
        const isSuperAdmin = roleNames.includes('super_admin');
        const isOrgAdmin = roleNames.includes('org_admin') || roleNames.includes('admin');

        // Get subscription info if user has an org
        let subscription = null;
        if (user.organization_id) {
            subscription = await prisma.organization_subscriptions.findFirst({
                where: { organization_id: user.organization_id, status: 'active' },
                orderBy: { created_at: 'desc' },
            });
        }

        res.json({
            success: true,
            user: {
                id: user.id,
                username: user.username || user.email,
                email: user.email || null,
                email_verified: user.email_verified || false,
                isDemo: isPortalUser ? false : user.isDemo,
                isValid: isPortalUser ? user.is_active : user.isValid,
                isSuperAdmin,
                isOrgAdmin,
                registerDate: isPortalUser ? user.created_at : user.registerDate,
                expiryDate: isPortalUser ? null : user.expiryDate,
                organization: user.organizations ? {
                    ...user.organizations,
                    org_join_code: user.organizations.org_join_code || null,
                } : null,
                subscription,
                roles,
                permissions: [...new Set(permissions)],
            },
        });
    } catch (error: any) {
        console.error('Get user error:', error);
        res.status(500).json({ success: false, message: 'Failed to get user info', error: error.message });
    }
});

// ============================================
// ORGANIZATION INFO (Org Admin — own org only)
// ============================================

/**
 * Get own organization info
 * GET /api/admin/organization
 */
router.get('/organization', authenticate, async (req, res) => {
    try {
        const orgId = await resolveOrgId(req);
        if (!orgId) {
            return res.status(400).json({ success: false, message: 'No organization context' });
        }

        const org = await prisma.organizations.findUnique({
            where: { id: orgId },
            include: {
                organization_settings: true,
                organization_subscriptions: {
                    where: { status: 'active' },
                    take: 1,
                    orderBy: { created_at: 'desc' },
                },
                _count: {
                    select: {
                        credentials: true,
                    },
                },
            },
        });

        if (!org) {
            return res.status(404).json({ success: false, message: 'Organization not found' });
        }

        // Document model removed — document counting should use InvoicesDb org tables
        const documentCount = 0;

        res.json({
            success: true,
            organization: {
                ...org,
                userCount: org._count.credentials,
                documentCount,
                subscription: org.organization_subscriptions[0] || null,
            },
        });
    } catch (error: any) {
        console.error('Get organization error:', error);
        res.status(500).json({ success: false, message: 'Failed to get organization', error: error.message });
    }
});

/**
 * Update own organization info (Org Admin only)
 * PUT /api/admin/organization
 */
router.put('/organization', authenticate, blockDemo, async (req, res) => {
    try {
        const {
            name, phone, email, website,
            country, governorate, city, street, building_number, postal_code,
        } = req.body;
        const orgId = await resolveOrgId(req);

        if (!orgId) {
            return res.status(400).json({ success: false, message: 'User is not linked to an organization' });
        }

        // Org admins cannot change subscription_plan or tax_id
        const org = await prisma.organizations.update({
            where: { id: orgId },
            data: {
                name,
                phone,
                email,
                website,
                country,
                governorate,
                city,
                street,
                building_number,
                postal_code,
                updated_at: new Date(),
            },
        });

        await logActivity(req.user!.id, req.user!.username, 'organization_updated', 'admin', 'organization', orgId.toString(), req.body, req);

        res.json({ success: true, message: 'Organization updated successfully', organization: org });
    } catch (error: any) {
        console.error('Update organization error:', error);
        res.status(500).json({ success: false, message: 'Failed to update organization', error: error.message });
    }
});

/**
 * Save ETA credentials to organization_settings (Org Admin only)
 * PUT /api/admin/organization/eta-settings
 */
/**
 * GET /api/admin/organization/eta-autosync
 * Returns just the auto-sync scheduling fields so the Settings UI can render them
 * without the weird legacy `properties` array shape that `/settings/load` uses.
 */
router.get('/organization/eta-autosync', authenticate, async (req, res) => {
    try {
        let orgId = getScopedOrgId(req) || req.user?.organizationId || null;
        if (!orgId) {
            const org = await prisma.organizations.findFirst({ where: { is_active: true }, orderBy: { id: 'asc' } });
            orgId = org?.id || null;
        }
        if (!orgId) return res.status(400).json({ success: false, message: 'No organization found' });

        const s = await prisma.organization_settings.findUnique({ where: { organization_id: orgId } });

        // Read notification prefs via raw SQL — they're new columns not yet in the Prisma schema.
        let notifyDigest = true, notifyVat = true, notifyRecipientEmail: string | null = null;
        try {
            const pool = req.app.get('pool') as any;
            if (pool) {
                // ALTER on the fly so this route is self-healing — first call after
                // a fresh deploy creates the column instead of 500-ing.
                await pool.query(`
                    ALTER TABLE "otaxdb".organization_settings
                      ADD COLUMN IF NOT EXISTS notify_daily_digest BOOLEAN DEFAULT TRUE,
                      ADD COLUMN IF NOT EXISTS notify_vat_reminder BOOLEAN DEFAULT TRUE,
                      ADD COLUMN IF NOT EXISTS notify_recipient_email VARCHAR(255)
                `).catch(() => { /* idempotent; ignore */ });
                const r = await pool.query(
                    `SELECT notify_daily_digest, notify_vat_reminder, notify_recipient_email
                       FROM "otaxdb".organization_settings WHERE organization_id = $1`,
                    [orgId]
                );
                if (r.rows[0]) {
                    notifyDigest         = r.rows[0].notify_daily_digest !== false;
                    notifyVat            = r.rows[0].notify_vat_reminder !== false;
                    notifyRecipientEmail = r.rows[0].notify_recipient_email || null;
                }
            }
        } catch { /* columns may not yet exist on first run — defaults above handle it */ }

        res.json({
            success: true,
            autosync: {
                mode: (s as any)?.eta_sync_mode || 'off',
                intervalMinutes: s?.eta_sync_interval || 60,
                times: (s as any)?.eta_sync_times || [],
                lastRunAt: (s as any)?.eta_last_auto_sync_at || null,
                autoSyncEnabled: s?.eta_auto_sync ?? true,
            },
            notifications: {
                dailyDigest:    notifyDigest,
                vatReminder:    notifyVat,
                recipientEmail: notifyRecipientEmail,
                // Surface the global sender so the UI can show "from otax.tech@..."
                // without the customer needing to enter SMTP creds.
                senderEmail:    process.env.SMTP_FROM || process.env.SMTP_USER || null,
            },
        });
    } catch (err: any) {
        res.status(500).json({ success: false, message: err.message });
    }
});

router.put('/organization/eta-settings', authenticate, blockDemo, async (req, res) => {
    try {
        // Resolve org: try scoped → user's org → first available org
        let orgId = getScopedOrgId(req) || req.user?.organizationId || null;

        if (!orgId) {
            // Last resort: find first active organization
            try {
                const org = await prisma.organizations.findFirst({ where: { is_active: true }, orderBy: { id: 'asc' } });
                if (org) {
                    orgId = org.id;
                    console.log(`[ETA-Settings] Auto-resolved org ${orgId} for user ${req.user?.id}`);
                }
            } catch { }
        }

        if (!orgId) {
            return res.status(400).json({ success: false, message: 'No organization found. Please create an organization first.' });
        }

        const {
            eta_environment,
            eta_preprod_client_id,
            eta_preprod_client_secret,
            eta_prod_client_id,
            eta_prod_client_secret,
            eta_client_id,
            eta_client_secret,
            eta_tax_id,
            eta_auto_sync,
            eta_sync_interval,
            eta_submit_format,
            eta_sync_mode,
            eta_sync_times,
            notify_daily_digest,
            notify_vat_reminder,
            notify_recipient_email,    // single override mailbox; empty/null falls back to all org users
        } = req.body;

        // Build update data — only include fields that were actually sent
        const updateData: any = { updated_at: new Date() };
        if (eta_environment !== undefined) updateData.eta_environment = eta_environment;
        if (eta_preprod_client_id !== undefined) updateData.eta_preprod_client_id = eta_preprod_client_id;
        if (eta_preprod_client_secret !== undefined) updateData.eta_preprod_client_secret = eta_preprod_client_secret;
        if (eta_prod_client_id !== undefined) updateData.eta_prod_client_id = eta_prod_client_id;
        if (eta_prod_client_secret !== undefined) updateData.eta_prod_client_secret = eta_prod_client_secret;
        if (eta_client_id !== undefined) updateData.eta_client_id = eta_client_id;
        if (eta_client_secret !== undefined) updateData.eta_client_secret = eta_client_secret;
        if (eta_tax_id !== undefined) updateData.eta_tax_id = eta_tax_id;
        if (eta_auto_sync !== undefined) updateData.eta_auto_sync = eta_auto_sync;
        if (eta_sync_interval !== undefined) updateData.eta_sync_interval = eta_sync_interval;
        if (eta_submit_format !== undefined && (eta_submit_format === 'JSON' || eta_submit_format === 'XML')) {
            updateData.eta_submit_format = eta_submit_format;
        }
        // Auto-sync scheduler fields
        if (eta_sync_mode !== undefined && ['off', 'interval', 'times'].includes(String(eta_sync_mode))) {
            updateData.eta_sync_mode = eta_sync_mode;
        }
        if (eta_sync_times !== undefined && Array.isArray(eta_sync_times)) {
            // Validate each entry is "HH:MM" and cap at 10 entries
            const clean = (eta_sync_times as string[])
                .map(t => String(t).trim())
                .filter(t => /^(\d{1,2}):(\d{2})$/.test(t))
                .map(t => {
                    const m = /^(\d{1,2}):(\d{2})$/.exec(t)!;
                    const h = Math.min(23, Math.max(0, parseInt(m[1], 10)));
                    const mi = Math.min(59, Math.max(0, parseInt(m[2], 10)));
                    return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
                })
                .slice(0, 10);
            // De-duplicate and keep original order
            updateData.eta_sync_times = Array.from(new Set(clean));
        }
        // Upsert: create if not exists, update if exists. Prisma only knows the
        // fields declared in schema.prisma, so we split off the two notification
        // opt-out toggles and apply them with raw SQL below.
        const settings = await prisma.organization_settings.upsert({
            where: { organization_id: orgId },
            create: {
                organization_id: orgId,
                ...updateData,
            },
            update: updateData,
        });

        // Notification opt-outs + recipient mailbox — auto-added columns,
        // updated out-of-band so we don't need a full Prisma regenerate every
        // time a toggle lands.
        //
        // `notify_recipient_email` is OPTIONAL: when set, the worker sends every
        // notification to that single address only. When empty/null, it falls
        // back to the legacy behaviour of mailing every active+verified portal
        // user of the org. Sender is always the global OTax SMTP — customers
        // never configure SMTP credentials.
        if (
            notify_daily_digest    !== undefined ||
            notify_vat_reminder    !== undefined ||
            notify_recipient_email !== undefined
        ) {
            const pool = req.app.get('pool') as any;
            if (pool) {
                try {
                    await pool.query(`
                        ALTER TABLE "otaxdb".organization_settings
                          ADD COLUMN IF NOT EXISTS notify_daily_digest BOOLEAN DEFAULT TRUE,
                          ADD COLUMN IF NOT EXISTS notify_vat_reminder BOOLEAN DEFAULT TRUE,
                          ADD COLUMN IF NOT EXISTS notify_recipient_email VARCHAR(255)
                    `);
                    const sets: string[] = [];
                    const params: any[] = [];
                    if (notify_daily_digest !== undefined) { params.push(Boolean(notify_daily_digest)); sets.push(`notify_daily_digest = $${params.length}`); }
                    if (notify_vat_reminder !== undefined) { params.push(Boolean(notify_vat_reminder)); sets.push(`notify_vat_reminder = $${params.length}`); }
                    if (notify_recipient_email !== undefined) {
                        // Trim, basic shape check; empty/null clears the override.
                        const raw = notify_recipient_email == null ? null : String(notify_recipient_email).trim();
                        if (raw && raw.length > 0) {
                            // Reject obvious junk so we don't store malformed addresses.
                            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw) || raw.length > 255) {
                                return res.status(400).json({ success: false, message: 'Invalid notification recipient email.' });
                            }
                            params.push(raw); sets.push(`notify_recipient_email = $${params.length}`);
                        } else {
                            // Empty input clears the override (back to legacy behaviour).
                            sets.push(`notify_recipient_email = NULL`);
                        }
                    }
                    if (sets.length > 0) {
                        params.push(orgId);
                        await pool.query(
                            `UPDATE "otaxdb".organization_settings SET ${sets.join(', ')} WHERE organization_id = $${params.length}`,
                            params
                        );
                    }
                } catch (e: any) {
                    console.warn('[Admin] Notification prefs update (non-fatal):', e.message);
                }
            }
        }

        await logActivity(req.user!.id, req.user!.username, 'eta_settings_updated', 'admin', 'organization_settings', orgId.toString(), { fields: Object.keys(updateData) }, req);

        console.log(`[Admin] ETA settings saved for org ${orgId}:`, Object.keys(updateData).join(', '));
        res.json({ success: true, message: 'ETA settings saved successfully', settings });
    } catch (error: any) {
        console.error('Save ETA settings error:', error);
        res.status(500).json({ success: false, message: 'Failed to save ETA settings', error: error.message });
    }
});

/**
 * Send a test email to verify SMTP configuration.
 * POST /api/admin/notifications/test
 *   body: { to?: string }   // defaults to the authenticated user's own email
 *
 * Order of operations:
 *   1. Verify the SMTP transport (catches missing creds + handshake errors).
 *   2. Send a small test email so the user actually sees it land in their inbox.
 *
 * Both stages return granular errors so the user can debug their .env quickly.
 */
router.post('/notifications/test', authenticate, blockDemo, async (req, res) => {
    try {
        // Resolve recipient: explicit "to" wins, else fall back to the
        // authenticated user's stored email (portal_users → credentials).
        let targetEmail = String(req.body?.to || '').trim();
        if (!targetEmail) {
            const uid = (req as any).user?.id;
            const username = (req as any).user?.username;
            if (uid) {
                try {
                    const pu = await prisma.portalUser.findUnique({ where: { id: BigInt(uid) }, select: { email: true } });
                    if (pu?.email) targetEmail = pu.email;
                } catch { /* ignore — fall through to username fallback */ }
            }
            // Final fallback: username may itself be an email
            if (!targetEmail && username && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(username)) {
                targetEmail = username;
            }
        }
        if (!targetEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(targetEmail)) {
            return res.status(400).json({ success: false, message: 'A valid recipient email is required (provide "to" or ensure your account has a verified email).' });
        }

        const verify = await verifySmtp();
        if (!verify.ok) {
            return res.status(500).json({
                success: false,
                stage: 'verify',
                message: `SMTP not ready: ${verify.message}`,
                hint: 'Check SMTP_USER / SMTP_PASS in the backend .env, restart the server, and retry.',
            });
        }

        // Resolve org name for a friendlier email body
        const orgId = await resolveOrgId(req);
        let orgName = 'OTax';
        if (orgId) {
            try {
                const org = await prisma.organizations.findUnique({ where: { id: orgId } });
                if (org?.name) orgName = org.name;
            } catch { /* ignore — fall back to default */ }
        }

        try {
            const info = await sendTestEmail(targetEmail, orgName);
            await logActivity(
                (req as any).user!.id,
                (req as any).user!.username,
                'smtp_test_sent',
                'admin',
                'organization_settings',
                orgId ? String(orgId) : null,
                { to: targetEmail, messageId: (info as any)?.messageId },
                req
            );
            return res.json({
                success: true,
                message: `Test email sent to ${targetEmail}. Check your inbox (and spam) within ~30 seconds.`,
                messageId: (info as any)?.messageId || null,
            });
        } catch (err: any) {
            // Soft-fail with HTTP 200 so the browser console doesn't log a
            // 500 every time the user hits a transient SMTP issue. The
            // frontend reads `success: false` and shows the message inline.
            //
            // Detect Gmail's daily-user limit specifically (otax.tech@gmail.com
            // is a free Gmail account, and Gmail caps free senders at ~500
            // emails/day per user) so we can offer the customer actionable
            // advice rather than a raw "550 5.4.5" error.
            const raw = String(err?.message || err);
            const isRateLimit = /5\.4\.5|Daily user sending limit|exceeded.*Gmail/i.test(raw);
            const hint = isRateLimit
                ? 'Gmail blocks free accounts after ~500 emails per day. The limit resets at midnight Pacific time. For higher volume, set SMTP_USER / SMTP_PASS / SMTP_FROM in the backend .env to a transactional provider (SendGrid, Mailgun, AWS SES) or a Google Workspace mailbox.'
                : undefined;
            return res.json({
                success: false,
                stage: 'send',
                kind:    isRateLimit ? 'gmail_rate_limit' : 'smtp_error',
                message: `SMTP verified, but sending failed: ${raw}`,
                hint,
            });
        }
    } catch (error: any) {
        console.error('[Admin] notifications/test error:', error);
        // Same soft-fail rationale — return 200 with success:false rather
        // than a 500 the browser highlights in red.
        res.json({ success: false, message: error.message || 'Test email failed' });
    }
});

/**
 * Upload (or clear) the organization logo. We store it as a data URL inline on
 * `organizations.logo_url` rather than a binary file because:
 *   - Logos are tiny (<200KB) so the row size cost is negligible
 *   - Avoids needing static file hosting / CDN setup
 *   - Survives backups + multi-region replication for free
 *
 * POST /api/admin/organization/logo
 *   body: { dataUrl: 'data:image/png;base64,...' }   // or null to clear
 *
 * Limits:
 *   - 200 KB max raw size to keep login payloads small
 *   - PNG / JPEG / WebP / SVG only — anything else is rejected
 */
router.post('/organization/logo', authenticate, blockDemo, async (req, res) => {
    try {
        const orgId = await resolveOrgId(req);
        if (!orgId) return res.status(400).json({ success: false, message: 'No organization scoped to this user' });

        const pool = req.app.get('pool') as any;
        if (!pool) return res.status(500).json({ success: false, message: 'Database not configured' });

        const { dataUrl } = req.body || {};

        // Allow clearing the logo by sending null/empty
        if (dataUrl === null || dataUrl === undefined || dataUrl === '') {
            await pool.query(
                `UPDATE "otaxdb".organizations SET logo_url = NULL WHERE id = $1`, [orgId]
            );
            await logActivity(req.user!.id, req.user!.username, 'org_logo_cleared', 'admin', 'organizations', String(orgId), {}, req).catch(() => {});
            return res.json({ success: true, logoUrl: null });
        }

        // Validate the data URL: must start with `data:image/{type};base64,...`
        const m = /^data:image\/(png|jpe?g|webp|svg\+xml);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl));
        if (!m) {
            return res.status(400).json({ success: false, message: 'Logo must be a base64 data URL — PNG, JPEG, WebP, or SVG only.' });
        }
        const sizeBytes = Math.floor(m[2].length * 3 / 4); // base64 → raw byte estimate
        const MAX_BYTES = 200 * 1024;
        if (sizeBytes > MAX_BYTES) {
            return res.status(413).json({ success: false, message: `Logo is too large (${Math.round(sizeBytes / 1024)} KB). Max ${MAX_BYTES / 1024} KB.` });
        }

        await pool.query(
            `UPDATE "otaxdb".organizations SET logo_url = $1 WHERE id = $2`,
            [dataUrl, orgId]
        );
        await logActivity(req.user!.id, req.user!.username, 'org_logo_updated', 'admin', 'organizations', String(orgId), { mime: m[1], sizeBytes }, req).catch(() => {});
        return res.json({ success: true, logoUrl: dataUrl });
    } catch (error: any) {
        console.error('[Admin] org/logo error:', error);
        res.status(500).json({ success: false, message: error.message || 'Logo upload failed' });
    }
});

/**
 * Trigger the auto-sync scheduler for the current org immediately, regardless
 * of the configured schedule. Wraps `fireSync()` so we don't duplicate the
 * JWT-mint + HTTP-call dance.
 *
 * POST /api/admin/autosync/run-now
 */
router.post('/autosync/run-now', authenticate, blockDemo, async (req, res) => {
    try {
        const orgId = await resolveOrgId(req);
        if (!orgId) return res.status(400).json({ success: false, message: 'No organization scoped to this user' });

        const pool = req.app.get('pool') as any;
        if (!pool) return res.status(500).json({ success: false, message: 'Database not configured' });

        const result = await runAutoSyncNow(pool, orgId);

        await logActivity(
            (req as any).user!.id,
            (req as any).user!.username,
            result.ok ? 'autosync_run_now' : 'autosync_run_now_failed',
            'admin',
            'organization_settings',
            String(orgId),
            { ok: result.ok, error: result.error || null },
            req
        );

        if (!result.ok) {
            return res.status(502).json({
                success: false,
                message: `Sync run failed: ${result.error || 'unknown error'}`,
                hint: 'Verify ETA credentials and that a portal user with a verified email exists for this org.',
            });
        }
        return res.json({ success: true, message: 'Sync started successfully — open ETA Documents to watch progress.' });
    } catch (error: any) {
        console.error('[Admin] autosync/run-now error:', error);
        res.status(500).json({ success: false, message: error.message || 'Run-now failed' });
    }
});

/**
 * Trigger a one-shot notifications cycle for the current org (digest + VAT
 * reminder), bypassing the worker's 22h / monthly cooldowns. Useful for
 * confirming SMTP works end-to-end before relying on the 6h worker tick.
 *
 * POST /api/admin/notifications/run-now
 */
router.post('/notifications/run-now', authenticate, blockDemo, async (req, res) => {
    try {
        const orgId = await resolveOrgId(req);
        if (!orgId) return res.status(400).json({ success: false, message: 'No organization scoped to this user' });

        const pool = req.app.get('pool') as any;
        if (!pool) return res.status(500).json({ success: false, message: 'Database not configured' });

        // Sanity-check SMTP first so we surface bad creds before doing the heavy
        // DB queries inside the worker.
        const v = await verifySmtp();
        if (!v.ok) {
            return res.status(500).json({ success: false, stage: 'verify', message: `SMTP not ready: ${v.message}` });
        }

        const report = await runNotificationsNow(pool, orgId);

        await logActivity(
            (req as any).user!.id,
            (req as any).user!.username,
            'notifications_run_now',
            'admin',
            'organization_settings',
            String(orgId),
            { digest: report.digest },
            req
        );

        return res.json({
            success: true,
            message: `Digest: ${report.digest.sent ? `sent to ${report.digest.sent}` : (report.digest.reason || 'skipped')}.`,
            report,
        });
    } catch (error: any) {
        console.error('[Admin] notifications/run-now error:', error);
        res.status(500).json({ success: false, message: error.message || 'Run-now failed' });
    }
});

// ============================================
// USER MANAGEMENT (Org-scoped)
// ============================================

/**
 * Get users in my organization
 * GET /api/admin/users
 */
router.get('/users', authenticate, async (req, res) => {
    try {
        const orgId = await resolveOrgId(req);

        const whereClause: any = {};
        if (orgId) {
            whereClause.organization_id = orgId;
        }

        const users = await prisma.credential.findMany({
            where: whereClause,
            include: {
                userRoles: {
                    include: {
                        role: { select: { id: true, name: true, displayName: true } },
                    },
                },
                organizations: {
                    select: { id: true, name: true },
                },
            },
            orderBy: { id: 'asc' },
        });

        const usersWithRoles = users.map((user: any) => ({
            id: user.id,
            username: user.username,
            email: user.email || null,
            email_verified: user.email_verified || false,
            isValid: user.isValid,
            isDemo: user.isDemo,
            registerDate: user.registerDate,
            expiryDate: user.expiryDate,
            organization: user.organizations,
            roles: user.userRoles.map(ur => ({
                id: ur.role.id,
                name: ur.role.name,
                displayName: ur.role.displayName,
            })),
        }));

        res.json({ success: true, users: usersWithRoles });
    } catch (error: any) {
        console.error('Get users error:', error);
        res.status(500).json({ success: false, message: 'Failed to get users', error: error.message });
    }
});

/**
 * Create new user (in my organization, subject to subscription limits)
 * POST /api/admin/users
 */
router.post('/users', authenticate, blockDemo, checkSubscriptionLimit('users'), async (req, res) => {
    try {
        const { username, email, password, isDemo, roleIds, permissionIds } = req.body;
        const orgId = await resolveOrgId(req);

        if ((!username && !email) || !password) {
            return res.status(400).json({ success: false, message: 'Username/email and password required' });
        }

        // Check if username or email exists
        const existing = await prisma.credential.findFirst({
            where: {
                OR: [
                    ...(username ? [{ username }] : []),
                    ...(email ? [{ email } as any] : []),
                ],
            },
        });
        if (existing) {
            return res.status(400).json({ success: false, message: 'Username or email already exists' });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Create user in the same organization
        const user = await prisma.credential.create({
            data: {
                username: username || (email ? email.split('@')[0] : 'user'),
                email: email || null,
                password: hashedPassword,
                isDemo: isDemo || false,
                isValid: true,
                registerDate: new Date(),
                expiryDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
                organization_id: orgId,
            } as any,
        });

        // Assign roles — org admins can't assign super_admin role
        let assignedRoleIds: number[] = [];
        if (roleIds && Array.isArray(roleIds)) {
            // Prevent assigning super_admin role
            const superAdminRole = await prisma.role.findUnique({ where: { name: 'super_admin' } });
            assignedRoleIds = superAdminRole
                ? roleIds.filter((id: number) => id !== superAdminRole.id)
                : roleIds;

            await Promise.all(
                assignedRoleIds.map((roleId: number) =>
                    prisma.userRole.create({
                        data: {
                            userId: user.id,
                            roleId,
                            assignedBy: req.user!.id,
                        },
                    })
                )
            );
        }

        // Apply per-user permission overrides if the admin customized the permission set.
        // Only keep permissions that actually belong to one of the assigned roles.
        if (Array.isArray(permissionIds) && permissionIds.length > 0 && assignedRoleIds.length > 0) {
            const rolePerms = await prisma.rolePermission.findMany({
                where: { roleId: { in: assignedRoleIds } },
                select: { permissionId: true },
            });
            const allowed = new Set(rolePerms.map(rp => rp.permissionId));
            const validIds = permissionIds
                .map(Number)
                .filter((id: number) => Number.isFinite(id) && allowed.has(id));

            if (validIds.length > 0) {
                const values = validIds.map((_, i) => `($1, $${i + 2})`).join(', ');
                await prisma.$executeRawUnsafe(
                    `INSERT INTO "otaxdb".user_permissions (user_id, permission_id) VALUES ${values} ON CONFLICT DO NOTHING`,
                    user.id,
                    ...validIds
                );
            }
        }

        await logActivity(req.user!.id, req.user!.username, 'user_created', 'admin', 'user', user.id.toString(), { username, orgId }, req);

        res.json({ success: true, message: 'User created successfully', userId: user.id });
    } catch (error: any) {
        console.error('Create user error:', error);
        res.status(500).json({ success: false, message: 'Failed to create user', error: error.message });
    }
});

/**
 * Update user (must be in my organization)
 * PUT /api/admin/users/:id
 */
router.put('/users/:id', authenticate, blockDemo, async (req, res) => {
    try {
        const userId = parseInt(req.params.id);
        const { isValid, isDemo, password, roleIds } = req.body;
        const orgId = await resolveOrgId(req);

        // Verify user belongs to same organization
        const targetUser = await prisma.credential.findUnique({ where: { id: userId } });
        if (!targetUser) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        if (!req.user!.isSuperAdmin && targetUser.organization_id !== orgId) {
            return res.status(403).json({ success: false, message: 'Cannot modify users from another organization' });
        }

        const updateData: any = {};
        if (typeof isValid === 'boolean') updateData.isValid = isValid;
        if (typeof isDemo === 'boolean') updateData.isDemo = isDemo;
        if (password) updateData.password = await bcrypt.hash(password, 10);

        await prisma.credential.update({
            where: { id: userId },
            data: updateData,
        });

        // Update roles if provided
        if (roleIds && Array.isArray(roleIds)) {
            await prisma.userRole.deleteMany({ where: { userId } });

            // Prevent assigning super_admin role (unless you ARE super admin)
            const superAdminRole = await prisma.role.findUnique({ where: { name: 'super_admin' } });
            const filteredRoleIds = (!req.user!.isSuperAdmin && superAdminRole)
                ? roleIds.filter((id: number) => id !== superAdminRole.id)
                : roleIds;

            await Promise.all(
                filteredRoleIds.map((roleId: number) =>
                    prisma.userRole.create({
                        data: { userId, roleId, assignedBy: req.user!.id },
                    })
                )
            );
        }

        await logActivity(req.user!.id, req.user!.username, 'user_updated', 'admin', 'user', userId.toString(), req.body, req);

        res.json({ success: true, message: 'User updated successfully' });
    } catch (error: any) {
        console.error('Update user error:', error);
        res.status(500).json({ success: false, message: 'Failed to update user', error: error.message });
    }
});

/**
 * Delete user (must be in my organization)
 * DELETE /api/admin/users/:id
 */
router.delete('/users/:id', authenticate, blockDemo, async (req, res) => {
    try {
        const userId = parseInt(req.params.id);
        const orgId = getScopedOrgId(req);

        if (userId === req.user!.id) {
            return res.status(400).json({ success: false, message: 'Cannot delete your own account' });
        }

        // Verify user belongs to same organization
        const targetUser = await prisma.credential.findUnique({ where: { id: userId } });
        if (!targetUser) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        if (!req.user!.isSuperAdmin && targetUser.organization_id !== orgId) {
            return res.status(403).json({ success: false, message: 'Cannot delete users from another organization' });
        }

        await prisma.credential.delete({ where: { id: userId } });

        await logActivity(req.user!.id, req.user!.username, 'user_deleted', 'admin', 'user', userId.toString(), undefined, req);

        res.json({ success: true, message: 'User deleted successfully' });
    } catch (error: any) {
        console.error('Delete user error:', error);
        res.status(500).json({ success: false, message: 'Failed to delete user', error: error.message });
    }
});

// ============================================
// ROLE MANAGEMENT
// ============================================

/**
 * Get all roles (visible roles depend on user level)
 * GET /api/admin/roles
 */
router.get('/roles', authenticate, requireOrgAdmin, async (req, res) => {
    try {
        const whereClause: any = {};

        // Non-super-admins shouldn't see the super_admin role
        if (!req.user!.isSuperAdmin) {
            whereClause.name = { not: 'super_admin' };
        }

        const roles = await prisma.role.findMany({
            where: whereClause,
            include: {
                rolePermissions: {
                    include: { permission: true },
                },
                _count: {
                    select: { userRoles: true },
                },
            },
            orderBy: { id: 'asc' },
        });

        const rolesWithPermissions = roles.map(role => ({
            id: role.id,
            name: role.name,
            displayName: role.displayName,
            description: role.description,
            isSystem: role.isSystem,
            userCount: role._count.userRoles,
            permissions: role.rolePermissions.map(rp => ({
                id: rp.permission.id,
                name: rp.permission.name,
                displayName: rp.permission.displayName,
                module: rp.permission.module,
                action: rp.permission.action,
            })),
        }));

        res.json({ success: true, roles: rolesWithPermissions });
    } catch (error: any) {
        console.error('Get roles error:', error);
        res.status(500).json({ success: false, message: 'Failed to get roles', error: error.message });
    }
});

/**
 * Create new role
 * POST /api/admin/roles
 */
router.post('/roles', authenticate, requireOrgAdmin, blockDemo, async (req, res) => {
    try {
        const { name, displayName, description, permissionIds } = req.body;

        if (!name || !displayName) {
            return res.status(400).json({ success: false, message: 'Name and display name required' });
        }

        const role = await prisma.role.create({
            data: { name, displayName, description, isSystem: false },
        });

        if (permissionIds && Array.isArray(permissionIds)) {
            await Promise.all(
                permissionIds.map((permissionId: number) =>
                    prisma.rolePermission.create({
                        data: { roleId: role.id, permissionId },
                    })
                )
            );
        }

        await logActivity(req.user!.id, req.user!.username, 'role_created', 'admin', 'role', role.id.toString(), { name, displayName }, req);

        res.json({ success: true, message: 'Role created successfully', roleId: role.id });
    } catch (error: any) {
        console.error('Create role error:', error);
        res.status(500).json({ success: false, message: 'Failed to create role', error: error.message });
    }
});

/**
 * Update role permissions
 * PUT /api/admin/roles/:id/permissions
 */
router.put('/roles/:id/permissions', authenticate, requireOrgAdmin, blockDemo, async (req, res) => {
    try {
        const roleId = parseInt(req.params.id);
        const { permissionIds } = req.body;

        if (!Array.isArray(permissionIds)) {
            return res.status(400).json({ success: false, message: 'Permission IDs must be an array' });
        }

        // Prevent modifying super_admin role by non-super-admins
        const role = await prisma.role.findUnique({ where: { id: roleId } });
        if (role?.name === 'super_admin' && !req.user!.isSuperAdmin) {
            return res.status(403).json({ success: false, message: 'Cannot modify Super Admin role' });
        }

        await prisma.rolePermission.deleteMany({ where: { roleId } });

        await Promise.all(
            permissionIds.map((permissionId: number) =>
                prisma.rolePermission.create({
                    data: { roleId, permissionId },
                })
            )
        );

        await logActivity(req.user!.id, req.user!.username, 'role_permissions_updated', 'admin', 'role', roleId.toString(), { permissionIds }, req);

        res.json({ success: true, message: 'Role permissions updated successfully' });
    } catch (error: any) {
        console.error('Update role permissions error:', error);
        res.status(500).json({ success: false, message: 'Failed to update role permissions', error: error.message });
    }
});

// ============================================
// PERMISSIONS
// ============================================

/**
 * Get all permissions
 * GET /api/admin/permissions
 */
router.get('/permissions', authenticate, requireOrgAdmin, async (req, res) => {
    try {
        const whereClause: any = {};

        // Non-super-admins shouldn't see org management permissions
        if (!req.user!.isSuperAdmin) {
            whereClause.module = { not: 'organizations' };
        }

        const permissions = await prisma.permission.findMany({
            where: whereClause,
            orderBy: [{ module: 'asc' }, { action: 'asc' }],
        });

        const grouped = permissions.reduce((acc: any, perm) => {
            if (!acc[perm.module]) {
                acc[perm.module] = [];
            }
            acc[perm.module].push(perm);
            return acc;
        }, {});

        res.json({ success: true, permissions, grouped });
    } catch (error: any) {
        console.error('Get permissions error:', error);
        res.status(500).json({ success: false, message: 'Failed to get permissions', error: error.message });
    }
});

// ============================================
// ACTIVITY LOGS (Org-scoped)
// ============================================

/**
 * Get user activity logs (scoped to my org)
 * GET /api/admin/activity-logs
 */
router.get('/activity-logs', authenticate, async (req, res) => {
    try {
        const { userId, action, limit = 100 } = req.query;
        const orgId = getScopedOrgId(req);

        const where: any = {};
        if (userId) where.userId = parseInt(userId as string);
        if (action) where.action = action;

        // Scope activity logs to org users
        if (orgId && !req.user!.isSuperAdmin) {
            const orgUserIds = (await prisma.credential.findMany({
                where: { organization_id: orgId },
                select: { id: true },
            })).map(u => u.id);
            where.userId = { in: orgUserIds };
        }

        const logs = await prisma.userActivityLog.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            take: parseInt(limit as string),
        });

        res.json({ success: true, logs });
    } catch (error: any) {
        console.error('Get activity logs error:', error);
        res.status(500).json({ success: false, message: 'Failed to get activity logs', error: error.message });
    }
});

/**
 * Get login history (scoped to my org)
 * GET /api/admin/login-history
 */
router.get('/login-history', authenticate, async (req, res) => {
    try {
        const { userId, limit = 100 } = req.query;
        const orgId = getScopedOrgId(req);

        const where: any = {};
        if (userId) where.userId = parseInt(userId as string);

        // Scope to org users
        if (orgId && !req.user!.isSuperAdmin) {
            const orgUserIds = (await prisma.credential.findMany({
                where: { organization_id: orgId },
                select: { id: true },
            })).map(u => u.id);
            where.userId = { in: orgUserIds };
        }

        const history = await prisma.userLoginHistory.findMany({
            where,
            orderBy: { loginTime: 'desc' },
            take: parseInt(limit as string),
        });

        res.json({ success: true, history });
    } catch (error: any) {
        console.error('Get login history error:', error);
        res.status(500).json({ success: false, message: 'Failed to get login history', error: error.message });
    }
});

// ============================================
// DASHBOARD STATS (Org-scoped)
// ============================================

/**
 * Get admin dashboard statistics (scoped to my org)
 * GET /api/admin/stats
 */
router.get('/stats', authenticate, async (req, res) => {
    try {
        const orgId = getScopedOrgId(req);

        const orgFilter = orgId ? { organization_id: orgId } : {};

        // Get org user IDs for activity/login scoping
        // Note: Credential.id is BigInt, but UserLoginHistory/UserActivityLog.userId is Int
        const orgUserIds = orgId
            ? (await prisma.credential.findMany({
                where: { organization_id: orgId },
                select: { id: true },
            })).map(u => Number(u.id))
            : [];

        const [
            totalUsers,
            activeUsers,
            demoUsers,
            totalRoles,
            totalPermissions,
            recentLogins,
            recentActivity,
            totalDocuments,
        ] = await Promise.all([
            prisma.credential.count({ where: orgFilter }),
            prisma.credential.count({ where: { ...orgFilter, isValid: true } }),
            prisma.credential.count({ where: { ...orgFilter, isDemo: true } }),
            prisma.role.count(),
            prisma.permission.count(),
            prisma.userLoginHistory.count({
                where: {
                    loginTime: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
                    ...(orgUserIds.length > 0 ? { userId: { in: orgUserIds } } : {}),
                },
            }),
            prisma.userActivityLog.count({
                where: {
                    createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
                    ...(orgUserIds.length > 0 ? { userId: { in: orgUserIds } } : {}),
                },
            }),
            0, // Document model removed
        ]);

        // Get subscription limits
        let subscription = null;
        if (orgId) {
            subscription = await prisma.organization_subscriptions.findFirst({
                where: { organization_id: orgId, status: 'active' },
                orderBy: { created_at: 'desc' },
            });
        }

        res.json({
            success: true,
            stats: {
                totalUsers,
                activeUsers,
                demoUsers,
                inactiveUsers: totalUsers - activeUsers,
                totalRoles,
                totalPermissions,
                recentLogins,
                recentActivity,
                totalDocuments,
                subscription: subscription ? {
                    plan: subscription.plan,
                    maxUsers: subscription.max_users,
                    maxInvoicesPerMonth: subscription.max_invoices_per_month,
                    expiresAt: subscription.expires_at,
                } : null,
            },
        });
    } catch (error: any) {
        console.error('Get stats error:', error);
        res.status(500).json({ success: false, message: 'Failed to get stats', error: error.message });
    }
});

// ============================================
// ORG USER MANAGEMENT ENDPOINTS
// ============================================

/**
 * GET /api/admin/users — List all users in the current user's org
 */
router.get('/users', authenticate, async (req, res) => {
    try {
        const pool = (req as any).app.get('pool');
        const orgId = await resolveOrgId(req);
        if (!orgId) {
            return res.json({ success: true, users: [] });
        }

        // Get portal users for this org
        const portalResult = await pool.query(
            `SELECT pu.id, pu.username, pu.email, pu.full_name, pu.is_active, pu.email_verified,
                    pu.created_at, pu.last_login_at
             FROM "otaxdb".portal_users pu
             WHERE pu.organization_id = $1
             ORDER BY pu.created_at DESC`,
            [orgId]
        ).catch(() => ({ rows: [] }));

        // Get legacy credential users for this org
        const legacyResult = await pool.query(
            `SELECT c.id, c.username, c.email, c."isValid", c."registerDate", c."expiryDate"
             FROM "otaxdb".credentials c
             WHERE c.organization_id = $1
             ORDER BY c."registerDate" DESC`,
            [orgId]
        ).catch(() => ({ rows: [] }));

        // Get roles for portal users
        const portalUserIds = portalResult.rows.map((u: any) => u.id);
        let portalRolesMap: Record<string, any[]> = {};
        if (portalUserIds.length > 0) {
            const rolesResult = await pool.query(
                `SELECT pur.user_id, r.id as role_id, r.name, r.display_name as "displayName"
                 FROM "otaxdb".portal_user_roles pur
                 JOIN "otaxdb".roles r ON r.id = pur.role_id
                 WHERE pur.user_id = ANY($1)`,
                [portalUserIds]
            ).catch(() => ({ rows: [] }));
            for (const row of rolesResult.rows) {
                if (!portalRolesMap[row.user_id]) portalRolesMap[row.user_id] = [];
                portalRolesMap[row.user_id].push({ id: row.role_id, name: row.name, displayName: row.displayName });
            }
        }

        // Get roles for legacy users
        const legacyUserIds = legacyResult.rows.map((u: any) => Number(u.id));
        let legacyRolesMap: Record<number, any[]> = {};
        if (legacyUserIds.length > 0) {
            const rolesResult = await pool.query(
                `SELECT ur.user_id, r.id as role_id, r.name, r.display_name as "displayName"
                 FROM "otaxdb".user_roles ur
                 JOIN "otaxdb".roles r ON r.id = ur.role_id
                 WHERE ur.user_id = ANY($1::bigint[])`,
                [legacyUserIds]
            ).catch(() => ({ rows: [] }));
            for (const row of rolesResult.rows) {
                const uid = Number(row.user_id);
                if (!legacyRolesMap[uid]) legacyRolesMap[uid] = [];
                legacyRolesMap[uid].push({ id: row.role_id, name: row.name, displayName: row.displayName });
            }
        }

        // Combine into unified list
        const users: any[] = [];

        for (const pu of portalResult.rows) {
            users.push({
                id: Number(pu.id),
                username: pu.username || pu.full_name || pu.email?.split('@')[0],
                email: pu.email,
                email_verified: pu.email_verified,
                isValid: pu.is_active !== false,
                isDemo: false,
                registerDate: pu.created_at,
                expiryDate: null,
                roles: portalRolesMap[pu.id] || [],
                source: 'portal',
            });
        }

        for (const cu of legacyResult.rows) {
            // Skip if same email already in portal users
            const alreadyExists = users.some(u => u.email && u.email === cu.email);
            if (alreadyExists) continue;

            users.push({
                id: Number(cu.id),
                username: cu.username,
                email: cu.email,
                email_verified: false,
                isValid: cu.isValid !== false,
                isDemo: false,
                registerDate: cu.registerDate,
                expiryDate: cu.expiryDate,
                roles: legacyRolesMap[Number(cu.id)] || [{ id: 0, name: 'org_admin', displayName: 'Admin' }],
                source: 'legacy',
            });
        }

        res.json({ success: true, users });
    } catch (error: any) {
        console.error('[Admin] Get users error:', error.message);
        res.json({ success: true, users: [], error: error.message });
    }
});

/**
 * POST /api/admin/users — Create a new user in the org
 */
router.post('/users', authenticate, async (req, res) => {
    try {
        const orgId = await resolveOrgId(req);
        if (!orgId) return res.status(400).json({ success: false, message: 'No organization found' });

        const { username, email, password, roleIds } = req.body;
        if (!password || (!username && !email)) {
            return res.status(400).json({ success: false, message: 'Username/email and password are required' });
        }
        const hashedPassword = await bcrypt.hash(password, 10);

        const user = await prisma.portalUser.create({
            data: {
                email: email || null,
                username: username || email?.split('@')[0] || 'user',
                full_name: username || null,
                password: hashedPassword,
                is_active: true,
                email_verified: false,
                organization_id: orgId,
            },
        });

        // Assign roles
        if (roleIds?.length > 0) {
            for (const roleId of roleIds) {
                await prisma.portalUserRole.create({
                    data: { userId: user.id, roleId },
                }).catch(() => { });
            }
        }

        res.json({ success: true, message: 'User created', userId: Number(user.id) });
    } catch (error: any) {
        console.error('[Admin] Create user error:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * PUT /api/admin/users/:id — Update user (activate/deactivate)
 */
router.put('/users/:id', authenticate, async (req, res) => {
    try {
        const userId = BigInt(req.params.id);
        const { isValid } = req.body;

        // Try portal_users first
        try {
            await prisma.portalUser.update({
                where: { id: userId },
                data: { is_active: isValid },
            });
            return res.json({ success: true, message: 'User updated' });
        } catch { }

        // Fallback to credentials
        try {
            await prisma.credential.update({
                where: { id: userId },
                data: { isValid },
            });
            return res.json({ success: true, message: 'User updated' });
        } catch { }

        res.status(404).json({ success: false, message: 'User not found' });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * DELETE /api/admin/users/:id — Delete a user
 */
router.delete('/users/:id', authenticate, async (req, res) => {
    try {
        const userId = BigInt(req.params.id);

        // Try portal_users first
        try {
            await prisma.portalUserRole.deleteMany({ where: { userId } });
            await prisma.portalUser.delete({ where: { id: userId } });
            return res.json({ success: true, message: 'User deleted' });
        } catch { }

        // Fallback to credentials
        try {
            await prisma.credential.delete({ where: { id: userId } });
            return res.json({ success: true, message: 'User deleted' });
        } catch { }

        res.status(404).json({ success: false, message: 'User not found' });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/admin/roles — List all available roles
 */
router.get('/roles', authenticate, async (req, res) => {
    try {
        const roles = await prisma.role.findMany({
            orderBy: { id: 'asc' },
            select: { id: true, name: true, displayName: true, description: true },
        });
        res.json({ success: true, roles });
    } catch (error: any) {
        console.error('[Admin] Get roles error:', error.message);
        res.json({ success: true, roles: [] });
    }
});

export default router;
