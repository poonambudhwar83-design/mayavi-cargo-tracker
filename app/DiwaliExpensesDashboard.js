'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';

const thisYear = () => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', year: 'numeric' }).format(new Date()));
const blank = (year = thisYear()) => ({
  officerName: '', year: String(year), metalChoice: 'Gold', customMetal: '', weightChoice: '100',
  customWeight: '', quantity: '1', amount: '', remarks: ''
});
const input = { width: '100%', boxSizing: 'border-box', padding: '10px 11px', border: '1px solid #cbd5e1', borderRadius: 9, background: '#fff', color: '#142642', fontSize: 14 };
const label = { display: 'block', marginBottom: 6, color: '#415674', fontWeight: 800, fontSize: 12 };
const action = { border: 'none', borderRadius: 9, padding: '10px 16px', cursor: 'pointer', fontWeight: 800, fontSize: 13 };
const cell = { padding: '11px 12px', borderBottom: '1px solid #e6ebf2', fontSize: 13, verticalAlign: 'top', textAlign: 'left' };
const isStandardMetal = value => value === 'Gold' || value === 'Silver';

function editDraft(row) {
  const standardWeight = Number(row.weightGrams) === 100 ? '100' : Number(row.weightGrams) === 50 ? '50' : 'manual';
  return {
    officerName: row.officerName || '',
    year: String(row.year || 2026),
    metalChoice: isStandardMetal(row.metal) ? row.metal : 'manual',
    customMetal: isStandardMetal(row.metal) ? '' : row.metal,
    weightChoice: standardWeight,
    customWeight: standardWeight === 'manual' ? String(row.weightGrams) : '',
    quantity: String(row.quantity),
    amount: String(row.amount),
    remarks: row.remarks || ''
  };
}

