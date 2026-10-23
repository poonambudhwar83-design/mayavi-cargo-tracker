'use client';

import { useEffect, useMemo, useState } from 'react';
import styles from './AdminNotesDashboard.module.css';

const API = '/api/admin-notes';
const STATUSES = [
  ['OPEN', 'Pending'],
  ['IN_PROGRESS', 'In Progress'],
  ['COMPLETED', 'Completed']
];
const todayIST = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const initial = (kind = 'DAILY_UPDATE') => ({
  kind, date: todayIST(), time: '', title: '', attendees: '',
  discussion: '', decisions: '', actionItems: '', assignedTo: '',
  dueDate: '', status: 'OPEN'
});
const dateLabel = (value) => {
  const parts = String(value || '').split('-');
  return parts.length === 3 ? [parts[2], parts[1], parts[0]].join('/') : '—';
};
const sortNotes = (notes) => [...notes].sort((a, b) =>
  String(b.date || '').localeCompare(String(a.date || '')) ||
  String(b.createdAt || '').localeCompare(String(a.createdAt || ''))
);
function statusLabel(value) {
  return STATUSES.find(([code]) => code === value)?.[1] || 'Pending';
}

export default function AdminNotesDashboard({ currentUser }) {
  const [items, setItems] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [kindFilter, setKindFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [search, setSearch] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState('');
  const [expandedId, setExpandedId] = useState('');
  const [draft, setDraft] = useState(() => initial());

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const response = await fetch(API, { credentials: 'include', cache: 'no-store' });
        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error(data.error || 'Unable to load notes.');
        if (active) setItems(sortNotes(data.rows || []));
      } catch (error) {
        if (active) setMessage(error.message || 'Unable to load notes.');
      } finally {
        if (active) setLoaded(true);
      }
    })();
    return () => { active = false; };
  }, []);

  const filtered = useMemo(() => items.filter(note => {
    if (kindFilter !== 'ALL' && note.kind !== kindFilter) return false;
    if (statusFilter !== 'ALL' && note.status !== statusFilter) return false;
    const needle = search.trim().toLowerCase();
    if (!needle) return true;
    return ['title', 'discussion', 'decisions', 'actionItems', 'attendees', 'assignedTo', 'date']
      .some(key => String(note[key] || '').toLowerCase().includes(needle));
  }), [items, kindFilter, statusFilter, search]);

  const pending = items.filter(note => note.status !== 'COMPLETED' && note.dueDate).length;
  const overdue = items.filter(note => note.status !== 'COMPLETED' && note.dueDate && note.dueDate < todayIST()).length;

  function createNote(kind) {
    setEditingId('');
    setDraft(initial(kind));
    setFormOpen(true);
    setMessage('');
  }
  function editNote(note) {
    setEditingId(note.id);
    setDraft({ ...initial(note.kind), ...note });
    setFormOpen(true);
    setExpandedId(note.id);
    setMessage('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function cancel() {
    setFormOpen(false);
    setEditingId('');
    setDraft(initial());
  }
  function change(key, value) {
    setDraft(previous => ({ ...previous, [key]: value }));
  }

  async function save(event) {
    event.preventDefault();
    if (!draft.title.trim() || !draft.date) {
      setMessage('Enter a date and title before saving.');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(API, {
        method: editingId ? 'PATCH' : 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...draft, id: editingId || undefined })
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || 'Could not save this record.');
      setItems(previous => sortNotes(editingId
        ? previous.map(note => note.id === editingId ? data.row : note)
        : [data.row, ...previous]));
      setExpandedId(data.row.id);
      cancel();
      setMessage(editingId ? 'Record updated and saved.' : 'New record saved to Mayavi.');
    } catch (error) {
      setMessage(error.message || 'Save failed.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(note) {
    if (!window.confirm('Delete "' + note.title + '" permanently?')) return;
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(API + '?id=' + encodeURIComponent(note.id), {
        method: 'DELETE', credentials: 'include'
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || 'Delete failed.');
      setItems(previous => previous.filter(item => item.id !== note.id));
      if (expandedId === note.id) setExpandedId('');
      if (editingId === note.id) cancel();
      setMessage('Record deleted.');
    } catch (error) {
      setMessage(error.message || 'Delete failed.');
    } finally {
      setBusy(false);
    }
  }

  return <main className={styles.page}>
    <header className={styles.header}>
      <div>
        <div className={styles.eyebrow}>MAYAVI CARGO • ADMIN PRIVATE</div>
        <h1>Meetings &amp; Daily Updates</h1>
        <p>Record meetings, daily progress, decisions and follow-ups in one place.</p>
        <small>Signed in as {currentUser?.displayName || 'Admin'} • Saved in Mayavi database</small>
      </div>
      <div className={styles.headerActions}>
        <button type="button" onClick={() => createNote('MEETING')}>+ New Meeting</button>
        <button type="button" className={styles.secondaryButton} onClick={() => createNote('DAILY_UPDATE')}>+ Daily Update</button>
      </div>
    </header>

    <section className={styles.stats}>
      <div><b>{items.length}</b><span>Total Records</span></div>
      <div><b>{items.filter(note => note.kind === 'MEETING').length}</b><span>Meetings</span></div>
      <div><b>{items.filter(note => note.kind === 'DAILY_UPDATE').length}</b><span>Daily Updates</span></div>
      <div><b>{pending}</b><span>Follow-ups Open</span></div>
      <div><b>{overdue}</b><span>Overdue Follow-ups</span></div>
    </section>

    {message && <div className={styles.message} role="status">{message}</div>}

    {formOpen && <section className={styles.panel}>
      <div className={styles.formHeading}>
        <h2>{editingId ? 'Edit Record' : draft.kind === 'MEETING' ? 'New Meeting Note' : 'New Daily Update'}</h2>
        <button type="button" className={styles.linkButton} onClick={cancel} disabled={busy}>Close</button>
      </div>
      <form onSubmit={save}>
        <div className={styles.fields}>
          <label>Record Type
            <select value={draft.kind} onChange={e => change('kind', e.target.value)}>
              <option value="MEETING">Meeting Notes</option>
              <option value="DAILY_UPDATE">Daily Update</option>
            </select>
          </label>
          <label>Date *
            <input type="date" required value={draft.date} onChange={e => change('date', e.target.value)} />
          </label>
          {draft.kind === 'MEETING' && <label>Meeting Time (IST)
            <input type="time" value={draft.time} onChange={e => change('time', e.target.value)} />
          </label>}
          <label>Title / Subject *
            <input required maxLength={160} placeholder={draft.kind === 'MEETING' ? 'e.g. Warehouse team meeting' : 'e.g. Operations update'} value={draft.title} onChange={e => change('title', e.target.value)} />
          </label>
          {draft.kind === 'MEETING' && <label className={styles.wide}>Attendees
            <input maxLength={400} placeholder="Names of people present" value={draft.attendees} onChange={e => change('attendees', e.target.value)} />
          </label>}
          <label className={styles.wide}>{draft.kind === 'MEETING' ? 'Agenda & Discussion' : 'Work Done / Daily Progress'}
            <textarea rows={4} placeholder="Write the main points..." value={draft.discussion} onChange={e => change('discussion', e.target.value)} />
          </label>
          <label className={styles.wide}>{draft.kind === 'MEETING' ? 'Decisions Taken' : 'Highlights / Issues'}
            <textarea rows={3} placeholder="Important decisions, updates or issues..." value={draft.decisions} onChange={e => change('decisions', e.target.value)} />
          </label>
          <label className={styles.wide}>Action Items / Next Steps
            <textarea rows={3} placeholder="What needs to be done next?" value={draft.actionItems} onChange={e => change('actionItems', e.target.value)} />
          </label>
          <label>Assigned To / Responsible Person
            <input maxLength={200} placeholder="Name or team" value={draft.assignedTo} onChange={e => change('assignedTo', e.target.value)} />
          </label>
          <label>Follow-up Due Date
            <input type="date" value={draft.dueDate} onChange={e => change('dueDate', e.target.value)} />
          </label>
          <label>Status
            <select value={draft.status} onChange={e => change('status', e.target.value)}>
              {STATUSES.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
            </select>
          </label>
        </div>
        <div className={styles.formActions}>
          <button disabled={busy} type="submit">{busy ? 'Saving…' : editingId ? 'Save Changes' : 'Save Record'}</button>
          <button disabled={busy} className={styles.cancelButton} type="button" onClick={cancel}>Cancel</button>
        </div>
      </form>
    </section>}

    <section className={styles.panel}>
      <div className={styles.filters}>
        <label>View
          <select value={kindFilter} onChange={e => setKindFilter(e.target.value)}>
            <option value="ALL">All Records</option>
            <option value="MEETING">Meetings</option>
            <option value="DAILY_UPDATE">Daily Updates</option>
          </select>
        </label>
        <label>Status
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="ALL">All Statuses</option>
            {STATUSES.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
          </select>
        </label>
        <label className={styles.search}>Search Notes
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search title, person, or text" />
        </label>
      </div>
      <h2>Saved Records <span className={styles.count}>{filtered.length}</span></h2>
      {!loaded ? <p>Loading saved notes…</p> : filtered.length === 0 ?
        <div className={styles.empty}>No records found. Add a meeting or daily update to get started.</div> :
        <div className={styles.list}>
          {filtered.map(note => <article className={styles.record} key={note.id}>
            <div className={styles.recordTop}>
              <div className={styles.recordTitle}>
                <span className={styles.kind}>{note.kind === 'MEETING' ? 'MEETING' : 'DAILY UPDATE'}</span>
                <span className={styles.date}>{dateLabel(note.date)}{note.time ? ' • ' + note.time + ' IST' : ''}</span>
                <h3>{note.title}</h3>
                <span className={styles.status} data-status={note.status}>{statusLabel(note.status)}</span>
                {note.dueDate && <span className={styles.due}>Follow-up: {dateLabel(note.dueDate)}</span>}
              </div>
              <div className={styles.recordButtons}>
                <button type="button" onClick={() => setExpandedId(previous => previous === note.id ? '' : note.id)}>{expandedId === note.id ? 'Hide' : 'View'}</button>
                <button type="button" onClick={() => editNote(note)}>Edit</button>
                <button type="button" className={styles.deleteButton} disabled={busy} onClick={() => remove(note)}>Delete</button>
              </div>
            </div>
            {expandedId === note.id && <div className={styles.details}>
              {note.attendees && <p><b>Attendees:</b> {note.attendees}</p>}
              {note.discussion && <div><b>{note.kind === 'MEETING' ? 'Discussion' : 'Daily Progress'}</b><p>{note.discussion}</p></div>}
              {note.decisions && <div><b>{note.kind === 'MEETING' ? 'Decisions' : 'Highlights / Issues'}</b><p>{note.decisions}</p></div>}
              {note.actionItems && <div><b>Action Items / Next Steps</b><p>{note.actionItems}</p></div>}
              {note.assignedTo && <p><b>Assigned to:</b> {note.assignedTo}</p>}
              <small>Created by {note.createdBy || 'Admin'} • Last edited by {note.updatedBy || 'Admin'} • {note.updatedAt ? new Date(note.updatedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false }) : ''}</small>
            </div>}
          </article>)}
        </div>}
    </section>
  </main>;
}
