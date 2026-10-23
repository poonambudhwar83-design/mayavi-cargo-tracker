import { randomUUID } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { readSession } from '../../../lib/mayaviAuth.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const database = () => {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL ||
    process.env.NEON_DATABASE_URL || process.env.DATABASE_URL_UNPOOLED || '';
  if (!url) throw new Error('Mayavi database is unavailable.');
  return neon(url);
};
const reply = (value, status = 200) => Response.json(value, {
  status, headers: { 'cache-control': 'no-store' }
});
async function adminAccess(request, sql) {
  const session = readSession(request);
  if (!session) return { error: 'Please log in to Mayavi.', status: 401 };
  if (session.role !== 'admin') return { error: 'Admin access only.', status: 403 };
  const found = await sql`SELECT username, role, is_active FROM mayavi_users
    WHERE lower(username) = ${session.username} LIMIT 1`;
  if (found[0]?.role !== 'admin' || !found[0]?.is_active) {
    return { error: 'Admin account is not active.', status: 403 };
  }
  return { session };
}
async function ensureTable(sql) {
  await sql`CREATE TABLE IF NOT EXISTS mayavi_admin_payments (
    id TEXT PRIMARY KEY,
    month_key TEXT NOT NULL,
    data JSONB NOT NULL,
    created_by TEXT NOT NULL,
    updated_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
}
const clean = (value, max) => String(value ?? '').trim().slice(0, max);
const validMonth = (v) => /^20\d{2}-(0[1-9]|1[0-2])$/.test(v);
function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(value + 'T00:00:00Z');
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}
function paise(value) {
  const input = String(value ?? '').trim().replace(/,/g, '');
  if (!/^\d{1,11}(?:\.\d{1,2})?$/.test(input)) return null;
  const [rupees, fraction = ''] = input.split('.');
  const result = Number(rupees) * 100 + Number((fraction + '00').slice(0, 2));
  return Number.isSafeInteger(result) && result <= 1000000000000 ? result : null;
}
const money = (paiseValue = 0) => (Math.max(0, Number(paiseValue) || 0) / 100).toFixed(2);
function parseEntry(body) {
  const month = clean(body?.month, 7);
  const amountPaise = paise(body?.amount);
  const paidPaise = paise(body?.paidAmount || '0');
  const category = clean(body?.category, 40);
  const method = clean(body?.method, 30);
  const entry = {
    month, title: clean(body?.title, 160), payee: clean(body?.payee, 200),
    category, amountPaise, paidPaise,
    dueDate: clean(body?.dueDate, 10), paidDate: clean(body?.paidDate, 10),
    method, reference: clean(body?.reference, 140), notes: clean(body?.notes, 4000)
  };
  const categories = ['VENDOR', 'SALARY', 'FREIGHT', 'RENT', 'UTILITIES', 'TAX', 'OTHER'];
  const methods = ['NONE', 'BANK_TRANSFER', 'UPI', 'CASH', 'CHEQUE', 'CARD', 'OTHER'];
  if (!validMonth(month) || !entry.title || !entry.payee ||
      amountPaise === null || amountPaise <= 0 || paidPaise === null ||
      paidPaise > amountPaise || !categories.includes(category) || !methods.includes(method) ||
      (entry.dueDate && !validDate(entry.dueDate)) ||
      (entry.paidDate && !validDate(entry.paidDate))) {
    return { error: 'Enter a valid month, payment, payee and amounts (paid cannot exceed total).' };
  }
  if (paidPaise === 0) {
    entry.paidDate = ''; entry.method = 'NONE'; entry.reference = '';
  }
  return { entry };
}
const output = (row) => ({
  ...row.data, id: row.id,
  amount: money(row.data?.amountPaise), paidAmount: money(row.data?.paidPaise),
  createdBy: row.created_by, updatedBy: row.updated_by,
  createdAt: row.created_at, updatedAt: row.updated_at
});
async function one(sql, id) {
  const found = await sql`SELECT id, data, created_by, updated_by, created_at, updated_at
    FROM mayavi_admin_payments WHERE id = ${id} LIMIT 1`;
  return found[0] ? output(found[0]) : null;
}
export async function GET(request) {
  try {
    const sql = database(), auth = await adminAccess(request, sql);
    if (auth.error) return reply({ ok: false, error: auth.error }, auth.status);
    const month = new URL(request.url).searchParams.get('month') || '';
    if (!validMonth(month)) return reply({ ok: false, error: 'Select a valid payment month.' }, 400);
    await ensureTable(sql);
    const rows = await sql`SELECT id, data, created_by, updated_by, created_at, updated_at
      FROM mayavi_admin_payments WHERE month_key = ${month}
      ORDER BY created_at DESC LIMIT 1000`;
    return reply({ ok: true, month, rows: rows.map(output) });
  } catch (e) { return reply({ ok: false, error: e?.message || 'Payments unavailable.' }, 503); }
}
export async function POST(request) {
  try {
    const sql = database(), auth = await adminAccess(request, sql);
    if (auth.error) return reply({ ok: false, error: auth.error }, auth.status);
    const { entry, error } = parseEntry(await request.json().catch(() => ({})));
    if (error) return reply({ ok: false, error }, 400);
    await ensureTable(sql);
    const id = randomUUID(), by = auth.session.displayName || auth.session.username;
    await sql`INSERT INTO mayavi_admin_payments (id, month_key, data, created_by, updated_by)
      VALUES (${id}, ${entry.month}, ${JSON.stringify(entry)}::jsonb, ${by}, ${by})`;
    return reply({ ok: true, row: await one(sql, id) }, 201);
  } catch (e) { return reply({ ok: false, error: e?.message || 'Save failed.' }, 503); }
}
export async function PATCH(request) {
  try {
    const sql = database(), auth = await adminAccess(request, sql);
    if (auth.error) return reply({ ok: false, error: auth.error }, auth.status);
    const body = await request.json().catch(() => ({}));
    const id = clean(body?.id, 80);
    if (!/^[0-9a-f-]{36}$/i.test(id)) return reply({ ok: false, error: 'Invalid record ID.' }, 400);
    const { entry, error } = parseEntry(body);
    if (error) return reply({ ok: false, error }, 400);
    await ensureTable(sql);
    const by = auth.session.displayName || auth.session.username;
    const updated = await sql`UPDATE mayavi_admin_payments
      SET month_key = ${entry.month}, data = ${JSON.stringify(entry)}::jsonb,
          updated_by = ${by}, updated_at = NOW()
      WHERE id = ${id} RETURNING id`;
    if (!updated.length) return reply({ ok: false, error: 'Payment record not found.' }, 404);
    return reply({ ok: true, row: await one(sql, id) });
  } catch (e) { return reply({ ok: false, error: e?.message || 'Update failed.' }, 503); }
}
export async function DELETE(request) {
  try {
    const sql = database(), auth = await adminAccess(request, sql);
    if (auth.error) return reply({ ok: false, error: auth.error }, auth.status);
    const id = new URL(request.url).searchParams.get('id') || '';
    if (!/^[0-9a-f-]{36}$/i.test(id)) return reply({ ok: false, error: 'Invalid record ID.' }, 400);
    await ensureTable(sql);
    const removed = await sql`DELETE FROM mayavi_admin_payments
      WHERE id = ${id} RETURNING id`;
    return removed.length ? reply({ ok: true }) :
      reply({ ok: false, error: 'Payment record not found.' }, 404);
  } catch (e) { return reply({ ok: false, error: e?.message || 'Delete failed.' }, 503); }
}
