import type { ReactNode } from 'react'
import { AppBar, BottomNavigation, BottomNavigationAction, Box, Button, Toolbar, Typography } from '@mui/material'
import Home from '@mui/icons-material/HomeOutlined'
import Calendar from '@mui/icons-material/CalendarMonthOutlined'
import Settings from '@mui/icons-material/TuneOutlined'

export type Page = 'Početna' | 'Termini' | 'Podešavanja' | 'Deca' | 'Kontakti' | 'Grupe'
const pages = [
  { label: 'Početna', icon: <Home /> },
  { label: 'Termini', icon: <Calendar /> },
  { label: 'Podešavanja', icon: <Settings /> },
] as const

export function AppShell({ page, navigate, busy, logout, children }: { page: Page; navigate: (page: Page) => void; trainer: string; busy: boolean; logout: () => void; children: ReactNode }) {
  return <>
    <AppBar className="perun-fixed-header" position="fixed" elevation={0} color="secondary" sx={{ pt: 'env(safe-area-inset-top)', color: '#fff' }}>
      <Toolbar sx={{ gap: 1.25, minHeight: 'var(--perun-toolbar-height)', px: { xs: 'max(16px, env(safe-area-inset-left))', sm: 'max(24px, env(safe-area-inset-left))' }, paddingRight: { xs: 'max(16px, env(safe-area-inset-right))', sm: 'max(24px, env(safe-area-inset-right))' } }}>
        <Box component="img" src="/perun-logo.jpg" alt="" sx={{ width: 38, height: 38, borderRadius: '8px' }} />
        <Typography sx={{ color: '#efd18b', fontWeight: 800, flex: 1 }}>TKD PERUN</Typography>
        <Button color="inherit" disabled={busy} onClick={logout}>Odjavi se</Button>
      </Toolbar>
    </AppBar>
    <Box component="main" sx={{ maxWidth: 1120, mx: 'auto', px: { xs: 2, sm: 3 }, pt: { xs: 'calc(var(--perun-header-height) + 20px)', sm: 'calc(var(--perun-header-height) + 32px)' }, pb: 'calc(84px + env(safe-area-inset-bottom))' }}>{children}</Box>
    <BottomNavigation component="nav" aria-label="Glavna navigacija" showLabels value={page}
      sx={{ position: 'fixed', inset: 'auto 0 0', zIndex: 10, height: 'calc(56px + env(safe-area-inset-bottom))', pb: 'env(safe-area-inset-bottom)', bgcolor: 'secondary.main' }}>
      {pages.map(({ label, icon }) => <BottomNavigationAction key={label} value={label} label={label} icon={icon}
        aria-current={page === label ? 'page' : undefined} disabled={busy} onClick={() => navigate(label)}
        sx={{ minWidth: 0, flex: 1, maxWidth: 'none', color: '#f2eee7', '&.Mui-selected': { color: '#efd18b' }, '& svg': { width: 20, height: 20, transform: 'translateY(0px)' } }} />)}
    </BottomNavigation>
  </>
}
