# Backend Implementation Blueprint

**How to Recreate This Architecture for Other Applications**

---

## Table of Contents

1. [Project Setup](#1-project-setup)
2. [Database Architecture](#2-database-architecture)
3. [Authentication System](#3-authentication-system)
4. [Controller Pattern](#4-controller-pattern)
5. [Service Layer](#5-service-layer)
6. [Route Structure](#6-route-structure)
7. [Database Factory Pattern](#7-database-factory-pattern)
8. [Testing Strategy](#8-testing-strategy)
9. [Deployment Checklist](#9-deployment-checklist)
10. [Key Learnings](#10-key-learnings)

---

## 1. Project Setup

### Initial Structure

```bash
mkdir server
cd server
npm init -y

# Install core dependencies
npm install express cors dotenv
npm install prisma @prisma/client
npm install axios

# Install dev dependencies
npm install --save-dev nodemon
```

### Project Directory

```
server/
├── src/
│   ├── controllers/[app-name]/
│   ├── routes/[app-name]/
│   ├── services/[app-name]/
│   ├── config/
│   │   └── database-factory.js
│   ├── middleware/
│   │   └── database-injector.js
│   └── server.js
├── prisma/
│   ├── [app-name].prisma
│   ├── seed.[app-name].js
│   └── migrations/
├── package.json
└── .env
```

### package.json Scripts

```json
{
  "type": "module",
  "scripts": {
    "dev": "nodemon src/server.js",
    "start": "node src/server.js",
    "prisma:generate": "npx prisma generate --schema=./prisma/[app].prisma",
    "prisma:migrate": "npx prisma migrate dev --schema=./prisma/[app].prisma",
    "prisma:deploy": "npx prisma migrate deploy --schema=./prisma/[app].prisma",
    "seed": "node prisma/seed.[app].js"
  }
}
```

---

## 2. Database Architecture

### Step 1: Create Prisma Schema

**File:** `prisma/[app-name].prisma`

```prisma
generator client {
  provider = "prisma-client-js"
  output   = "../node_modules/.prisma/[app]-client"
}

datasource db {
  provider = "postgresql"
  url      = env("[APP]_DATABASE_URL")
}

// Example model
model Company {
  id                String   @id @default(uuid())
  company_name      String
  api_client_id     String?
  api_client_secret String?
  api_access_token  String?  @db.Text
  api_refresh_token String?  @db.Text
  api_token_expires DateTime?
  environment       String   @default("production")
  is_active         Boolean  @default(true)
  created_at        DateTime @default(now())
  updated_at        DateTime @updatedAt

  // Relations
  documents         Document[]

  @@map("companies")
}

model Document {
  id            String   @id @default(uuid())
  company_id    String
  external_uuid String?  @unique
  internal_id   String
  document_type String
  total_amount  Decimal  @db.Decimal(15, 2)
  status        String   @default("DRAFT")
  created_at    DateTime @default(now())
  updated_at    DateTime @updatedAt

  company       Company @relation(fields: [company_id], references: [id], onDelete: Cascade)

  @@index([company_id, status])
  @@map("documents")
}
```

### Step 2: Environment Variables

```env
# Database
[APP]_DATABASE_URL=postgresql://user:pass@host:5432/[app]_db

# External API
API_URL=https://api.example.com
API_AUTH_URL=https://auth.example.com/token
```

### Step 3: Generate and Migrate

```bash
# Generate Prisma client
npx prisma generate --schema=./prisma/[app].prisma

# Create migration
npx prisma migrate dev --name init --schema=./prisma/[app].prisma

# Deploy to production
npx prisma migrate deploy --schema=./prisma/[app].prisma
```

### Step 4: Seed Data

**File:** `prisma/seed.[app].js`

```javascript
import { PrismaClient } from '../node_modules/.prisma/[app]-client/index.js';

const prisma = new PrismaClient();

async function main() {
    // Create test company
    const company = await prisma.company.create({
        data: {
            company_name: 'Test Company',
            environment: 'production',
            is_active: true
        }
    });

    console.log('✅ Seed completed:', company.id);
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
```

---

## 3. Authentication System

### Step 1: Create API Service

**File:** `src/services/[app]/api.service.js`

```javascript
import axios from 'axios';

const API_AUTH_URL = process.env.API_AUTH_URL;
const API_BASE_URL = process.env.API_URL;

class ApiService {
    constructor(db) {
        this.db = db;
    }

    /**
     * Authenticate with external API (OAuth 2.0)
     */
    async authenticate(clientId, clientSecret) {
        const response = await axios.post(
            API_AUTH_URL,
            new URLSearchParams({
                grant_type: 'client_credentials',
                client_id: clientId,
                client_secret: clientSecret,
                scope: 'API'
            }),
            {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            }
        );

        const { access_token, refresh_token, expires_in } = response.data;
        const expiresAt = new Date(Date.now() + expires_in * 1000);

        return {
            access_token,
            refresh_token,
            expires_at: expiresAt
        };
    }

    /**
     * Get valid token with auto-refresh
     */
    async getValidToken(companyId) {
        const company = await this.db.company.findUnique({
            where: { id: companyId },
            select: {
                api_access_token: true,
                api_refresh_token: true,
                api_token_expires: true,
                api_client_id: true,
                api_client_secret: true
            }
        });

        if (!company?.api_access_token) {
            throw new Error('Company not authenticated');
        }

        // Check if token expires in next 5 minutes
        const now = new Date();
        const expiresAt = new Date(company.api_token_expires);
        const minutesUntilExpiry = (expiresAt - now) / 1000 / 60;

        if (minutesUntilExpiry < 5) {
            // Refresh token
            const tokens = await this.authenticate(
                company.api_client_id,
                company.api_client_secret
            );

            await this.db.company.update({
                where: { id: companyId },
                data: {
                    api_access_token: tokens.access_token,
                    api_refresh_token: tokens.refresh_token,
                    api_token_expires: tokens.expires_at
                }
            });

            return tokens.access_token;
        }

        return company.api_access_token;
    }

    /**
     * Make authenticated request
     */
    async request(companyId, method, endpoint, data = null) {
        const token = await this.getValidToken(companyId);

        try {
            const response = await axios({
                method,
                url: `${API_BASE_URL}${endpoint}`,
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                data
            });

            return response.data;
        } catch (error) {
            // Handle 401 - retry with fresh token
            if (error.response?.status === 401) {
                // Force re-authentication and retry
                // ... implement retry logic
            }
            throw error;
        }
    }

    async get(companyId, endpoint) {
        return this.request(companyId, 'GET', endpoint);
    }

    async post(companyId, endpoint, data) {
        return this.request(companyId, 'POST', endpoint, data);
    }
}

export default ApiService;
```

### Step 2: Auth Controller

**File:** `src/controllers/[app]/auth.controller.js`

```javascript
import ApiService from '../../services/[app]/api.service.js';

export const login = async (req, res) => {
    try {
        const { client_id, client_secret, environment } = req.body;

        const apiService = new ApiService(req.db);
        const tokens = await apiService.authenticate(client_id, client_secret);

        // Find or create company
        let company = await req.db.company.findFirst({
            where: { api_client_id: client_id }
        });

        if (!company) {
            company = await req.db.company.create({
                data: {
                    company_name: 'New Company',
                    api_client_id: client_id,
                    api_client_secret: client_secret,
                    environment
                }
            });
        }

        // Update tokens
        await req.db.company.update({
            where: { id: company.id },
            data: {
                api_access_token: tokens.access_token,
                api_refresh_token: tokens.refresh_token,
                api_token_expires: tokens.expires_at
            }
        });

        return res.json({
            success: true,
            data: {
                company_id: company.id,
                access_token: tokens.access_token,
                expires_at: tokens.expires_at
            }
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
};
```

---

## 4. Controller Pattern

### Standard Controller Structure

**File:** `src/controllers/[app]/resources.controller.js`

```javascript
import ApiService from '../../services/[app]/api.service.js';

/**
 * List all resources
 * GET /api/[app]/resources
 */
export const listResources = async (req, res) => {
    try {
        const { company_id, page_size = 50 } = req.query;

        if (!company_id) {
            return res.status(400).json({
                success: false,
                error: 'Missing company_id'
            });
        }

        // Query local database
        const resources = await req.db.resource.findMany({
            where: { company_id },
            take: parseInt(page_size),
            orderBy: { created_at: 'desc' }
        });

        return res.json({
            success: true,
            data: {
                resources,
                total: resources.length
            }
        });
    } catch (error) {
        console.error('List resources error:', error);
        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

/**
 * Create resource
 * POST /api/[app]/resources
 */
export const createResource = async (req, res) => {
    try {
        const { company_id, name, data } = req.body;

        // Save to local database
        const resource = await req.db.resource.create({
            data: {
                company_id,
                name,
                data: JSON.stringify(data),
                status: 'PENDING'
            }
        });

        // Submit to external API
        const apiService = new ApiService(req.db);
        try {
            const apiResponse = await apiService.post(
                company_id,
                '/api/v1/resources',
                { resource: data }
            );

            // Update with external ID
            await req.db.resource.update({
                where: { id: resource.id },
                data: {
                    external_uuid: apiResponse.id,
                    status: 'SUBMITTED'
                }
            });

            return res.json({
                success: true,
                data: {
                    id: resource.id,
                    external_id: apiResponse.id,
                    status: 'SUBMITTED'
                }
            });
        } catch (apiError) {
            // Rollback on API failure
            await req.db.resource.update({
                where: { id: resource.id },
                data: { status: 'FAILED' }
            });

            throw apiError;
        }
    } catch (error) {
        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

/**
 * Sync from external API
 * POST /api/[app]/resources/sync
 */
export const syncResources = async (req, res) => {
    try {
        const { company_id } = req.body;

        const apiService = new ApiService(req.db);
        const apiData = await apiService.get(
            company_id,
            '/api/v1/resources?pageSize=100'
        );

        let synced = 0;
        for (const item of apiData.result || []) {
            const existing = await req.db.resource.findFirst({
                where: { external_uuid: item.id }
            });

            if (!existing) {
                await req.db.resource.create({
                    data: {
                        company_id,
                        external_uuid: item.id,
                        name: item.name,
                        status: 'SYNCED'
                    }
                });
                synced++;
            }
        }

        return res.json({
            success: true,
            message: `Synced ${synced} resources`
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
};
```

---

## 5. Service Layer

### When to Use Services

**Use services for:**
- External API communication
- Complex business logic
- Reusable operations across controllers
- Authentication/token management

**Keep in controllers:**
- Request validation
- Response formatting
- Database queries (simple CRUD)

### Service Example

**File:** `src/services/[app]/sync.service.js`

```javascript
import ApiService from './api.service.js';

class SyncService {
    constructor(db) {
        this.db = db;
        this.apiService = new ApiService(db);
    }

    async syncAll(companyId, dateFrom, dateTo) {
        const results = {
            total: 0,
            new: 0,
            updated: 0,
            errors: 0
        };

        try {
            // Fetch from external API
            const data = await this.apiService.get(
                companyId,
                `/api/v1/data?from=${dateFrom}&to=${dateTo}`
            );

            for (const item of data.result || []) {
                results.total++;

                try {
                    const existing = await this.db.document.findFirst({
                        where: { external_uuid: item.uuid }
                    });

                    if (existing) {
                        await this.db.document.update({
                            where: { id: existing.id },
                            data: { status: item.status }
                        });
                        results.updated++;
                    } else {
                        await this.db.document.create({
                            data: {
                                company_id: companyId,
                                external_uuid: item.uuid,
                                internal_id: item.internalId,
                                status: item.status
                            }
                        });
                        results.new++;
                    }
                } catch (itemError) {
                    results.errors++;
                    console.error(`Failed to sync ${item.uuid}:`, itemError);
                }
            }

            return results;
        } catch (error) {
            throw new Error(`Sync failed: ${error.message}`);
        }
    }
}

export default SyncService;
```

---

## 6. Route Structure

### Step 1: Individual Route Files

**File:** `src/routes/[app]/resources.routes.js`

```javascript
import express from 'express';
import * as resourceController from '../../controllers/[app]/resources.controller.js';

const router = express.Router();

router.get('/', resourceController.listResources);
router.post('/', resourceController.createResource);
router.post('/sync', resourceController.syncResources);
router.get('/:id', resourceController.getResource);
router.put('/:id', resourceController.updateResource);
router.delete('/:id', resourceController.deleteResource);

export default router;
```

### Step 2: Main Router

**File:** `src/routes/[app]/index.js`

```javascript
import express from 'express';
import authRoutes from './auth.routes.js';
import resourcesRoutes from './resources.routes.js';
import syncRoutes from './sync.routes.js';

const router = express.Router();

// Mount sub-routers
router.use('/auth', authRoutes);
router.use('/resources', resourcesRoutes);
router.use('/sync', syncRoutes);

// Health check
router.get('/health', (req, res) => {
    res.json({
        success: true,
        service: '[App Name]',
        database: '[app]_db',
        timestamp: new Date().toISOString()
    });
});

export default router;
```

### Step 3: Mount in Server

**File:** `src/server.js`

```javascript
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import appRoutes from './routes/[app]/index.js';
import databaseInjector from './middleware/database-injector.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Database injection middleware
app.use('/api/[app]', databaseInjector('[app]_db'));

// Routes
app.use('/api/[app]', appRoutes);

// Global error handler
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({
        success: false,
        error: err.message || 'Internal server error'
    });
});

app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
});
```

---

## 7. Database Factory Pattern

### Why Use a Database Factory?

**Benefits:**
- Support multiple databases in one application
- Clean separation of concerns (one DB per microapp)
- Easy testing with mock databases
- Automatic Prisma client management

### Step 1: Create Factory

**File:** [src/config/database-factory.js](file:///d:/MicroMind_Suite/Web_App/server/src/config/database-factory.js)

```javascript
class DatabaseFactory {
    constructor() {
        this.clients = new Map();
        this.clientPromises = new Map();
    }

    async getClient(databaseName) {
        // Return existing client if already initialized
        if (this.clients.has(databaseName)) {
            return this.clients.get(databaseName);
        }

        // Return existing promise if initialization in progress
        if (this.clientPromises.has(databaseName)) {
            return this.clientPromises.get(databaseName);
        }

        // Create new client
        const clientPromise = this._createClient(databaseName);
        this.clientPromises.set(databaseName, clientPromise);

        const client = await clientPromise;
        this.clients.set(databaseName, client);
        this.clientPromises.delete(databaseName);

        return client;
    }

    async _createClient(databaseName) {
        console.log(`🔄 Initializing Prisma client for: ${databaseName}`);

        let PrismaClient;

        switch (databaseName) {
            case 'otax_sv1':
                PrismaClient = (await import('../../node_modules/.prisma/otax-client/index.js')).PrismaClient;
                break;
            case '[app]_db':
                PrismaClient = (await import('../../node_modules/.prisma/[app]-client/index.js')).PrismaClient;
                break;
            default:
                throw new Error(`Unknown database: ${databaseName}`);
        }

        const client = new PrismaClient();
        await client.$connect();

        console.log(`✅ Connected to: ${databaseName}`);
        return client;
    }

    async disconnectAll() {
        for (const [name, client] of this.clients) {
            await client.$disconnect();
            console.log(`Disconnected from: ${name}`);
        }
        this.clients.clear();
    }
}

export default new DatabaseFactory();
```

### Step 2: Database Injector Middleware

**File:** `src/middleware/database-injector.js`

```javascript
import databaseFactory from '../config/database-factory.js';

function databaseInjector(databaseName) {
    return async (req, res, next) => {
        try {
            req.db = await databaseFactory.getClient(databaseName);
            next();
        } catch (error) {
            console.error('Database injection failed:', error);
            res.status(500).json({
                success: false,
                error: 'Database connection failed'
            });
        }
    };
}

export default databaseInjector;
```

### Step 3: Usage in Controllers

```javascript
// req.db is automatically injected
export const myController = async (req, res) => {
    const data = await req.db.myModel.findMany();
    // ...
};
```

---

## 8. Testing Strategy

### Manual Testing Scripts

**File:** `test-auth.js`

```javascript
import databaseFactory from './src/config/database-factory.js';
import ApiService from './src/services/[app]/api.service.js';

async function testAuth() {
    const db = await databaseFactory.getClient('[app]_db');
    const apiService = new ApiService(db);

    try {
        // Test authentication
        const tokens = await apiService.authenticate(
            process.env.TEST_CLIENT_ID,
            process.env.TEST_CLIENT_SECRET
        );

        console.log('✅ Auth successful');
        console.log('Token expires:', tokens.expires_at);

        // Test API call
        const data = await apiService.get(
            'company-id',
            '/api/v1/test'
        );

        console.log('✅ API call successful');
        console.log('Data:', data);

    } catch (error) {
        console.error('❌ Test failed:', error.message);
    }

    process.exit(0);
}

testAuth();
```

### Sync Script Template

**File:** `sync-[resource].js`

```javascript
import databaseFactory from './src/config/database-factory.js';
import SyncService from './src/services/[app]/sync.service.js';

async function sync() {
    const db = await databaseFactory.getClient('[app]_db');
    const syncService = new SyncService(db);

    const company = await db.company.findFirst({
        where: { is_active: true }
    });

    if (!company) {
        console.error('No company found');
        process.exit(1);
    }

    const dateFrom = new Date();
    dateFrom.setDate(dateFrom.getDate() - 7);
    const dateTo = new Date();

    try {
        const results = await syncService.syncAll(
            company.id,
            dateFrom.toISOString(),
            dateTo.toISOString()
        );

        console.log('✅ Sync complete');
        console.log('Results:', results);
    } catch (error) {
        console.error('❌ Sync failed:', error.message);
    }

    process.exit(0);
}

sync();
```

---

## 9. Deployment Checklist

### Pre-Deployment

- [ ] All environment variables set
- [ ] Database created and accessible
- [ ] Prisma client generated
- [ ] Migrations deployed
- [ ] Database seeded (if needed)
- [ ] External API credentials validated
- [ ] Test scripts passed

### Deployment Steps

```bash
# 1. Install dependencies
npm install

# 2. Generate Prisma clients
npm run prisma:generate

# 3. Deploy migrations
npm run prisma:deploy

# 4. Seed database (optional)
npm run seed

# 5. Test connection
node test-auth.js

# 6. Start server
npm start
```

### Post-Deployment

- [ ] Health endpoint responding
- [ ] Authentication working
- [ ] Database queries executing
- [ ] External API calls succeeding
- [ ] Sync script tested
- [ ] Error logging configured

---

## 10. Key Learnings

### Critical Patterns

**1. Token Management**
- Always check token expiry before API calls
- Implement auto-refresh 5 minutes before expiry
- For critical operations, get fresh token per request

**2. Error Handling**
- Rollback database changes on external API failures
- Log all errors with context
- Return consistent error format to clients

**3. Database Design**
- Use UUIDs for primary keys
- Always include `created_at` and `updated_at`
- Index frequently queried fields
- Use `@unique` for external IDs

**4. API Integration**
- Never trust external API stability
- Implement retry logic with exponential backoff
- Cache responses when appropriate
- Handle rate limiting gracefully

### Common Pitfalls

**❌ Don't:**
- Store sensitive data without encryption
- Use sequential IDs for external references
- Skip error handling in async operations
- Forget to close database connections
- Hard-code API URLs

**✅ Do:**
- Use environment variables for all config
- Implement comprehensive logging
- Test with production-like data
- Document API version compatibility
- Monitor database connection pool

### Production Tips

1. **Connection Pooling:** Configure Prisma connection limits
   ```prisma
   datasource db {
     provider = "postgresql"
     url      = env("DATABASE_URL")
     pool_timeout = 60
     connection_limit = 10
   }
   ```

2. **Logging:** Use structured logging
   ```javascript
   console.log(JSON.stringify({
     level: 'error',
     service: '[app]',
     function: 'syncResources',
     error: error.message,
     timestamp: new Date().toISOString()
   }));
   ```

3. **Health Checks:** Include database status
   ```javascript
   router.get('/health', async (req, res) => {
     try {
       await req.db.$queryRaw`SELECT 1`;
       res.json({ status: 'healthy', database: 'connected' });
     } catch (error) {
       res.status(503).json({ status: 'unhealthy', database: 'disconnected' });
     }
   });
   ```

---

## Quick Start Checklist

Use this checklist when starting a new backend:

- [ ] Create project structure
- [ ] Install dependencies
- [ ] Create Prisma schema
- [ ] Set up environment variables
- [ ] Create database factory
- [ ] Create API service
- [ ] Implement authentication
- [ ] Create first controller
- [ ] Create routes
- [ ] Add database injector middleware
- [ ] Mount routes in server
- [ ] Write test script
- [ ] Test authentication
- [ ] Test first API call
- [ ] Create sync script
- [ ] Document endpoints
- [ ] Deploy and validate

---

**Blueprint Version:** 1.0  
**Based on:** OTax Production Implementation  
**Last Updated:** January 22, 2026
