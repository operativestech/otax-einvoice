import express from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../prisma';
import {
    authenticate,
    requireSuperAdmin,
    logActivity,
    blockDemo,
} from '../middleware/auth';

const router = express.Router();

// All routes in this file require super admin access
router.use(authenticate, requireSuperAdmin);

// ============================================
// PLATFORM DASHBOARD STATS
// ============================================

/**
 * Get platform-wide statistics (Super Admin)
 * GET /api/super-admin/stats
 */
router.get('/stats', async (req, res) => {
    try {
        const [
            totalOrgs,
            activeOrgs,
            totalUsers,
            activeUsers,
            totalDocuments,
            recentOrgs,
        ] = await Promise.all([
            prisma.organizations.count(),
            prisma.organizations.count({ where: { is_active: true } }),
            prisma.credential.count(),
            prisma.credential.count({ where: { isValid: true } }),
            0, // Document model removed
            prisma.organizations.findMany({
                orderBy: { created_at: 'desc' },
                take: 5,
                select: {
                    id: true,
                    name: true,
                    tax_id: true,
                    is_active: true,
                    subscription_plan: true,
                    created_at: true,
                    _count: {
                        select: { credentials: true },
                    },
                },
            }),
        ]);

        // Get subscription stats
        const subscriptionStats = await prisma.organization_subscriptions.groupBy({
            by: ['plan'],
            _count: { id: true },
            where: { status: 'active' },
        });

        res.json({
            success: true,
            stats: {
                totalOrganizations: totalOrgs,
                activeOrganizations: activeOrgs,
                inactiveOrganizations: totalOrgs - activeOrgs,
                totalUsers,
                activeUsers,
                totalDocuments,
                recentOrganizations: recentOrgs.map(org => ({
                    ...org,
                    userCount: org._count.credentials,
                })),
                subscriptionBreakdown: subscriptionStats.map(s => ({
                    plan: s.plan,
                    count: s._count.id,
                })),
            },
        });
    } catch (error: any) {
        console.error('Super admin stats error:', error);
        res.status(500).json({ success: false, message: 'Failed to get platform stats', error: error.message });
    }
});

// ============================================
// ORGANIZATION MANAGEMENT
// ============================================

/**
 * List all organizations
 * GET /api/super-admin/organizations
 */
router.get('/organizations', async (req, res) => {
    try {
        const { search, status, plan, page = '1', limit = '20' } = req.query;
        const skip = (parseInt(page as string) - 1) * parseInt(limit as string);

        const where: any = {};
        if (search) {
            where.OR = [
                { name: { contains: search as string, mode: 'insensitive' } },
                { tax_id: { contains: search as string, mode: 'insensitive' } },
                { email: { contains: search as string, mode: 'insensitive' } },
            ];
        }
        if (status === 'active') where.is_active = true;
        if (status === 'inactive') where.is_active = false;
        if (plan) where.subscription_plan = plan;

        const [organizations, total] = await Promise.all([
            prisma.organizations.findMany({
                where,
                include: {
                    _count: {
                        select: {
                            credentials: true,
                        },
                    },
                    organization_subscriptions: {
                        where: { status: 'active' },
                        take: 1,
                        orderBy: { created_at: 'desc' },
                    },
                },
                orderBy: { created_at: 'desc' },
                skip,
                take: parseInt(limit as string),
            }),
            prisma.organizations.count({ where }),
        ]);

        // Get document counts per org separately (since documents relation may not be generated yet)
        const orgIds = organizations.map(o => o.id);
        const docCounts = await Promise.all(
            orgIds.map(async (orgId) => {
                const count = 0; // Document model removed — use InvoicesDb org tables
                return { orgId, count };
            })
        );
        const docCountMap = new Map(docCounts.map(d => [d.orgId, d.count]));

        const orgsWithDetails = organizations.map(org => ({
            id: org.id,
            name: org.name,
            tax_id: org.tax_id,
            company_type: org.company_type,
            email: org.email,
            phone: org.phone,
            country: org.country,
            governorate: org.governorate,
            city: org.city,
            is_active: org.is_active,
            subscription_plan: org.subscription_plan,
            created_at: org.created_at,
            userCount: org._count.credentials,
            documentCount: docCountMap.get(org.id) || 0,
            subscription: org.organization_subscriptions[0] || null,
        }));

        res.json({
            success: true,
            organizations: orgsWithDetails,
            pagination: {
                total,
                page: parseInt(page as string),
                limit: parseInt(limit as string),
                totalPages: Math.ceil(total / parseInt(limit as string)),
            },
        });
    } catch (error: any) {
        console.error('List organizations error:', error);
        res.status(500).json({ success: false, message: 'Failed to list organizations', error: error.message });
    }
});

