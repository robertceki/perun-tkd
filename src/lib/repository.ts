import type { SupabaseClient } from '@supabase/supabase-js'
import type { Child, ChildContact, ClubData, CompetitionClass, Contact, Group, TermAssignment, TrainingSession, SessionAttendance, WeightCategory, WeeklyTerm } from '../domain/types'
import { validateContact, validateGroup } from '../domain/validation'
import { supabase } from './supabase'

function check(errors: string[]) { if (errors.length) throw new Error(errors.join(' ')) }
export function createClubRepository(client: SupabaseClient) {
  async function rows<T>(table: string, order: string): Promise<T[]> {
    // Paginate explicitly: PostgREST's default row cap must not silently truncate club history.
    const result: T[] = []
    for (let offset = 0; ; offset += 500) {
      let query = client.from(table).select('*')
      for (const column of order.split(',')) query = query.order(column)
      const { data, error } = await query.range(offset, offset + 499)
      if (error) throw error
      result.push(...(data as T[]))
      if (data.length < 500) return result
    }
  }
  async function rpc(name: string, args: Record<string, unknown> = {}) {
    const { data, error } = await client.rpc(name, args)
    if (error) throw error
    return data
  }
  return {
    async load(): Promise<ClubData> {
      const [trainers, groups, contacts, children, childContacts, terms, assignments, sessions, attendance, weightCategories, competitionClasses] = await Promise.all([
        rows<ClubData['trainers'][number]>('trainers', 'id'), rows<Group>('groups', 'id'), rows<Contact>('contacts', 'id'), rows<Child>('children', 'id'),
        rows<ChildContact>('child_contacts', 'child_id,contact_id'), rows<WeeklyTerm>('weekly_terms', 'id'), rows<TermAssignment>('term_assignments', 'term_id,child_id,valid_from'),
        rows<TrainingSession>('training_sessions', 'id'), rows<SessionAttendance>('session_attendance', 'session_id,child_id'),
        rows<WeightCategory>('weight_categories', 'age_category,sex,sort_order,id'), rows<CompetitionClass>('competition_classes', 'id'),
      ])
      return { trainers, groups, contacts, children, childContacts, terms, assignments, sessions, attendance, weightCategories, competitionClasses }
    },
    async ensureSession(sessionDate: string, termId: string): Promise<TrainingSession> {
      return await rpc('ensure_session', { p_session_date: sessionDate, p_term_id: termId }) as TrainingSession
    },
    async setPresence(sessionId: string, childId: string, present: boolean): Promise<void> {
      await rpc('set_presence', { p_session_id: sessionId, p_child_id: childId, p_present: present })
    },
    async addSubstitute(sessionId: string, childId: string): Promise<void> {
      await rpc('add_substitute', { p_session_id: sessionId, p_child_id: childId })
    },
    async completeSession(sessionId: string): Promise<void> { await rpc('complete_session', { p_session_id: sessionId }) },
    async cancelSession(sessionId: string): Promise<void> { await rpc('cancel_session', { p_session_id: sessionId }) },
    async cancelEnrollment(termId: string, childId: string, validFrom: string): Promise<void> {
      await rpc('cancel_enrollment', { p_term_id: termId, p_child_id: childId, p_valid_from: validFrom })
    },
    async getServerTime(): Promise<string> { return await rpc('get_server_time') as string },
    async saveContact(contact: Contact): Promise<void> {
      check(validateContact(contact))
      const { error } = await client.from('contacts').upsert({ ...contact, first_name: contact.first_name.trim(), last_name: contact.last_name.trim(), phone: contact.phone.trim(), email: contact.email?.trim() || null, address: contact.address?.trim() || null })
      if (error) throw error
    },
    async saveGroup(group: Group): Promise<void> {
      check(validateGroup(group))
      const { error } = await client.from('groups').upsert({ ...group, name: group.name.trim() })
      if (error) throw error
    },
    async saveChild(child: Child, contacts: ChildContact[]): Promise<void> {
      const { error } = await client.rpc('save_child', { p_child: child, p_contacts: contacts })
      if (error) throw error
    },
    async saveTerm(term: Omit<WeeklyTerm, 'trainer_id'> & { trainer_id?: string }, assignments: TermAssignment[]): Promise<void> {
      const { error } = await client.rpc('save_term', { p_term: { ...term, trainer_id: term.trainer_id || undefined }, p_assignments: assignments })
      if (error) throw error
    },
  }
}
export const repository = supabase ? createClubRepository(supabase) : null




