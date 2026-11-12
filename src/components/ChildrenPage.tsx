import { useState, type FormEvent } from 'react'
import type { Child, ChildContact, ClubData } from '../domain/types'
import { validateChild } from '../domain/validation'
import type { ClubController } from '../hooks/useClubData'
import type { Page } from './AppShell'
import { Feedback, Field, FormActions, SelectField } from './Feedback'

export function ChildrenPage({ data, club, navigate }: { data: ClubData; club: ClubController; navigate: (page: Page) => void }) {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('all')
  const [group, setGroup] = useState('')
  const [draft, setDraft] = useState<Child | null>(null)
  const [links, setLinks] = useState<ChildContact[]>([])
  const [errors, setErrors] = useState<string[]>([])
  const previous = data.children.find(c => c.id === draft?.id)
  function edit(child: Child) { setDraft({ ...child }); setLinks(data.childContacts.filter(link => link.child_id === child.id).map(link => ({ ...link }))); setErrors([]) }
  const ready = data.groups.some(g => g.active && g.kind === 'main') && data.contacts.length > 0
  async function submit(event: FormEvent) {
    event.preventDefault(); if (!draft) return
    const value = { ...draft, first_name: draft.first_name.trim(), last_name: draft.last_name.trim(), address: draft.address.trim(), belt: draft.belt.trim(), notes: draft.notes?.trim() ? draft.notes : null }
    const invalid = validateChild(value, links, data); setErrors(invalid)
    if (!invalid.length && await club.saveChild(value, links) === 'saved') setDraft(null)
  }
  const list = data.children.filter(c => `${c.first_name} ${c.last_name}`.toLocaleLowerCase('sr-Latn').includes(query.toLocaleLowerCase('sr-Latn')) && (status === 'all' || c.status === status) && (!group || c.main_group_id === group || c.competition_group_id === group))
  return <><h1 className="h3">Deca</h1><p>Za promenu grupe ili deaktivaciju najpre završite postojeće upise u termine zaključno sa prethodnim danom.</p>
    {!ready && <div className="alert alert-info">Za novo dete potrebni su aktivna glavna grupa i kontakt. <button type="button" className="btn btn-link" onClick={() => navigate('Grupe')}>Otvori grupe</button><button type="button" className="btn btn-link" onClick={() => navigate('Kontakti')}>Otvori kontakte</button></div>}
    <button type="button" className="btn btn-primary mb-3" disabled={club.busy || !ready} onClick={() => edit({ id: crypto.randomUUID(), first_name: '', last_name: '', birth_date: '', address: '', belt: '', status: 'active', main_group_id: '', competition_group_id: null })}>Dodaj dete</button>
    {draft && <section className="card mb-4"><div className="card-body"><h2 className="h4">{previous ? 'Uredi dete' : 'Novo dete'}</h2><Feedback errors={errors} /><form onSubmit={submit}><fieldset disabled={club.busy}>
      <div className="row"><div className="col-md-6"><Field label="Ime deteta" autoComplete="given-name" required value={draft.first_name} onChange={e => setDraft({ ...draft, first_name: e.target.value })} /></div><div className="col-md-6"><Field label="Prezime deteta" autoComplete="family-name" required value={draft.last_name} onChange={e => setDraft({ ...draft, last_name: e.target.value })} /></div></div>
      <Field label="Datum rođenja" type="date" required value={draft.birth_date} onChange={e => setDraft({ ...draft, birth_date: e.target.value })} />
      <Field label="Adresa (opciono pri upisu)" autoComplete="street-address" value={draft.address} onChange={e => setDraft({ ...draft, address: e.target.value })} />
      <Field label="Pojas (opciono pri upisu)" value={draft.belt} onChange={e => setDraft({ ...draft, belt: e.target.value })} />
      <div className="mb-3">
        <label className="form-label" htmlFor="child-notes">Napomene</label>
        <textarea className="form-control" id="child-notes" rows={3} value={draft.notes ?? ''} onChange={e => setDraft({ ...draft, notes: e.target.value })} />
      </div>
      <SelectField label="Status deteta" value={draft.status} onChange={e => setDraft({ ...draft, status: e.target.value as Child['status'] })}><option value="active">Aktivno</option><option value="inactive">Neaktivno</option></SelectField>
      <SelectField label="Glavna grupa" required value={draft.main_group_id} onChange={e => setDraft({ ...draft, main_group_id: e.target.value })}><option value="">Izaberite glavnu grupu</option>{data.groups.filter(g => g.kind === 'main' && (g.active || g.id === previous?.main_group_id)).map(g => <option key={g.id} value={g.id}>{g.name}{!g.active ? ' (neaktivna)' : ''}</option>)}</SelectField>
      <SelectField label="Takmičarska grupa (opciono)" value={draft.competition_group_id ?? ''} onChange={e => setDraft({ ...draft, competition_group_id: e.target.value || null })}><option value="">Bez takmičarske grupe</option>{data.groups.filter(g => g.kind === 'competition' && (g.active || g.id === previous?.competition_group_id)).map(g => <option key={g.id} value={g.id}>{g.name}{!g.active ? ' (neaktivna)' : ''}</option>)}</SelectField>
      <fieldset className="border rounded p-3 mb-3"><legend className="float-none w-auto fs-5 px-1">Kontakti deteta</legend><p>Izaberite postojeće kontakte, odnos i tačno jedan glavni kontakt.</p>
        {links.map((link, index) => <div className="border-bottom mb-3 pb-3" key={index}>
          <SelectField label={`Kontakt ${index + 1}`} required value={link.contact_id} onChange={e => setLinks(links.map((item, i) => i === index ? { ...item, contact_id: e.target.value } : item))}><option value="">Izaberite kontakt</option>{data.contacts.filter(c => c.id === link.contact_id || !links.some(item => item.contact_id === c.id)).map(c => <option key={c.id} value={c.id}>{c.first_name} {c.last_name} — {c.phone}</option>)}</SelectField>
          <Field label={`Odnos kontakta ${index + 1} sa detetom`} required placeholder="Npr. majka, otac, staratelj" value={link.relationship} onChange={e => setLinks(links.map((item, i) => i === index ? { ...item, relationship: e.target.value } : item))} />
          <div className="form-check mb-2"><input id={`primary-${index}`} type="radio" name="primary-contact" className="form-check-input" checked={link.is_primary} onChange={() => setLinks(links.map((item, i) => ({ ...item, is_primary: i === index })))} /><label htmlFor={`primary-${index}`} className="form-check-label">Glavni kontakt</label></div>
          <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => setLinks(links.filter((_, i) => i !== index))}>Ukloni vezu sa kontaktom {index + 1}</button>
        </div>)}
        <button type="button" className="btn btn-outline-primary" disabled={links.length >= data.contacts.length} onClick={() => setLinks([...links, { child_id: draft.id, contact_id: '', relationship: '', is_primary: links.length === 0 }])}>Poveži postojeći kontakt</button>
      </fieldset><FormActions busy={club.busy} cancel={() => setDraft(null)} />
    </fieldset></form></div></section>}
    <div className="row"><div className="col-md-6"><Field label="Pretraži decu po imenu i prezimenu" type="search" value={query} onChange={e => setQuery(e.target.value)} /></div><div className="col-md-3"><SelectField label="Filter statusa" value={status} onChange={e => setStatus(e.target.value)}><option value="all">Svi statusi</option><option value="active">Aktivna</option><option value="inactive">Neaktivna</option></SelectField></div><div className="col-md-3"><SelectField label="Filter grupe" value={group} onChange={e => setGroup(e.target.value)}><option value="">Sve grupe</option>{data.groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</SelectField></div></div>
    {!list.length ? <p role="status">Nema dece koja odgovaraju izabranim filterima.</p> : <div className="table-responsive"><table className="table table-striped"><caption>Deca, grupe i kontakti</caption><thead><tr><th scope="col">Dete</th><th scope="col">Datum rođenja / pojas</th><th scope="col">Grupe / status</th><th scope="col">Kontakti</th><th scope="col">Radnja</th></tr></thead><tbody>{list.map(child => <tr key={child.id}><td>{child.first_name} {child.last_name}<div className="small text-break">{child.address}</div></td><td>{child.birth_date}<br />{child.belt || 'Pojas nije unet'}</td><td>{data.groups.find(g => g.id === child.main_group_id)?.name}{child.competition_group_id && <div>Takmičarska: {data.groups.find(g => g.id === child.competition_group_id)?.name}</div>}<div>{child.status === 'active' ? 'Aktivno' : 'Neaktivno'}</div></td><td>{data.childContacts.filter(l => l.child_id === child.id).map(l => { const c = data.contacts.find(item => item.id === l.contact_id); return <div key={l.contact_id}>{c?.first_name} {c?.last_name} ({l.relationship}{l.is_primary ? ', glavni' : ''})</div> })}</td><td><button type="button" className="btn btn-outline-primary btn-sm" disabled={club.busy} onClick={() => edit(child)} aria-label={`Uredi dete ${child.first_name} ${child.last_name}`}>Uredi / status</button></td></tr>)}</tbody></table></div>}
  </>
}

