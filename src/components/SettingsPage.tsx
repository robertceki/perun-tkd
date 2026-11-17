import { Box, ButtonBase, Stack, Typography } from '@mui/material'
import type { ClubData } from '../domain/types'
import type { ClubController } from '../hooks/useClubData'
import type { Page } from './AppShell'
import { ChildrenPage } from './ChildrenPage'
import { ContactsPage } from './ContactsPage'
import { GroupsPage } from './GroupsPage'
import { TermsPage } from './TermsPage'

export type SettingsTab = 'Deca' | 'Kontakti' | 'Grupe' | 'Raspored'
const tabs: { id: SettingsTab; label: string }[] = [
  { id: 'Deca', label: 'Deca' }, { id: 'Kontakti', label: 'Roditelji/staratelji' },
  { id: 'Grupe', label: 'Grupe' }, { id: 'Raspored', label: 'Raspored termina' },
]
export function SettingsPage({ tab, select, data, club, navigate, today }: {
  tab: SettingsTab; select: (tab: SettingsTab) => void; data: ClubData; club: ClubController
  navigate: (page: Page) => void; today: string
}) {
  return <>
    <Typography component="h1" variant="h4" sx={{ fontSize: { xs: '1.8rem', sm: '2.2rem' }, mb: 2.5 }}>Podešavanja</Typography>
    <Stack direction="row" spacing={1} role="group" aria-label="Podešavanja"
      sx={{ overflowX: 'auto', scrollbarWidth: 'none', mb: 1, pb: 1 }}>
      {tabs.map(({ id, label }) => <ButtonBase key={id} aria-current={tab === id ? 'page' : undefined}
        onClick={() => select(id)} sx={{ flexShrink: 0, minWidth: 44, minHeight: 48, borderRadius: 6,
          '&.Mui-focusVisible span': { outline: '2px solid #222229', outlineOffset: 2 } }}>
        <Box component="span" sx={{ display: 'grid', placeItems: 'center', minHeight: 30, px: 1.25, borderRadius: 6,
          border: '1px solid', borderColor: tab === id ? 'primary.main' : '#ded6c7', bgcolor: tab === id ? 'primary.main' : 'background.paper',
          fontSize: { xs: '.9375rem', sm: '.8125rem' }, fontWeight: 700, whiteSpace: 'nowrap' }}>{label}</Box>
      </ButtonBase>)}
    </Stack>
    <div hidden={tab !== 'Deca'}><ChildrenPage data={data} club={club} navigate={navigate} today={today} openSchedule={() => select('Raspored')} /></div>
    <div hidden={tab !== 'Kontakti'}><ContactsPage data={data} club={club} /></div>
    <div hidden={tab !== 'Grupe'}><GroupsPage data={data} club={club} /></div>
    <div hidden={tab !== 'Raspored'}><TermsPage data={data} club={club} navigate={navigate} today={today} /></div>
  </>
}
