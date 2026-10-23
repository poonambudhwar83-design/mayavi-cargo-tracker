'use client';

import { useEffect, useMemo, useState } from 'react';
import styles from './AdminPaymentsDashboard.module.css';

const API = '/api/admin-payments';
const todayIST = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const thisMonth = () => todayIST().slice(0, 7);
const money = value => new Intl.NumberFormat('en-IN', {
  style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2
}).format(Number(value || 0));
const amount = value => Number(value || 0);
const categories = [
  ['VENDOR', 'Vendor / Supplier'], ['SALARY', 'Salary'],
  ['FREIGHT', 'Freight / Courier'], ['RENT', 'Rent'],
  ['UTILITIES', 'Utilities'], ['TAX', 'Tax / Government'], ['OTHER', 'Other']
];
const methods = [
  ['NONE', 'Not selected'], ['BANK_TRANSFER', 'Bank Transfer / NEFT / RTGS'],
  ['UPI', 'UPI'], ['CASH', 'Cash'], ['CHEQUE', 'Cheque'], ['CARD', 'Card'],
  ['OTHER', 'Other']
];
function emptyPayment(month) {
  return { month, title: '', payee: '', category: 'VENDOR', amount: '',
    paidAmount: '0', dueDate: '', paidDate: '', method: 'NONE', reference: '', notes: '' };
}
function statusOf(payment) {
  const total = amount(payment.amount), paid = amount(payment.paidAmount);
  return paid >= total && total > 0 ? 'PAID' : paid > 0 ? 'PART_PAID' : 'PENDING';
}
function statusLabel(status) {
  return status === 'PAID' ? 'Paid' : status === 'PART_PAID' ? 'Part Paid' : 'Pending';
}
function stepMonth(month, step) {
  const [year, mm] = month.split('-').map(Number);
  const next = new Date(Date.UTC(year, mm - 1 + step, 1));
  return next.toISOString().slice(0, 7);
}
function niceMonth(month) {
  return new Date(month + '-01T00:00:00Z').toLocaleDateString('en-IN', {
    timeZone: 'UTC', month: 'long', year: 'numeric'
  });
}
function humanDate(date) {
  const p = String(date || '').split('-');
  return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : '—';
}
const escapeCsv = value => {
  let text = String(value ?? '');
  if (/^[\s]*[=+\-@]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
};

export default function AdminPaymentsDashboard({ currentUser }) {
  const [month, setMonth] = useState(thisMonth);
  const [records, setRecords] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [search, setSearch] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState('');
  const [draft, setDraft] = useState(() => emptyPayment(thisMonth()));

  useEffect(() => {
    const controller = new AbortController();
    setLoaded(false);
    setMessage('');
    (async () => {
      try {
        const response = await fetch(API + '?month=' + encodeURIComponent(month),
          { credentials: 'include', cache: 'no-store', signal: controller.signal });
        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error(data.error || 'Unable to load payments.');
        if (!controller.signal.aborted) setRecords(data.rows || []);
      } catch (error) {
        if (!controller.signal.aborted) { setRecords([]); setMessage(error.message || 'Could not load payments.'); }
      } finally {
        if (!controller.signal.aborted) setLoaded(true);
      }
    })();
    return () => controller.abort();
  }, [month]);

  const totals = useMemo(() => records.reduce((result, entry) => {
    const due = amount(entry.amount), paid = amount(entry.paidAmount);
    result.total += due;
    result.paid += paid;
    result.pending += Math.max(0, due - paid);
    if (statusOf(entry) !== 'PAID' && entry.dueDate && entry.dueDate < todayIST()) {
      result.overdue += Math.max(0, due - paid);
    }
    return result;
  }, { total: 0, paid: 0, pending: 0, overdue: 0 }), [records]);

  const visible = useMemo(() => records.filter(entry => {
    if (statusFilter !== 'ALL' && statusOf(entry) !== statusFilter) return false;
    const query = search.trim().toLowerCase();
    return !query || ['title', 'payee', 'notes', 'category', 'reference']
      .some(field => String(entry[field] || '').toLowerCase().includes(query));
  }), [records, statusFilter, search]);

  function newPayment() {
    setEditId('');
    setDraft(emptyPayment(month));
    setFormOpen(true);
    setMessage('');
  }
  function editPayment(entry) {
    setEditId(entry.id);
    setDraft({ ...emptyPayment(entry.month), ...entry });
    setFormOpen(true);
    setMessage('');
  }
  function cancel() {
    setFormOpen(false);
    setEditId('');
    setDraft(emptyPayment(month));
  }
  function setField(name, value) {
    setDraft(previous => ({
      ...previous, [name]: value,
      ...(name === 'paidAmount' && Number(value) > 0 && !previous.paidDate ?
        { paidDate: todayIST() } : {})
    }));
  }
  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setMessage('');
    try {
      const response = await fetch(API, {
        method: editId ? 'PATCH' : 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...draft, id: editId || undefined })
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || 'Unable to save payment.');
      setRecords(previous => {
        const next = editId ? previous.filter(item => item.id !== editId) : previous.slice();
        return data.row.month === month ? [data.row, ...next] : next;
      });
      const text = editId ? 'Payment record updated.' : 'Payment record saved.';
      const moved = data.row.month !== month ? ' Record saved under ' + niceMonth(data.row.month) + '.' : '';
      cancel();
      setMessage(text + moved);
    } catch (error) {
      setMessage(error.message || 'Unable to save payment.');
    } finally { setSaving(false); }
  }
  async function remove(entry) {
    if (!window.confirm('Delete payment record for ' + entry.payee + '?')) return;
    setSaving(true);
    setMessage('');
    try {
      const response = await fetch(API + '?id=' + encodeURIComponent(entry.id),
        { method: 'DELETE', credentials: 'include' });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || 'Delete failed.');
      setRecords(previous => previous.filter(item => item.id !== entry.id));
      if (entry.id === editId) cancel();
      setMessage('Payment record deleted.');
    } catch (error) { setMessage(error.message || 'Delete failed.'); }
    finally { setSaving(false); }
  }
  function downloadCsv() {
    const headers = ['Billing Month', 'Payment / Purpose', 'Payee', 'Category',
      'Total (INR)', 'Paid (INR)', 'Balance (INR)', 'Status', 'Due Date', 'Payment Date',
      'Payment Method', 'Transaction Reference', 'Remarks'];
    const rows = visible.map(entry => [
      entry.month, entry.title, entry.payee, categories.find(([id]) => id === entry.category)?.[1] || entry.category,
      amount(entry.amount).toFixed(2), amount(entry.paidAmount).toFixed(2),
      (amount(entry.amount) - amount(entry.paidAmount)).toFixed(2), statusLabel(statusOf(entry)),
      entry.dueDate, entry.paidDate, methods.find(([id]) => id === entry.method)?.[1] || entry.method,
      entry.reference, entry.notes
    ]);
    const csv = '\uFEFF' + [headers, ...rows].map(row => row.map(escapeCsv).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'Mayavi-Payments-' + month + '.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  return <div className={styles.wrapper}>
    <div className={styles.heading}>
      <div>
        <h2>Monthly Payment Register</h2>
        <p>Track your payable amounts, received payments and monthly outstanding balance.</p>
        <small>Private to Admin • INR • Billing month basis • {currentUser?.displayName || 'Admin'}</small>
      </div>
      <button className={styles.primary} onClick={newPayment}>+ Add Payment</button>
    </div>

    <div className={styles.period}>
      <button type="button" onClick={() => setMonth(value => stepMonth(value, -1))} aria-label="Previous month">‹</button>
      <label>Payment Month
        <input aria-label="Payment month" type="month" value={month} onChange={e => {
          if (e.target.value) { setMonth(e.target.value); cancel(); }
        }}/>
      </label>
      <button type="button" onClick={() => setMonth(value => stepMonth(value, 1))} aria-label="Next month">›</button>
      <strong>{niceMonth(month)}</strong>
      <button type="button" className={styles.secondary} onClick={() => setMonth(thisMonth())}>Current Month</button>
    </div>

    <div className={styles.summary}>
      <div><span>Total Payments Due</span><b>{money(totals.total)}</b></div>
      <div><span>Paid</span><b>{money(totals.paid)}</b></div>
      <div><span>Outstanding</span><b>{money(totals.pending)}</b></div>
      <div><span>Overdue</span><b>{money(totals.overdue)}</b></div>
      <div><span>Entries</span><b>{records.length}</b></div>
    </div>
    {message && <div role="status" className={styles.message}>{message}</div>}

    {formOpen && <section className={styles.formCard}>
      <div className={styles.formTitle}>
        <h3>{editId ? 'Edit Payment' : 'Add New Payment'}</h3>
        <button className={styles.link} type="button" onClick={cancel} disabled={saving}>Close</button>
      </div>
      <form onSubmit={save}>
        <div className={styles.formGrid}>
          <label>Billing Month *
            <input type="month" required value={draft.month} onChange={e => setField('month', e.target.value)}/>
          </label>
          <label>Payment Purpose *
            <input required maxLength={160} value={draft.title} onChange={e => setField('title', e.target.value)} placeholder="e.g. Office rent, supplier invoice"/>
          </label>
          <label>Payee / Vendor Name *
            <input required maxLength={200} value={draft.payee} onChange={e => setField('payee', e.target.value)} placeholder="Person or company name"/>
          </label>
          <label>Category *
            <select value={draft.category} onChange={e => setField('category', e.target.value)}>
              {categories.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          </label>
          <label>Total Amount (₹) *
            <input type="number" min="0.01" max="10000000000" step="0.01" required
              value={draft.amount} onChange={e => setField('amount', e.target.value)} placeholder="0.00"/>
          </label>
          <label>Amount Paid (₹)
            <input type="number" min="0" max="10000000000" step="0.01"
              value={draft.paidAmount} onChange={e => setField('paidAmount', e.target.value)} placeholder="0.00"/>
          </label>
          <label>Due Date
            <input type="date" value={draft.dueDate} onChange={e => setField('dueDate', e.target.value)}/>
          </label>
          <label>Last Payment Date
            <input type="date" value={draft.paidDate} disabled={amount(draft.paidAmount) === 0}
              onChange={e => setField('paidDate', e.target.value)}/>
          </label>
          <label>Payment Method
            <select value={draft.method} disabled={amount(draft.paidAmount) === 0}
              onChange={e => setField('method', e.target.value)}>
              {methods.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          </label>
          <label>Transaction Reference (optional)
            <input maxLength={140} value={draft.reference} disabled={amount(draft.paidAmount) === 0}
              onChange={e => setField('reference', e.target.value)} placeholder="Receipt / UTR / invoice reference"/>
          </label>
          <label className={styles.full}>Remarks
            <textarea rows={3} value={draft.notes} onChange={e => setField('notes', e.target.value)}
              placeholder="Any payment or follow-up details"/>
          </label>
        </div>
        <div className={styles.balancePreview}>Balance to pay: <b>{money(Math.max(0, amount(draft.amount) - amount(draft.paidAmount)))}</b></div>
        <div className={styles.formActions}>
          <button className={styles.primary} type="submit" disabled={saving}>{saving ? 'Saving…' : editId ? 'Save Changes' : 'Save Payment'}</button>
          <button className={styles.secondary} type="button" disabled={saving} onClick={cancel}>Cancel</button>
        </div>
      </form>
    </section>}

    <section className={styles.tableCard}>
      <div className={styles.tableToolbar}>
        <div><h3>{niceMonth(month)} Payments</h3><span>{visible.length} shown / {records.length} total</span></div>
        <label>Status
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="ALL">All Payments</option>
            <option value="PENDING">Pending</option>
            <option value="PART_PAID">Part Paid</option>
            <option value="PAID">Paid</option>
          </select>
        </label>
        <label>Search
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search vendor / purpose"/>
        </label>
        <button type="button" className={styles.secondary} disabled={!visible.length} onClick={downloadCsv}>Export CSV</button>
      </div>

      <div className={styles.tableScroll}>
        <table>
          <thead><tr>
            <th>Date Due</th><th>Purpose / Payee</th><th>Category</th>
            <th>Total Amount</th><th>Paid Amount</th><th>Balance</th>
            <th>Status</th><th>Last Paid</th><th>Actions</th>
          </tr></thead>
          <tbody>
            {visible.map(entry => {
              const status = statusOf(entry);
              const balance = Math.max(0, amount(entry.amount) - amount(entry.paidAmount));
              const overdue = status !== 'PAID' && entry.dueDate && entry.dueDate < todayIST();
              return <tr key={entry.id}>
                <td>{humanDate(entry.dueDate)}</td>
                <td><strong>{entry.title}</strong><small>{entry.payee}</small>
                  {entry.reference && <small>Ref: {entry.reference}</small>}
                  {entry.notes && <small title={entry.notes}>{entry.notes}</small>}
                </td>
                <td>{categories.find(([id]) => id === entry.category)?.[1] || 'Other'}</td>
                <td className={styles.number}>{money(entry.amount)}</td>
                <td className={styles.number}>{money(entry.paidAmount)}</td>
                <td className={styles.number}><b>{money(balance)}</b></td>
                <td><span className={styles.status} data-status={status}>{statusLabel(status)}</span>
                  {overdue && <small className={styles.overdue}>Overdue</small>}
                </td>
                <td>{humanDate(entry.paidDate)}</td>
                <td><div className={styles.actions}>
                  <button type="button" onClick={() => editPayment(entry)}>Edit</button>
                  <button type="button" disabled={saving} className={styles.delete} onClick={() => remove(entry)}>Delete</button>
                </div></td>
              </tr>;
            })}
            {loaded && !visible.length && <tr><td colSpan={9} className={styles.empty}>No payments found for this month. Add your first payment using the button above.</td></tr>}
            {!loaded && <tr><td colSpan={9} className={styles.empty}>Loading monthly records…</td></tr>}
          </tbody>
          {visible.length > 0 && <tfoot><tr>
            <td colSpan={3}>Visible Total</td>
            <td className={styles.number}>{money(visible.reduce((sum, p) => sum + amount(p.amount), 0))}</td>
            <td className={styles.number}>{money(visible.reduce((sum, p) => sum + amount(p.paidAmount), 0))}</td>
            <td className={styles.number}>{money(visible.reduce((sum, p) => sum + amount(p.amount) - amount(p.paidAmount), 0))}</td>
            <td colSpan={3}></td>
          </tr></tfoot>}
        </table>
      </div>
      <p className={styles.footnote}>Monthly totals are grouped by billing month, not by the date money left the account. Paid means fully recorded as paid; this register does not initiate bank transfers.</p>
    </section>
  </div>;
}
