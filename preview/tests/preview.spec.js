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

async function expectKeyLabelsToFit(grid) {
  const clipped = await grid.locator('.mantine-Button-label').evaluateAll((labels) => labels
    .filter((label) => label.scrollWidth > label.clientWidth || label.scrollHeight > label.clientHeight)
    .map((label) => label.textContent));
  expect(clipped).toEqual([]);
}

for (const colorScheme of ['light', 'dark']) {
  test(`preview stays dark and readable with a ${colorScheme} system theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.addInitScript(() => localStorage.setItem('mantine-color-scheme-value', 'light'));
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-mantine-color-scheme', 'dark');
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(36, 36, 36)');
    await expect(page.locator('body')).toHaveCSS('color-scheme', 'dark');

    for (const name of ['eng', 'ja', 'num']) {
      await page.getByRole('radiogroup', { name: 'Layout' }).getByText(name, { exact: true }).click();
      const grid = page.getByRole('table', { name: `${name} key layout`, exact: true });
      for (const position of ['1,0', '4,0']) {
        await grid.locator(`td[data-key-position="${position}"]`).getByRole('button').click();
        await expect(page.getByRole('table', { name: 'Center actions', exact: true })).toBeVisible();
        const unreadable = await page.locator('.mantine-Text-root, .mantine-Button-label, .mantine-Code-root')
          .evaluateAll((elements) => {
            const channels = (color) => color.match(/[\d.]+/g).map(Number);
            const luminance = (rgb) => rgb.reduce((total, channel, index) => {
              const value = channel / 255;
              return total + (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
                * [0.2126, 0.7152, 0.0722][index];
            }, 0);
            return elements.filter((element) => element.checkVisibility() && element.textContent.trim())
              .map((element) => {
                const ancestors = [];
                for (let parent = element; parent; parent = parent.parentElement) ancestors.unshift(parent);
                let background = [0, 0, 0];
                for (const ancestor of ancestors) {
                  const [r, g, b, alpha = 1] = channels(getComputedStyle(ancestor).backgroundColor);
                  background = background.map((value, index) => [r, g, b][index] * alpha + value * (1 - alpha));
                }
                const [r, g, b, alpha = 1] = channels(getComputedStyle(element).color);
                const foreground = background.map((value, index) => [r, g, b][index] * alpha + value * (1 - alpha));
                const light = luminance(foreground);
                const dark = luminance(background);
                return {
                  text: element.textContent,
                  contrast: (Math.max(light, dark) + 0.05) / (Math.min(light, dark) + 0.05),
                };
              }).filter(({ contrast }) => contrast < 4.5);
          });
        expect(unreadable, `${name} text should meet WCAG AA contrast`).toEqual([]);
      }
    }
  });
}

test('preview controls use English while kana labels and actions stay Japanese', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('azooKey Keyboard Preview');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('heading', { name: 'Keyboard preview', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Selected key', exact: true })).toBeVisible();
  await expect(page.getByText('Read-only', { exact: true })).toBeVisible();
  const grid = page.getByRole('table', { name: 'ja key layout', exact: true });
  for (const label of ['Space', 'ENTER', 'Delete', 'Small/Voiced', 'あ']) {
    await expect(grid.getByRole('button', { name: `${label}, x=`, exact: false })).toHaveText(label);
  }
  await expect(grid.locator('td[data-key-position="0,0"]').getByText('Layout', { exact: true })).toBeVisible();
  await grid.getByRole('button', { name: 'Space, x=4, y=1', exact: true }).click();
  const actions = page.getByRole('table', { name: 'Center actions', exact: true });
  await expect(actions.getByRole('columnheader')).toHaveText(['Gesture', 'Actions']);
  await expect(actions.getByRole('cell')).toHaveText([
    'Tap', 'input(text=" ")',
  ]);
  await grid.getByRole('button', { name: 'あ, x=1, y=0', exact: true }).click();
  await expect(actions.getByRole('cell')).toHaveText(['Tap', 'input(text="あ")']);
});

for (const name of ['eng', 'ja', 'num']) {
  const layout = JSON.parse(readFileSync(new URL(`../../${name}.json`, import.meta.url), 'utf8'));

  test(`${name}: every source key, flick, and action is available without importing`, async ({ page }) => {
    const requests = [];
    page.on('request', (request) => requests.push({ method: request.method(), url: request.url() }));
    await page.goto('/');
    await page.getByRole('radiogroup', { name: 'Layout' }).getByText(name, { exact: true }).click();
    const grid = page.getByRole('table', { name: `${name} key layout`, exact: true });
    await expect(grid).toHaveCSS('table-layout', 'fixed');
    await expect(grid.getByRole('row')).toHaveCount(4);
    await expect(grid.getByRole('cell')).toHaveCount(19);
    await expect(grid.getByRole('button')).toHaveCount(18);
    const blank = grid.locator('td[data-key-position="0,3"]');
    await expect(blank).toBeEmpty();
    await expect(blank.getByRole('button')).toHaveCount(0);
    const blankBox = await blank.boundingBox();
    const nextBox = await grid.locator('td[data-key-position="1,3"]').boundingBox();
    const aboveBox = await grid.locator('td[data-key-position="1,2"]').boundingBox();
    expect(blankBox.x + blankBox.width).toBeCloseTo(nextBox.x, 1);
    expect(nextBox.x).toBeCloseTo(aboveBox.x, 1);
    await expectKeyLabelsToFit(grid);
    await expect(page.getByText(`${name}.json`, { exact: true })).toBeVisible();
    await expect(page.getByText('5 columns x 4 rows', { exact: true })).toBeVisible();

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
        await expect(page.getByText('System key', { exact: true })).toBeVisible();
        await expect(page.getByText(/cannot be determined from JSON alone/)).toBeVisible();
      } else {
        for (const { label, key } of keyVariants(entry)) {
          const control = page.getByRole('button', { name: `${label}: ${labelText(key.design.label)}`, exact: true });
          if (await control.getAttribute('aria-expanded') !== 'true') await control.click();
          const actions = page.getByRole('table', { name: `${label} actions`, exact: true });
          await expect(actions.getByRole('cell')).toHaveText(['Tap', actionsText(key.press_actions)]);
          await expect(page.getByText(/Hold (start|repeat)|Long-press timing/)).toHaveCount(0);
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

test('cursor keys share Space and ENTER special colors', async ({ page }) => {
  await page.goto('/');
  for (const name of ['eng', 'ja', 'num']) {
    await page.getByRole('radiogroup', { name: 'Layout' }).getByText(name, { exact: true }).click();
    const grid = page.getByRole('table', { name: `${name} key layout`, exact: true });
    for (const selected of [false, true]) {
      const colors = [];
      for (const position of ['0,1', '4,1', '4,2']) {
        const button = grid.locator(`td[data-key-position="${position}"]`).getByRole('button');
        if (selected) {
          await button.click();
          await expect(button).toHaveAttribute('aria-pressed', 'true');
        }
        colors.push(await button.evaluate((element) => {
          const { backgroundColor, color } = getComputedStyle(element);
          return { backgroundColor, color };
        }));
      }
      expect(colors[0]).toEqual(colors[1]);
      expect(colors[0]).toEqual(colors[2]);
    }
  }
});

test('all layouts keep delete and tab flicks without long-press UI', async ({ page }) => {
  await page.goto('/');
  for (const name of ['eng', 'ja', 'num']) {
    await page.getByRole('radiogroup', { name: 'Layout' }).getByText(name, { exact: true }).click();
    const grid = page.getByRole('table', { name: `${name} key layout`, exact: true });
    await expect(grid.getByText('Resize', { exact: true })).toHaveCount(0);
    await grid.getByRole('button', { name: 'Delete, x=4, y=0', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Up: Resize', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Left: Smart delete', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Down: Hide', exact: true })).toBeVisible();
    await grid.getByRole('button', { name: 'Space, x=4, y=1', exact: true }).click();
    await page.getByRole('button', { name: 'Left: tab', exact: true }).click();
    await expect(page.getByRole('table', { name: 'Left actions', exact: true }).getByRole('cell')).toHaveText([
      'Tap', 'input(text="\\t")',
    ]);
  }
});

test('layout menus disable taps and keep all three layout flicks without emoji', async ({ page }) => {
  await page.goto('/');
  for (const name of ['eng', 'ja', 'num']) {
    await page.getByRole('radiogroup', { name: 'Layout' }).getByText(name, { exact: true }).click();
    const grid = page.getByRole('table', { name: `${name} key layout`, exact: true });
    await expect(grid.getByText('Emoji', { exact: true })).toHaveCount(0);
    await grid.getByRole('button', { name: 'Layout, x=0, y=0', exact: true }).click();
    await expect(page.getByRole('table', { name: 'Center actions', exact: true }).getByRole('cell')).toHaveText([
      'Tap', 'None',
    ]);
    for (const [direction, target] of [['Up', 'num'], ['Right', 'eng'], ['Down', 'ja']]) {
      await page.getByRole('button', { name: `${direction}: ${target}`, exact: true }).click();
      await expect(page.getByRole('table', { name: `${direction} actions`, exact: true }).getByRole('cell')).toHaveText([
        'Tap', `move_tab(identifier="${target}", tab_type="custom")`,
      ]);
    }
  }
});

test('switching layouts clears selection and keeps compound labels intact', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'あ, x=1, y=0', exact: true }).click();
  await expect(page.getByRole('table', { name: 'Center actions', exact: true })).toContainText('input(text="あ")');
  const switcher = page.getByRole('radiogroup', { name: 'Layout' });
  await switcher.getByText('eng', { exact: true }).click();
  await expect(page.getByText('Select the center button of a key.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'r, x=1, y=0', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Center: r', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'caps, x=1, y=3', exact: true }).click();
  await expect(page.getByRole('table', { name: 'Center actions', exact: true })).toContainText('toggle_caps_lock_state');
  await switcher.getByText('num', { exact: true }).click();
  await page.getByRole('button', { name: '←, x=0, y=1', exact: true }).click();
  await expect(page.getByRole('table', { name: 'Center actions', exact: true }).getByRole('cell')).toHaveText([
    'Tap', 'move_cursor(count=-1)',
  ]);
});

test('keyboard controls work and narrow screens scroll without overflowing the page', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const key = page.getByRole('button', { name: 'あ, x=1, y=0', exact: true });
  await key.focus();
  await page.keyboard.press('Enter');
  await expect(key).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('table', { name: 'Center actions', exact: true })).toBeVisible();
  for (const [name, keyName] of [
    ['ja', 'あ, x=1, y=0'],
    ['eng', 'r, x=1, y=0'],
    ['num', '^_, x=1, y=3'],
  ]) {
    await page.getByRole('radiogroup', { name: 'Layout' }).getByText(name, { exact: true }).click();
    await page.getByRole('button', { name: keyName, exact: true }).click();
    await expectKeyLabelsToFit(page.getByRole('table', { name: `${name} key layout`, exact: true }));
    const widths = await page.evaluate(() => ({
      content: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
    }));
    expect(widths.content, `${name} should not overflow`).toBeLessThanOrEqual(widths.viewport);
  }
});
