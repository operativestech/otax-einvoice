import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../prisma';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Extend Express Request to include user
declare global {
    namespace Express {
        interface Request {
            user?: {
                id: number;
                username: string;
                isDemo: boolean;
                organizationId: number | null;
                organizationName: string | null;
                roles: string[];
                permissions: string[];
                isSuperAdmin: boolean;
                isOrgAdmin: boolean;
            };
        }
    }
}

/**
 * Authentication Middleware
 * Verifies JWT token and attaches user info to request
 * Strategy: portal_users first → credentials fallback → RBAC loading
 */
export const authenticate = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');

        if (!token) {
            return res.status(401).json({ success: false, message: 'No token provided' });
        }

        const decoded = jwt.verify(token, JWT_SECRET) as { userId: number };

        // Use pool (raw SQL) — Prisma may point to a different DB on Render
        const pool = req.app?.get('pool');
        let user: any = null;
        let isPortalUser = false;

        // ── Step 0: Check super_admins table FIRST (platform-level) ──
        if (pool) {
            try {
                const superResult = await pool.query(
                    `SELECT id, username, email, is_active, full_name
                     FROM "otaxdb".super_admins WHERE id = $1 LIMIT 1`,
                    [decoded.userId]
                );
                if (superResult.rows.length > 0) {
                    const sa = superResult.rows[0];
                    if (!sa.is_active) {
                        return res.status(401).json({ success: false, message: 'Super admin account disabled' });
                    }
                    req.user = {
                        id: Number(sa.id),
                        username: sa.username || sa.email,
                        isDemo: false,
                        organizationId: null,
                        organizationName: null,
                        roles: ['super_admin'],
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
                            // Phase 1-4 additions
                            'packages.view', 'packages.manage',
                            'reconciliation.view', 'reconciliation.manage',
                            'signing.view', 'signing.manage',
                            'assistant.use',
                        ],
                        isSuperAdmin: true,
                        isOrgAdmin: true,
                    };
                    return next();
                }
            } catch (superErr: any) {
                // Table may not exist yet — skip
            }
        }

        // ── Step 1: Check portal_users table FIRST ──
        if (pool) {
            try {
                const portalResult = await pool.query(
                    `SELECT id, email, username, is_active, email_verified, organization_id
                     FROM "otaxdb".portal_users WHERE id = $1 LIMIT 1`,
                    [decoded.userId]
                );
                if (portalResult.rows.length > 0) {
                    user = portalResult.rows[0];
                    user.isValid = user.is_active;
                    user.isDemo = false;
                    isPortalUser = true;
                }
            } catch (portalErr: any) {
                // Table may not exist yet — skip
            }
        }

        // ── Step 2: Fallback to legacy credentials ──
        if (!user && pool) {
            try {
                const result = await pool.query(
                    `SELECT id, username, "isValid", "isDemo", organization_id, email
                     FROM "otaxdb".credentials WHERE id = $1 LIMIT 1`,
                    [decoded.userId]
                );
                if (result.rows.length > 0) {
                    user = result.rows[0];
                }
            } catch (poolErr: any) {
                console.warn('[Auth] Pool query failed, trying Prisma:', poolErr.message);
            }
        }

        // Fallback to Prisma if pool didn't work
        if (!user) {
            try {
                user = await prisma.credential.findUnique({
                    where: { id: decoded.userId },
                });
            } catch (prismaErr: any) {
                console.warn('[Auth] Prisma query also failed:', prismaErr.message);
            }
        }

        if (!user || user.isValid === false) {
            return res.status(401).json({ success: false, message: 'Invalid or inactive user' });
        }

        // Default roles and permissions (dot notation — matches Sidebar requirements)
        const roles: string[] = ['org_admin'];
        const permissions: string[] = [
            'dashboard.view',
            'invoices.view', 'invoices.create', 'invoices.edit', 'invoices.delete', 'invoices.cancel',
            'reports.view', 'reports.export',
            'settings.view', 'settings.edit',
            'masterdata.view', 'masterdata.edit',
            'erp.view', 'erp.configure',
            'org_users.view', 'org_users.create', 'org_users.edit', 'org_users.delete',
            // Phase 1-4 additions — granted to default org_admin so existing users aren't locked out.
            'packages.view', 'packages.manage',
            'reconciliation.view', 'reconciliation.manage',
            'signing.view', 'signing.manage',
            'assistant.use',
        ];

        // Try to load RBAC roles if tables exist
        if (pool) {
            try {
                // Use portal_user_roles for portal users, user_roles for legacy
                const roleTable = isPortalUser ? 'portal_user_roles' : 'user_roles';
                const rolesResult = await pool.query(
                    `SELECT r.name FROM "otaxdb".${roleTable} ur
                     JOIN "otaxdb".roles r ON r.id = ur.role_id
                     WHERE ur.user_id = $1`,
                    [decoded.userId]
                );
                if (rolesResult.rows.length > 0) {
                    roles.length = 0;
                    roles.push(...rolesResult.rows.map(r => r.name));

                    const permsResult = await pool.query(
                        `SELECT DISTINCT p.name FROM "otaxdb".role_permissions rp
                         JOIN "otaxdb".permissions p ON p.id = rp.permission_id
                         JOIN "otaxdb".${roleTable} ur ON ur.role_id = rp.role_id
                         WHERE ur.user_id = $1`,
                        [decoded.userId]
                    );
                    if (permsResult.rows.length > 0) {
                        permissions.length = 0;
                        permissions.push(...permsResult.rows.map(r => r.name));
                    }
                }
            } catch (rbacErr: any) {
                // RBAC tables don't exist — use defaults
            }
        }

        const isSuperAdmin = roles.includes('super_admin');
        const isOrgAdmin = roles.includes('org_admin') || roles.includes('admin');

        // ── Resolve organization for legacy users without org_id ──
        let resolvedOrgId = user.organization_id || null;
        if (!resolvedOrgId && !isSuperAdmin && pool) {
            try {
                // Try to find the first available organization for this legacy user
                const orgResult = await pool.query(
                    `SELECT id FROM "otaxdb".organizations WHERE is_active = true ORDER BY id ASC LIMIT 1`
                );
                if (orgResult.rows.length > 0) {
                    resolvedOrgId = orgResult.rows[0].id;
                    console.log(`[Auth] Auto-resolved org ${resolvedOrgId} for legacy user ${user.id}`);
                    // Also update the credential record for future logins
                    await pool.query(
                        `UPDATE "otaxdb".credentials SET organization_id = $1 WHERE id = $2 AND (organization_id IS NULL)`,
                        [resolvedOrgId, user.id]
                    ).catch(() => { });
                }
            } catch (orgErr: any) {
                // Non-critical — continue without org
            }
        }

        // Attach user to request
        req.user = {
            id: Number(user.id),
            username: user.username || user.email || 'user',
            isDemo: user.isDemo || false,
            organizationId: resolvedOrgId,
            organizationName: null,
            roles: Array.from(new Set(roles)),
            permissions: Array.from(new Set(permissions)),
            isSuperAdmin,
            isOrgAdmin,
        };

        next();
    } catch (error) {
        console.error('Authentication error:', error);
        return res.status(401).json({ success: false, message: 'Invalid token' });
    }
};

