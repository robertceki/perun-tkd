import { expect, test } from 'vitest'
import type { Child, ClubData, TermAssignment } from './types'
import { validateChild } from './validation'

test('only a live enrollment blocks moving or deactivating a child', () => {
  const child: Child = {
    id: '00000000-0000-4000-8000-000000000001', first_name: 'Ana', last_name: 'Test',
    birth_date: '2015-02-01', sex: 'F', address: '', belt: '', status: 'active',
    main_group_id: 'original', competition_group_id: null,
  }
  const assignment: TermAssignment = { term_id: 'term', child_id: child.id, valid_from: '2099-01-01', valid_to: null }
  const links = [{ child_id: child.id, contact_id: 'parent', relationship: 'roditelj', is_primary: true }]
  const data: ClubData = {
    trainers: [], children: [child], childContacts: links,
    contacts: [{ id: 'parent', first_name: 'Mira', last_name: 'Test', phone: '000', email: null, address: null }],
    groups: ['original', 'other'].map(id => ({ id, name: id, kind: 'main', active: true })),
    terms: [{ id: 'term', group_id: 'original', weekday: 1, starts_at: '18:00:00', ends_at: '19:00:00', trainer_id: '', valid_from: '2026-01-01', valid_to: null, active: true }],
    assignments: [assignment],
  }
  const cancelled = { ...data, assignments: [{ ...assignment, cancelled_at: '2026-07-06T18:00:00Z' }] }
  for (const changed of [{ ...child, main_group_id: 'other' }, { ...child, status: 'inactive' as const }]) {
    expect(validateChild(changed, links, data)).toEqual([expect.stringMatching(/Najpre završite upise/)])
    expect(validateChild(changed, links, cancelled)).toEqual([])
  }
})
