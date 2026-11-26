import { Dialog, DialogTitle, DialogContent, DialogActions, Alert, Typography, Box, Button, IconButton } from '@mui/material'
import Close from '@mui/icons-material/Close'
import { SettingsDetail } from './SettingsDetail'
import { DirectoryCard } from './DirectoryCard'
import { useState, type FormEvent } from 'react'
import type { Child, ClubData, Group } from '../domain/types'
import { validateGroup } from '../domain/validation'
import type { ClubController } from '../hooks/useClubData'
import { Check, Feedback, Field, FormActions, SelectField } from './Feedback'

export function GroupsPage({ data, club }: { data: ClubData; club: ClubController }) {
  const [draft, setDraft] = useState<Group | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [removing, setRemoving] = useState<Child | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const edit = (value: Group) => { setDraft({ ...value }); setErrors([]) }
  const linked = !!draft && (data.children.some(c => c.main_group_id === draft.id || c.competition_group_id === draft.id) || data.terms.some(t => t.group_id === draft.id) || (data.sessions ?? []).some(session => session.group_id === draft.id))
  const existing = !!draft && data.groups.some(group => group.id === draft.id)
  async function submit(event: FormEvent) {
    event.preventDefault(); if (!draft) return
    const invalid = validateGroup(draft); setErrors(invalid)
    if (!invalid.length && await club.saveGroup({ ...draft, name: draft.name.trim() }) === 'saved') setDraft(null)
  }
  if (draft) {
    const members = data.children.filter(child => child.main_group_id === draft.id || child.competition_group_id === draft.id)
    return <>
    <SettingsDetail busy={club.busy} backLabel="Nazad na spisak grupa" onBack={() => setDraft(null)}><Typography component="h2" variant="h6" sx={{ mb: 1.25 }}>Grupa</Typography><Feedback errors={errors} /><form onSubmit={submit}><fieldset disabled={club.busy}><Field label="Naziv" required value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /><SelectField label="Vrsta" value={draft.kind} disabled={linked} onChange={e => setDraft({ ...draft, kind: e.target.value as Group['kind'] })}><option value="main">Glavna</option><option value="competition">Takmičarska</option></SelectField>{linked && <Alert variant="outlined" severity="info" role="note" sx={{ mb: 1.5 }}>Vrsta je zaključana jer grupa ima povezane podatke.</Alert>}<Check label="Aktivna grupa" checked={draft.active} onChange={e => setDraft({ ...draft, active: e.target.checked })} /><FormActions busy={club.busy} cancel={() => setDraft(null)} /></fieldset></form>
      {existing && !linked && <Box sx={{ mt: 2 }}>
        <Button color="error" variant="outlined" disabled={club.busy || linked} onClick={() => setDeleting(true)}>Obriši grupu</Button>
      </Box>}
      <Dialog open={deleting} onClose={() => { if (!club.busy) setDeleting(false) }} aria-labelledby="delete-group-title">
        <DialogTitle id="delete-group-title">Obriši grupu „{draft.name}“?</DialogTitle>
        <DialogContent>Brisanje grupe je trajno.</DialogContent>
        <DialogActions>
          <Button disabled={club.busy} onClick={() => setDeleting(false)}>Odustani</Button>
          <Button color="error" disabled={club.busy || linked} onClick={async () => {
            const result = await club.deleteGroup(draft.id)
            if (result === 'saved' || result === 'refresh-failed') { setDeleting(false); setDraft(null) }
          }}>Obriši</Button>
        </DialogActions>
      </Dialog>
      {members.length > 0 && <Box component="section" sx={{ mt: 1.5 }}>
        <Typography component="h3" variant="subtitle1">Članovi ({members.length}, aktivni: {members.filter(child => child.status === 'active').length})</Typography>
        <Box component="ul" aria-label="Članovi grupe" sx={{ listStyle: 'none', p: 0, m: 0 }}>
          {members.map(child => <Box component="li" key={child.id}
            sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, minHeight: 44 }}>
            <span>{child.first_name} {child.last_name}{child.status === 'inactive' ? ' — neaktivan' : ''}</span>
            <IconButton color="error" aria-label={`Ukloni člana ${child.first_name} ${child.last_name} iz grupe`}
              sx={{ minWidth: 44, minHeight: 44 }} disabled={club.busy} onClick={() => setRemoving(child)}><Close /></IconButton>
          </Box>)}
        </Box>
      </Box>}
      <Dialog open={removing !== null} onClose={() => { if (!club.saving) setRemoving(null) }}
        aria-labelledby="remove-group-member-title" aria-describedby="remove-group-member-description">
        <DialogTitle id="remove-group-member-title">Ukloni člana iz grupe?</DialogTitle>
        <DialogContent>
          <Typography id="remove-group-member-description">
            {removing?.first_name} {removing?.last_name} biće uklonjen iz grupe „{draft.name}“. Aktivni upisi za termine ove grupe biće otkazani. Profil člana i sačuvano prisustvo ostaju dostupni.
          </Typography>
          {club.error && <Alert severity="error" sx={{ mt: 1.5 }}>{club.error}</Alert>}
        </DialogContent>
        <DialogActions>
          <Button autoFocus disabled={club.saving} onClick={() => setRemoving(null)}>Odustani</Button>
          <Button color="error" disabled={club.busy} onClick={async () => {
            if (!removing) return
            const result = await club.removeGroupMember(draft.id, removing.id)
            if (result !== 'failed') setRemoving(null)
          }}>Ukloni iz grupe</Button>
        </DialogActions>
      </Dialog>
    </SettingsDetail>
  </>
  }

  return <><Typography component="h1" variant="h6" sx={{ mb: 1 }}>Grupe</Typography><Alert variant="outlined" severity="info" role="note" sx={{ mb: 1.5 }}>Deaktivacija čuva članove, termine i istoriju. Vrsta povezane grupe ne može se menjati.</Alert><Button type="button" variant="contained" sx={{ mb: 1.5 }} disabled={club.busy} onClick={() => edit({ id: crypto.randomUUID(), name: '', kind: 'main', active: true })}>Dodaj grupu</Button>
    {!data.groups.length ? <Alert variant="outlined" severity="info" role="status">Nema grupa. Najpre dodajte glavnu grupu.</Alert> :
      <Box component="ul" sx={{ listStyle: 'none', p: 0, m: 0 }} aria-label="Spisak grupa">{data.groups.map(group => {
        const members = data.children.filter(child => child.main_group_id === group.id || child.competition_group_id === group.id)
        return <li key={group.id}>
          <DirectoryCard disabled={club.busy} onClick={() => edit(group)} label={`Uredi grupu ${group.name}`}>
            <Box component="span" sx={{ display: 'block', flex: 1, minWidth: 0, lineHeight: 1.25, overflowWrap: 'anywhere', '& small': { display: 'block', color: 'text.secondary', fontSize: { xs: '.9375rem', sm: '.875rem' } } }}>
              <span role="heading" aria-level={2}><strong>{group.name}</strong></span>
              <small>{group.kind === 'main' ? 'Glavna' : 'Takmičarska'} · {group.active ? 'Aktivna' : 'Neaktivna'} · Članovi: {members.length}</small></Box>
          </DirectoryCard>
        </li>
      })}</Box>}
  </>
}

