import { Alert, Typography, Box, Button } from '@mui/material'
import { SettingsDetail } from './SettingsDetail'
import { DirectoryCard } from './DirectoryCard'
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
  if (draft) return <>
    <SettingsDetail busy={club.busy} backLabel="Nazad na spisak kontakata" onBack={() => setDraft(null)}><Typography component="h2" variant="h6" sx={{ mb: 1.25 }}>{data.contacts.some(c => c.id === draft.id) ? 'Uredi kontakt' : 'Novi kontakt'}</Typography><Feedback errors={errors} /><form onSubmit={submit}><fieldset disabled={club.busy}>
      <Field label="Ime" autoComplete="given-name" required value={draft.first_name} onChange={e => setDraft({ ...draft, first_name: e.target.value })} />
      <Field label="Prezime" autoComplete="family-name" required value={draft.last_name} onChange={e => setDraft({ ...draft, last_name: e.target.value })} />
      <Field label="Telefon" type="tel" autoComplete="tel" required value={draft.phone} onChange={e => setDraft({ ...draft, phone: e.target.value })} />
      <Field label="Imejl (opciono)" type="email" autoComplete="email" value={draft.email ?? ''} onChange={e => setDraft({ ...draft, email: e.target.value })} />
      <Field label="Adresa (opciono)" autoComplete="street-address" value={draft.address ?? ''} onChange={e => setDraft({ ...draft, address: e.target.value })} />
      <FormActions busy={club.busy} cancel={() => setDraft(null)} />
    </fieldset></form></SettingsDetail>
  </>

  return <><Typography component="h1" variant="h6" sx={{ mb: 1 }}>Kontakti</Typography><Alert variant="outlined" severity="info" role="note" sx={{ mb: 1.5 }}>Jedan kontakt možete povezati sa više dece. Za braću i sestre izaberite postojeći kontakt.</Alert>
    <Button type="button" variant="contained" sx={{ mb: 1.5 }} disabled={club.busy} onClick={() => edit({ id: crypto.randomUUID(), first_name: '', last_name: '', phone: '', email: null, address: null })}>Dodaj kontakt</Button>
    <Field label="Pretraži kontakte po imenu, telefonu ili imejlu" type="search" value={query} onChange={e => setQuery(e.target.value)} />
    {!list.length ? <Alert variant="outlined" severity="info" role="status">Nema kontakata koji odgovaraju pretrazi.</Alert> :
      <Box component="ul" sx={{ listStyle: 'none', p: 0, m: 0 }} aria-label="Spisak roditelja i staratelja">
        {list.map(contact => {
          const children = data.childContacts.filter(link => link.contact_id === contact.id)
            .map(link => data.children.find(child => child.id === link.child_id))
            .filter(child => child !== undefined)
          return <li key={contact.id}>
            <DirectoryCard disabled={club.busy} onClick={() => edit(contact)}
              label={`Uredi kontakt ${contact.first_name} ${contact.last_name}`}>
              <Box component="span" sx={{ display: 'block', flex: 1, minWidth: 0, lineHeight: 1.25, overflowWrap: 'anywhere', '& small': { display: 'block', color: 'text.secondary', fontSize: '.875rem' } }}>
                <strong>{contact.first_name} {contact.last_name}</strong>
                <small>{children.length ? children.map(child => child.first_name + ' ' + child.last_name).join(', ') : 'Nema povezane dece'}</small></Box>
          </DirectoryCard>
          </li>
        })}</Box>}
  </>
}
