import { readFileSync } from 'node:fs';
import { expect, test as base } from '@playwright/test';
import { actionsText, createHelpLayout, keyLabel, keyVariants, labelText } from '../src/layout.js';

const layouts = Object.fromEntries(['eng', 'ja', 'num'].map((name) => [
  name, JSON.parse(readFileSync(new URL(`../../${name}.json`, import.meta.url), 'utf8')),
]));

const test = base.extend({
  baseURL: async ({}, use, { project }) => {
    const url = process.env[`PREVIEW_${project.name.toUpperCase()}_URL`];
    expect(url, 'Playwright must capture the isolated preview server URL').toBeTruthy();
    await use(url);
  },
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

const keyAt = (grid, x, y) => grid.locator(`button[data-key-position="${x},${y}"]`);
const actionRow = (page, direction) => page.getByRole('table', { name: 'Key actions', exact: true })
  .locator(`tr[data-direction="${direction}"]`);

async function selectLayout(page, name) {
  await page.getByRole('radiogroup', { name: 'Layout' }).getByText(name, { exact: true }).click();
  return page.getByRole('group', { name: `${name} key layout`, exact: true });
}

async function expectKeyLabelsToFit(grid) {
  const clipped = await grid.locator('button > span').evaluateAll((labels) => labels
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

    for (const name of Object.keys(layouts)) {
      const grid = await selectLayout(page, name);
      for (const [x, y] of [[1, 0], [4, 0]]) {
        await keyAt(grid, x, y).click();
        await expect(page.getByRole('table', { name: 'Key actions', exact: true })).toBeVisible();
        const unreadable = await page.locator('h1, h2, p, button, th, td, code, pre, label')
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
  await expect(page.getByText('Tap ? to toggle flick hints. Select another key to inspect its actions. Device appearance may differ.', { exact: true })).toBeVisible();
  await expect(page.getByRole('table')).toHaveCount(0);
  await expect(page.getByText('Read-only', { exact: true })).toHaveCount(0);
  const grid = await selectLayout(page, 'ja');
  for (const label of ['ja', 'Space', 'ENTER', '⌫', 'Small/Voiced', 'あ']) {
    await expect(grid.getByRole('button', { name: `${label}, x=`, exact: false })).toHaveText(label);
  }
  await keyAt(grid, 4, 1).click();
  await expect(page.getByRole('columnheader')).toHaveText(['Gesture', 'Label', 'Actions']);
  await expect(actionRow(page, 'center').getByRole('rowheader')).toHaveText('Tap');
  await expect(actionRow(page, 'center').getByRole('cell')).toHaveText(['Space', 'input(text=" ")']);
  await keyAt(grid, 1, 0).click();
  await expect(actionRow(page, 'center').getByRole('cell')).toHaveText(['あ', 'input(text="あ")']);
});

for (const [name, layout] of Object.entries(layouts)) {
  test(`${name}: only main labels are shown until a key is selected, with all actions preserved`, async ({ page }) => {
    const requests = [];
    page.on('request', (request) => requests.push({ method: request.method(), url: request.url() }));
    await page.goto('/');
    const grid = await selectLayout(page, name);
    await expect(grid).toHaveCSS('display', 'grid');
    const ordered = layout.interface.keys.toSorted((a, b) => a.specifier.y - b.specifier.y || a.specifier.x - b.specifier.x);
    await expect(grid.getByRole('button')).toHaveText(ordered.map(keyLabel));
    expect((await grid.textContent()).replace(/\s/g, '')).toBe(ordered.map(keyLabel).join('').replace(/\s/g, ''));
    await expect(page.getByRole('table')).toHaveCount(0);
    await expect(keyAt(grid, 0, 0)).toHaveText('?');
    await expect(keyAt(grid, 0, 3)).toHaveText('ja');
    await expectKeyLabelsToFit(grid);
    const origin = await grid.boundingBox();
    const cell = await keyAt(grid, 1, 0).boundingBox();
    const gap = await grid.evaluate((element) => parseFloat(getComputedStyle(element).gap));

    for (const entry of ordered.filter((item) => item.specifier.x !== 0 || item.specifier.y !== 0)) {
      const { x, y, width, height } = entry.specifier;
      const button = keyAt(grid, x, y);
      await expect(button).toHaveAccessibleName(`${keyLabel(entry)}, x=${x}, y=${y}`);
      await expect(button).toHaveCSS('grid-column-start', String(x + 1));
      await expect(button).toHaveCSS('grid-column-end', `span ${width}`);
      await expect(button).toHaveCSS('grid-row-start', String(y + 1));
      await expect(button).toHaveCSS('grid-row-end', `span ${height}`);
      const box = await button.boundingBox();
      expect(box.x).toBeCloseTo(origin.x + x * (cell.width + gap), 1);
      expect(box.y).toBeCloseTo(origin.y + y * (cell.height + gap), 1);
      expect(box.width).toBeCloseTo(width * cell.width + (width - 1) * gap, 1);
      expect(box.height).toBeCloseTo(height * cell.height + (height - 1) * gap, 1);
      await button.click();
      await expect(button).toHaveAttribute('aria-pressed', 'true');
      await expect(grid.getByRole('button', { pressed: true })).toHaveCount(1);
      await expect(button).toHaveAttribute('aria-controls', 'key-details');
      const details = page.getByRole('region', { name: 'Selected key', exact: true });
      await expect(details.getByRole('heading')).toHaveText(keyLabel(entry));
      if (entry.key_type === 'system') {
        await expect(details.getByText('flick_kogaki', { exact: true })).toBeVisible();
        await expect(details.getByText(/System key/)).toBeVisible();
        await expect(details.getByText(/cannot be determined from JSON alone/)).toBeVisible();
        await expect(details.getByRole('table')).toHaveCount(0);
      } else {
        await expect(details.getByRole('table')).toHaveCount(1);
        await expect(details.getByRole('rowheader')).toHaveCount(keyVariants(entry).length);
        for (const { direction, label, key } of keyVariants(entry)) {
          const row = actionRow(page, direction);
          await expect(row.getByRole('rowheader')).toHaveText(label);
          await expect(row.getByRole('cell')).toHaveText([labelText(key.design.label), actionsText(key.press_actions)]);
        }
      }
      await expect(page.getByText(/Hold (start|repeat)|Long-press timing/)).toHaveCount(0);
      await expect(grid.getByRole('button')).toHaveText(ordered.map(keyLabel));
    }

    const { origin: localOrigin } = new URL(page.url());
    expect(requests.every((request) => request.method === 'GET' && new URL(request.url).origin === localOrigin)).toBe(true);
    await expect(page.locator('input[type="file"], textarea, [contenteditable="true"]')).toHaveCount(0);
  });
}

test('the top-left tap toggles all flick hints and preserves help when switching layouts', async ({ page }) => {
  await page.goto('/');
  let grid = await selectLayout(page, 'ja');
  const before = await grid.boundingBox();
  await keyAt(grid, 1, 0).click();
  await keyAt(grid, 0, 0).click();
  await expect(page.getByRole('table')).toHaveCount(0);
  expect(await grid.boundingBox()).toEqual(before);
  for (const [name, layout] of Object.entries(layouts)) {
    grid = await selectLayout(page, name);
    const toggle = keyAt(grid, 0, 0);
    await expect(toggle).toHaveText('?');
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(toggle).toHaveAttribute('aria-controls', 'keyboard-layout');
    const help = createHelpLayout(layout);
    for (const entry of help.interface.keys) {
      const button = keyAt(grid, entry.specifier.x, entry.specifier.y);
      const hints = entry.key_type === 'custom' && entry.key.design.label.type === 'main_and_directions'
        ? entry.key.design.label.directions : {};
      await expect(button.locator('[data-direction]')).toHaveCount(Object.keys(hints).length);
      for (const [direction, text] of Object.entries(hints)) {
        await expect(button.locator(`[data-direction="${direction}"]`)).toHaveText(text);
      }
    }
    await expectKeyLabelsToFit(grid);
    await keyAt(grid, 0, 3).click();
    for (const [direction, target] of [['center', 'ja'], ['top', 'num'], ['right', 'eng']]) {
      await expect(actionRow(page, direction).getByRole('cell')).toHaveText([
        target, `move_tab(identifier="${target}-help", tab_type="custom")`,
      ]);
    }
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(grid.locator('[data-direction]')).toHaveCount(0);
    await expect(page.getByRole('table')).toHaveCount(0);
    await toggle.focus();
    await page.keyboard.press('Space');
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  }
  await keyAt(grid, 0, 0).focus();
  await page.keyboard.press('Enter');
  await expect(keyAt(grid, 0, 0)).toHaveAttribute('aria-pressed', 'false');
});

test('normal keys are neutral and cursor keys share Space and ENTER special colors', async ({ page }) => {
  await page.goto('/');
  for (const name of Object.keys(layouts)) {
    const grid = await selectLayout(page, name);
    const backgrounds = await grid.getByRole('button').evaluateAll((buttons) => buttons.map((button) => getComputedStyle(button).backgroundColor));
    for (const background of backgrounds) {
      const [r, g, b] = background.match(/\d+/g).map(Number);
      expect(r).toBe(g);
      expect(g).toBe(b);
    }
    for (const selected of [false, true]) {
      const colors = [];
      for (const [x, y] of [[0, 1], [4, 1], [4, 2]]) {
        const button = keyAt(grid, x, y);
        if (selected) await button.click();
        colors.push(await button.evaluate((element) => {
          const { backgroundColor, color, borderColor } = getComputedStyle(element);
          return { backgroundColor, color, borderColor };
        }));
      }
      expect(colors[0]).toEqual(colors[1]);
      expect(colors[0]).toEqual(colors[2]);
    }
  }
});

test('delete, tab, and layout tap and flick actions remain inspectable', async ({ page }) => {
  await page.goto('/');
  for (const name of Object.keys(layouts)) {
    const grid = await selectLayout(page, name);
    await keyAt(grid, 4, 0).click();
    await expect(actionRow(page, 'top')).toHaveCount(0);
    await expect(actionRow(page, 'left').getByRole('cell')).toHaveText(['Clear', 'smart_delete_default']);
    await expect(actionRow(page, 'bottom').getByRole('cell')).toHaveText(['Hide', 'dismiss_keyboard']);
    await keyAt(grid, 4, 1).click();
    await expect(actionRow(page, 'left').getByRole('cell')).toHaveText(['tab', 'input(text="\\t")']);
    await keyAt(grid, 0, 3).click();
    await expect(actionRow(page, 'bottom')).toHaveCount(0);
    for (const [direction, target] of [['center', 'ja'], ['top', 'num'], ['right', 'eng']]) {
      await expect(actionRow(page, direction).getByRole('cell')).toHaveText([
        target, `move_tab(identifier="${target}", tab_type="custom")`,
      ]);
    }
    await expect(page.getByText(/Emoji|Resize/, { exact: true })).toHaveCount(0);
  }
});

test('switching layouts clears selection and retains word shortcuts, caps, and cursor actions', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'あ, x=1, y=0', exact: true }).click();
  await expect(actionRow(page, 'center')).toContainText('input(text="あ")');
  const grid = await selectLayout(page, 'eng');
  await expect(page.getByRole('table')).toHaveCount(0);
  await expect(grid.getByRole('button', { pressed: true })).toHaveCount(0);
  await keyAt(grid, 1, 0).click();
  await expect(actionRow(page, 'top').getByRole('cell')).toHaveText(['really', 'input(text="really ")']);
  await keyAt(grid, 1, 3).click();
  await expect(actionRow(page, 'center').getByRole('cell')).toHaveText(['caps', 'toggle_caps_lock_state']);
  const numbers = await selectLayout(page, 'num');
  await expect(page.getByRole('table')).toHaveCount(0);
  await keyAt(numbers, 0, 1).click();
  await expect(actionRow(page, 'center').getByRole('cell')).toHaveText(['←', 'move_cursor(count=-1)']);
});

test('keys follow positional tab order with visible focus and Enter and Space activation', async ({ page }) => {
  await page.goto('/');
  const grid = await selectLayout(page, 'ja');
  const buttons = grid.getByRole('button');
  await buttons.first().focus();
  for (let index = 0; index < await buttons.count(); index += 1) {
    await expect(buttons.nth(index)).toBeFocused();
    await page.keyboard.press('Tab');
  }
  const first = keyAt(grid, 1, 0);
  await first.focus();
  await page.keyboard.press('Enter');
  await expect(first).toHaveAttribute('aria-pressed', 'true');
  await expect(first).toHaveCSS('outline-style', 'solid');
  await expect(first).toHaveCSS('outline-width', '2px');
  const second = keyAt(grid, 2, 0);
  await second.focus();
  await page.keyboard.press('Space');
  await expect(first).toHaveAttribute('aria-pressed', 'false');
  await expect(second).toHaveAttribute('aria-pressed', 'true');
  await expect(actionRow(page, 'center').getByRole('cell')).toHaveText(['か', 'input(text="か")']);
});

for (const width of [320, 390, 768, 1280]) {
  test(`${width}px: keys fit without horizontal scrolling or movement when selected`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    for (const [name, x, y] of [['ja', 1, 3], ['eng', 1, 0], ['num', 1, 3]]) {
      const grid = await selectLayout(page, name);
      const before = await grid.boundingBox();
      await keyAt(grid, x, y).click({ position: { x: 4, y: 4 } });
      await expect(keyAt(grid, x, y)).toHaveAttribute('aria-pressed', 'true');
      expect(await grid.boundingBox()).toEqual(before);
      expect(before.width).toBeLessThanOrEqual(Math.min(width, 640));
      await expectKeyLabelsToFit(grid);
      const tooSmall = await grid.getByRole('button').evaluateAll((buttons) => buttons
        .filter((button) => button.getBoundingClientRect().width < 44 || button.getBoundingClientRect().height < 44)
        .map((button) => button.textContent));
      expect(tooSmall).toEqual([]);
      const widths = await grid.evaluate((element) => ({
        grid: element.scrollWidth,
        available: element.clientWidth,
        page: document.documentElement.scrollWidth,
        viewport: window.innerWidth,
      }));
      expect(widths.grid).toBeLessThanOrEqual(widths.available);
      expect(widths.page).toBeLessThanOrEqual(widths.viewport);
      await keyAt(grid, 0, 0).click();
      await expect(keyAt(grid, 0, 0)).toHaveAttribute('aria-pressed', 'true');
      expect(await grid.boundingBox()).toEqual(before);
      await expectKeyLabelsToFit(grid);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await keyAt(grid, 0, 0).click();
    }
  });
}