/**
 * Authorization Middleware Factory
 * Creates middleware that checks for specific permissions
 */
export const authorize = (...requiredPermissions: string[]) => {
    return (req: Request, res: Response, next: NextFunction) => {
        if (!req.user) {
            return res.status(401).json({ success: false, message: 'Not authenticated' });
        }

        // Super admin bypasses all permission checks
        if (req.user.isSuperAdmin) {
            return next();
        }

        const hasPermission = requiredPermissions.some(permission =>
            req.user!.permissions.includes(permission)
        );

        if (!hasPermission) {
            return res.status(403).json({
                success: false,
                message: 'Insufficient permissions',
                required: requiredPermissions,
            });
        }

        next();
    };
};

/**
 * Role-based Authorization
 * Checks if user has any of the specified roles
 */
export const requireRole = (...requiredRoles: string[]) => {
    return (req: Request, res: Response, next: NextFunction) => {
        if (!req.user) {
            return res.status(401).json({ success: false, message: 'Not authenticated' });
        }

        // Super admin bypasses all role checks
        if (req.user.isSuperAdmin) {
            return next();
        }

        const hasRole = requiredRoles.some(role => req.user!.roles.includes(role));

        if (!hasRole) {
            return res.status(403).json({
                success: false,
                message: 'Insufficient role',
                required: requiredRoles,
            });
        }

        next();
    };
};

/**
 * Super Admin Only Middleware
 * Only platform-level super admins can access
 */
export const requireSuperAdmin = (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
        return res.status(401).json({ success: false, message: 'Not authenticated' });
    }

    if (!req.user.isSuperAdmin) {
        return res.status(403).json({
            success: false,
            message: 'Super Admin access required. This action is restricted to platform administrators.',
        });
    }

    next();
};

/**
 * Org Admin or Super Admin Middleware
 * Organization admins or super admins can access
 */
export const requireOrgAdmin = (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
        return res.status(401).json({ success: false, message: 'Not authenticated' });
    }

    if (!req.user.isSuperAdmin && !req.user.isOrgAdmin) {
        return res.status(403).json({
            success: false,
            message: 'Organization Admin access required.',
        });
    }

    next();
};

/**
 * Admin Only Middleware (backwards compatible — allows super_admin, org_admin, admin)
 */
export const adminOnly = requireRole('admin', 'super_admin', 'org_admin');

/**
 * Enforce Organization Scope Middleware
 * Ensures the user has an organizationId (unless super admin accessing a specific org)
 * For super admins, they can optionally specify ?orgId= to scope their requests
 */
