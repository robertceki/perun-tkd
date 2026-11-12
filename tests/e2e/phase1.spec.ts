import { test, expect, login, fixtureIds } from './fixtures'

test('settings keeps core forms and reuses the existing sibling contact', async ({ page, calls }) => {
  await login(page)
  await page.getByRole('button', { name: 'Podešavanja', exact: true }).click()
  const button = (name: string | RegExp) => page.getByRole('button', { name, exact: typeof name === 'string' })
  const label = (name: string | RegExp) => page.getByLabel(name, { exact: typeof name === 'string' })
  await button('Roditelji/staratelji').click()
  await button(/Uredi kontakt Mira Test/i).click()
  await label('Telefon').fill('000123')
  await button('Sačuvaj').click()
  await expect(page.getByRole('row', { name: /Mira Test.*000123/ })).toBeVisible()

  await button('Grupe').click()
  await button(/Dodaj grupu/i).click()
  await label(/^Naziv(?: grupe)?$/).fill('Nova grupa')
  await button('Sačuvaj').click()
  await expect(page.getByRole('heading', { name: 'Nova grupa' })).toBeVisible()

  await button('Deca').click()
  await button(/Dodaj dete/i).click()
  await label('Ime deteta').fill('Lana')
  await label('Prezime deteta').fill('Test')
  await label('Datum rođenja').fill('2016-01-01')
  await label('Glavna grupa').selectOption({ label: 'Nova grupa' })
  if (!await label('Kontakt 1').isVisible()) await button(/Poveži postojeći kontakt/i).click()
  await label('Kontakt 1').selectOption(fixtureIds.parent)
  await label(/Odnos kontakta 1/).fill('majka')
  await button('Sačuvaj').click()
  await expect(page.getByRole('row', { name: /Lana Test.*Mira Test/ })).toBeVisible()
  expect(calls.find(call => call.name === 'save_child')?.args.p_contacts).toEqual([
    expect.objectContaining({ contact_id: fixtureIds.parent, is_primary: true }),
  ])

  await button('Raspored termina').click()
  await expect(button(/Dodaj termin/i)).toBeVisible()
  await expect(page.getByText(/odgovorni trener|created_by|updated_by/i)).toHaveCount(0)
})

test('child notes preserve multiple lines after reload and can be cleared', async ({ page, calls }) => {
  const button = (name: string) => page.getByRole('button', { name, exact: true })
  const label = (name: string) => page.getByLabel(name, { exact: true })
  const openChildren = async () => {
    await button('Podešavanja').click()
    await button('Deca').click()
  }
  const edit = button('Uredi dete Lana Test')
  const notes = label('Napomene')
  const multiline = 'Poneti opremu.\nKontaktirati roditelja posle treninga.'
  const save = async () => {
    await button('Sačuvaj').click()
    await expect(notes).toBeHidden()
  }

  await login(page)
  await openChildren()
  await button('Dodaj dete').click()
  await label('Ime deteta').fill('Lana')
  await label('Prezime deteta').fill('Test')
  await label('Datum rođenja').fill('2016-01-01')
  await label('Glavna grupa').selectOption(fixtureIds.group)
  await button('Poveži postojeći kontakt').click()
  await label('Kontakt 1').selectOption(fixtureIds.parent)
  await label('Odnos kontakta 1 sa detetom').fill('majka')
  await expect(notes).toHaveValue('')
  await save()

  await edit.click()
  await expect(notes).toHaveValue('')
  await notes.fill(multiline)
  await save()
  await page.reload()
  await openChildren()
  await edit.click()
  await expect(notes).toHaveValue(multiline)

  await notes.fill('')
  await save()
  await page.reload()
  await openChildren()
  await edit.click()
  await expect(notes).toHaveValue('')
  expect(calls.filter(call => call.name === 'save_child').map(call => call.args.p_child))
    .toEqual([null, multiline, null].map(value => expect.objectContaining({ notes: value })))
})

test('mocked login survives a browser reload', async ({ page, calls }) => {
  await login(page)
  await page.reload()
  await expect(page.getByRole('button', { name: 'Odjavi se' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: /glavna navigacija/i })).toBeVisible()
  expect(calls.filter(call => call.name === 'ensure_session')).toEqual([])
})


