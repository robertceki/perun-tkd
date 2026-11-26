import { allowsCompetitionEnrollment } from './competitorProfile'
import type { ClubData } from './types'

export function groupRoster(data: ClubData, groupId: string) {
  const group = data.groups.find(item => item.id === groupId)
  if (!group) return []
  return data.children.filter(child => child.status === 'active' &&
    (child.main_group_id === group.id || child.competition_group_id === group.id) &&
    allowsCompetitionEnrollment(child, group))
}

export function plannedRoster(data: ClubData, term: { termId: string; date: string; startsAt: number }, today: string) {
  const childIds = new Set(data.assignments.filter(entry =>
    entry.term_id === term.termId && entry.valid_from <= term.date &&
    (!entry.valid_to || entry.valid_to >= term.date) &&
    (!entry.cancelled_at || Date.parse(entry.cancelled_at) > term.startsAt)
  ).map(entry => entry.child_id))
  const schedule = data.terms.find(item => item.id === term.termId)
  if (schedule && today && term.date >= today) {
    for (const child of groupRoster(data, schedule.group_id)) childIds.add(child.id)
  }
  return data.children.filter(child => childIds.has(child.id))
}
