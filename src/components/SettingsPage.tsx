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
    <h1 className="h3">Podešavanja</h1>
    <nav className="nav nav-pills gap-1 mb-3" aria-label="Podešavanja">
      {tabs.map(({ id, label }) => <button key={id} type="button" className={'nav-link' + (tab === id ? ' active' : '')}
        aria-current={tab === id ? 'page' : undefined} onClick={() => select(id)}>{label}</button>)}
    </nav>
    <div hidden={tab !== 'Deca'}><ChildrenPage data={data} club={club} navigate={navigate} today={today} openSchedule={() => select('Raspored')} /></div>
    <div hidden={tab !== 'Kontakti'}><ContactsPage data={data} club={club} /></div>
    <div hidden={tab !== 'Grupe'}><GroupsPage data={data} club={club} /></div>
    <div hidden={tab !== 'Raspored'}><TermsPage data={data} club={club} navigate={navigate} today={today} /></div>
  </>
}