export default function DiwaliExpensesDashboard() {
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState(blank);
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [search, setSearch] = useState('');
  const [viewYear, setViewYear] = useState(thisYear);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/diwali-expenses', { credentials: 'include', cache: 'no-store' });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Unable to load saved expenses.');
      setRows(data.rows || []);
    } catch (error) {
      setMessage(error.message || 'Could not load expenses.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const years = useMemo(() => [...new Set([
    ...Array.from({ length: 12 }, (_, index) => thisYear() - 4 + index),
    ...rows.map(row => Number(row.year || 2026))
  ])].filter(year => year >= 2000 && year <= 2100).sort((a, b) => b - a), [rows]);
  const thisYearRows = useMemo(() => rows.filter(row => Number(row.year || 2026) === viewYear), [rows, viewYear]);
  const totals = useMemo(() => ({
    gifts: thisYearRows.length,
    officers: new Set(thisYearRows.map(row => String(row.officerName || '').trim().toLowerCase())).size
  }), [thisYearRows]);
  const filteredRows = useMemo(() => thisYearRows.filter(row => {
    const term = search.trim().toLowerCase();
    return !term || [row.officerName, row.metal, row.remarks].some(value => String(value || '').toLowerCase().includes(term));
  }), [thisYearRows, search]);

  const set = (field, value) => setForm(current => ({ ...current, [field]: value }));
  const reset = () => { setForm(blank(viewYear)); setEditingId(null); };
  function beginEdit(row) {
    setForm(editDraft(row));
    setEditingId(row.id);
    setMessage('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function save(event) {
    event.preventDefault();
    if (saving) return;
    const metal = form.metalChoice === 'manual' ? form.customMetal.trim() : form.metalChoice;
    const weightGrams = Number(form.weightChoice === 'manual' ? form.customWeight : form.weightChoice);
    if (!form.officerName.trim() || !metal || !Number.isFinite(weightGrams) || weightGrams <= 0) {
      setMessage('Enter officer name, coin metal and weight.');
      return;
    }
    setSaving(true);
    setMessage('');
    try {
      const body = {
        ...(editingId ? { id: editingId } : {}),
        officerName: form.officerName.trim(), year: Number(form.year), metal, weightGrams,
        quantity: Number(form.quantity), amount: form.amount || '0', remarks: form.remarks
      };
      const res = await fetch('/api/diwali-expenses', {
        method: editingId ? 'PATCH' : 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Save failed.');
      const wasEditing = Boolean(editingId);
      const savedYear = Number(form.year);
      setForm(blank(savedYear));
      setEditingId(null);
      setViewYear(savedYear);
      await load();
      setMessage(wasEditing ? 'Diwali expense updated.' : 'Diwali expense saved.');
    } catch (error) {
      setMessage(error.message || 'Could not save expense.');
    } finally {
      setSaving(false);
    }
  }

  async function remove(row) {
    if (saving || !window.confirm('Delete the Diwali expense for ' + row.officerName + '?')) return;
    setSaving(true);
    setMessage('');
    try {
      const res = await fetch('/api/diwali-expenses?id=' + encodeURIComponent(row.id), {
        method: 'DELETE', credentials: 'include'
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Delete failed.');
      setRows(previous => previous.filter(item => item.id !== row.id));
      if (editingId === row.id) reset();
      setMessage('Diwali expense deleted.');
    } catch (error) {
      setMessage(error.message || 'Could not delete expense.');
    } finally {
      setSaving(false);
    }
  }

  return <main style={{ minHeight: '80vh', padding: '22px clamp(12px,3vw,32px)', background: '#f6f8fc', color: '#152b45' }}>
    <div style={{ maxWidth: 1280, margin: 'auto' }}>
      <div style={{ marginBottom: 18 }}>
        <small style={{ color: '#456ca0', fontWeight: 900, letterSpacing: 1 }}>MAYAVI CARGO • ADMIN ONLY</small>
        <h1 style={{ margin: '6px 0', fontSize: 27 }}>Diwali Expenses</h1>
        <p style={{ color: '#64748b', margin: '5px 0 0', fontSize: 14 }}>Maintain a separate record for each Diwali year. Choose gold, silver, or enter metal and weight manually.</p>
      </div>
      <section style={{ background: '#fff', borderRadius: 14, border: '1px solid #e0e7f0', padding: 18, marginBottom: 16 }}>
        <h2 style={{ fontSize: 17, margin: '0 0 17px' }}>{editingId ? 'Edit officer gift' : 'Add officer gift'}</h2>
        <form onSubmit={save}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 14 }}>
            <div><label style={label}>OFFICER NAME *</label><input style={input} value={form.officerName} onChange={e => set('officerName', e.target.value)} maxLength={200} placeholder="Officer name" required /></div>
            <div><label style={label}>YEAR *</label><select style={input} value={form.year} onChange={e => set('year', e.target.value)} required>{years.map(year => <option key={year} value={year}>{year}</option>)}</select></div>
            <div><label style={label}>GOLD / SILVER *</label>
              <select style={input} value={form.metalChoice} onChange={e => set('metalChoice', e.target.value)}>
                <option value="Gold">Gold Coin</option>
                <option value="Silver">Silver Coin</option>
                <option value="manual">Other — Enter Manually</option>
              </select>
              {form.metalChoice === 'manual' && <input style={{ ...input, marginTop: 8 }} value={form.customMetal} onChange={e => set('customMetal', e.target.value)} placeholder="Enter metal / gift type" maxLength={60} required />}
            </div>
            <div><label style={label}>COIN WEIGHT *</label>
              <select style={input} value={form.weightChoice} onChange={e => set('weightChoice', e.target.value)}>
                <option value="100">100 gm</option>
                <option value="50">50 gm</option>
                <option value="manual">Other Weight — Enter Manually</option>
              </select>
              {form.weightChoice === 'manual' && <input style={{ ...input, marginTop: 8 }} type="number" min="0.01" max="100000" step="0.01" value={form.customWeight} onChange={e => set('customWeight', e.target.value)} placeholder="Weight in grams" required />}
            </div>
            <div><label style={label}>REMARKS</label><input style={input} value={form.remarks} onChange={e => set('remarks', e.target.value)} maxLength={1000} placeholder="Optional details" /></div>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 17 }}>
            <button type="submit" disabled={saving} style={{ ...action, background: '#214e94', color: '#fff' }}>{saving ? 'SAVING…' : editingId ? 'UPDATE ENTRY' : 'SAVE ENTRY'}</button>
            <button type="button" onClick={reset} disabled={saving} style={{ ...action, background: '#e9eef5', color: '#334155' }}>{editingId ? 'CANCEL EDIT' : 'CLEAR'}</button>
          </div>
        </form>
        {message && <p role="status" style={{ color: '#234e84', fontWeight: 750, fontSize: 13, margin: '12px 0 0' }}>{message}</p>}
      </section>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        {[
          ['OFFICERS — ' + viewYear, totals.officers],
          ['GIFT RECORDS — ' + viewYear, totals.gifts]
        ].map(([name, value]) => <div key={name} style={{ flex: '1 1 170px', background: '#fff', border: '1px solid #e0e7f0', borderRadius: 12, padding: 14 }}>
          <div style={{ color: '#64748b', fontSize: 11, fontWeight: 900 }}>{name}</div>
          <strong style={{ fontSize: 22, color: '#1e3a69' }}>{value}</strong>
        </div>)}
      </div>
      <section style={{ background: '#fff', borderRadius: 14, border: '1px solid #e0e7f0', overflow: 'hidden' }}>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between', flexWrap: 'wrap', alignItems: 'center', padding: 15 }}>
          <h2 style={{ margin: 0, fontSize: 17 }}>Saved Diwali Gifts — {viewYear}</h2>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <select aria-label="Show Diwali year" style={{ ...input, width: 120 }} value={viewYear} onChange={e => { const year = Number(e.target.value); setViewYear(year); if (!editingId) setForm(blank(year)); }}>{years.map(year => <option key={year} value={year}>{year}</option>)}</select>
            <input aria-label="Search officers" style={{ ...input, maxWidth: 260 }} value={search} onChange={e => setSearch(e.target.value)} placeholder="Search officer or coin…" />
          </div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
            <thead style={{ background: '#eef3fa', color: '#344b6e' }}><tr>
              {['S.No.', 'Year', 'Officer Name', 'Coin', 'Weight', 'Remarks', 'Actions'].map(item =>
                <th key={item} style={{ ...cell, fontSize: 12, fontWeight: 900 }}>{item}</th>)}
            </tr></thead>
            <tbody>
              {filteredRows.map((row, index) => <tr key={row.id}>
                <td style={cell}>{index + 1}</td>
                <td style={cell}>{row.year || 2026}</td>
                <td style={{ ...cell, fontWeight: 800 }}>{row.officerName}</td>
                <td style={cell}>{row.metal}</td>
                <td style={cell}>{row.weightGrams} gm</td>
                <td style={{ ...cell, maxWidth: 240, overflowWrap: 'anywhere' }}>{row.remarks || '—'}</td>
                <td style={{ ...cell, whiteSpace: 'nowrap' }}>
                  <button type="button" disabled={saving} onClick={() => beginEdit(row)} style={{ ...action, padding: '7px 10px', marginRight: 6, background: '#e0edff', color: '#1e4d89' }}>EDIT</button>
                  <button type="button" disabled={saving} onClick={() => remove(row)} style={{ ...action, padding: '7px 10px', background: '#fce8e8', color: '#a12929' }}>DELETE</button>
                </td>
              </tr>)}
              {!loading && filteredRows.length === 0 && <tr><td style={{ ...cell, textAlign: 'center', padding: 24 }} colSpan={7}>No Diwali expense entries found.</td></tr>}
              {loading && <tr><td style={{ ...cell, textAlign: 'center', padding: 24 }} colSpan={7}>Loading saved entries…</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  </main>;
}
