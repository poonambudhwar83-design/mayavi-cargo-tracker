import { randomUUID } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { readSession } from '../../../lib/mayaviAuth.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function database() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL ||
    process.env.NEON_DATABASE_URL || process.env.DATABASE_URL_UNPOOLED || '';
  if (!url) throw new Error('Mayavi database is unavailable.');
  return neon(url);
}
const reply = (data, status = 200) => Response.json(data, {
  status, headers: { 'cache-control': 'no-store' }
});
async function adminAccess(request, sql) {
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
  await sql`CREATE TABLE IF NOT EXISTS mayavi_admin_notes (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    note_date DATE NOT NULL,
    data JSONB NOT NULL,
    created_by TEXT NOT NULL,
    updated_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
}
const clean = (value, max) => String(value ?? '').trim().slice(0, max);
function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(value + 'T00:00:00Z');
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}
function parseEntry(body) {
  const kind = ['MEETING', 'DAILY_UPDATE'].includes(body?.kind) ? body.kind : '';
  const status = ['OPEN', 'IN_PROGRESS', 'COMPLETED'].includes(body?.status) ? body.status : '';
  const entry = {
    kind,
    date: clean(body?.date, 10),
    time: clean(body?.time, 5),
    title: clean(body?.title, 160),
    attendees: clean(body?.attendees, 400),
    discussion: clean(body?.discussion, 6000),
    decisions: clean(body?.decisions, 4000),
    actionItems: clean(body?.actionItems, 4000),
    assignedTo: clean(body?.assignedTo, 200),
    dueDate: clean(body?.dueDate, 10),
    status
  };
  if (!kind || !status || !entry.title || !validDate(entry.date) ||
      (entry.dueDate && !validDate(entry.dueDate)) ||
      (entry.time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(entry.time))) {
    return { error: 'A title, date, note type and status are required.' };
  }
  return { entry };
}
function result(row) {
  return { ...(row.data || {}), id: row.id, createdBy: row.created_by,
    updatedBy: row.updated_by, createdAt: row.created_at, updatedAt: row.updated_at };
}
async function findOne(sql, id) {
  const found = await sql`SELECT id, data, created_by, updated_by, created_at, updated_at
    FROM mayavi_admin_notes WHERE id = ${id}`;
  return found[0] ? result(found[0]) : null;
}
export async function GET(request) {
  try {
    const sql = database(), auth = await adminAccess(request, sql);
    if (auth.error) return reply({ ok: false, error: auth.error }, auth.status);
    await ensureTable(sql);
    const rows = await sql`SELECT id, data, created_by, updated_by, created_at, updated_at
      FROM mayavi_admin_notes ORDER BY note_date DESC, created_at DESC LIMIT 400`;
    return reply({ ok: true, rows: rows.map(result) });
  } catch (error) { return reply({ ok: false, error: error?.message || 'Notes unavailable.' }, 503); }
}
export async function POST(request) {
  try {
    const sql = database(), auth = await adminAccess(request, sql);
    if (auth.error) return reply({ ok: false, error: auth.error }, auth.status);
    const { entry, error } = parseEntry(await request.json().catch(() => ({})));
    if (error) return reply({ ok: false, error }, 400);
    await ensureTable(sql);
    const id = randomUUID(), by = auth.session.displayName || auth.session.username;
    await sql`INSERT INTO mayavi_admin_notes
      (id, kind, note_date, data, created_by, updated_by)
      VALUES (${id}, ${entry.kind}, ${entry.date}::date, ${JSON.stringify(entry)}::jsonb, ${by}, ${by})`;
    return reply({ ok: true, row: await findOne(sql, id) }, 201);
  } catch (error) { return reply({ ok: false, error: error?.message || 'Save failed.' }, 503); }
}
export async function PATCH(request) {
  try {
    const sql = database(), auth = await adminAccess(request, sql);
    if (auth.error) return reply({ ok: false, error: auth.error }, auth.status);
    const body = await request.json().catch(() => ({}));
    const id = clean(body?.id, 80);
    if (!/^[0-9a-f-]{36}$/i.test(id)) return reply({ ok: false, error: 'Invalid note ID.' }, 400);
    const { entry, error } = parseEntry(body);
    if (error) return reply({ ok: false, error }, 400);
    await ensureTable(sql);
    const by = auth.session.displayName || auth.session.username;
    const updated = await sql`UPDATE mayavi_admin_notes
      SET kind = ${entry.kind}, note_date = ${entry.date}::date,
      data = ${JSON.stringify(entry)}::jsonb, updated_by = ${by}, updated_at = NOW()
      WHERE id = ${id} RETURNING id`;
    if (!updated.length) return reply({ ok: false, error: 'Note not found.' }, 404);
    return reply({ ok: true, row: await findOne(sql, id) });
  } catch (error) { return reply({ ok: false, error: error?.message || 'Update failed.' }, 503); }
}
export async function DELETE(request) {
  try {
    const sql = database(), auth = await adminAccess(request, sql);
    if (auth.error) return reply({ ok: false, error: auth.error }, auth.status);
    const id = new URL(request.url).searchParams.get('id') || '';
    if (!/^[0-9a-f-]{36}$/i.test(id)) return reply({ ok: false, error: 'Invalid note ID.' }, 400);
    await ensureTable(sql);
    const removed = await sql`DELETE FROM mayavi_admin_notes WHERE id = ${id} RETURNING id`;
    return removed.length ? reply({ ok: true }) : reply({ ok: false, error: 'Note not found.' }, 404);
  } catch (error) { return reply({ ok: false, error: error?.message || 'Delete failed.' }, 503); }
}