/**
 * Get organization details
 * GET /api/super-admin/organizations/:id
 */
router.get('/organizations/:id', async (req, res) => {
    try {
        const orgId = parseInt(req.params.id);

        const org = await prisma.organizations.findUnique({
            where: { id: orgId },
            include: {
                credentials: {
                    select: {
                        id: true,
                        username: true,
                        isValid: true,
                        isDemo: true,
                        registerDate: true,
                        expiryDate: true,
                        userRoles: {
                            include: {
                                role: { select: { id: true, name: true, displayName: true } },
                            },
                        },
                    },
                },
                organization_settings: true,
                organization_subscriptions: {
                    orderBy: { created_at: 'desc' },
                },
                eta_credentials: {
                    select: {
                        id: true,
                        environment: true,
                        isActive: true,
                        lastValidated: true,
                        validationStatus: true,
                    },
                },
                _count: {
                    select: {
                        credentials: true,
                        organization_audit_logs: true,
                    },
                },
            },
        });

        if (!org) {
            return res.status(404).json({ success: false, message: 'Organization not found' });
        }

        // Document model removed — use InvoicesDb org tables for counting
        const documentCount = 0;

        res.json({
            success: true,
            organization: {
                ...org,
                documentCount,
            },
        });
    } catch (error: any) {
        console.error('Get organization error:', error);
        res.status(500).json({ success: false, message: 'Failed to get organization', error: error.message });
    }
});

/**
 * Create new organization
 * POST /api/super-admin/organizations
 */
router.post('/organizations', blockDemo, async (req, res) => {
    try {
        const {
            name, tax_id, company_type, email, phone, website,
            country, governorate, city, street, building_number, postal_code,
            subscription_plan, admin_username, admin_password,
            max_users, max_invoices_per_month,
        } = req.body;

        if (!name || !tax_id) {
            return res.status(400).json({ success: false, message: 'Organization name and tax ID are required' });
        }

        if (!admin_username || !admin_password) {
            return res.status(400).json({ success: false, message: 'Admin username and password are required for the new organization' });
        }

        // Check if tax_id already exists
        const existing = await prisma.organizations.findUnique({ where: { tax_id } });
        if (existing) {
            return res.status(400).json({ success: false, message: 'An organization with this Tax ID already exists' });
        }

        // Check if admin username is taken
        const existingUser = await prisma.credential.findFirst({ where: { username: admin_username } });
        if (existingUser) {
            return res.status(400).json({ success: false, message: 'Admin username already exists' });
        }

        // Create organization
        const org = await prisma.organizations.create({
            data: {
                name,
                tax_id,
                company_type,
                email,
                phone,
                website,
                country,
                governorate,
                city,
                street,
                building_number,
                postal_code,
                subscription_plan: subscription_plan || 'free',
                is_active: true,
                created_by: req.user!.id,
            },
        });

        // Create subscription
        const planLimits: Record<string, { users: number; invoices: number; storage: number }> = {
            free: { users: 3, invoices: 50, storage: 1 },
            starter: { users: 5, invoices: 200, storage: 5 },
            professional: { users: 15, invoices: 1000, storage: 20 },
            enterprise: { users: 999, invoices: 999999, storage: 100 },
        };
        const limits = planLimits[subscription_plan || 'free'] || planLimits.free;

        await prisma.organization_subscriptions.create({
            data: {
                organization_id: org.id,
                plan: subscription_plan || 'free',
                status: 'active',
                max_users: max_users || limits.users,
                max_invoices_per_month: max_invoices_per_month || limits.invoices,
                max_storage_gb: limits.storage,
                billing_cycle: 'monthly',
                starts_at: new Date(),
                expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            },
        });

        // Create organization settings
        await prisma.organization_settings.create({
            data: {
                organization_id: org.id,
            },
        });

        // Create admin user for this organization
        const hashedPassword = await bcrypt.hash(admin_password, 10);
        const adminUser = await prisma.credential.create({
            data: {
                username: admin_username,
                password: hashedPassword,
                isValid: true,
                isDemo: false,
                registerDate: new Date(),
                expiryDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
                organization_id: org.id,
            },
        });

        // Assign org_admin role
        const orgAdminRole = await prisma.role.findUnique({ where: { name: 'org_admin' } });
        if (orgAdminRole) {
            await prisma.userRole.create({
                data: {
                    userId: adminUser.id,
                    roleId: orgAdminRole.id,
                    assignedBy: req.user!.id,
                },
            });
        }

        // Log activity
        await logActivity(req.user!.id, req.user!.username, 'organization_created', 'super_admin', 'organization', org.id.toString(), { name, tax_id, admin_username }, req);

        res.json({
            success: true,
            message: 'Organization created successfully',
            organization: {
                id: org.id,
                name: org.name,
                tax_id: org.tax_id,
                subscription_plan: org.subscription_plan,
                adminUser: {
                    id: adminUser.id,
                    username: adminUser.username,
                },
            },
        });
    } catch (error: any) {
        console.error('Create organization error:', error);
        res.status(500).json({ success: false, message: 'Failed to create organization', error: error.message });
    }
});

