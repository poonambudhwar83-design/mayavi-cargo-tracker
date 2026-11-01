import { randomUUID } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { readSession } from '../../../lib/mayaviAuth.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const reply = (data, status = 200) => Response.json(data, {
  status,
  headers: { 'Cache-Control': 'no-store, private' }
});
function database() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL ||
    process.env.NEON_DATABASE_URL || process.env.DATABASE_URL_UNPOOLED || '';
  if (!url) throw new Error('Mayavi shared database is not configured.');
  return neon(url);
}
async function authorize(request, sql) {
  const session = readSession(request);
  if (!session) return { error: 'Please log in to Mayavi.', status: 401 };
  if (session.role !== 'admin') return { error: 'Admin access only.', status: 403 };
  const users = await sql`SELECT role, is_active FROM mayavi_users
    WHERE lower(username) = ${session.username} LIMIT 1`;
  if (users[0]?.role !== 'admin' || !users[0]?.is_active) {
    return { error: 'Admin account is not active.', status: 403 };
  }
  return { session };
}
async function ensureTable(sql) {
  await sql`CREATE TABLE IF NOT EXISTS mayavi_diwali_expenses (
    id TEXT PRIMARY KEY,
    officer_name TEXT NOT NULL,
    expense_year INTEGER NOT NULL DEFAULT 2026 CHECK (expense_year BETWEEN 2000 AND 2100),
    metal TEXT NOT NULL,
    weight_grams NUMERIC(10,2) NOT NULL CHECK (weight_grams > 0),
    quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
    total_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
    remarks TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL,
    updated_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
  // Older Diwali records were created in 2026 before a year field existed.
  await sql`ALTER TABLE mayavi_diwali_expenses ADD COLUMN IF NOT EXISTS expense_year INTEGER NOT NULL DEFAULT 2026`;
}
function parseEntry(body) {
  const officerName = String(body?.officerName ?? '').trim();
  const year = body?.year == null || body.year === '' ? new Date().getUTCFullYear() : Number(body.year);
  const metal = String(body?.metal ?? '').trim();
  const weight = Number(body?.weightGrams);
  const quantity = body?.quantity == null || body.quantity === '' ? 1 : Number(body.quantity);
  const amount = body?.amount === '' || body?.amount == null ? 0 : Number(body.amount);
  const remarks = String(body?.remarks ?? '').trim();
  if (!officerName || officerName.length > 200) return { error: 'Enter an officer name (up to 200 characters).' };
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return { error: 'Choose a valid Diwali year.' };
  if (!metal || metal.length > 60 || !/^[\p{L}\p{N} .&/-]+$/u.test(metal)) return { error: 'Select Gold or Silver, or enter a valid custom metal.' };
  if (!Number.isFinite(weight) || weight <= 0 || weight > 100000 || Math.abs(weight * 100 - Math.round(weight * 100)) > 0.000001) {
    return { error: 'Enter a valid coin weight in grams (up to two decimals).' };
  }
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10000) return { error: 'Quantity must be a positive whole number.' };
  if (!Number.isFinite(amount) || amount < 0 || amount > 999999999999 || Math.abs(amount * 100 - Math.round(amount * 100)) > 0.000001) {
    return { error: 'Total cost must be a valid amount in rupees.' };
  }
  if (remarks.length > 1000) return { error: 'Remarks must be under 1000 characters.' };
  return { entry: { officerName, year, metal, weight, quantity, amount, remarks } };
}
const mapRow = row => ({
  id: row.id,
  officerName: row.officer_name,
  year: Number(row.expense_year || 2026),
  metal: row.metal,
  weightGrams: Number(row.weight_grams),
  quantity: Number(row.quantity),
  amount: Number(row.total_amount),
  remarks: row.remarks,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});
async function findOne(sql, id) {
  const rows = await sql`SELECT * FROM mayavi_diwali_expenses WHERE id = ${id}`;
  return rows[0] ? mapRow(rows[0]) : null;
}
export async function GET(request) {
  try {
    const sql = database(), auth = await authorize(request, sql);
    if (auth.error) return reply({ ok: false, error: auth.error }, auth.status);
    await ensureTable(sql);
    const rows = await sql`SELECT * FROM mayavi_diwali_expenses
      ORDER BY expense_year DESC, created_at DESC, officer_name ASC LIMIT 2000`;
    return reply({ ok: true, rows: rows.map(mapRow) });
  } catch {
    return reply({ ok: false, error: 'Unable to load Diwali expenses.' }, 503);
  }
}
export async function POST(request) {
  try {
    const sql = database(), auth = await authorize(request, sql);
    if (auth.error) return reply({ ok: false, error: auth.error }, auth.status);
    const { entry, error } = parseEntry(await request.json().catch(() => ({})));
    if (error) return reply({ ok: false, error }, 400);
    await ensureTable(sql);
    const id = randomUUID(), by = auth.session.displayName || auth.session.username;
    await sql`INSERT INTO mayavi_diwali_expenses
      (id, officer_name, expense_year, metal, weight_grams, quantity, total_amount, remarks, created_by, updated_by)
      VALUES (${id}, ${entry.officerName}, ${entry.year}, ${entry.metal}, ${entry.weight}, ${entry.quantity},
        ${entry.amount}, ${entry.remarks}, ${by}, ${by})`;
    return reply({ ok: true, row: await findOne(sql, id) }, 201);
  } catch {
    return reply({ ok: false, error: 'Could not save Diwali expense.' }, 503);
  }
}
export async function PATCH(request) {
  try {
    const sql = database(), auth = await authorize(request, sql);
    if (auth.error) return reply({ ok: false, error: auth.error }, auth.status);
    const body = await request.json().catch(() => ({}));
    const id = String(body?.id || '');
    if (!/^[0-9a-f-]{36}$/i.test(id)) return reply({ ok: false, error: 'Invalid expense ID.' }, 400);
    const { entry, error } = parseEntry(body);
    if (error) return reply({ ok: false, error }, 400);
    await ensureTable(sql);
    const by = auth.session.displayName || auth.session.username;
    const updated = await sql`UPDATE mayavi_diwali_expenses
      SET officer_name = ${entry.officerName}, expense_year = ${entry.year}, metal = ${entry.metal},
        weight_grams = ${entry.weight}, quantity = ${entry.quantity},
        total_amount = ${entry.amount}, remarks = ${entry.remarks},
        updated_by = ${by}, updated_at = NOW()
      WHERE id = ${id} RETURNING id`;
    if (!updated.length) return reply({ ok: false, error: 'Expense not found.' }, 404);
    return reply({ ok: true, row: await findOne(sql, id) });
  } catch {
    return reply({ ok: false, error: 'Could not update Diwali expense.' }, 503);
  }
}
export async function DELETE(request) {
  try {
    const sql = database(), auth = await authorize(request, sql);
    if (auth.error) return reply({ ok: false, error: auth.error }, auth.status);
    const id = new URL(request.url).searchParams.get('id') || '';
    if (!/^[0-9a-f-]{36}$/i.test(id)) return reply({ ok: false, error: 'Invalid expense ID.' }, 400);
    await ensureTable(sql);
    const deleted = await sql`DELETE FROM mayavi_diwali_expenses WHERE id = ${id} RETURNING id`;
    return deleted.length ? reply({ ok: true }) : reply({ ok: false, error: 'Expense not found.' }, 404);
  } catch {
    return reply({ ok: false, error: 'Could not delete Diwali expense.' }, 503);
  }
}