test('an existing enrollment blocks a duplicate for the same period', async ({ page, calls }) => {
  await login(page)
  await page.getByRole('button', { name: 'Podešavanja', exact: true }).click()
  await page.getByRole('button', { name: 'Raspored termina', exact: true }).click()
  await page.getByRole('button', { name: 'Uredi termin Ponedeljak 18:00' }).click()
  await page.getByRole('button', { name: 'Dodaj upis' }).click()

  const child = page.getByLabel('Dete za upis 2', { exact: true })
  await expect(child.getByRole('option', { name: 'Ana Test — već prijavljeno' })).toBeDisabled()
  await expect(child.getByRole('option', { name: 'Iva Test' })).toBeEnabled()
  await page.getByLabel('Upis 1 do (prazno: bez završetka)', { exact: true }).fill('2099-01-01')
  const start = page.getByLabel('Upis 2 od', { exact: true })
  await start.fill('2099-01-01')
  await expect(child.getByRole('option', { name: 'Ana Test — već prijavljeno' })).toBeDisabled()
  await start.fill('2099-01-02')
  await child.selectOption(fixtureIds.ana)
  await start.fill('2098-12-31')
  await expect(page.getByRole('alert').filter({ hasText: 'Dete je već prijavljeno' })).toBeVisible()
  await page.getByRole('button', { name: 'Sačuvaj', exact: true }).click()
  expect(calls.filter(call => call.name === 'save_term')).toHaveLength(0)

  await start.fill('2099-01-02')
  await page.getByRole('button', { name: 'Sačuvaj', exact: true }).click()
  await expect.poll(() => calls.filter(call => call.name === 'save_term')).toHaveLength(1)
  expect(calls.find(call => call.name === 'save_term')?.args.p_assignments).toEqual(expect.arrayContaining([
    expect.objectContaining({ child_id: fixtureIds.ana, valid_to: '2099-01-01' }),
    expect.objectContaining({ child_id: fixtureIds.ana, valid_from: '2099-01-02' }),
  ]))
})

test('medical exam date rejects future input, persists, filters, and clears', async ({ page, calls }) => {
  const button = (name: string) => page.getByRole('button', { name, exact: true })
  const openChildren = async () => {
    await button('Podešavanja').click()
    await button('Deca').click()
  }
  const date = page.getByLabel('Datum lekarskog pregleda', { exact: true })
  const edit = button('Uredi dete Ana Test')
  const clear = button('Obriši datum lekarskog pregleda')
  const save = button('Sačuvaj')
  const filter = page.getByLabel('Filter lekarskog pregleda', { exact: true })
  const writes = () => calls.filter(call => call.name === 'save_child').map(call => call.args.p_child)

  await login(page)
  await openChildren()
  await edit.click()
  await expect(date).toHaveValue('')
  await expect(date).toHaveAttribute('max', '2026-07-06')
  await date.fill('2026-07-07')
  await save.click()
  await expect(date).toBeVisible()
  expect(await date.evaluate((input: HTMLInputElement) => input.validity.rangeOverflow)).toBe(true)
  expect(writes()).toEqual([])

  await date.fill('2026-01-20')
  await save.click()
  await expect(date).toBeHidden()
  await page.reload()
  await openChildren()
  await expect(button('Uredi dete Iva Test')).toBeVisible()
  await filter.selectOption({ label: 'Ističe uskoro ili je istekao' })
  await expect(edit).toBeVisible()
  await expect(page.getByText('Lekarski pregled ističe za 14 dana', { exact: true })).toBeVisible()
  await expect(button('Uredi dete Iva Test')).toHaveCount(0)

  await edit.click()
  await expect(date).toHaveValue('2026-01-20')
  await clear.click()
  await expect(date).toHaveValue('')
  await save.click()
  await expect(edit).toHaveCount(0)
  await expect(page.getByRole('status').filter({ hasText: 'Nema dece koja odgovaraju izabranim filterima.' })).toBeVisible()
  await page.reload()
  await openChildren()
  await edit.click()
  await expect(date).toHaveValue('')
  expect(writes()).toEqual(['2026-01-20', null].map(value => expect.objectContaining({
    id: fixtureIds.ana, medical_exam_date: value,
  })))
})

for (const [examDate, warning] of [
  ['2026-01-05', 'Lekarski pregled je istekao 05.07.2026.'],
  ['2026-01-21', 'Lekarski pregled važi do 21.07.2026.'],
] as const) {
  test.describe(`children with an exam on ${examDate}`, () => {
    test.use({ anaMedicalExamDate: examDate })

    test('shows the exact expiry date', async ({ page, calls }) => {
      await login(page)
      await page.getByRole('button', { name: 'Podešavanja', exact: true }).click()
      await page.getByRole('button', { name: 'Deca', exact: true }).click()
      await expect(page.getByText(warning, { exact: true })).toBeVisible()
      expect(calls.filter(call => call.name === 'save_child')).toEqual([])
    })
  })
}
