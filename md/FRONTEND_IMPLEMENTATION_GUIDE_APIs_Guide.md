# OTax Frontend - Implementation Guide

**For Frontend Engineers**  
**Backend API Version:** 1.0 (Production Validated)  
**Last Updated:** January 22, 2026

---

## Table of Contents

1. [Overview](#overview)
2. [Technology Stack](#technology-stack)
3. [Project Setup](#project-setup)
4. [Backend API Reference](#backend-api-reference)
5. [Authentication Implementation](#authentication-implementation)
6. [Data Models](#data-models)
7. [UI Components](#ui-components)
8. [Integration Examples](#integration-examples)
9. [Error Handling](#error-handling)
10. [Testing Guide](#testing-guide)

---

## Overview

The OTax application is an Egyptian Tax Authority (ETA) integration system for managing e-invoices, reconciliation, and reporting.

### Application Scope

**Primary Features:**
- Document Management (create, submit, track e-invoices)
- Portal Synchronization (pull documents from ETA)
- Reconciliation (match ERP, Bank, and ETA transactions)
- Batch Operations (submit 100+ documents at once)
- Digital Signatures (USB token integration)
- Gap Analysis & Reporting

**Backend Status:**
- ✅ 44 API endpoints ready
- ✅ Production validated with real ETA data
- ✅ 24 documents successfully synced
- ✅ Authentication working
- ✅ Full CRUD operations available

---

## Technology Stack

### Recommended Frontend Stack

**Framework:** Next.js 14+ (App Router) or Vite + React 18+  
**State Management:** Zustand or React Query  
**UI Library:** shadcn/ui + Tailwind CSS  
**Forms:** React Hook Form + Zod validation  
**HTTP Client:** Axios or Fetch API  
**Charts:** Recharts or Chart.js  
**Tables:** TanStack Table (React Table v8)  
**Date Handling:** date-fns  

### Why This Stack?

- **Next.js:** SSR support, API routes, optimized builds
- **shadcn/ui:** Production-ready components, accessible
- **React Query:** Perfect for API data fetching and caching
- **Zod:** TypeScript-first schema validation
- **TanStack Table:** Powerful table features (sort, filter, pagination)

---

## Project Setup

### Initialize Project

```bash
# Using Next.js (Recommended)
npx create-next-app@latest otax-frontend
cd otax-frontend

# Install dependencies
npm install axios zustand react-hook-form zod @hookform/resolvers
npm install @tanstack/react-query @tanstack/react-table
npm install recharts date-fns lucide-react

# Install shadcn/ui
npx shadcn-ui@latest init
npx shadcn-ui@latest add button card input table dialog
```

### Directory Structure

```
src/
├── app/                    # Next.js app router
│   ├── (auth)/
│   │   └── login/
│   ├── (dashboard)/
│   │   ├── documents/
│   │   ├── reconciliation/
│   │   ├── reports/
│   │   └── settings/
│   └── api/               # API route handlers (optional)
├── components/
│   ├── ui/                # shadcn components
│   ├── documents/
│   ├── reconciliation/
│   └── reports/
├── lib/
│   ├── api/               # API client & hooks
│   ├── stores/            # Zustand stores
│   ├── types/             # TypeScript types
│   └── utils/             # Utilities
└── config/
    └── env.ts             # Environment config
```

### Environment Variables

```env
NEXT_PUBLIC_API_URL=http://localhost:5000/api/otax
# For production:
# NEXT_PUBLIC_API_URL=https://your-api.com/api/otax
```

---

## Backend API Reference

### Base URL

**Production:** `https://your-api.com/api/otax`  
**Development:** `http://localhost:5000/api/otax`

### API Response Format

All endpoints return this structure:

```typescript
interface ApiResponse<T> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
}
```

### Authentication Required

All endpoints except `/auth/login` require authentication. Include the company_id in requests.

---

### 1. Authentication APIs

#### Login

```http
POST /auth/login
Content-Type: application/json

{
  "client_id": "your-client-id",
  "client_secret": "your-client-secret",
  "environment": "production"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Authentication successful",
  "data": {
    "company_id": "uuid-here",
    "company_name": "Your Company",
    "access_token": "eyJhbGci...",
    "expires_at": "2026-01-22T10:00:00Z",
    "environment": "production"
  }
}
```

**Frontend Usage:**
```typescript
async function login(credentials: LoginCredentials) {
  const response = await axios.post('/auth/login', credentials);
  
  // Store company_id and access_token
  localStorage.setItem('company_id', response.data.data.company_id);
  localStorage.setItem('access_token', response.data.data.access_token);
  
  return response.data;
}
```

#### Logout

```http
POST /auth/logout
Content-Type: application/json

{
  "company_id": "uuid-here"
}
```

---

### 2. Document Management APIs

#### Get Documents (Search)

```http
GET /documents/search?company_id={id}&submission_date_from=2026-01-01T00:00:00Z&submission_date_to=2026-01-30T23:59:59Z&direction=Sent&page_size=100
```

**Query Parameters:**
- `company_id` (required)
- `submission_date_from` (required, ISO 8601)
- `submission_date_to` (required, max 30 days from start)
- `direction`: `Sent` | `Received`
- `document_type`: `i` | `c` | `d`
- `status`: [Valid](file:///d:/MicroMind_Suite/Web_App/server/src/services/otax/eta-api.service.js#105-177) | `Invalid` | `Cancelled`
- `page_size`: 1-100
- `continuation_token`: For next page

**Response:**
```json
{
  "success": true,
  "data": {
    "documents": [
      {
        "uuid": "42S512YACQBRSRHY...",
        "internalId": "INV-2026-001",
        "typeName": "i",
        "typeVersionName": "1.0",
        "issuerId": "100000001",
        "issuerName": "My Company",
        "receiverId": "200000002",
        "receiverName": "Client Company",
        "dateTimeIssued": "2026-01-22T10:00:00Z",
        "totalSales": 1000.00,
        "total": 1140.00,
        "status": "Valid"
      }
    ],
    "pagination": {
      "total_results": 24,
      "page_size": 100,
      "continuation_token": null,
      "has_more": false
    }
  }
}
```

#### Submit Document

```http
POST /documents/submit
Content-Type: application/json

{
  "company_id": "uuid-here",
  "documents": [
    {
      "internalId": "INV-2026-001",
      "documentType": "I",
      "dateTimeIssued": "2026-01-22T10:00:00Z",
      "receiver": {
        "name": "Client Company",
        "type": "B",
        "id": "200000002"
      },
      "totalAmount": 1140.00,
      "invoiceLines": [
        {
          "description": "Product A",
          "quantity": 10,
          "unitPrice": 100,
          "taxRate": 14,
          "totalAmount": 1140
        }
      ]
    }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "submissionId": "XYE60M8END...",
    "acceptedDocuments": [
      {
        "uuid": "42S512YACQ...",
        "internalId": "INV-2026-001",
        "status": "SUBMITTED"
      }
    ],
    "rejectedDocuments": []
  }
}
```

#### Get Document Status

```http
GET /documents/{uuid}/status?company_id={id}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "uuid": "42S512YACQBRSRHY...",
    "status": "VALID",
    "submissionDate": "2026-01-22T10:00:00Z",
    "validationDate": "2026-01-22T10:05:00Z",
    "publicUrl": "https://eta.gov.eg/documents/42S512..."
  }
}
```

#### Download PDF

```http
GET /documents/{uuid}/pdf?company_id={id}
```

Returns PDF file as blob.

#### Cancel/Reject Document

```http
PUT /documents/{uuid}/cancel
Content-Type: application/json

{
  "company_id": "uuid-here",
  "reason": "Cancelled by issuer"
}
```

---

### 3. Sync APIs

#### Pull Documents from ETA

```http
POST /sync/documents
Content-Type: application/json

{
  "company_id": "uuid-here",
  "date_from": "2026-01-01",
  "date_to": "2026-01-30"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Synced 24 documents from ETA",
  "data": {
    "total": 24,
    "new": 18,
    "updated": 6,
    "errors": 0
  }
}
```

#### Get Notifications

```http
GET /sync/notifications?company_id={id}
```

---

### 4. Batch Operations

#### Batch Submit

```http
POST /batch/submit
Content-Type: application/json

{
  "company_id": "uuid-here",
  "documents": [/* 100+ documents */]
}
```

**Response:**
```json
{
  "success": true,
  "message": "Batch job created",
  "data": {
    "job_id": "550e8400-e29b-41d4-a716-446655440000",
    "total_documents": 150,
    "status": "PROCESSING"
  }
}
```

#### Get Batch Status

```http
GET /batch/{jobId}/status
```

**Response:**
```json
{
  "success": true,
  "data": {
    "job_id": "550e8400...",
    "status": "COMPLETED",
    "progress": {
      "percentage": 100,
      "total": 150,
      "processed": 150,
      "submitted": 147,
      "failed": 3
    }
  }
}
```

---

### 5. Reconciliation APIs

#### Get Unmatched Items

```http
GET /reconciliation/unmatched?company_id={id}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "erp": {
      "count": 15,
      "transactions": [
        {
          "id": "uuid",
          "invoice_number": "INV-001",
          "total_amount": 1000.00,
          "customer_name": "Client A",
          "transaction_date": "2026-01-15"
        }
      ]
    },
    "bank": {
      "count": 8,
      "transactions": [...]
    },
    "eta": {
      "count": 12,
      "documents": [...]
    }
  }
}
```

#### Auto-Match

```http
POST /reconciliation/auto-match
Content-Type: application/json

{
  "company_id": "uuid-here"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Auto-match completed: 35 matches created",
  "summary": {
    "perfect_matches": 25,
    "wht_matches": 5,
    "fx_matches": 3,
    "manual_review": 2
  }
}
```

#### Create Manual Match

```http
POST /reconciliation/matches
Content-Type: application/json

{
  "erp_transaction_id": "uuid",
  "eta_document_id": "uuid",
  "variance_amount": 100.00,
  "variance_reason": "WHT_5%"
}
```

---

### 6. Reports APIs

#### Gap Analysis

```http
GET /reports/gap-analysis?company_id={id}&date_from=2026-01-01&date_to=2026-01-31
```

**Response:**
```json
{
  "success": true,
  "data": {
    "portal_liability": 125000.00,
    "erp_liability": 123500.00,
    "gap": 1500.00,
    "gap_percentage": 1.21,
    "tax_gap": 210.00,
    "counts": {
      "eta_documents": 150,
      "erp_transactions": 145,
      "discrepancies": 8
    },
    "discrepancies": [
      {
        "type": "AMOUNT_MISMATCH",
        "eta_uuid": "...",
        "internal_id": "INV-001",
        "eta_amount": 1140.00,
        "erp_amount": 1000.00,
        "difference": 140.00
      }
    ]
  }
}
```

#### Statistics

```http
GET /reports/statistics?company_id={id}&period=30
```

**Response:**
```json
{
  "success": true,
  "data": {
    "period_days": 30,
    "document_status": {
      "VALID": 120,
      "SUBMITTED": 25,
      "REJECTED": 5
    },
    "reconciliation": {
      "total_transactions": 150,
      "matched": 135,
      "unmatched": 15,
      "match_rate": 90.00
    }
  }
}
```

---

## Authentication Implementation

### Setup Auth Store (Zustand)

```typescript
// lib/stores/auth-store.ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AuthState {
  companyId: string | null;
  companyName: string | null;
  accessToken: string | null;
  expiresAt: string | null;
  isAuthenticated: boolean;
  
  setAuth: (data: {
    companyId: string;
    companyName: string;
    accessToken: string;
    expiresAt: string;
  }) => void;
  
  clearAuth: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      companyId: null,
      companyName: null,
      accessToken: null,
      expiresAt: null,
      isAuthenticated: false,
      
      setAuth: (data) => set({
        companyId: data.companyId,
        companyName: data.companyName,
        accessToken: data.accessToken,
        expiresAt: data.expiresAt,
        isAuthenticated: true
      }),
      
      clearAuth: () => set({
        companyId: null,
        companyName: null,
        accessToken: null,
        expiresAt: null,
        isAuthenticated: false
      })
    }),
    {
      name: 'otax-auth'
    }
  )
);
```

### Create API Client

```typescript
// lib/api/client.ts
import axios from 'axios';
import { useAuthStore } from '../stores/auth-store';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api/otax';

export const apiClient = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json'
  }
});

// Add company_id to all requests
apiClient.interceptors.request.use((config) => {
  const { companyId } = useAuthStore.getState();
  
  if (companyId) {
    // Add to query params for GET requests
    if (config.method === 'get') {
      config.params = {
        ...config.params,
        company_id: companyId
      };
    }
    // Add to body for POST/PUT requests
    else {
      config.data = {
        ...config.data,
        company_id: companyId
      };
    }
  }
  
  return config;
});

// Handle 401 errors
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      useAuthStore.getState().clearAuth();
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);
```

### Login Component

```typescript
// app/(auth)/login/page.tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuthStore } from '@/lib/stores/auth-store';
import { apiClient } from '@/lib/api/client';

const loginSchema = z.object({
  client_id: z.string().min(1, 'Client ID is required'),
  client_secret: z.string().min(1, 'Client Secret is required'),
  environment: z.enum(['production', 'sandbox'])
});

type LoginForm = z.infer<typeof loginSchema>;

export default function LoginPage() {
  const router = useRouter();
  const setAuth = useAuthStore(state => state.setAuth);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  const { register, handleSubmit, formState: { errors } } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      environment: 'production'
    }
  });
  
  const onSubmit = async (data: LoginForm) => {
    setLoading(true);
    setError('');
    
    try {
      const response = await apiClient.post('/auth/login', data);
      
      if (response.data.success) {
        setAuth({
          companyId: response.data.data.company_id,
          companyName: response.data.data.company_name,
          accessToken: response.data.data.access_token,
          expiresAt: response.data.data.expires_at
        });
        
        router.push('/dashboard');
      } else {
        setError(response.data.error || 'Login failed');
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Login failed');
    } finally {
      setLoading(false);
    }
  };
  
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-md space-y-8 p-8">
        <div className="text-center">
          <h1 className="text-3xl font-bold">OTax Login</h1>
          <p className="mt-2 text-gray-600">Egyptian Tax Authority Integration</p>
        </div>
        
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          <div>
            <label className="block text-sm font-medium">Client ID</label>
            <Input {...register('client_id')} />
            {errors.client_id && (
              <p className="mt-1 text-sm text-red-600">{errors.client_id.message}</p>
            )}
          </div>
          
          <div>
            <label className="block text-sm font-medium">Client Secret</label>
            <Input type="password" {...register('client_secret')} />
            {errors.client_secret && (
              <p className="mt-1 text-sm text-red-600">{errors.client_secret.message}</p>
            )}
          </div>
          
          <div>
            <label className="block text-sm font-medium">Environment</label>
            <select {...register('environment')} className="w-full rounded border p-2">
              <option value="production">Production</option>
              <option value="sandbox">Sandbox</option>
            </select>
          </div>
          
          {error && (
            <div className="rounded bg-red-50 p-3 text-red-600">{error}</div>
          )}
          
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? 'Logging in...' : 'Login'}
          </Button>
        </form>
      </div>
    </div>
  );
}
```

---

## Data Models

### TypeScript Interfaces

```typescript
// lib/types/index.ts

export interface Document {
  uuid: string;
  internalId: string;
  typeName: 'i' | 'c' | 'd' | 'r';
  typeVersionName: string;
  issuerId: string;
  issuerName: string;
  receiverId: string;
  receiverName: string;
  dateTimeIssued: string;
  dateTimeReceived?: string;
  totalSales: number;
  totalDiscount: number;
  netAmount: number;
  total: number;
  status: 'Valid' | 'Invalid' | 'Submitted' | 'Rejected' | 'Cancelled';
  submissionUUID?: string;
}

export interface DocumentSearchParams {
  submission_date_from: string;
  submission_date_to: string;
  direction?: 'Sent' | 'Received';
  document_type?: 'i' | 'c' | 'd';
  status?: string;
  page_size?: number;
  continuation_token?: string;
}

export interface PaginatedResponse<T> {
  documents: T[];
  pagination: {
    total_results: number;
    page_size: number;
    continuation_token: string | null;
    has_more: boolean;
  };
}

export interface ReconciliationMatch {
  id: string;
  erp_transaction_id?: string;
  bank_transaction_id?: string;
  eta_document_id?: string;
  match_type: 'PERFECT' | 'WHT' | 'FX' | 'MANUAL';
  confidence_score: number;
  variance_amount: number;
  variance_reason?: string;
  status: 'SUGGESTED' | 'APPROVED' | 'REJECTED';
  matched_at: string;
}

export interface GapAnalysis {
  portal_liability: number;
  erp_liability: number;
  gap: number;
  gap_percentage: number;
  tax_gap: number;
  counts: {
    eta_documents: number;
    erp_transactions: number;
    discrepancies: number;
  };
  discrepancies: Discrepancy[];
}

export interface Discrepancy {
  type: 'IN_ETA_NOT_IN_ERP' | 'IN_ERP_NOT_IN_ETA' | 'AMOUNT_MISMATCH';
  eta_uuid?: string;
  internal_id?: string;
  erp_invoice?: string;
  eta_amount?: number;
  erp_amount?: number;
  difference?: number;
}

export interface BatchJob {
  job_id: string;
  total_documents: number;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  progress?: {
    percentage: number;
    total: number;
    processed: number;
    submitted: number;
    failed: number;
  };
}
```

---

## UI Components

### Required Pages

#### 1. Dashboard (Home)
**Route:** `/dashboard`

**Components:**
- Statistics cards (Total Documents, Valid, Pending, Rejected)
- Recent documents table
- Gap analysis chart
- Reconciliation status widget

#### 2. Documents List
**Route:** `/documents`

**Features:**
- Search and filter (date range, status, direction)
- Table with columns: Internal ID, Date, Receiver, Amount, Status
- Actions: View, Download PDF, Cancel, Reject
- Pagination with continuation token

#### 3. Document Detail/Create
**Route:** `/documents/new` & `/documents/[uuid]`

**Form Fields:**
- Internal ID
- Document Type (Invoice, Credit Note, etc.)
- Date Issued
- Receiver (Name, Tax Number, Type)
- Line Items (Description, Quantity, Unit Price, Tax Rate)
- Total calculations (auto-calculate)

#### 4. Sync Portal
**Route:** `/sync`

**Features:**
- Date range selector (max 30 days)
- Sync button
- Progress indicator
- Sync history table
- Last sync info

#### 5. Batch Operations
**Route:** `/batch`

**Features:**
- File upload (Excel/CSV)
- Document preview table
- Validate button
- Submit batch button
- Job status tracking

#### 6. Reconciliation
**Route:** `/reconciliation`

**Sections:**
- **Unmatched Items Tab:** ERP, Bank, ETA lists
- **Auto-Match Button:** Trigger multi-pass matching
- **Matches Table:** Show suggested/approved/rejected
- **Match Detail Modal:** View variance details, approve/reject

#### 7. Reports
**Route:** `/reports`

**Reports:**
- **Gap Analysis:** Chart + discrepancies table
- **Statistics:** Period selector + metrics cards
- **Export:** Download CSV/Excel

---

### Component Examples

#### Documents Table Component

```typescript
// components/documents/documents-table.tsx
'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { apiClient } from '@/lib/api/client';
import type { Document, PaginatedResponse } from '@/lib/types';

export function DocumentsTable() {
  const [dateFrom, setDateFrom] = useState(
    new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  );
  const [dateTo, setDateTo] = useState(new Date().toISOString());
  const [continuationToken, setContinuationToken] = useState<string | null>(null);
  
  const { data, isLoading } = useQuery({
    queryKey: ['documents', dateFrom, dateTo, continuationToken],
    queryFn: async () => {
      const params: any = {
        submission_date_from: dateFrom,
        submission_date_to: dateTo,
        page_size: 50
      };
      
      if (continuationToken) {
        params.continuation_token = continuationToken;
      }
      
      const response = await apiClient.get<{
        success: boolean;
        data: PaginatedResponse<Document>;
      }>('/documents/search', { params });
      
      return response.data.data;
    }
  });
  
  if (isLoading) {
    return <div>Loading...</div>;
  }
  
  return (
    <div className="space-y-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Internal ID</TableHead>
            <TableHead>Date</TableHead>
            <TableHead>Receiver</TableHead>
            <TableHead>Amount</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data?.documents.map((doc) => (
            <TableRow key={doc.uuid}>
              <TableCell className="font-medium">{doc.internalId}</TableCell>
              <TableCell>
                {new Date(doc.dateTimeIssued).toLocaleDateString()}
              </TableCell>
              <TableCell>{doc.receiverName}</TableCell>
              <TableCell>{doc.total.toFixed(2)} EGP</TableCell>
              <TableCell>
                <span className={`badge ${getStatusColor(doc.status)}`}>
                  {doc.status}
                </span>
              </TableCell>
              <TableCell>
                <Button variant="outline" size="sm">View</Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      
      {data?.pagination.has_more && (
        <Button
          onClick={() => setContinuationToken(data.pagination.continuation_token)}
        >
          Load More
        </Button>
      )}
    </div>
  );
}

function getStatusColor(status: string) {
  switch (status) {
    case 'Valid':
      return 'bg-green-100 text-green-800';
    case 'Submitted':
      return 'bg-blue-100 text-blue-800';
    case 'Rejected':
      return 'bg-red-100 text-red-800';
    default:
      return 'bg-gray-100 text-gray-800';
  }
}
```

---

## Integration Examples

### Using React Query for Data Fetching

```typescript
// lib/api/queries.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from './client';
import type { Document, GapAnalysis } from '../types';

// Fetch documents
export function useDocuments(params: DocumentSearchParams) {
  return useQuery({
    queryKey: ['documents', params],
    queryFn: async () => {
      const response = await apiClient.get('/documents/search', { params });
      return response.data.data;
    }
  });
}

// Submit document
export function useSubmitDocument() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (document: any) => {
      const response = await apiClient.post('/documents/submit', {
        documents: [document]
      });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents'] });
    }
  });
}

// Sync documents
export function useSyncDocuments() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (params: { date_from: string; date_to: string }) => {
      const response = await apiClient.post('/sync/documents', params);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents'] });
    }
  });
}

// Gap analysis
export function useGapAnalysis(dateFrom: string, dateTo: string) {
  return useQuery({
    queryKey: ['gap-analysis', dateFrom, dateTo],
    queryFn: async () => {
      const response = await apiClient.get<{ data: GapAnalysis }>('/reports/gap-analysis', {
        params: { date_from: dateFrom, date_to: dateTo }
      });
      return response.data.data;
    }
  });
}
```

---

## Error Handling

### Global Error Handler

```typescript
// lib/utils/error-handler.ts
export function handleApiError(error: any): string {
  if (error.response) {
    // Server responded with error
    return error.response.data?.error || error.response.data?.message || 'An error occurred';
  } else if (error.request) {
    // Request made but no response
    return 'No response from server. Please check your connection.';
  } else {
    // Something else happened
    return error.message || 'An unexpected error occurred';
  }
}
```

### Usage in Components

```typescript
const { mutate, isLoading } = useSubmitDocument();

const handleSubmit = (data: any) => {
  mutate(data, {
    onSuccess: () => {
      toast.success('Document submitted successfully');
    },
    onError: (error) => {
      toast.error(handleApiError(error));
    }
  });
};
```

---

## Testing Guide

### 1. Test Authentication

```typescript
// Test login with real credentials
const testAuth = async () => {
  const response = await fetch('http://localhost:5000/api/otax/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: 'your-client-id',
      client_secret: 'your-client-secret',
      environment: 'production'
    })
  });
  
  const data = await response.json();
  console.log('Auth response:', data);
};
```

### 2. Test Document Retrieval

```typescript
// After logging in, get documents
const testDocuments = async (companyId: string) => {
  const dateFrom = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const dateTo = new Date().toISOString();
  
  const response = await fetch(
    `http://localhost:5000/api/otax/documents/search?` +
    `company_id=${companyId}&` +
    `submission_date_from=${dateFrom}&` +
    `submission_date_to=${dateTo}&` +
    `page_size=10`
  );
  
  const data = await response.json();
  console.log('Documents:', data);
};
```

### 3. Test Data

**Backend has 24 real documents** synced from production ETA:
- Document range: 1.14 - 2,220 EGP
- Both SENT and RECEIVED documents
- All with Valid, Submitted, or Rejected status

---

## Quick Start Checklist

- [ ] Set up Next.js project
- [ ] Install dependencies (axios, zustand, react-query, shadcn/ui)
- [ ] Configure environment variables
- [ ] Create auth store
- [ ] Create API client with interceptors
- [ ] Build login page
- [ ] Test authentication
- [ ] Create TypeScript interfaces
- [ ] Build document list page
- [ ] Test document retrieval
- [ ] Implement pagination with continuation tokens
- [ ] Build document detail/create page
- [ ] Test document submission
- [ ] Build sync page
- [ ] Build reconciliation page
- [ ] Build reports page
- [ ] Add error handling
- [ ] Add loading states
- [ ] Test complete flow

---

## Backend Endpoints Summary

**Total: 44 endpoints available**

| Category | Count | Key Endpoints |
|----------|-------|---------------|
| Authentication | 4 | login, logout, refresh, status |
| Documents | 9 | search, submit, status, pdf, cancel, reject |
| Sync | 3 | pull documents, notifications, reconcile |
| Batch | 3 | submit, status, list jobs |
| Reconciliation | 5 | unmatched, auto-match, matches, approve, reject |
| Reports | 2 | gap-analysis, statistics |
| Others | 18 | taxpayer, codes, transactions, bank, signature |

---

## Support

**Backend API:** http://localhost:5000/api/otax  
**Health Check:** http://localhost:5000/api/otax/health  
**API Documentation:** See API_DOCUMENTATION.md

---

**Documentation Version:** 1.0  
**For:** Frontend Implementation  
**Last Updated:** January 22, 2026
