import { test as base, expect, type Page } from '@playwright/test'
import type { TrainingSession, SessionAttendance, Child, WeightCategory } from '../../src/domain/types'

export { expect }
export const today = '2026-07-06'
export const prior = '2026-06-29'
export const fixtureIds = {
  parent: '10000000-0000-4000-8000-000000000001',
  group: '10000000-0000-4000-8000-000000000002',
  ana: '10000000-0000-4000-8000-000000000003',
  iva: '10000000-0000-4000-8000-000000000004',
  future: '10000000-0000-4000-8000-000000000005',
  started: '10000000-0000-4000-8000-000000000006',
  early: '10000000-0000-4000-8000-000000000007',
  other: '10000000-0000-4000-8000-000000000008',
  trainer: '10000000-0000-4000-8000-000000000009',
  user: '10000000-0000-4000-8000-000000000010',
}

export function sessionId(termId: string, date: string) {
  return `20000000-0000-4000-8000-${termId.slice(-4)}${date.replace(/-/g, '')}`
}

const now = '2026-07-06T16:30:00Z'
const trainer = { id: fixtureIds.trainer, user_id: fixtureIds.user, full_name: 'Synthetic Trainer', active: true }
const actor = { created_by: trainer.id, updated_by: trainer.id, created_at: now, updated_at: now }
const child = (id: string, first_name: string): Child => ({ id, first_name, last_name: 'Test', birth_date: '2015-01-01',
  sex: null, member_type: 'recreational', status: 'active', main_group_id: fixtureIds.group, competition_group_id: null, address: '', belt: '' })
const term = (id: string, starts_at: string, weekday = 1) => ({ id, starts_at, weekday, ends_at: '21:00:00',
  group_id: fixtureIds.group, trainer_id: trainer.id, active: true, valid_from: '2026-01-01', valid_to: null })

type Call = { name: string; args: Record<string, unknown> }
const belgrade = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Belgrade', dateStyle: 'short', timeStyle: 'medium',
})

