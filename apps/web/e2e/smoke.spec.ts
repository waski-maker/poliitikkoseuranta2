import { expect, test } from '@playwright/test';

test('login, dashboard, parties, inline edit and command palette', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Kirjaudu sisään' })).toBeVisible();

  // Not on the allow-list → no access.
  await page.getByLabel('Sähköpostiosoite').fill('outsider@example.com');
  await page.getByRole('button', { name: /Kirjaudu/ }).click();
  await expect(page.getByRole('alert')).toContainText('sallittujen');

  await page.getByLabel('Sähköpostiosoite').fill('admin@example.com');
  await page.getByRole('button', { name: /Kirjaudu/ }).click();
  await expect(page.getByRole('heading', { name: 'Kojelauta' })).toBeVisible();
  await expect(page.getByText('Orpon hallitus')).toBeVisible();

  await page.getByRole('link', { name: 'Puolueet' }).first().click();
  await expect(page.getByRole('heading', { name: 'Puolueet' })).toBeVisible();
  await page.getByRole('link', { name: 'Vasemmistoliitto' }).click();
  await expect(page.getByRole('heading', { name: /Vasemmistoliitto/ })).toBeVisible();

  // Inline edit with auto-save and undo.
  await page.getByRole('button', { name: 'Muistiinpanot: muokkaa' }).click();
  const note = `Testimuistiinpano ${Date.now()}`;
  await page.getByLabel('Muistiinpanot').fill(note);
  await page.getByRole('heading', { name: 'Perustiedot' }).click();
  await expect(page.getByText('Muistiinpanot: tallennettu')).toBeVisible();
  await page.reload();
  await expect(page.getByText(note)).toBeVisible();

  // Command palette searches across modules.
  await page.keyboard.press('Control+k');
  await page.getByPlaceholder('Hae tai kirjoita komento…').fill('kokoomus');
  await expect(page.getByRole('option', { name: /Kansallinen Kokoomus/ })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: /Kansallinen Kokoomus/ })).toBeVisible();
});

test('admin pages render', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Sähköpostiosoite').fill('admin@example.com');
  await page.getByRole('button', { name: /Kirjaudu/ }).click();
  await expect(page.getByRole('heading', { name: 'Kojelauta' })).toBeVisible();
  for (const [path, heading] of [
    ['/yllapito/palvelut', 'Palvelut'],
    ['/yllapito/tekoaly', 'Tekoäly'],
    ['/yllapito/synkronoinnit', 'Synkronoinnit'],
    ['/yllapito/varmuuskopiot', 'Varmuuskopiot'],
    ['/yllapito/muutoshistoria', 'Muutoshistoria'],
    ['/yllapito/roskakori', 'Roskakori'],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
  }
});