export const enforceOrgScope = (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
        return res.status(401).json({ success: false, message: 'Not authenticated' });
    }

    // Super admin can access any org via query parameter
    if (req.user.isSuperAdmin) {
        const orgIdParam = req.query.orgId || req.params.orgId;
        if (orgIdParam) {
            // Override the organizationId for this request to scope to a specific org
            (req as any).scopedOrgId = parseInt(orgIdParam as string);
        }
        // Super admin without orgId works on all orgs (no scope)
        return next();
    }

    // Non-super-admin MUST have an organizationId
    if (!req.user.organizationId) {
        return res.status(403).json({
            success: false,
            message: 'User is not linked to an organization. Contact your administrator.',
        });
    }

    // Set scoped org ID to the user's own org
    (req as any).scopedOrgId = req.user.organizationId;
    next();
};

/**
 * Helper to get the scoped organization ID from the request
 * Returns the org ID to use for filtering queries
 */
export const getScopedOrgId = (req: Request): number | null => {
    return (req as any).scopedOrgId || req.user?.organizationId || null;
};

/**
 * Check Subscription Limits Middleware Factory
 * Checks if the organization has reached its subscription limits
 */
export const checkSubscriptionLimit = (limitType: 'users' | 'invoices') => {
    return async (req: Request, res: Response, next: NextFunction) => {
        if (!req.user) {
            return res.status(401).json({ success: false, message: 'Not authenticated' });
        }

        // Super admin bypasses limits
        if (req.user.isSuperAdmin) {
            return next();
        }

        const orgId = getScopedOrgId(req);
        if (!orgId) {
            return res.status(403).json({ success: false, message: 'No organization context' });
        }

        try {
            // Get active subscription
            const subscription = await prisma.organization_subscriptions.findFirst({
                where: {
                    organization_id: orgId,
                    status: 'active',
                },
            });

            if (!subscription) {
                return res.status(403).json({
                    success: false,
                    message: 'No active subscription found. Contact platform administrator.',
                });
            }

            // Check expiry
            if (subscription.expires_at && new Date() > subscription.expires_at) {
                return res.status(403).json({
                    success: false,
                    message: 'Subscription has expired. Please renew your subscription.',
                });
            }

            if (limitType === 'users') {
                const currentUserCount = await prisma.credential.count({
                    where: { organization_id: orgId },
                });

                if (subscription.max_users && currentUserCount >= subscription.max_users) {
                    return res.status(403).json({
                        success: false,
                        message: `User limit reached (${currentUserCount}/${subscription.max_users}). Upgrade your subscription to add more users.`,
                        limit: subscription.max_users,
                        current: currentUserCount,
                    });
                }
            }

            if (limitType === 'invoices') {
                // Count invoices created this month
                const startOfMonth = new Date();
                startOfMonth.setDate(1);
                startOfMonth.setHours(0, 0, 0, 0);

                // Invoice counting disabled — Document model removed
                // Invoice limits should be checked against InvoicesDb org tables
                const currentInvoiceCount = 0;

                if (subscription.max_invoices_per_month && currentInvoiceCount >= subscription.max_invoices_per_month) {
                    return res.status(403).json({
                        success: false,
                        message: `Monthly invoice limit reached (${currentInvoiceCount}/${subscription.max_invoices_per_month}). Upgrade your subscription.`,
                        limit: subscription.max_invoices_per_month,
                        current: currentInvoiceCount,
                    });
                }
            }

            next();
        } catch (error) {
            console.error('Subscription check error:', error);
            // Don't block on subscription check failures
            next();
        }
    };
};

/**
 * Block Demo Users from Modifying Data
 */
export const blockDemo = (req: Request, res: Response, next: NextFunction) => {
    if (req.user?.isDemo && req.method !== 'GET') {
        return res.status(403).json({
            success: false,
            message: 'Demo users cannot modify data',
        });
    }
    next();
};

/**
 * Generate JWT Token
 */
export const generateToken = (userId: number): string => {
    return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '24h' });
};

/**
 * Log User Activity
 */
export const logActivity = async (
    userId: number,
    username: string,
    action: string,
    module?: string,
    resourceType?: string,
    resourceId?: string,
    details?: any,
    req?: Request
) => {
    try {
        await prisma.userActivityLog.create({
            data: {
                userId,
                username,
                action,
                module,
                resourceType,
                resourceId,
                details: details ? JSON.stringify(details) : null,
                ipAddress: req?.ip || req?.headers['x-forwarded-for'] as string || null,
                userAgent: req?.headers['user-agent'] || null,
                status: 'success',
            },
        });
    } catch (error) {
        console.error('Failed to log activity:', error);
    }
};

/**
 * Log User Login
 */
export const logLogin = async (userId: number, username: string, req: Request) => {
    try {
        await prisma.userLoginHistory.create({
            data: {
                userId,
                username,
                ipAddress: req.ip || req.headers['x-forwarded-for'] as string || null,
                userAgent: req.headers['user-agent'] || null,
                status: 'active',
            },
        });
    } catch (error) {
        console.error('Failed to log login:', error);
    }
};