export const test = base.extend<{
  calls: Call[]
  initialTime: string
  anaMedicalExamDate: string | null
  boundaryTerm: { time: string; weekday: number } | null
  serverClock: { instant: string }
}>({
  initialTime: [now, { option: true }],
  anaMedicalExamDate: [null, { option: true }],
  boundaryTerm: [null, { option: true }],
  serverClock: async ({ initialTime }, use) => { await use({ instant: initialTime }) },
  serviceWorkers: 'block',
  timezoneId: 'Pacific/Honolulu',
  calls: async ({ page, context, baseURL, initialTime, anaMedicalExamDate, boundaryTerm, serverClock }, use) => {
    const calls: Call[] = []
    const unexpected: string[] = []
    const sessions: TrainingSession[] = []
    const attendance: SessionAttendance[] = []
    const terms = [term(fixtureIds.future, '20:00:00'), term(fixtureIds.started, '18:00:00'), term(fixtureIds.early, '17:00:00'), term(fixtureIds.other, '16:00:00', 2)]
    if (boundaryTerm) terms[1] = term(fixtureIds.started, boundaryTerm.time, boundaryTerm.weekday)
    const children: Child[] = [
      { ...child(fixtureIds.ana, 'Ana'), medical_exam_date: anaMedicalExamDate },
      { ...child(fixtureIds.iva, 'Iva'), medical_exam_date: null },
    ]
    const links = [{ child_id: fixtureIds.ana, contact_id: fixtureIds.parent, relationship: 'majka', is_primary: true }]
    const assignments = [{ term_id: fixtureIds.started, child_id: fixtureIds.ana, valid_from: '2026-01-01', valid_to: null, cancelled_at: null as string | null }]
    const groups = [{ id: fixtureIds.group, name: 'Pioniri', kind: 'main', active: true }]
    const contacts = [{ id: fixtureIds.parent, first_name: 'Mira', last_name: 'Test', phone: '000', email: null, address: null }]
    const weightCategories: WeightCategory[] = [
      { id: 'older_pioneers:F:-27', age_category: 'older_pioneers', sex: 'F', signed_kg: -27, sort_order: 1 },
      { id: 'cadets:F:-29', age_category: 'cadets', sex: 'F', signed_kg: -29, sort_order: 1 },
      { id: 'cadets:M:-33', age_category: 'cadets', sex: 'M', signed_kg: -33, sort_order: 1 },
    ]
    const tables = { weight_categories: weightCategories, competition_classes: [{ id: 'A' }, { id: 'B' }], trainers: [trainer], groups, contacts, children, child_contacts: links, weekly_terms: terms,
      term_assignments: assignments, training_sessions: sessions, session_attendance: attendance }
    const user = { id: trainer.user_id, aud: 'authenticated', role: 'authenticated', email: 'trainer@example.invalid',
      app_metadata: {}, user_metadata: {}, created_at: now }
    const expiresAt = Math.floor(Date.parse(initialTime) / 1000) + 86_400
    const token = Buffer.from(JSON.stringify({ sub: user.id, exp: expiresAt })).toString('base64url')
    const headers = { 'access-control-allow-origin': '*' }
    function add(id: string, childId: string, substitute: boolean) {
      const person = children.find(row => row.id === childId)
      if (person && !attendance.some(row => row.session_id === id && row.child_id === childId)) {
        attendance.push({ ...actor, session_id: id, child_id: childId, child_first_name: person.first_name,
          child_last_name: person.last_name, present: false, is_substitute: substitute })
      }
    }
    function upsert<T extends { id: string }>(rows: T[], value: T) {
      const index = rows.findIndex(row => row.id === value.id)
      if (index < 0) rows.push(value)
      else rows[index] = { ...rows[index], ...value }
    }
    await page.clock.setFixedTime(new Date(initialTime))
    await context.route('**/*', async route => {
      const request = route.request()
      const method = request.method()
      const url = new URL(request.url())
      const path = url.pathname
      const reply = (json: unknown, status = 200) => route.fulfill({ status, headers, json })
      const reject = () => { unexpected.push(`${method} ${path}`); return route.abort() }
      if (url.origin === new URL(baseURL!).origin && !/^\/(auth|rest|storage|functions|realtime)\/v1/.test(path)) return route.continue()
      if (url.origin !== 'https://tkd-r1.invalid') return reject()
      if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...headers,
        'access-control-allow-methods': 'GET, POST, OPTIONS',
        'access-control-allow-headers': request.headers()['access-control-request-headers'] ?? '*',
      } })
      if (path === '/auth/v1/token' && method === 'POST') return reply({
        access_token: `eyJhbGciOiJIUzI1NiJ9.${token}.synthetic`, refresh_token: 'synthetic',
        token_type: 'bearer', expires_at: expiresAt, expires_in: 3600, user,
      })
      if (path === '/auth/v1/user' && method === 'GET') return reply(user)
      const table = /^\/rest\/v1\/([^/]+)$/.exec(path)?.[1] as keyof typeof tables | undefined
      if (table && method === 'GET' && Object.prototype.hasOwnProperty.call(tables, table)) {
        const rows = tables[table]
        const filter = url.searchParams.get('session_id')
        return reply(filter && table === 'session_attendance' ? attendance.filter(row => `eq.${row.session_id}` === filter) : rows)
      }
      if ((table === 'groups' || table === 'contacts') && method === 'POST') {
        if (table === 'groups') upsert(groups, request.postDataJSON())
        else upsert(contacts, request.postDataJSON())
        return route.fulfill({ status: 201, headers })
      }
      const name = /^\/rest\/v1\/rpc\/([^/]+)$/.exec(path)?.[1]
      if (!name || method !== 'POST') return reject()
      const args = request.postDataJSON()
      const now = serverClock.instant
      const instant = Date.parse(now)
      const openingError = 'Evidencija prisustva se otvara 60 minuta pre zakazanog početka treninga.'
      calls.push({ name, args })
      if (name === 'get_server_time') return reply(now)
      if (name === 'ensure_session') {
        const schedule = terms.find(row => row.id === args.p_term_id)
        const date = args.p_session_date as string
        if (!schedule) return reply({ message: 'Termin ne postoji.' }, 400)
        // Modern Belgrade uses these two offsets. Prefer standard time on a repeated hour.
        const start = ['+01:00', '+02:00'].map(offset => Date.parse(`${date}T${schedule.starts_at}${offset}`))
          .find(candidate => belgrade.format(candidate) === `${date} ${schedule.starts_at}`)
        if (start === undefined) return reply({ message: 'Datum nije u rasporedu termina.' }, 400)
        const id = sessionId(schedule.id, date)
        const existing = sessions.find(row => row.id === id)
        if (existing) return reply(existing)
        if (instant < start - 3_600_000) return reply({ message: openingError }, 400)
        const row = { ...actor, id, term_id: schedule.id, session_date: date, group_id: schedule.group_id,
          group_name: groups.find(group => group.id === schedule.group_id)!.name, starts_at: schedule.starts_at,
          ends_at: schedule.ends_at, starts_at_utc: new Date(start).toISOString(), completed_at: null, cancelled_at: null }
        sessions.push(row)
        for (const entry of assignments) {
          if (entry.term_id === row.term_id && entry.valid_from <= date && (!entry.cancelled_at || entry.cancelled_at > row.starts_at_utc)) add(id, entry.child_id, false)
        }
        return reply(row)
      }
      if (name === 'save_child') {
        upsert(children, args.p_child)
        for (let i = links.length - 1; i >= 0; i--) if (links[i].child_id === args.p_child.id) links.splice(i, 1)
        links.push(...args.p_contacts)
        return reply(null)
      }
      if (name === 'save_term') {
        upsert(terms, { trainer_id: trainer.id, ...args.p_term })
        assignments.push(...args.p_assignments.filter((entry: typeof assignments[number]) => !assignments.some(row =>
          row.term_id === entry.term_id && row.child_id === entry.child_id && row.valid_from === entry.valid_from)))
        return reply(null)
      }
      if (name === 'cancel_enrollment') {
        const entry = assignments.find(row => row.term_id === args.p_term_id && row.child_id === args.p_child_id && row.valid_from === args.p_valid_from)
        if (!entry) return reply({ message: 'Upis ne postoji.' }, 400)
        entry.cancelled_at ??= now
        return reply(null)
      }
      if (['set_presence', 'add_substitute', 'complete_session', 'cancel_session'].includes(name)) {
        const row = sessions.find(value => value.id === args.p_session_id)
        if (!row || (row.cancelled_at && name !== 'cancel_session')) return reply({ message: 'Otkazan trening je zaključan.' }, 400)
        const start = Date.parse(row.starts_at_utc)
        if (name === 'cancel_session' && instant < start) return reply({ message: 'Trening još nije počeo.' }, 400)
        if (instant < start - 3_600_000) return reply({ message: openingError }, 400)
        if (name === 'add_substitute') add(row.id, args.p_child_id, true)
        if (name === 'complete_session') row.completed_at ??= now
        if (name === 'cancel_session') row.cancelled_at ??= now
        if (name === 'set_presence') {
          const entry = attendance.find(value => value.session_id === row.id && value.child_id === args.p_child_id)
          if (!entry || typeof args.p_present !== 'boolean') return reply({ message: 'Neispravno prisustvo.' }, 400)
          entry.present = args.p_present
        }
        return reply(null)
      }
      return reject()
    })
    await use(calls)
    expect(unexpected).toEqual([])
  },
})

export async function login(page: Page) {
  await page.goto('/')
  await page.getByLabel('Imejl', { exact: true }).fill('trainer@example.invalid')
  await page.getByLabel('Lozinka', { exact: true }).fill('synthetic-password')
  await page.getByRole('button', { name: 'Prijavi se' }).click()
  await expect(page.getByRole('button', { name: 'Odjavi se' })).toBeVisible()
}
