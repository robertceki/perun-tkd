import type { ReactNode } from 'react'

export type Page = 'Početna' | 'Termini' | 'Podešavanja' | 'Deca' | 'Kontakti' | 'Grupe'
const pages = [
  { label: 'Početna', path: 'm3 10 9-7 9 7v10h-6v-6H9v6H3z' },
  { label: 'Termini', path: 'M3 5h18v16H3zM7 3v4m10-4v4M3 10h18m-14 5h3m4 0h3' },
  { label: 'Podešavanja', path: 'M4 6h16M4 12h16M4 18h16M8 4v4m8 2v4m-6 2v4' },
] as const

export function AppShell({ page, navigate, trainer, busy, logout, children }: { page: Page; navigate: (page: Page) => void; trainer: string; busy: boolean; logout: () => void; children: ReactNode }) {
  return <>
    <header className="perun-header">
      <div className="container py-3 d-flex justify-content-between align-items-center flex-wrap gap-3">
        <div className="perun-brand">
          <img src="/perun-logo.jpg" alt="" width="62" height="62" />
          <div><strong>TKD Perun</strong><small>Trening centar Pančevo</small></div>
        </div>
        <div className="d-flex align-items-center gap-2 flex-wrap">
          <span className="text-break">{trainer}</span>
          <button type="button" className="btn perun-logout" disabled={busy} onClick={logout}>Odjavi se</button>
        </div>
      </div>
    </header>
    <main className="container perun-main">{children}</main>
    <nav className="perun-nav" aria-label="Glavna navigacija">
      {pages.map(({ label, path }) => <button key={label} type="button" aria-current={page === label ? 'page' : undefined} disabled={busy} onClick={() => navigate(label)}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d={path} /></svg>
        <span>{label}</span>
      </button>)}
    </nav>
  </>
}
