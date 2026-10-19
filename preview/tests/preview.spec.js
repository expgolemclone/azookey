import { readFileSync } from 'node:fs';
import { expect, test as base } from '@playwright/test';
import { actionsText, keyLabel, keyVariants, labelText } from '../src/layout.js';

const test = base.extend({
  page: async ({ page }, use) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (['error', 'warning'].includes(message.type())) errors.push(message.text());
    });
    await use(page);
    expect(errors).toEqual([]);
  },
});

for (const name of ['abc', 'kana', 'num']) {
  const layout = JSON.parse(readFileSync(new URL(`../../${name}.json`, import.meta.url), 'utf8'));

  test(`${name}: every source key, flick, and action is available without importing`, async ({ page }) => {
    const requests = [];
    page.on('request', (request) => requests.push({ method: request.method(), url: request.url() }));
    await page.goto('/');
    await page.getByRole('radiogroup', { name: 'レイアウト' }).getByText(name, { exact: true }).click();
    const grid = page.getByRole('table', { name: `${name}のキー配置`, exact: true });
    await expect(grid).toHaveCSS('table-layout', 'fixed');
    await expect(grid.getByRole('row')).toHaveCount(4);
    await expect(grid.getByRole('cell')).toHaveCount(19);
    await expect(grid.getByRole('button')).toHaveCount(19);
    await expect(page.getByText(`${name}.json`, { exact: true })).toBeVisible();
    await expect(page.getByText('5列 x 4行', { exact: true })).toBeVisible();

    for (const entry of layout.interface.keys) {
      const { x, y, width, height } = entry.specifier;
      const cell = grid.locator(`td[data-key-position="${x},${y}"]`);
      await expect(cell).toHaveAttribute('colspan', String(width));
      await expect(cell).toHaveAttribute('rowspan', String(height));
      for (const variant of keyVariants(entry).slice(1)) {
        await expect(cell.getByText(labelText(variant.key.design.label), { exact: true })).toBeVisible();
      }
      const button = cell.getByRole('button', { name: `${keyLabel(entry)}, x=${x}, y=${y}`, exact: true });
      await button.click();
      await expect(button).toHaveAttribute('aria-pressed', 'true');
      if (entry.key_type === 'system') {
        await expect(page.getByText('flick_kogaki', { exact: true })).toBeVisible();
        await expect(page.getByText(/JSONだけでは動作を特定できません/)).toBeVisible();
      } else {
        for (const { label, key } of keyVariants(entry)) {
          const control = page.getByRole('button', { name: `${label}: ${labelText(key.design.label)}`, exact: true });
          if (await control.getAttribute('aria-expanded') !== 'true') await control.click();
          const actions = page.getByRole('table', { name: `${label}の動作`, exact: true });
          for (const [gesture, value] of [
            ['タップ', key.press_actions],
            ['長押し開始', key.longpress_actions.start],
            ['長押し中の繰り返し', key.longpress_actions.repeat],
          ]) {
            const row = actions.getByRole('row').filter({ has: page.getByRole('cell', { name: gesture, exact: true }) });
            await expect(row.getByRole('cell').nth(1)).toHaveText(actionsText(value));
          }
        }
      }
    }

    const enter = grid.locator('td[data-key-position="4,2"]');
    const ordinary = grid.locator('td[data-key-position="3,2"]');
    const enterBox = await enter.boundingBox();
    const ordinaryBox = await ordinary.boundingBox();
    expect(enterBox.height).toBeGreaterThan(ordinaryBox.height * 1.5);
    const { origin } = new URL(page.url());
    expect(requests.every((request) => request.method === 'GET' && new URL(request.url).origin === origin)).toBe(true);
    await expect(page.locator('input[type="file"], textarea, [contenteditable="true"]')).toHaveCount(0);
  });
}

test('switching layouts clears selection and keeps compound labels intact', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'あ, x=1, y=0', exact: true }).click();
  await expect(page.getByRole('table', { name: '中央の動作', exact: true })).toContainText('input(text="ぁ")');
  const switcher = page.getByRole('radiogroup', { name: 'レイアウト' });
  await switcher.getByText('abc', { exact: true }).click();
  await expect(page.getByText('キー中央のボタンを選択してください.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'R, x=1, y=0', exact: true }).click();
  await expect(page.getByRole('button', { name: '中央: R', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'caps, x=1, y=3', exact: true }).click();
  await expect(page.getByRole('table', { name: '中央の動作', exact: true })).toContainText('toggle_caps_lock_state');
  await switcher.getByText('num', { exact: true }).click();
  await page.getByRole('button', { name: '←, x=0, y=0', exact: true }).click();
  await expect(page.getByRole('table', { name: '中央の動作', exact: true })).toContainText('長押し中の繰り返し');
});

test('keyboard controls work and narrow screens scroll without overflowing the page', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const key = page.getByRole('button', { name: 'あ, x=1, y=0', exact: true });
  await key.focus();
  await page.keyboard.press('Enter');
  await expect(key).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('table', { name: '中央の動作', exact: true })).toBeVisible();
  for (const [name, keyName] of [
    ['kana', 'あ, x=1, y=0'],
    ['abc', 'R, x=1, y=0'],
    ['num', '^_, x=1, y=3'],
  ]) {
    await page.getByRole('radiogroup', { name: 'レイアウト' }).getByText(name, { exact: true }).click();
    await page.getByRole('button', { name: keyName, exact: true }).click();
    const widths = await page.evaluate(() => ({
      content: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
    }));
    expect(widths.content, `${name} should not overflow`).toBeLessThanOrEqual(widths.viewport);
  }
});
