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
  return <main className="container py-5"><div className="row justify-content-center"><div className="col-12 col-md-7 col-lg-5"><h1 className="h3">TKD Perun</h1><div className="card"><div className="card-body"><h2 className="h4">{recovery ? 'Nova lozinka' : reset ? 'Oporavak lozinke' : 'Prijava trenera'}</h2>
    {!auth.configured && <Feedback errors={['Veza sa servisom nije podešena. Obratite se administratoru.']} />}
    <Feedback errors={[auth.error, error].filter(Boolean)} message={auth.message} />
    {auth.status === 'loading' && !auth.busy && <p role="status">Provera sesije…</p>}
    <form onSubmit={submit}><fieldset disabled={auth.busy || !auth.configured || auth.status === 'loading'}>
      {!recovery && <Field label="Imejl" type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} />}
      {(!reset || recovery) && <Field label={recovery ? 'Nova lozinka (najmanje 8 znakova)' : 'Lozinka'} type="password" autoComplete={recovery ? 'new-password' : 'current-password'} minLength={recovery ? 8 : undefined} required value={password} onChange={e => setPassword(e.target.value)} />}
      {recovery && <Field label="Ponovite novu lozinku" type="password" autoComplete="new-password" required value={confirmation} onChange={e => setConfirmation(e.target.value)} />}
      <button type="submit" className="btn btn-primary">{auth.busy ? 'Sačekajte…' : recovery ? 'Sačuvaj lozinku' : reset ? 'Pošalji uputstvo' : 'Prijavi se'}</button>
    </fieldset></form>
    <div className="mt-3">{recovery ? <button type="button" disabled={auth.busy} className="btn btn-link px-0" onClick={() => void auth.logout()}>Odustani i odjavi se</button> : <button type="button" disabled={auth.busy} className="btn btn-link px-0" onClick={() => { setReset(!reset); setPassword(''); setError('') }}>{reset ? 'Nazad na prijavu' : 'Zaboravljena lozinka?'}</button>}</div>
    <p className="text-body-secondary small mb-0">Pristup je namenjen samo ovlašćenim aktivnim trenerima. Nalog obezbeđuje administrator.</p>
  </div></div></div></div></main>
}