/**
 * Update organization
 * PUT /api/super-admin/organizations/:id
 */
router.put('/organizations/:id', blockDemo, async (req, res) => {
    try {
        const orgId = parseInt(req.params.id);
        const {
            name, email, phone, website, company_type,
            country, governorate, city, street, building_number, postal_code,
            is_active, subscription_plan,
        } = req.body;

        const updateData: any = {};
        if (name !== undefined) updateData.name = name;
        if (email !== undefined) updateData.email = email;
        if (phone !== undefined) updateData.phone = phone;
        if (website !== undefined) updateData.website = website;
        if (company_type !== undefined) updateData.company_type = company_type;
        if (country !== undefined) updateData.country = country;
        if (governorate !== undefined) updateData.governorate = governorate;
        if (city !== undefined) updateData.city = city;
        if (street !== undefined) updateData.street = street;
        if (building_number !== undefined) updateData.building_number = building_number;
        if (postal_code !== undefined) updateData.postal_code = postal_code;
        if (typeof is_active === 'boolean') updateData.is_active = is_active;
        if (subscription_plan !== undefined) updateData.subscription_plan = subscription_plan;
        updateData.updated_at = new Date();

        const org = await prisma.organizations.update({
            where: { id: orgId },
            data: updateData,
        });

        await logActivity(req.user!.id, req.user!.username, 'organization_updated', 'super_admin', 'organization', orgId.toString(), updateData, req);

        res.json({ success: true, message: 'Organization updated successfully', organization: org });
    } catch (error: any) {
        console.error('Update organization error:', error);
        res.status(500).json({ success: false, message: 'Failed to update organization', error: error.message });
    }
});

/**
 * Delete organization
 * DELETE /api/super-admin/organizations/:id
 */
router.delete('/organizations/:id', blockDemo, async (req, res) => {
    try {
        const orgId = parseInt(req.params.id);

        // Prevent deleting the platform org
        const org = await prisma.organizations.findUnique({ where: { id: orgId } });
        if (!org) {
            return res.status(404).json({ success: false, message: 'Organization not found' });
        }
        if (org.tax_id === 'PLATFORM-001') {
            return res.status(400).json({ success: false, message: 'Cannot delete the platform organization' });
        }

        // Cascade delete handles related records via Prisma schema
        await prisma.organizations.delete({ where: { id: orgId } });

        await logActivity(req.user!.id, req.user!.username, 'organization_deleted', 'super_admin', 'organization', orgId.toString(), { name: org.name, tax_id: org.tax_id }, req);

        res.json({ success: true, message: 'Organization deleted successfully' });
    } catch (error: any) {
        console.error('Delete organization error:', error);
        res.status(500).json({ success: false, message: 'Failed to delete organization', error: error.message });
    }
});

// ============================================
// ORGANIZATION SUBSCRIPTION MANAGEMENT
// ============================================

/**
 * Update organization subscription
 * PUT /api/super-admin/organizations/:id/subscription
 */
