import { allowsCompetitionEnrollment, liveCompetitionAssignments, matchingWeights } from './competitorProfile'
import type { Child, ChildContact, ClubData, Contact, Group, TermAssignment, WeeklyTerm } from './types'

const uuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
const date = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value && value >= '0001-01-01'
const belgradeDate = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Belgrade', year: 'numeric', month: '2-digit', day: '2-digit',
})
export function belgradeBusinessDate(instant: Date = new Date()): string {
  const parts = belgradeDate.formatToParts(instant)
  const year = parts.find(part => part.type === 'year')!.value.padStart(4, '0')
  const month = parts.find(part => part.type === 'month')!.value
  const day = parts.find(part => part.type === 'day')!.value
  return `${year}-${month}-${day}`
}
const ended = (value: string | null) => value !== null && date(value) && value < belgradeBusinessDate()
const range = (from: string, to: string | null) => date(from) && (to === null || (date(to) && to >= from))
export const enrollmentPeriodsOverlap = (a: TermAssignment, b: TermAssignment) => a.valid_from <= (b.valid_to ?? '9999-12-31') && b.valid_from <= (a.valid_to ?? '9999-12-31')
const time = (value: string) => /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,6})?)?$/.test(value) ? (value.length === 5 ? `${value}:00` : value) : null
export function formatTime(value: string): string {
  if (!time(value)) throw new Error('Neispravno vreme.')
  return value.slice(0, 5)
}
export function normalizeTermTime(value: string): string | null {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d(?::00)?$/.test(value)) return null
  const parsed = time(value)
  return parsed?.endsWith(':00') ? parsed : null
}
const names = (first: string, last: string) => first.trim() && last.trim()

export function validateContact(contact: Contact): string[] {
  const errors: string[] = []
  if (!uuid(contact.id)) errors.push('Neispravan identifikator kontakta.')
  if (!names(contact.first_name, contact.last_name)) errors.push('Ime i prezime kontakta su obavezni.')
  if (!contact.phone.trim()) errors.push('Telefon je obavezan.')
  if (contact.email !== null && contact.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email.trim())) errors.push('Unesite ispravnu imejl adresu.')
  return errors
}

export function validateGroup(group: Group): string[] {
  const errors: string[] = []
  if (!uuid(group.id)) errors.push('Neispravan identifikator grupe.')
  if (!group.name.trim()) errors.push('Naziv grupe je obavezan.')
  if (!['main', 'competition'].includes(group.kind)) errors.push('Neispravna vrsta grupe.')
  return errors
}

export function validateChild(child: Child, links: ChildContact[], data: ClubData, today = belgradeBusinessDate()): string[] {
  const errors: string[] = []
  if (!uuid(child.id)) errors.push('Neispravan identifikator deteta.')
  if (!names(child.first_name, child.last_name)) errors.push('Ime i prezime deteta su obavezni.')
  if (!date(child.birth_date) || child.birth_date > (today || belgradeBusinessDate())) errors.push('Datum rođenja mora biti ispravan i ne može biti u budućnosti.')
  if (!['active', 'inactive'].includes(child.status)) errors.push('Neispravan status deteta.')
  const previous = data.children.find(item => item.id === child.id)
  if ((!previous || child.sex != null) && child.sex !== 'M' && child.sex !== 'F') errors.push('Izaberite pol deteta.')
  if ((!previous || child.member_type !== undefined) && child.member_type !== 'recreational' && child.member_type !== 'competitor') errors.push('Izaberite tip člana.')
  if (child.member_type !== 'competitor') {
    if (child.competition_group_id && (previous?.member_type === 'competitor' || child.competition_group_id !== previous?.competition_group_id)) errors.push('Takmičarska grupa zahteva takmičara.')
    if (child.competition_class || child.weight_category_id) errors.push('Takmičarska klasa i težinska kategorija zahtevaju takmičara.')
  }
  if (child.competition_class && child.competition_class !== previous?.competition_class && !data.competitionClasses?.some(item => item.id === child.competition_class)) errors.push('Izaberite važeću takmičarsku klasu.')
  if (child.weight_category_id && (child.weight_category_id !== previous?.weight_category_id || child.sex !== previous.sex || child.birth_date !== previous.birth_date)
      && !matchingWeights(child, data, today).some(weight => weight.id === child.weight_category_id)) errors.push('Izaberite težinsku kategoriju koja odgovara polu i uzrastu deteta.')
  if (child.member_type !== 'competitor' && (previous?.member_type === 'competitor' || (previous?.competition_group_id && !child.competition_group_id))
      && (!today || liveCompetitionAssignments(child.id, data, today).length)) errors.push('Najpre završite ili otkažite takmičarske upise u rasporedu i proverite današnji datum.')
  const main = data.groups.find(group => group.id === child.main_group_id && group.kind === 'main')
  const competition = data.groups.find(group => group.id === child.competition_group_id && group.kind === 'competition')
  if (!main || (!main.active && previous?.main_group_id !== main.id)) errors.push('Izaberite glavnu grupu odgovarajuće vrste.')
  if (child.competition_group_id !== null && (!competition || (!competition.active && previous?.competition_group_id !== competition.id))) errors.push('Izaberite takmičarsku grupu odgovarajuće vrste.')
  if (links.filter(link => link.is_primary).length !== 1) errors.push('Dete mora imati tačno jedan glavni kontakt.')
  if (new Set(links.map(link => link.contact_id)).size !== links.length) errors.push('Kontakt je dodat više puta.')
  if (links.some(link => link.child_id !== child.id || !link.relationship.trim() || !data.contacts.some(contact => contact.id === link.contact_id))) errors.push('Veza sa kontaktom nije ispravna.')
  if (data.assignments.some(assignment => assignment.child_id === child.id && !assignment.cancelled_at && (!today || !assignment.valid_to || assignment.valid_to >= today) && (child.status !== 'active' || data.terms.some(term => term.id === assignment.term_id && term.group_id !== child.main_group_id && term.group_id !== child.competition_group_id)))) errors.push('Najpre završite upise u termine prethodne grupe.')
  return errors
}

