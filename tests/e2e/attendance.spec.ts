import type { Locator, Page } from '@playwright/test'
import { test, expect, login, today, prior, fixtureIds, sessionId } from './fixtures'

function openTime(scope: Page | Locator, time: string) {
  const name = new RegExp(time)
  return scope.getByRole('button', { name }).or(scope.getByRole('link', { name }))
}

test('home lists today in order and keeps attendance isolated across dates', async ({ page, calls }) => {
  await login(page)
  const navigation = page.getByRole('navigation', { name: /glavna navigacija/i })
  for (const name of ['Početna', 'Termini', 'Podešavanja']) {
    await expect(navigation.getByRole('button', { name, exact: true })).toBeVisible()
  }
  const main = page.getByRole('main')
  await expect(main.getByText(/16:00/).filter({ visible: true })).toHaveCount(0)
  await expect(main.getByText(/(?:17|18|20):00:00/).filter({ visible: true })).toHaveCount(0)
  for (const time of ['17:00', '18:00', '20:00']) await expect(openTime(main, time)).toBeVisible()
  const times = main.getByRole('button', { name: /(?:17|18|20):00/ })
    .or(main.getByRole('link', { name: /(?:17|18|20):00/ }))
  await expect(times).toHaveText([/17:00/, /18:00/, /20:00/])
  await openTime(main, '18:00').click()
  const presence = page.getByRole('checkbox', { name: /Ana Test/i })
  await expect(presence).toBeVisible()
  await expect(presence).not.toBeChecked()
  await presence.check()
  await expect(presence).toBeChecked()
  await presence.uncheck()
  await expect(presence).not.toBeChecked()
  await presence.check()

  const select = page.getByRole('combobox', { name: /zamen/i })
  await select.selectOption({ label: 'Iva Test' })
  await page.getByRole('button', { name: /Dodaj zamenu/i }).click()
  const substitute = page.getByRole('checkbox', { name: /Iva Test/i })
  await expect(substitute).toHaveCount(1)
  await expect(substitute).not.toBeChecked()
  await expect(select.getByRole('option', { name: 'Iva Test' })).toHaveCount(0)
  await page.getByRole('button', { name: /Završi (prozivku|trening)/i }).click()
  await expect.poll(() => calls.filter(call => call.name === 'complete_session')).toHaveLength(1)
  await expect(main.getByText(/odgovorni trener|created_by|updated_by|poslednja izmena/i).filter({ visible: true })).toHaveCount(0)
  await page.reload()
  if (!await presence.isVisible()) await openTime(main, '18:00').click()
  await expect(presence).toBeChecked()
  await expect(substitute).toHaveCount(1)
  await substitute.check()
  await expect(substitute).toBeChecked()

  await navigation.getByRole('button', { name: 'Termini', exact: true }).click()
  await page.getByLabel(/^(?:Izaberite |Izabrani )?datum$/i).filter({ visible: true }).fill(prior)
  await openTime(main, '18:00').click()
  await expect(presence).toBeVisible()
  await expect(presence).not.toBeChecked()
  await expect(substitute).toHaveCount(0)
  expect(calls.filter(call => call.name === 'ensure_session').map(call => call.args)).toEqual(expect.arrayContaining([
    { p_session_date: today, p_term_id: fixtureIds.started }, { p_session_date: prior, p_term_id: fixtureIds.started },
  ]))
  expect(calls.filter(call => call.name === 'set_presence').map(call => call.args)).toEqual([
    { p_session_id: sessionId(fixtureIds.started, today), p_child_id: fixtureIds.ana, p_present: true },
    { p_session_id: sessionId(fixtureIds.started, today), p_child_id: fixtureIds.ana, p_present: false },
    { p_session_id: sessionId(fixtureIds.started, today), p_child_id: fixtureIds.ana, p_present: true },
    { p_session_id: sessionId(fixtureIds.started, today), p_child_id: fixtureIds.iva, p_present: true },
  ])
})

