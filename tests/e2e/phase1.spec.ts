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