export function validateTerm(term: WeeklyTerm, assignments: TermAssignment[], data: ClubData): string[] {
  const errors: string[] = []
  const previous = data.terms.find(item => item.id === term.id)
  if (!uuid(term.id)) errors.push('Neispravan identifikator termina.')
  if (!Number.isInteger(term.weekday) || term.weekday < 1 || term.weekday > 7) errors.push('Dan mora biti između 1 i 7.')
  const start = term.starts_at === previous?.starts_at ? time(term.starts_at) : normalizeTermTime(term.starts_at), end = term.ends_at === previous?.ends_at ? time(term.ends_at) : normalizeTermTime(term.ends_at)
  if (!start || !end || start >= end) errors.push('Početak termina mora biti pre završetka.')
  if (!range(term.valid_from, term.valid_to)) errors.push('Period važenja termina nije ispravan.')
  if (!data.groups.some(group => group.id === term.group_id && (group.active || previous?.group_id === group.id))) errors.push('Izaberite postojeću aktivnu grupu.')
  if (term.trainer_id && !data.trainers.some(trainer => trainer.id === term.trainer_id && (trainer.active || previous?.trainer_id === trainer.id))) errors.push('Izaberite aktivnog trenera.')
  const retained = data.assignments.filter(old => old.term_id === term.id && !assignments.some(item => item.child_id === old.child_id && item.valid_from === old.valid_from))
  const effective = [...assignments.map(item => {
    const old = data.assignments.find(a => a.term_id === item.term_id && a.child_id === item.child_id && a.valid_from === item.valid_from)
    return old?.cancelled_at ? old : item
  }), ...retained]
  if (previous && data.assignments.some(item => item.term_id === term.id) && (previous.group_id !== term.group_id || previous.weekday !== term.weekday || time(previous.starts_at) !== start || time(previous.ends_at) !== end || previous.trainer_id !== term.trainer_id || previous.valid_from !== term.valid_from)) errors.push('Za promenu povezanog rasporeda napravite novi termin.')
  for (const [index, assignment] of effective.entries()) {
    const child = data.children.find(item => item.id === assignment.child_id)
    const old = data.assignments.find(item => item.term_id === term.id && item.child_id === assignment.child_id && item.valid_from === assignment.valid_from)
    if (assignment.term_id !== term.id) errors.push('Upis pripada drugom terminu.')
    if (old?.cancelled_at) continue
    if (!old && data.assignments.some(a => a.term_id === term.id && a.child_id === assignment.child_id && a.cancelled_at && assignment.valid_from <= belgradeBusinessDate(new Date(a.cancelled_at)))) errors.push('Ponovni upis mora početi posle datuma otkazivanja.')
    if (assignment.cancelled_at) errors.push('Otkazivanje upisa zahteva posebnu radnju.')
    const unchanged = old !== undefined && old.valid_to === assignment.valid_to
    const closing = old !== undefined && assignment.valid_to !== null && (old.valid_to === null || assignment.valid_to <= old.valid_to)
    if (old && ended(old.valid_to) && !unchanged) errors.push('Završeni upis se ne može menjati.')
    if (assignment.term_id !== term.id || !child || !range(assignment.valid_from, assignment.valid_to) || assignment.valid_from < term.valid_from || (term.valid_to !== null && (assignment.valid_to === null || assignment.valid_to > term.valid_to))) errors.push('Period upisa mora biti unutar perioda termina.')
    if (!unchanged && !closing && child && !allowsCompetitionEnrollment(child, data.groups.find(group => group.id === term.group_id))) errors.push('Upis u takmičarski termin zahteva takmičara.')
    if (!unchanged && !closing && (!term.active || !data.groups.some(group => group.id === term.group_id && group.active) || (Boolean(term.trainer_id) && !data.trainers.some(trainer => trainer.id === term.trainer_id && trainer.active)) || !child || child.status !== 'active' || (child.main_group_id !== term.group_id && child.competition_group_id !== term.group_id))) errors.push('Dete ne pripada grupi termina ili nije aktivno.')
    if (effective.slice(0, index).some(other => !other.cancelled_at && other.child_id === assignment.child_id && enrollmentPeriodsOverlap(other, assignment))) errors.push('Dete je već prijavljeno na ovaj termin u izabranom periodu.')
  }
  return errors
}


