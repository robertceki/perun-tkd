import { useState, type FormEvent } from 'react'
import type { ClubData, Contact } from '../domain/types'
import { validateContact } from '../domain/validation'
import type { ClubController } from '../hooks/useClubData'
import { Feedback, Field, FormActions } from './Feedback'

export function ContactsPage({ data, club }: { data: ClubData; club: ClubController }) {
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState<Contact | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const edit = (value: Contact) => { setDraft({ ...value }); setErrors([]) }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (!draft) return
    const value = { ...draft, first_name: draft.first_name.trim(), last_name: draft.last_name.trim(), phone: draft.phone.trim(), email: draft.email?.trim() || null, address: draft.address?.trim() || null }
    const invalid = validateContact(value); setErrors(invalid)
    if (!invalid.length && await club.saveContact(value) === 'saved') setDraft(null)
  }
  const list = data.contacts.filter(contact => `${contact.first_name} ${contact.last_name} ${contact.phone} ${contact.email ?? ''}`.toLocaleLowerCase('sr-Latn').includes(query.toLocaleLowerCase('sr-Latn')))
  return <><h1 className="h3">Kontakti</h1><p>Jedan kontakt možete povezati sa više dece. Za braću i sestre izaberite postojeći kontakt.</p>
    <button type="button" className="btn btn-primary mb-3" disabled={club.busy} onClick={() => edit({ id: crypto.randomUUID(), first_name: '', last_name: '', phone: '', email: null, address: null })}>Dodaj kontakt</button>
    {draft && <section className="card mb-4"><div className="card-body"><h2 className="h4">{data.contacts.some(c => c.id === draft.id) ? 'Uredi kontakt' : 'Novi kontakt'}</h2><Feedback errors={errors} /><form onSubmit={submit}><fieldset disabled={club.busy}>
      <Field label="Ime" autoComplete="given-name" required value={draft.first_name} onChange={e => setDraft({ ...draft, first_name: e.target.value })} />
      <Field label="Prezime" autoComplete="family-name" required value={draft.last_name} onChange={e => setDraft({ ...draft, last_name: e.target.value })} />
      <Field label="Telefon" type="tel" autoComplete="tel" required value={draft.phone} onChange={e => setDraft({ ...draft, phone: e.target.value })} />
      <Field label="Imejl (opciono)" type="email" autoComplete="email" value={draft.email ?? ''} onChange={e => setDraft({ ...draft, email: e.target.value })} />
      <Field label="Adresa (opciono)" autoComplete="street-address" value={draft.address ?? ''} onChange={e => setDraft({ ...draft, address: e.target.value })} />
      <FormActions busy={club.busy} cancel={() => setDraft(null)} />
    </fieldset></form></div></section>}
    <Field label="Pretraži kontakte po imenu, telefonu ili imejlu" type="search" value={query} onChange={e => setQuery(e.target.value)} />
    {!list.length ? <p role="status">Nema kontakata koji odgovaraju pretrazi. Dodajte kontakt pre unosa deteta.</p> : <div className="table-responsive"><table className="table table-striped"><caption>Kontakti i povezana deca</caption><thead><tr><th scope="col">Ime i prezime</th><th scope="col">Telefon / imejl</th><th scope="col">Adresa</th><th scope="col">Deca</th><th scope="col">Radnja</th></tr></thead><tbody>{list.map(contact => <tr key={contact.id}><td>{contact.first_name} {contact.last_name}</td><td className="text-break">{contact.phone}<br />{contact.email}</td><td className="text-break">{contact.address || '—'}</td><td>{data.childContacts.filter(link => link.contact_id === contact.id).map(link => { const child = data.children.find(c => c.id === link.child_id); return <div key={link.child_id}>{child?.first_name} {child?.last_name} ({link.relationship}{link.is_primary ? ', glavni' : ''})</div> })}</td><td><button type="button" className="btn btn-outline-primary btn-sm" disabled={club.busy} onClick={() => edit(contact)} aria-label={`Uredi kontakt ${contact.first_name} ${contact.last_name}`}>Uredi</button></td></tr>)}</tbody></table></div>}
  </>
}