test('future preview and cancelled attendance are read-only', async ({ page, calls }) => {
  await login(page)
  const main = page.getByRole('main')
  await openTime(main, '20:00').click()
  await expect(main.getByText(/Prozivka se otvara u 19:00/)).toBeVisible()
  await expect(main.getByRole('checkbox')).toHaveCount(0)
  expect(calls.filter(call => call.name !== 'get_server_time')).toEqual([])

  const home = page.getByRole('navigation').getByRole('button', { name: 'Početna' })
  await home.click()
  await openTime(main, '18:00').click()
  page.on('dialog', dialog => dialog.accept())
  await main.getByRole('button', { name: /Otkaži (trening|termin)/i }).click()
  await expect(main.getByText(/otkazan/i).first()).toBeVisible()
  const enabledControls = main.getByRole('checkbox', { disabled: false })
    .or(main.getByRole('button', { name: /Dodaj zamenu|Završi (prozivku|trening)/i, disabled: false }))
  await expect(enabledControls).toHaveCount(0)
  expect(calls.filter(call => call.name !== 'get_server_time')).toEqual([
    { name: 'ensure_session', args: { p_session_date: today, p_term_id: fixtureIds.started } },
    { name: 'cancel_session', args: { p_session_id: sessionId(fixtureIds.started, today) } },
  ])
})


for (const scenario of [
  { label: 'ordinary evening', date: today, time: '18:00:00', weekday: 1, before: '2026-07-06T14:59:00Z', opening: '2026-07-06T15:00:00Z', local: '17:00', openingDate: '6.7.26.' },
  { label: 'across Belgrade midnight', date: today, time: '00:30:00', weekday: 1, before: '2026-07-05T21:29:00Z', opening: '2026-07-05T21:30:00Z', local: '23:30', openingDate: '5.7.26.' },
  { label: 'across the Belgrade spring DST jump', date: '2026-03-29', time: '03:30:00', weekday: 7, before: '2026-03-29T00:29:00Z', opening: '2026-03-29T00:30:00Z', local: '01:30', openingDate: '29.3.26.' },
]) {
  test.describe(scenario.label, () => {
    test.use({ initialTime: scenario.before, boundaryTerm: { time: scenario.time, weekday: scenario.weekday } })

    test('opens at the inclusive cutoff on the same page', async ({ page, calls, serverClock }) => {
      const before = new Date(scenario.before)
      await page.clock.install({ time: new Date(before.getTime() - 1000) })
      await login(page)
      const main = page.getByRole('main')
      await page.getByRole('navigation').getByRole('button', { name: 'Termini', exact: true }).click()
      await page.getByLabel(/^(?:Izaberite |Izabrani )?datum$/i).filter({ visible: true }).fill(scenario.date)
      await openTime(main, scenario.time.slice(0, 5)).click()
      await expect(main.getByText(`Prozivka se otvara u ${scenario.local} (${scenario.openingDate}).`)).toBeVisible()
      await expect(main.getByText('Ana Test', { exact: true }).filter({ visible: true })).toBeVisible()
      await expect(main.getByRole('checkbox')).toHaveCount(0)
      expect(calls.filter(call => call.name !== 'get_server_time')).toEqual([])

      serverClock.instant = scenario.opening
      await page.clock.runFor(60_000)
      const presence = main.getByRole('checkbox', { name: /Ana Test/ })
      await expect(presence).toBeEnabled()
      await expect(main.getByRole('button', { name: 'Otkaži trening' })).toHaveCount(0)
      expect(calls.filter(call => call.name === 'ensure_session')).toEqual([
        { name: 'ensure_session', args: { p_session_date: scenario.date, p_term_id: fixtureIds.started } },
      ])
    })
  })
}

test.describe('after opening and before start', () => {
  test.use({ initialTime: '2026-07-06T15:30:00Z' })

  test('saves attendance, adds a substitute and completes roll call', async ({ page, calls }) => {
    await login(page)
    const main = page.getByRole('main')
    await openTime(main, '18:00').click()
    await main.getByRole('checkbox', { name: /Ana Test/ }).check()
    await main.getByRole('combobox', { name: /zamen/i }).selectOption({ label: 'Iva Test' })
    await main.getByRole('button', { name: 'Dodaj zamenu' }).click()
    await expect(main.getByRole('checkbox', { name: /Iva Test/ })).toBeEnabled()
    await main.getByRole('button', { name: 'Završi prozivku' }).click()
    await expect(main.getByText('Prozivka je završena.')).toBeVisible()
    await expect(main.getByRole('button', { name: 'Otkaži trening' })).toHaveCount(0)
    expect(calls.filter(call => call.name !== 'get_server_time').map(call => call.name))
      .toEqual(['ensure_session', 'set_presence', 'add_substitute', 'complete_session'])
  })
})
