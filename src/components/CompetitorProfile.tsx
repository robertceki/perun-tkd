import type { Child, ClubData, MemberType } from '../domain/types'
import { ageCategoryLabels, getAgeCategory, liveCompetitionAssignments, matchingWeights, memberTypeLabels } from '../domain/competitorProfile'
import { formatTime } from '../domain/validation'
import { Field, SelectField } from './Feedback'

const weekdays = ['Ponedeljak', 'Utorak', 'Sreda', 'Četvrtak', 'Petak', 'Subota', 'Nedelja']

export function CompetitorProfile({ child, previous, data, today, change, openSchedule }: {
  child: Child; previous?: Child; data: ClubData; today: string
  change: (child: Child) => void; openSchedule: () => void
}) {
  const competitor = child.member_type === 'competitor'
  const category = getAgeCategory(child.birth_date, today)
  const weights = matchingWeights(child, data, today)
  const stale = !!today && !!child.weight_category_id && !weights.some(weight => weight.id === child.weight_category_id)
  const grandfathered = !competitor && !!child.competition_group_id
  const removingCompetition = !competitor && previous?.member_type === 'competitor'
  const blocking = liveCompetitionAssignments(child.id, data, today)

  function updateWeightInputs(next: Child) {
    if (next.weight_category_id && !matchingWeights(next, data, today).some(weight => weight.id === next.weight_category_id)) {
      next.weight_category_id = null
    }
    change(next)
  }

  function changeType(memberType: MemberType) {
    if (memberType === 'competitor') {
      change({ ...child, member_type: memberType, competition_group_id: child.competition_group_id ?? previous?.competition_group_id ?? null })
      return
    }
    change({
      ...child, member_type: memberType,
      competition_group_id: previous?.member_type === 'competitor' ? null : previous?.competition_group_id ?? null,
      competition_class: null, weight_category_id: null,
    })
  }

  return <>
    <Field label="Datum rođenja" type="date" required value={child.birth_date} onChange={e => updateWeightInputs({ ...child, birth_date: e.target.value })} />
    <SelectField label="Pol" autoComplete="sex" required value={child.sex ?? ''} onChange={e => updateWeightInputs({ ...child, sex: (e.target.value || null) as Child['sex'] })}>
      <option value="">Izaberite pol</option><option value="M">Muški</option><option value="F">Ženski</option>
    </SelectField>
    <SelectField label="Tip člana" required value={child.member_type ?? ''} onChange={e => changeType(e.target.value as MemberType)}>
      <option value="" disabled>Izaberite tip člana</option>
      <option value="recreational">{memberTypeLabels.recreational}</option>
      <option value="competitor">{memberTypeLabels.competitor}</option>
    </SelectField>
    <p>Uzrasna kategorija: {category ? ageCategoryLabels[category] : '—'}</p>
    {competitor && <>
      <SelectField label="Takmičarska grupa (opciono)" value={child.competition_group_id ?? ''} onChange={e => change({ ...child, competition_group_id: e.target.value || null })}>
        <option value="">Bez takmičarske grupe</option>
        {data.groups.filter(group => group.kind === 'competition' && (group.active || group.id === previous?.competition_group_id))
          .map(group => <option key={group.id} value={group.id}>{group.name}{!group.active ? ' (neaktivna)' : ''}</option>)}
      </SelectField>
      <SelectField label="Takmičarska klasa (opciono)" value={child.competition_class ?? ''} onChange={e => change({ ...child, competition_class: (e.target.value || null) as Child['competition_class'] })}>
        <option value="">Bez klase</option>
        {data.competitionClasses?.map(item => <option key={item.id} value={item.id}>{item.id}</option>)}
      </SelectField>
      <SelectField label="Težinska kategorija (opciono)" disabled={!today} value={child.weight_category_id ?? ''} onChange={e => change({ ...child, weight_category_id: e.target.value || null })}>
        <option value="">Bez težinske kategorije</option>
        {child.weight_category_id && (stale || !today) && <option value={child.weight_category_id} disabled>{stale ? 'Zastarela kategorija – izaberite ponovo' : 'Sačuvana kategorija'}</option>}
        {weights.map(weight => <option key={weight.id} value={weight.id}>{weight.signed_kg > 0 ? '+' : ''}{weight.signed_kg} kg</option>)}
      </SelectField>
    </>}
    {(grandfathered || (removingCompetition && (!today || blocking.length > 0))) && <div className="alert alert-warning">
      {grandfathered && <p>Rekreativac ima ranije dodeljenu takmičarsku grupu: {data.groups.find(group => group.id === child.competition_group_id)?.name}.</p>}
      {!!blocking.length && <><p>Završite ili otkažite sledeće takmičarske upise u rasporedu pre uklanjanja grupe:</p>
        <ul>{blocking.map(({ assignment, term, group }) => <li key={term.id + assignment.valid_from}>
          {group.name}, {weekdays[term.weekday - 1]} {formatTime(term.starts_at)}–{formatTime(term.ends_at)}, {assignment.valid_from} – {assignment.valid_to ?? 'bez završetka'}
        </li>)}</ul>
        <button type="button" className="btn btn-link" onClick={openSchedule}>Otvori raspored</button>
      </>}
      {!today && <p>Sačekajte potvrdu današnjeg datuma.</p>}
      {grandfathered && <button type="button" className="btn btn-outline-secondary" disabled={!today || !!blocking.length} onClick={() => change({ ...child, competition_group_id: null })}>Ukloni takmičarsku grupu</button>}
    </div>}
  </>
}
