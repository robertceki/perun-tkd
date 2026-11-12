import { describe, expect, it } from 'vitest'
import { getAgeCategory, matchingWeights } from './competitorProfile'
import type { Child, ClubData, WeightCategory } from './types'
import { validateChild, validateTerm } from './validation'

const today = '2026-01-01'
const legacy: Child = {
  id: '10000000-0000-4000-8000-000000000001', first_name: 'Ana', last_name: 'Test', birth_date: '2014-12-31',
  sex: null, member_type: 'recreational', status: 'active', address: '', belt: '',
  main_group_id: 'main', competition_group_id: 'competition',
}
const competitor: Child = { ...legacy, sex: 'F', member_type: 'competitor' }
const term = {
  id: '10000000-0000-4000-8000-000000000002', group_id: 'competition', weekday: 1, starts_at: '18:00', ends_at: '19:00',
  trainer_id: 'trainer', active: true, valid_from: today, valid_to: null,
}
const assignment = { term_id: term.id, child_id: legacy.id, valid_from: today, valid_to: null }
const weights: WeightCategory[] = [
  { id: 'female-plus', age_category: 'cadets', sex: 'F', signed_kg: 59, sort_order: 10 },
  { id: 'male', age_category: 'cadets', sex: 'M', signed_kg: -33, sort_order: 1 },
  { id: 'older', age_category: 'older_pioneers', sex: 'F', signed_kg: -27, sort_order: 1 },
  { id: 'female-minus', age_category: 'cadets', sex: 'F', signed_kg: -29, sort_order: 1 },
]
const links = [{ child_id: legacy.id, contact_id: 'parent', relationship: 'majka', is_primary: true }]
const data: ClubData = {
  trainers: [{ id: 'trainer', user_id: 'user', full_name: 'Trainer', active: true }],
  groups: [{ id: 'main', name: 'Main', kind: 'main', active: true },
    { id: 'competition', name: 'Competition', kind: 'competition', active: true }],
  contacts: [{ id: 'parent', first_name: 'Mira', last_name: 'Test', phone: '000', email: null, address: null }],
  children: [legacy], childContacts: links, terms: [term], assignments: [assignment],
  weightCategories: weights,
}

describe('competitor profiles', () => {
  it.each([
    [5, null], [6, 'rev_pioneers'], [7, 'rev_pioneers'],
    [8, 'younger_pioneers'], [9, 'younger_pioneers'],
    [10, 'older_pioneers'], [11, 'older_pioneers'], [12, 'cadets'], [14, 'cadets'],
    [15, 'juniors'], [17, 'juniors'], [18, 'seniors'], [40, 'seniors'],
  ])('classifies competition age %s on January 1', (age, category) => {
    expect(getAgeCategory(`${2026 - age}-12-31`, today)).toBe(category)
  })

  it('offers only the matching sex and age catalog in display order', () => {
    expect(matchingWeights(competitor, data, today).map(row => row.signed_kg)).toEqual([-29, 59])
    expect(matchingWeights({ ...competitor, sex: 'M' }, data, today).map(row => row.signed_kg)).toEqual([-33])
    expect(matchingWeights({ ...competitor, birth_date: '2015-01-01' }, data, today).map(row => row.signed_kg)).toEqual([-27])
    expect(matchingWeights(legacy, data, today)).toEqual([])
  })
})
it('permits optional competitor details and preserves a legacy competition group', () => {
  expect(validateChild(legacy, links, data, today)).toEqual([])
  expect(validateChild({ ...competitor, competition_class: null, weight_category_id: null }, links, data, today)).toEqual([])
  expect(validateChild(legacy, links, { ...data, children: [] }, today)).toContain('Takmičarska grupa zahteva takmičara.')
})

it('keeps an existing legacy enrollment but rejects a new competition enrollment', () => {
  expect(validateTerm(term, [assignment], data)).toEqual([])
  expect(validateTerm(term, [assignment], { ...data, assignments: [] })).toContain('Upis u takmičarski termin zahteva takmičara.')
})

it('blocks switching to recreational until the current competition enrollment ends', () => {
  const draft = { ...competitor, member_type: 'recreational' as const, competition_group_id: null }
  const enrolled = { ...data, children: [competitor] }
  expect(validateChild(draft, links, enrolled, today)).toContain('Najpre završite ili otkažite takmičarske upise u rasporedu i proverite današnji datum.')
  expect(validateChild(draft, links, { ...enrolled, assignments: [{ ...assignment, valid_from: '2025-12-01', valid_to: '2025-12-31' }] }, today)).toEqual([])
})

