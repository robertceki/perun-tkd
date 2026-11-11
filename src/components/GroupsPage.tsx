import { useState, type FormEvent } from 'react'
import type { ClubData, Group } from '../domain/types'
import { validateGroup } from '../domain/validation'
import type { ClubController } from '../hooks/useClubData'
import { Check, Feedback, Field, FormActions, SelectField } from './Feedback'

export function GroupsPage({ data, club }: { data: ClubData; club: ClubController }) {
  const [draft, setDraft] = useState<Group | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const edit = (value: Group) => { setDraft({ ...value }); setErrors([]) }
  const linked = !!draft && (data.children.some(c => c.main_group_id === draft.id || c.competition_group_id === draft.id) || data.terms.some(t => t.group_id === draft.id))
  async function submit(event: FormEvent) {
    event.preventDefault(); if (!draft) return
    const invalid = validateGroup(draft); setErrors(invalid)
    if (!invalid.length && await club.saveGroup({ ...draft, name: draft.name.trim() }) === 'saved') setDraft(null)
  }
  return <><h1 className="h3">Grupe</h1><p>Deaktivacija čuva članove, termine i istoriju. Vrsta povezane grupe ne može se menjati.</p><button type="button" className="btn btn-primary mb-3" disabled={club.busy} onClick={() => edit({ id: crypto.randomUUID(), name: '', kind: 'main', active: true })}>Dodaj grupu</button>
    {draft && <section className="card mb-4"><div className="card-body"><h2 className="h4">Grupa</h2><Feedback errors={errors} /><form onSubmit={submit}><fieldset disabled={club.busy}><Field label="Naziv" required value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /><SelectField label="Vrsta" value={draft.kind} disabled={linked} onChange={e => setDraft({ ...draft, kind: e.target.value as Group['kind'] })}><option value="main">Glavna</option><option value="competition">Takmičarska</option></SelectField>{linked && <p className="text-body-secondary">Vrsta je zaključana jer grupa ima povezane podatke.</p>}<Check label="Aktivna grupa" checked={draft.active} onChange={e => setDraft({ ...draft, active: e.target.checked })} /><FormActions busy={club.busy} cancel={() => setDraft(null)} /></fieldset></form></div></section>}
    {!data.groups.length ? <p role="status">Nema grupa. Najpre dodajte glavnu grupu.</p> : <div className="row g-3">{data.groups.map(group => { const members = data.children.filter(c => c.main_group_id === group.id || c.competition_group_id === group.id); return <div className="col-12 col-md-6" key={group.id}><section className="card h-100"><div className="card-body"><h2 className="h5 text-break">{group.name}</h2><p>{group.kind === 'main' ? 'Glavna' : 'Takmičarska'} · {group.active ? 'Aktivna' : 'Neaktivna'}</p><p>Članovi: {members.length} (aktivni: {members.filter(c => c.status === 'active').length})</p>{members.length > 0 && <ul>{members.map(c => <li key={c.id}>{c.first_name} {c.last_name}{c.status === 'inactive' ? ' — neaktivan' : ''}</li>)}</ul>}<button type="button" className="btn btn-outline-primary" disabled={club.busy} onClick={() => edit(group)} aria-label={`Uredi grupu ${group.name}`}>Uredi / aktivnost</button></div></section></div> })}</div>}
  </>
}

