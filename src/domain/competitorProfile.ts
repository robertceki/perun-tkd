import type { AgeCategory, Child, ClubData, Group, MemberType } from './types'

export const memberTypeLabels: Record<MemberType, string> = {
  recreational: 'Rekreativac',
  competitor: 'Takmičar',
}

export const ageCategoryLabels: Record<AgeCategory, string> = {
  rev_pioneers: 'REV pioniri',
  younger_pioneers: 'Mlađi pioniri',
  older_pioneers: 'Stariji pioniri',
  cadets: 'Kadeti',
  juniors: 'Juniori',
  seniors: 'Seniori',
}

export function getAgeCategory(birthDate: string, today: string): AgeCategory | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate) || !today || birthDate > today) return null
  const age = Number(today.slice(0, 4)) - Number(birthDate.slice(0, 4))
  if (age >= 18) return 'seniors'
  if (age >= 15) return 'juniors'
  if (age >= 12) return 'cadets'
  if (age >= 10) return 'older_pioneers'
  if (age >= 8) return 'younger_pioneers'
  if (age >= 6) return 'rev_pioneers'
  return null
}

export function matchingWeights(child: Child, data: ClubData, today: string) {
  const category = getAgeCategory(child.birth_date, today)
  return (data.weightCategories ?? []).filter(weight => weight.age_category === category && weight.sex === child.sex)
    .sort((a, b) => a.sort_order - b.sort_order)
}

export function allowsCompetitionEnrollment(child: Child, group: Group | undefined) {
  return group?.kind !== 'competition' || child.member_type === 'competitor'
}

export function liveCompetitionAssignments(childId: string, data: ClubData, today: string) {
  return data.assignments.flatMap(assignment => {
    if (assignment.child_id !== childId || assignment.cancelled_at || (today && assignment.valid_to && assignment.valid_to < today)) return []
    const term = data.terms.find(item => item.id === assignment.term_id)
    const group = data.groups.find(item => item.id === term?.group_id)
    return term && group?.kind === 'competition' ? [{ assignment, term, group }] : []
  })
}
