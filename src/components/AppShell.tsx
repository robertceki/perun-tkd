import type { ReactNode } from 'react'
export type Page = 'Početna' | 'Termini' | 'Podešavanja' | 'Deca' | 'Kontakti' | 'Grupe'
const pages: Page[] = ['Početna', 'Termini', 'Podešavanja']
export function AppShell({ page, navigate, trainer, busy, logout, children }: { page: Page; navigate: (page: Page) => void; trainer: string; busy: boolean; logout: () => void; children: ReactNode }) {
  return <><header className="border-bottom bg-body-tertiary"><div className="container py-3"><div className="d-flex justify-content-between align-items-center flex-wrap gap-2"><span className="fs-4">TKD Perun</span><div className="d-flex align-items-center gap-2 flex-wrap"><span className="text-break">{trainer}</span><button type="button" className="btn btn-outline-secondary" disabled={busy} onClick={logout}>Odjavi se</button></div></div><nav className="nav nav-pills mt-3 gap-1" aria-label="Glavna navigacija">{pages.map(item => <button key={item} type="button" className={`nav-link${page === item ? ' active' : ''}`} aria-current={page === item ? 'page' : undefined} disabled={busy} onClick={() => navigate(item)}>{item}</button>)}</nav></div></header><main className="container py-4">{children}</main></>
}