router.put('/organizations/:id/subscription', blockDemo, async (req, res) => {
    try {
        const orgId = parseInt(req.params.id);
        const {
            plan, max_users, max_invoices_per_month, max_storage_gb,
            billing_cycle, expires_at, status,
        } = req.body;

        // Deactivate current active subscription
        await prisma.organization_subscriptions.updateMany({
            where: { organization_id: orgId, status: 'active' },
            data: { status: 'superseded', cancelled_at: new Date() },
        });

        // Create new subscription
        const subscription = await prisma.organization_subscriptions.create({
            data: {
                organization_id: orgId,
                plan: plan || 'free',
                status: status || 'active',
                max_users: max_users || 5,
                max_invoices_per_month: max_invoices_per_month || 100,
                max_storage_gb: max_storage_gb || 5,
                billing_cycle: billing_cycle || 'monthly',
                starts_at: new Date(),
                expires_at: expires_at ? new Date(expires_at) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            },
        });

        // Update org's plan reference
        await prisma.organizations.update({
            where: { id: orgId },
            data: { subscription_plan: plan || 'free' },
        });

        await logActivity(req.user!.id, req.user!.username, 'subscription_updated', 'super_admin', 'subscription', subscription.id.toString(), { orgId, plan, max_users, max_invoices_per_month }, req);

        res.json({ success: true, message: 'Subscription updated successfully', subscription });
    } catch (error: any) {
        console.error('Update subscription error:', error);
        res.status(500).json({ success: false, message: 'Failed to update subscription', error: error.message });
    }
});

/**
 * Toggle organization active status
 * PUT /api/super-admin/organizations/:id/toggle-active
 */
router.put('/organizations/:id/toggle-active', blockDemo, async (req, res) => {
    try {
        const orgId = parseInt(req.params.id);

        const org = await prisma.organizations.findUnique({ where: { id: orgId } });
        if (!org) {
            return res.status(404).json({ success: false, message: 'Organization not found' });
        }

        if (org.tax_id === 'PLATFORM-001') {
            return res.status(400).json({ success: false, message: 'Cannot deactivate the platform organization' });
        }

        const updated = await prisma.organizations.update({
            where: { id: orgId },
            data: { is_active: !org.is_active },
        });

        await logActivity(req.user!.id, req.user!.username, updated.is_active ? 'organization_activated' : 'organization_deactivated', 'super_admin', 'organization', orgId.toString(), undefined, req);

        res.json({
            success: true,
            message: `Organization ${updated.is_active ? 'activated' : 'deactivated'} successfully`,
            is_active: updated.is_active,
        });
    } catch (error: any) {
        console.error('Toggle org active error:', error);
        res.status(500).json({ success: false, message: 'Failed to toggle organization status', error: error.message });
    }
});

// ============================================
// ORGANIZATION USER MANAGEMENT (Super Admin)
// ============================================

/**
 * Get users for a specific organization
 * GET /api/super-admin/organizations/:id/users
 */
router.get('/organizations/:id/users', async (req, res) => {
    try {
        const orgId = parseInt(req.params.id);

        const users = await prisma.credential.findMany({
            where: { organization_id: orgId },
            include: {
                userRoles: {
                    include: {
                        role: { select: { id: true, name: true, displayName: true } },
                    },
                },
            },
            orderBy: { id: 'asc' },
        });

        const usersWithRoles = users.map(user => ({
            id: user.id,
            username: user.username,
            isValid: user.isValid,
            isDemo: user.isDemo,
            registerDate: user.registerDate,
            expiryDate: user.expiryDate,
            roles: user.userRoles.map(ur => ({
                id: ur.role.id,
                name: ur.role.name,
                displayName: ur.role.displayName,
            })),
        }));

        res.json({ success: true, users: usersWithRoles });
    } catch (error: any) {
        console.error('Get org users error:', error);
        res.status(500).json({ success: false, message: 'Failed to get organization users', error: error.message });
    }
});

/**
 * Add user to a specific organization (Super Admin)
 * POST /api/super-admin/organizations/:id/users
 */
