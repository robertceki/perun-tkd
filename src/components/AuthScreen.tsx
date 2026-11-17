import { Box, Button, Card, Stack, Typography } from '@mui/material'
import { useState, type FormEvent } from 'react'
import type { useAuth } from '../hooks/useAuth'
import { Feedback, Field } from './Feedback'

export function AuthScreen({ auth }: { auth: ReturnType<typeof useAuth> }) {
  const [reset, setReset] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState('')
  const recovery = auth.status === 'recovery'
  async function submit(event: FormEvent) {
    event.preventDefault(); setError('')
    if (recovery) {
      if (password.length < 8 || password !== confirmation) { setError('Lozinka mora imati najmanje 8 znakova i oba unosa moraju biti jednaka.'); return }
      await auth.completeRecovery(password)
    } else if (reset) await auth.reset(email)
    else await auth.login(email, password)
  }
  return <Box component="main" sx={{ maxWidth: 480, mx: 'auto', px: 2, py: { xs: 3, sm: 6 } }}>
    <Stack direction="row" alignItems="center" gap={1.25} sx={{ bgcolor: 'secondary.main', color: '#efd18b', p: 1.5, borderRadius: '14px', mb: 2 }}>
      <Box component="img" src="/perun-logo.jpg" alt="" sx={{ width: 38, height: 38, borderRadius: '8px' }} />
      <Typography component="h1" fontWeight={800}>TKD PERUN</Typography>
    </Stack>
    <Card sx={{ p: { xs: 2, sm: 3 } }}>
      <Typography component="h2" variant="h6" fontWeight={750} sx={{ mb: 2 }}>{recovery ? 'Nova lozinka' : reset ? 'Oporavak lozinke' : 'Prijava trenera'}</Typography>
    {!auth.configured && <Feedback errors={['Veza sa servisom nije podešena. Obratite se administratoru.']} />}
    <Feedback errors={[auth.error, error].filter(Boolean)} message={auth.message} />
    {auth.status === 'loading' && !auth.busy && <p role="status">Provera sesije…</p>}
    <form onSubmit={submit}><fieldset disabled={auth.busy || !auth.configured || auth.status === 'loading'}>
      {!recovery && <Field label="Imejl" type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} />}
      {(!reset || recovery) && <Field label={recovery ? 'Nova lozinka (najmanje 8 znakova)' : 'Lozinka'} type="password" autoComplete={recovery ? 'new-password' : 'current-password'} minLength={recovery ? 8 : undefined} required value={password} onChange={e => setPassword(e.target.value)} />}
      {recovery && <Field label="Ponovite novu lozinku" type="password" autoComplete="new-password" required value={confirmation} onChange={e => setConfirmation(e.target.value)} />}
      <Button type="submit" variant="contained" fullWidth>{auth.busy ? 'Sačekajte…' : recovery ? 'Sačuvaj lozinku' : reset ? 'Pošalji uputstvo' : 'Prijavi se'}</Button>
    </fieldset></form>
    <Box sx={{ mt: 1 }}>{recovery ? <Button type="button" color="secondary" disabled={auth.busy} onClick={() => void auth.logout()}>Odustani i odjavi se</Button> : <Button type="button" color="secondary" disabled={auth.busy} onClick={() => { setReset(!reset); setPassword(''); setError('') }}>{reset ? 'Nazad na prijavu' : 'Zaboravljena lozinka?'}</Button>}</Box>
    <Typography variant="body2" color="text.secondary">Pristup je namenjen samo ovlašćenim aktivnim trenerima. Nalog obezbeđuje administrator.</Typography>
  </Card></Box>
}
