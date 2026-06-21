import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// Helper: upsert credential by username (since username may not be @unique in old client)
async function upsertCredentialByUsername(
    username: string,
    createData: any,
    updateData: any
) {
    const existing = await prisma.credential.findFirst({ where: { username } });
    if (existing) {
        return prisma.credential.update({ where: { id: existing.id }, data: updateData });
    }
    return prisma.credential.create({ data: createData });
}

async function main() {
    console.log('🌱 Starting SaaS database seed...');

    // ============================================
    // 1. CREATE ROLES (Including org_admin)
    // ============================================
    console.log('📋 Creating roles...');

    const roles = await Promise.all([
        prisma.role.upsert({
            where: { name: 'super_admin' },
            update: {},
            create: {
                name: 'super_admin',
                displayName: 'Super Administrator',
                description: 'Platform-level admin — manages all organizations, users, and platform settings',
                isSystem: true,
            },
        }),
        prisma.role.upsert({
            where: { name: 'org_admin' },
            update: {},
            create: {
                name: 'org_admin',
                displayName: 'Organization Admin',
                description: 'Organization-level admin — manages users and settings within their own organization',
                isSystem: true,
            },
        }),
        prisma.role.upsert({
            where: { name: 'admin' },
            update: { description: 'Legacy admin role — use org_admin for new users' },
            create: {
                name: 'admin',
                displayName: 'Administrator',
                description: 'Legacy admin role — use org_admin for new users',
                isSystem: true,
            },
        }),
        prisma.role.upsert({
            where: { name: 'manager' },
            update: {},
            create: {
                name: 'manager',
                displayName: 'Manager',
                description: 'Can manage invoices and view reports within their organization',
                isSystem: false,
            },
        }),
        prisma.role.upsert({
            where: { name: 'accountant' },
            update: {},
            create: {
                name: 'accountant',
                displayName: 'Accountant',
                description: 'Can create and manage invoices within their organization',
                isSystem: false,
            },
        }),
        prisma.role.upsert({
            where: { name: 'viewer' },
            update: {},
            create: {
                name: 'viewer',
                displayName: 'Viewer',
                description: 'Read-only access to invoices and reports within their organization',
                isSystem: false,
            },
        }),
    ]);

    console.log(`✅ Created ${roles.length} roles`);

    // ============================================
    // 2. CREATE PERMISSIONS (Including org management)
    // ============================================
    console.log('🔐 Creating permissions...');

    const permissions = await Promise.all([
        // Dashboard
        prisma.permission.upsert({
            where: { name: 'dashboard.view' },
            update: {},
            create: { name: 'dashboard.view', displayName: 'View Dashboard', description: 'Access to main dashboard', module: 'dashboard', action: 'view' },
        }),

        // Invoices
        prisma.permission.upsert({
            where: { name: 'invoices.view' },
            update: {},
            create: { name: 'invoices.view', displayName: 'View Invoices', description: 'View invoice list and details', module: 'invoices', action: 'view' },
        }),
        prisma.permission.upsert({
            where: { name: 'invoices.create' },
            update: {},
            create: { name: 'invoices.create', displayName: 'Create Invoices', description: 'Create new invoices', module: 'invoices', action: 'create' },
        }),
        prisma.permission.upsert({
            where: { name: 'invoices.edit' },
            update: {},
            create: { name: 'invoices.edit', displayName: 'Edit Invoices', description: 'Edit existing invoices', module: 'invoices', action: 'edit' },
        }),
        prisma.permission.upsert({
            where: { name: 'invoices.delete' },
            update: {},
            create: { name: 'invoices.delete', displayName: 'Delete Invoices', description: 'Delete invoices', module: 'invoices', action: 'delete' },
        }),
        prisma.permission.upsert({
            where: { name: 'invoices.cancel' },
            update: {},
            create: { name: 'invoices.cancel', displayName: 'Cancel Invoices', description: 'Cancel submitted invoices', module: 'invoices', action: 'cancel' },
        }),

        // Reports
        prisma.permission.upsert({
            where: { name: 'reports.view' },
            update: {},
            create: { name: 'reports.view', displayName: 'View Reports', description: 'Access reports section', module: 'reports', action: 'view' },
        }),
        prisma.permission.upsert({
            where: { name: 'reports.export' },
            update: {},
            create: { name: 'reports.export', displayName: 'Export Reports', description: 'Export reports to PDF/Excel', module: 'reports', action: 'export' },
        }),

        // Settings
        prisma.permission.upsert({
            where: { name: 'settings.view' },
            update: {},
            create: { name: 'settings.view', displayName: 'View Settings', description: 'Access settings page', module: 'settings', action: 'view' },
        }),
        prisma.permission.upsert({
            where: { name: 'settings.edit' },
            update: {},
            create: { name: 'settings.edit', displayName: 'Edit Settings', description: 'Modify system settings', module: 'settings', action: 'edit' },
        }),

        // Users (Org-scoped user management)
        prisma.permission.upsert({
            where: { name: 'users.view' },
            update: {},
            create: { name: 'users.view', displayName: 'View Users', description: 'View user list in organization', module: 'users', action: 'view' },
        }),
        prisma.permission.upsert({
            where: { name: 'users.create' },
            update: {},
            create: { name: 'users.create', displayName: 'Create Users', description: 'Create new users in organization', module: 'users', action: 'create' },
        }),
        prisma.permission.upsert({
            where: { name: 'users.edit' },
            update: {},
            create: { name: 'users.edit', displayName: 'Edit Users', description: 'Edit user details in organization', module: 'users', action: 'edit' },
        }),
        prisma.permission.upsert({
            where: { name: 'users.delete' },
            update: {},
            create: { name: 'users.delete', displayName: 'Delete Users', description: 'Delete users from organization', module: 'users', action: 'delete' },
        }),
        prisma.permission.upsert({
            where: { name: 'users.manage_roles' },
            update: {},
            create: { name: 'users.manage_roles', displayName: 'Manage User Roles', description: 'Assign/remove roles from users', module: 'users', action: 'manage_roles' },
        }),

        // Master Data
        prisma.permission.upsert({
            where: { name: 'masterdata.view' },
            update: {},
            create: { name: 'masterdata.view', displayName: 'View Master Data', description: 'Access master data', module: 'masterdata', action: 'view' },
        }),
        prisma.permission.upsert({
            where: { name: 'masterdata.edit' },
            update: {},
            create: { name: 'masterdata.edit', displayName: 'Edit Master Data', description: 'Modify master data', module: 'masterdata', action: 'edit' },
        }),

        // ERP
        prisma.permission.upsert({
            where: { name: 'erp.view' },
            update: {},
            create: { name: 'erp.view', displayName: 'View ERP Connector', description: 'Access ERP connector', module: 'erp', action: 'view' },
        }),
        prisma.permission.upsert({
            where: { name: 'erp.configure' },
            update: {},
            create: { name: 'erp.configure', displayName: 'Configure ERP', description: 'Configure ERP connections', module: 'erp', action: 'configure' },
        }),

        // ============================================
        // NEW: Organization Management Permissions (Super Admin only)
        // ============================================
        prisma.permission.upsert({
            where: { name: 'organizations.view' },
            update: {},
            create: { name: 'organizations.view', displayName: 'View Organizations', description: 'View all organizations on the platform', module: 'organizations', action: 'view' },
        }),
        prisma.permission.upsert({
            where: { name: 'organizations.create' },
            update: {},
            create: { name: 'organizations.create', displayName: 'Create Organizations', description: 'Create new organizations', module: 'organizations', action: 'create' },
        }),
        prisma.permission.upsert({
            where: { name: 'organizations.edit' },
            update: {},
            create: { name: 'organizations.edit', displayName: 'Edit Organizations', description: 'Edit organization details', module: 'organizations', action: 'edit' },
        }),
        prisma.permission.upsert({
            where: { name: 'organizations.delete' },
            update: {},
            create: { name: 'organizations.delete', displayName: 'Delete Organizations', description: 'Delete organizations', module: 'organizations', action: 'delete' },
        }),
        prisma.permission.upsert({
            where: { name: 'organizations.manage' },
            update: {},
            create: { name: 'organizations.manage', displayName: 'Manage Organizations', description: 'Manage org subscriptions, plans, and activation', module: 'organizations', action: 'manage' },
        }),

        // Org-scoped user management (for org_admin)
        prisma.permission.upsert({
            where: { name: 'org_users.view' },
            update: {},
            create: { name: 'org_users.view', displayName: 'View Org Users', description: 'View users in own organization', module: 'org_users', action: 'view' },
        }),
        prisma.permission.upsert({
            where: { name: 'org_users.create' },
            update: {},
            create: { name: 'org_users.create', displayName: 'Create Org Users', description: 'Create users in own organization', module: 'org_users', action: 'create' },
        }),
        prisma.permission.upsert({
            where: { name: 'org_users.edit' },
            update: {},
            create: { name: 'org_users.edit', displayName: 'Edit Org Users', description: 'Edit users in own organization', module: 'org_users', action: 'edit' },
        }),
        prisma.permission.upsert({
            where: { name: 'org_users.delete' },
            update: {},
            create: { name: 'org_users.delete', displayName: 'Delete Org Users', description: 'Delete users from own organization', module: 'org_users', action: 'delete' },
        }),
    ]);

    console.log(`✅ Created ${permissions.length} permissions`);

    // ============================================
    // 3. ASSIGN PERMISSIONS TO ROLES
    // ============================================
    console.log('🔗 Assigning permissions to roles...');

    const [superAdmin, orgAdmin, admin, manager, accountant, viewer] = roles;
    const allPermissions = await prisma.permission.findMany();

    // Helper to assign permissions to role
    const assignPermissions = async (roleId: number, permNames: string[] | 'ALL') => {
        const perms = permNames === 'ALL'
            ? allPermissions
            : allPermissions.filter(p => permNames.includes(p.name));

        for (const permission of perms) {
            await prisma.rolePermission.upsert({
                where: { roleId_permissionId: { roleId, permissionId: permission.id } },
                update: {},
                create: { roleId, permissionId: permission.id },
            });
        }
    };

    // Super Admin gets ALL permissions
    await assignPermissions(superAdmin.id, 'ALL');

    // Org Admin gets org-level permissions (NOT organizations.* super admin perms)
    await assignPermissions(orgAdmin.id, [
        'dashboard.view',
        'invoices.view', 'invoices.create', 'invoices.edit', 'invoices.delete', 'invoices.cancel',
        'reports.view', 'reports.export',
        'settings.view', 'settings.edit',
        'users.view', 'users.create', 'users.edit', 'users.delete', 'users.manage_roles',
        'org_users.view', 'org_users.create', 'org_users.edit', 'org_users.delete',
        'masterdata.view', 'masterdata.edit',
        'erp.view', 'erp.configure',
    ]);

    // Admin gets same as org_admin (legacy compatibility)
    await assignPermissions(admin.id, [
        'dashboard.view',
        'invoices.view', 'invoices.create', 'invoices.edit', 'invoices.cancel',
        'reports.view', 'reports.export',
        'settings.view', 'settings.edit',
        'users.view', 'users.create', 'users.edit', 'users.manage_roles',
        'org_users.view', 'org_users.create', 'org_users.edit',
        'masterdata.view', 'masterdata.edit',
        'erp.view', 'erp.configure',
    ]);

    // Manager permissions
    await assignPermissions(manager.id, [
        'dashboard.view',
        'invoices.view', 'invoices.create', 'invoices.edit', 'invoices.cancel',
        'reports.view', 'reports.export',
        'settings.view',
    ]);

    // Accountant permissions
    await assignPermissions(accountant.id, [
        'dashboard.view',
        'invoices.view', 'invoices.create', 'invoices.edit',
        'reports.view',
        'masterdata.view',
    ]);

    // Viewer permissions (read-only)
    await assignPermissions(viewer.id, [
        'dashboard.view',
        'invoices.view',
        'reports.view',
    ]);

    console.log('✅ Assigned permissions to roles');

    // ============================================
    // 4. CREATE DEFAULT ORGANIZATION (Platform Org)
    // ============================================
    console.log('🏢 Creating default organization...');

    const defaultOrg = await prisma.organizations.upsert({
        where: { tax_id: 'PLATFORM-001' },
        update: {},
        create: {
            name: 'OTax Platform',
            tax_id: 'PLATFORM-001',
            company_type: 'Platform',
            email: 'admin@otax.com',
            country: 'Egypt',
            governorate: 'Cairo',
            city: 'Cairo',
            is_active: true,
            subscription_plan: 'enterprise',
        },
    });

    console.log(`✅ Created default organization: ${defaultOrg.name} (ID: ${defaultOrg.id})`);

    // ============================================
    // 5. CREATE DEFAULT SUBSCRIPTION FOR PLATFORM ORG
    // ============================================
    console.log('💳 Creating default subscription...');

    const existingSub = await prisma.organization_subscriptions.findFirst({
        where: { organization_id: defaultOrg.id, status: 'active' },
    });

    if (!existingSub) {
        await prisma.organization_subscriptions.create({
            data: {
                organization_id: defaultOrg.id,
                plan: 'enterprise',
                status: 'active',
                max_users: 999,
                max_invoices_per_month: 999999,
                max_storage_gb: 100,
                billing_cycle: 'yearly',
                starts_at: new Date(),
                expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
            },
        });
    }

    console.log('✅ Created platform subscription');

    // ============================================
    // 6. CREATE SUPER ADMIN USER (linked to platform org)
    // ============================================
    console.log('👤 Creating super admin user...');

    const hashedPassword = await bcrypt.hash('admin123', 10);

    const adminUser = await upsertCredentialByUsername(
        'admin',
        {
            username: 'admin',
            password: hashedPassword,
            isValid: true,
            isDemo: false,
            registerDate: new Date(),
            expiryDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
            organization_id: defaultOrg.id,
        },
        {
            organization_id: defaultOrg.id,
        }
    );

    // Assign Super Admin role
    await prisma.userRole.upsert({
        where: { userId_roleId: { userId: adminUser.id, roleId: superAdmin.id } },
        update: {},
        create: { userId: adminUser.id, roleId: superAdmin.id, assignedBy: null },
    });

    console.log('✅ Created super admin user (username: admin, password: admin123)');

    // ============================================
    // 7. CREATE SAMPLE ORGANIZATION WITH ORG ADMIN
    // ============================================
    console.log('🏢 Creating sample organization...');

    const sampleOrg = await prisma.organizations.upsert({
        where: { tax_id: 'SAMPLE-ORG-001' },
        update: {},
        create: {
            name: 'Sample Company',
            tax_id: 'SAMPLE-ORG-001',
            company_type: 'B',
            email: 'admin@samplecompany.com',
            country: 'Egypt',
            governorate: 'Cairo',
            city: 'Nasr City',
            is_active: true,
            subscription_plan: 'professional',
            created_by: Number(adminUser.id),
        },
    });

    // Create subscription for sample org
    const existingSampleSub = await prisma.organization_subscriptions.findFirst({
        where: { organization_id: sampleOrg.id, status: 'active' },
    });

    if (!existingSampleSub) {
        await prisma.organization_subscriptions.create({
            data: {
                organization_id: sampleOrg.id,
                plan: 'professional',
                status: 'active',
                max_users: 10,
                max_invoices_per_month: 500,
                max_storage_gb: 10,
                billing_cycle: 'monthly',
                starts_at: new Date(),
                expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            },
        });
    }

    // Create org admin user for sample org
    const orgAdminPassword = await bcrypt.hash('orgadmin123', 10);

    const orgAdminUser = await upsertCredentialByUsername(
        'orgadmin',
        {
            username: 'orgadmin',
            password: orgAdminPassword,
            isValid: true,
            isDemo: false,
            registerDate: new Date(),
            expiryDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
            organization_id: sampleOrg.id,
        },
        {
            organization_id: sampleOrg.id,
        }
    );

    // Assign org_admin role
    await prisma.userRole.upsert({
        where: { userId_roleId: { userId: orgAdminUser.id, roleId: orgAdmin.id } },
        update: {},
        create: { userId: orgAdminUser.id, roleId: orgAdmin.id, assignedBy: null },
    });

    console.log(`✅ Created sample organization: ${sampleOrg.name} (ID: ${sampleOrg.id})`);
    console.log('✅ Created org admin user (username: orgadmin, password: orgadmin123)');

    // ============================================
    // 8. CREATE DEMO USER (linked to sample org)
    // ============================================
    console.log('👤 Creating demo user...');

    const demoPassword = await bcrypt.hash('demo123', 10);

    const demoUser = await upsertCredentialByUsername(
        'demo',
        {
            username: 'demo',
            password: demoPassword,
            isValid: true,
            isDemo: true,
            registerDate: new Date(),
            expiryDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
            organization_id: sampleOrg.id,
        },
        {
            organization_id: sampleOrg.id,
        }
    );

    // Assign Viewer role to demo user
    await prisma.userRole.upsert({
        where: { userId_roleId: { userId: demoUser.id, roleId: viewer.id } },
        update: {},
        create: { userId: demoUser.id, roleId: viewer.id },
    });

    console.log('✅ Created demo user (username: demo, password: demo123)');

    // ============================================
    // 9. CREATE SIDEBAR ITEMS
    // ============================================
    console.log('📱 Creating sidebar items...');

    const sidebarItems = await Promise.all([
        prisma.sidebarItem.upsert({
            where: { name: 'dashboard' },
            update: {},
            create: { name: 'dashboard', displayName: 'Dashboard', icon: 'LayoutDashboard', path: '/', order: 1, requiredPermission: 'dashboard.view' },
        }),
        prisma.sidebarItem.upsert({
            where: { name: 'invoices' },
            update: {},
            create: { name: 'invoices', displayName: 'Invoices', icon: 'FileText', path: '/invoices', order: 2, requiredPermission: 'invoices.view' },
        }),
        prisma.sidebarItem.upsert({
            where: { name: 'create_invoice' },
            update: {},
            create: { name: 'create_invoice', displayName: 'Create Invoice', icon: 'FilePlus', path: '/invoice-excel', order: 3, requiredPermission: 'invoices.create' },
        }),
        prisma.sidebarItem.upsert({
            where: { name: 'reports' },
            update: {},
            create: { name: 'reports', displayName: 'Reports', icon: 'BarChart3', path: '/reports', order: 4, requiredPermission: 'reports.view' },
        }),
        prisma.sidebarItem.upsert({
            where: { name: 'master_data' },
            update: {},
            create: { name: 'master_data', displayName: 'Master Data', icon: 'Database', path: '/master-data', order: 5, requiredPermission: 'masterdata.view' },
        }),
        prisma.sidebarItem.upsert({
            where: { name: 'erp_connector' },
            update: {},
            create: { name: 'erp_connector', displayName: 'ERP Connector', icon: 'Link', path: '/erp-connector', order: 6, requiredPermission: 'erp.view' },
        }),
        prisma.sidebarItem.upsert({
            where: { name: 'settings' },
            update: {},
            create: { name: 'settings', displayName: 'Settings', icon: 'Settings', path: '/settings', order: 7, requiredPermission: 'settings.view' },
        }),
        prisma.sidebarItem.upsert({
            where: { name: 'admin_panel' },
            update: {},
            create: { name: 'admin_panel', displayName: 'User Management', icon: 'Users', path: '/admin/users', order: 8, requiredPermission: 'org_users.view' },
        }),
        prisma.sidebarItem.upsert({
            where: { name: 'super_admin' },
            update: {},
            create: { name: 'super_admin', displayName: 'Organizations', icon: 'Building2', path: '/super-admin', order: 9, requiredPermission: 'organizations.view' },
        }),
    ]);

    console.log(`✅ Created ${sidebarItems.length} sidebar items`);

    // ============================================
    // FINAL SUMMARY
    // ============================================
    console.log('\n🎉 SaaS Database seeding completed successfully!');
    console.log('\n📝 Default Credentials:');
    console.log('   ┌──────────────────────────────────────────────────────────┐');
    console.log('   │ SUPER ADMIN (Platform)                                  │');
    console.log('   │   Username: admin        Password: admin123             │');
    console.log('   │   Organization: OTax Platform                           │');
    console.log('   ├──────────────────────────────────────────────────────────┤');
    console.log('   │ ORG ADMIN (Sample Company)                              │');
    console.log('   │   Username: orgadmin     Password: orgadmin123          │');
    console.log('   │   Organization: Sample Company                          │');
    console.log('   ├──────────────────────────────────────────────────────────┤');
    console.log('   │ DEMO USER (Sample Company - Read Only)                  │');
    console.log('   │   Username: demo         Password: demo123              │');
    console.log('   │   Organization: Sample Company                          │');
    console.log('   └──────────────────────────────────────────────────────────┘');
    console.log('\n⚠️  Please change default passwords in production!');
}

main()
    .catch((e) => {
        console.error('❌ Error during seeding:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
