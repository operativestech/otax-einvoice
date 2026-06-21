/**
 * Shared client-side exporters for tables across the app.
 * Uses xlsx (already in deps) for .xlsx; falls back to RFC-4180 CSV.
 *
 * Keep this file framework-agnostic — no React, no DOM refs beyond the
 * download <a> hack. That way any page can call exportExcel / exportCsv.
 */

import * as XLSX from 'xlsx';
import { alertDialog } from '../components/ConfirmDialog';

export interface Sheet {
    name: string;                          // tab name, max 31 chars, no special chars
    rows: Array<Record<string, any>>;      // column → value; headers come from the first row's keys
    colWidths?: number[];                  // optional column widths in chars
}

function sanitizeSheetName(name: string): string {
    // Excel rejects /\?*[]: and caps the name at 31 chars.
    return name.replace(/[\/\\?*[\]:]/g, '_').slice(0, 31) || 'Sheet';
}

function timestamp(): string {
    return new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
}

/**
 * Export one or more sheets to a single .xlsx file.
 */
export function exportExcel(filenameBase: string, sheets: Sheet[]): void {
    const wb = XLSX.utils.book_new();
    for (const s of sheets) {
        const ws = XLSX.utils.json_to_sheet(s.rows.length ? s.rows : [{ '(empty)': '' }]);
        if (s.colWidths && s.colWidths.length) {
            ws['!cols'] = s.colWidths.map(wch => ({ wch }));
        } else if (s.rows.length > 0) {
            // Auto-width: use the max of header length and longest string in that column
            const keys = Object.keys(s.rows[0]);
            ws['!cols'] = keys.map(k => {
                const maxVal = s.rows.reduce((m, r) => {
                    const v = r[k];
                    const len = v === null || v === undefined ? 0 : String(v).length;
                    return Math.max(m, len);
                }, k.length);
                return { wch: Math.min(Math.max(maxVal + 2, 10), 60) };
            });
        }
        XLSX.utils.book_append_sheet(wb, ws, sanitizeSheetName(s.name));
    }
    XLSX.writeFile(wb, `${filenameBase}-${timestamp()}.xlsx`);
}

/**
 * Export a single dataset to CSV. Wraps strings in quotes and escapes embedded quotes.
 * Prepends a UTF-8 BOM so Excel reads non-ASCII (Arabic) correctly.
 */
export function exportCsv(filenameBase: string, rows: Array<Record<string, any>>): void {
    if (rows.length === 0) {
        // fire-and-forget — caller doesn't await us anyway and the function
        // signature is sync. This pops the modal and proceeds to bail out.
        void alertDialog({ title: 'Nothing to export', message: 'There are no rows to export.', tone: 'info' });
        return;
    }
    const headers = Object.keys(rows[0]);
    const esc = (v: any): string => {
        if (v === null || v === undefined) return '';
        const s = String(v);
        if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
        return s;
    };
    const lines = [headers.map(esc).join(',')];
    for (const r of rows) {
        lines.push(headers.map(h => esc(r[h])).join(','));
    }
    const csv = '\ufeff' + lines.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filenameBase}-${timestamp()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

/**
 * Format a Date or ISO string for export cells. Returns "" for empty/invalid input
 * so Excel doesn't show "#N/A" or "Invalid Date".
 */
export function fmtDate(v: string | Date | null | undefined): string {
    if (!v) return '';
    const d = v instanceof Date ? v : new Date(v);
    if (isNaN(d.getTime())) return '';
    return d.toISOString().slice(0, 10);
}

/**
 * Coerce to number for export, returning '' if not a real number so Excel keeps the cell blank.
 */
export function num(v: any): number | '' {
    if (v === null || v === undefined || v === '') return '';
    const n = typeof v === 'number' ? v : parseFloat(String(v));
    return isNaN(n) ? '' : n;
}
