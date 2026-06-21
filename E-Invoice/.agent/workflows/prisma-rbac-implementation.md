---
description: Prisma RBAC Implementation Plan
---

# Prisma User Management & RBAC Implementation

## Overview
Implement a complete Role-Based Access Control (RBAC) system using Prisma ORM with PostgreSQL.

## Phase 1: Setup Prisma
1. Install Prisma dependencies
2. Initialize Prisma with PostgreSQL
3. Create comprehensive schema for users, roles, and permissions

## Phase 2: Database Schema Design

### Core Tables:
- **users**: User accounts with authentication
- **roles**: Predefined roles (Admin, Manager, Accountant, Viewer, etc.)
- **permissions**: Granular permissions (view_invoices, create_invoices, etc.)
- **role_permissions**: Many-to-many relationship
- **user_roles**: Many-to-many relationship
- **sidebar_items**: Dynamic sidebar configuration
- **user_sidebar_permissions**: User-specific sidebar visibility

### Existing Tables to Integrate:
- documents (already exists)
- clients (already exists)
- errors (already exists)

## Phase 3: Backend Implementation
1. Create Prisma client singleton
2. Implement authentication middleware
3. Create user management endpoints
4. Create role management endpoints
5. Create permission management endpoints
6. Update existing endpoints with permission checks

## Phase 4: Frontend Implementation
1. Create Admin Dashboard page
2. Create User Management component
3. Create Role Management component
4. Create Permission Assignment component
5. Update Sidebar to be permission-based
6. Add permission checks to all pages

## Phase 5: Migration Strategy
1. Migrate existing LoginDb.credentials to new users table
2. Create default admin account
3. Set up default roles and permissions
4. Assign existing users to appropriate roles

## Implementation Steps

### Step 1: Install Dependencies
```bash
npm install @prisma/client bcryptjs jsonwebtoken
npm install -D prisma @types/bcryptjs @types/jsonwebtoken
```

### Step 2: Initialize Prisma
```bash
npx prisma init
```

### Step 3: Define Schema
Create comprehensive Prisma schema with all tables and relationships

### Step 4: Generate Prisma Client
```bash
npx prisma generate
npx prisma db push
```

### Step 5: Seed Database
Create seed script with default admin and roles

### Step 6: Implement Backend Services
- AuthService: Login, register, password reset
- UserService: CRUD operations
- RoleService: Role management
- PermissionService: Permission assignment

### Step 7: Create Admin UI
- User list with search/filter
- Role assignment interface
- Permission matrix
- Sidebar configuration panel

## Security Considerations
- Password hashing with bcrypt
- JWT token-based authentication
- Role-based middleware
- Permission-based route guards
- Audit logging for admin actions
