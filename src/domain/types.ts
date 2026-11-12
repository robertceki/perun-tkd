export interface Trainer { id: string; user_id: string; full_name: string; active: boolean }
export interface Group { id: string; name: string; kind: 'main' | 'competition'; active: boolean }
export interface Contact { id: string; first_name: string; last_name: string; phone: string; email: string | null; address: string | null }
export type Sex = 'M' | 'F'
export type MemberType = 'recreational' | 'competitor'
export type CompetitionClassId = 'A' | 'B'
export type AgeCategory = 'rev_pioneers' | 'younger_pioneers' | 'older_pioneers' | 'cadets' | 'juniors' | 'seniors'
export interface CompetitionClass { id: CompetitionClassId }
export interface WeightCategory { id: string; age_category: AgeCategory; sex: Sex; signed_kg: number; sort_order: number }
export interface Child { id: string; first_name: string; last_name: string; birth_date: string; address: string; belt: string; status: 'active' | 'inactive'; main_group_id: string; competition_group_id: string | null; notes?: string | null; medical_exam_date?: string | null; sex?: Sex | null; member_type?: MemberType; competition_class?: CompetitionClassId | null; weight_category_id?: string | null }
export interface ChildContact { child_id: string; contact_id: string; relationship: string; is_primary: boolean }
export interface WeeklyTerm { id: string; group_id: string; weekday: number; starts_at: string; ends_at: string; trainer_id: string; valid_from: string; valid_to: string | null; active: boolean; created_by?: string | null; updated_by?: string | null; created_at?: string | null; updated_at?: string | null }
export interface TermAssignment { term_id: string; child_id: string; valid_from: string; valid_to: string | null; cancelled_at?: string | null }
export interface TrainingSession { id: string; term_id: string; session_date: string; group_id: string; group_name: string; starts_at: string; ends_at: string; starts_at_utc: string; completed_at: string | null; cancelled_at: string | null; created_by: string; updated_by: string; created_at: string; updated_at: string }
export interface SessionAttendance { session_id: string; child_id: string; child_first_name: string; child_last_name: string; present: boolean; is_substitute: boolean; created_by: string; updated_by: string; created_at: string; updated_at: string }
// Optional collections support legacy fixtures. The repository supplies all collections.
export interface ClubData { trainers: Trainer[]; groups: Group[]; contacts: Contact[]; children: Child[]; childContacts: ChildContact[]; terms: WeeklyTerm[]; assignments: TermAssignment[]; sessions?: TrainingSession[]; attendance?: SessionAttendance[]; weightCategories?: WeightCategory[]; competitionClasses?: CompetitionClass[] }