router.post('/organizations/:id/users', blockDemo, async (req, res) => {
    try {
        const orgId = parseInt(req.params.id);
        const { username, password, roleIds } = req.body;

        if (!username || !password) {
            return res.status(400).json({ success: false, message: 'Username and password required' });
        }

        // Check if username exists
        const existing = await prisma.credential.findFirst({ where: { username } });
        if (existing) {
            return res.status(400).json({ success: false, message: 'Username already exists' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const user = await prisma.credential.create({
            data: {
                username,
                password: hashedPassword,
                isValid: true,
                isDemo: false,
                registerDate: new Date(),
                expiryDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
                organization_id: orgId,
            },
        });

        // Assign roles
        if (roleIds && Array.isArray(roleIds)) {
            await Promise.all(
                roleIds.map((roleId: number) =>
                    prisma.userRole.create({
                        data: { userId: user.id, roleId, assignedBy: req.user!.id },
                    })
                )
            );
        }

        await logActivity(req.user!.id, req.user!.username, 'user_created_for_org', 'super_admin', 'user', user.id.toString(), { username, orgId }, req);

        res.json({ success: true, message: 'User created successfully', userId: user.id });
    } catch (error: any) {
        console.error('Create org user error:', error);
        res.status(500).json({ success: false, message: 'Failed to create user', error: error.message });
    }
});

// ============================================
// AVAILABLE PLANS
// ============================================

/**
 * Get available subscription plans
 * GET /api/super-admin/plans
 */
router.get('/plans', async (_req, res) => {
    const plans = [
        {
            id: 'free',
            name: 'Free',
            max_users: 3,
            max_invoices_per_month: 50,
            max_storage_gb: 1,
            price_per_month: 0,
            features: ['Basic invoicing', 'ETA integration', 'Up to 3 users'],
        },
        {
            id: 'starter',
            name: 'Starter',
            max_users: 5,
            max_invoices_per_month: 200,
            max_storage_gb: 5,
            price_per_month: 199,
            features: ['Everything in Free', 'Up to 5 users', '200 invoices/month', 'Email support'],
        },
        {
            id: 'professional',
            name: 'Professional',
            max_users: 15,
            max_invoices_per_month: 1000,
            max_storage_gb: 20,
            price_per_month: 499,
            features: ['Everything in Starter', 'Up to 15 users', '1000 invoices/month', 'Priority support', 'Custom branding'],
        },
        {
            id: 'enterprise',
            name: 'Enterprise',
            max_users: 999,
            max_invoices_per_month: 999999,
            max_storage_gb: 100,
            price_per_month: 999,
            features: ['Everything in Professional', 'Unlimited users', 'Unlimited invoices', 'Dedicated support', 'Custom integrations'],
        },
    ];

    res.json({ success: true, plans });
});

// ============================================
// ACTIVITY LOGS (Platform-Wide)
// ============================================

/**
 * Get platform activity logs
 * GET /api/super-admin/activity-logs
 */
router.get('/activity-logs', async (req, res) => {
    try {
        const { page = '1', limit = '30', action, module, userId } = req.query;
        const skip = (parseInt(page as string) - 1) * parseInt(limit as string);

        const where: any = {};
        if (action) where.action = action as string;
        if (module) where.module = module as string;
        if (userId) where.userId = parseInt(userId as string);

        const [logs, total] = await Promise.all([
            prisma.userActivityLog.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                skip,
                take: parseInt(limit as string),
            }),
            prisma.userActivityLog.count({ where }),
        ]);

        res.json({
            success: true,
            logs,
            pagination: {
                total,
                page: parseInt(page as string),
                limit: parseInt(limit as string),
                totalPages: Math.ceil(total / parseInt(limit as string)),
            },
        });
    } catch (error: any) {
        console.error('Activity logs error:', error);
        res.status(500).json({ success: false, message: 'Failed to get activity logs', error: error.message });
    }
});

/**
 * Get login history
 * GET /api/super-admin/login-history
 */
router.get('/login-history', async (req, res) => {
    try {
        const { page = '1', limit = '30' } = req.query;
        const skip = (parseInt(page as string) - 1) * parseInt(limit as string);

        const [logs, total] = await Promise.all([
            prisma.userLoginHistory.findMany({
                orderBy: { loginTime: 'desc' },
                skip,
                take: parseInt(limit as string),
            }),
            prisma.userLoginHistory.count(),
        ]);

        res.json({ success: true, logs, pagination: { total, page: parseInt(page as string), limit: parseInt(limit as string), totalPages: Math.ceil(total / parseInt(limit as string)) } });
    } catch (error: any) {
        console.error('Login history error:', error);
        res.status(500).json({ success: false, message: 'Failed to get login history', error: error.message });
    }
});

// ============================================
// ROLES & PERMISSIONS MANAGEMENT
// ============================================

/**
 * Get all roles with permission counts
 * GET /api/super-admin/roles
 */
router.get('/roles', async (_req, res) => {
    try {
        const roles = await prisma.role.findMany({
            include: {
                rolePermissions: {
                    include: { permission: true },
                },
                _count: {
                    select: {
                        userRoles: true,
                        portalUserRoles: true,
                    },
                },
            },
            orderBy: { id: 'asc' },
        });

        const result = roles.map(r => ({
            id: r.id,
            name: r.name,
            displayName: r.displayName,
            description: r.description,
            isSystem: r.isSystem,
            createdAt: r.createdAt,
            permissionCount: r.rolePermissions.length,
            permissions: r.rolePermissions.map(rp => ({
                id: rp.permission.id,
                name: rp.permission.name,
                displayName: rp.permission.displayName,
                module: rp.permission.module,
                action: rp.permission.action,
            })),
            userCount: r._count.userRoles + r._count.portalUserRoles,
        }));

        res.json({ success: true, roles: result });
    } catch (error: any) {
        console.error('Get roles error:', error);
        res.status(500).json({ success: false, message: 'Failed to get roles', error: error.message });
    }
});

/**
 * Get all permissions grouped by module
 * GET /api/super-admin/permissions
 */
router.get('/permissions', async (_req, res) => {
    try {
        const permissions = await prisma.permission.findMany({
            orderBy: [{ module: 'asc' }, { action: 'asc' }],
        });

        // Group by module
        const grouped: Record<string, typeof permissions> = {};
        permissions.forEach(p => {
            if (!grouped[p.module]) grouped[p.module] = [];
            grouped[p.module].push(p);
        });

        res.json({ success: true, permissions, grouped });
    } catch (error: any) {
        console.error('Get permissions error:', error);
        res.status(500).json({ success: false, message: 'Failed to get permissions', error: error.message });
    }
});

/**
 * Create a new role
 * POST /api/super-admin/roles
 */
router.post('/roles', blockDemo, async (req, res) => {
    try {
        const { name, displayName, description, permissionIds } = req.body;

        if (!name || !displayName) {
            return res.status(400).json({ success: false, message: 'Name and displayName are required' });
        }

        const role = await prisma.role.create({
            data: { name, displayName, description },
        });

        // Assign permissions
        if (permissionIds?.length) {
            await Promise.all(
                permissionIds.map((pid: number) =>
                    prisma.rolePermission.create({
                        data: { roleId: role.id, permissionId: pid },
                    })
                )
            );
        }

        await logActivity(req.user!.id, req.user!.username, 'role_created', 'super_admin', 'role', role.id.toString(), { name, displayName, permissionIds }, req);

        res.json({ success: true, role });
    } catch (error: any) {
        console.error('Create role error:', error);
        res.status(500).json({ success: false, message: 'Failed to create role', error: error.message });
    }
});

/**
 * Update role permissions
 * PUT /api/super-admin/roles/:id/permissions
 */
router.put('/roles/:id/permissions', blockDemo, async (req, res) => {
    try {
        const roleId = parseInt(req.params.id);
        const { permissionIds } = req.body;

        // Remove all existing permissions for this role
        await prisma.rolePermission.deleteMany({ where: { roleId } });

        // Re-add
        if (permissionIds?.length) {
            await Promise.all(
                permissionIds.map((pid: number) =>
                    prisma.rolePermission.create({
                        data: { roleId, permissionId: pid },
                    })
                )
            );
        }

        await logActivity(req.user!.id, req.user!.username, 'role_permissions_updated', 'super_admin', 'role', roleId.toString(), { permissionIds }, req);

        res.json({ success: true, message: 'Permissions updated' });
    } catch (error: any) {
        console.error('Update role permissions error:', error);
        res.status(500).json({ success: false, message: 'Failed to update permissions', error: error.message });
    }
});

export default router;
