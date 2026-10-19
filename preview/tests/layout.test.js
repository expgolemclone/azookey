import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { strFromU8, unzipSync } from 'fflate';
import { actionsText, createHelpLayout, keyLabel, keyVariants, labelText } from '../src/layout.js';

const files = readdirSync(new URL('../../', import.meta.url))
  .filter((name) => name.endsWith('.json'))
  .toSorted();
const layouts = Object.fromEntries(files.map((name) => [
  name.slice(0, -5),
  JSON.parse(readFileSync(new URL(`../../${name}`, import.meta.url), 'utf8')),
]));
const entryAt = (name, x, y) => layouts[name].interface.keys
  .find((entry) => entry.specifier.x === x && entry.specifier.y === y);

test('uses every repository layout without copying its data', () => {
  assert.deepEqual(Object.keys(layouts), ['eng', 'ja', 'num']);
  for (const layout of Object.values(layouts)) {
    const before = JSON.stringify(layout);
    for (const entry of layout.interface.keys) {
      assert.ok(keyLabel(entry));
      for (const variant of keyVariants(entry)) {
        assert.ok(labelText(variant.key.design.label));
        actionsText(variant.key.press_actions);
      }
    }
    assert.equal(JSON.stringify(layout), before);
  }
});

test('the lower-left layout key taps ja and flicks num or eng', () => {
  for (const name of Object.keys(layouts)) {
    assert.equal(keyLabel(entryAt(name, 0, 0)), '?');
    const menu = entryAt(name, 0, 3);
    assert.equal(keyLabel(menu), 'ja');
    assert.deepEqual(menu.key.design.label, { text: 'ja' });
    assert.deepEqual(keyVariants(menu).map(({ direction, key }) => [
      direction, labelText(key.design.label), key.press_actions,
    ]), [
      ['center', 'ja', [{ identifier: 'ja', tab_type: 'custom', type: 'move_tab' }]],
      ['top', 'num', [{ identifier: 'num', tab_type: 'custom', type: 'move_tab' }]],
      ['right', 'eng', [{ identifier: 'eng', tab_type: 'custom', type: 'move_tab' }]],
    ]);
  }
});

test('plain main labels retain input case, caps, and separate flick labels', () => {
  const r = entryAt('eng', 1, 0);
  assert.equal(keyLabel(r), 'r');
  assert.equal(actionsText(r.key.press_actions), 'input(text="r")');
  assert.equal(keyLabel(entryAt('eng', 1, 3)), 'caps');
  assert.deepEqual(keyVariants(r).map(({ direction, key }) => [direction, labelText(key.design.label)]), [
    ['center', 'r'], ['top', 'really'], ['left', 'right'], ['right', 'real'], ['bottom', 'read'],
  ]);
  const really = keyVariants(r).find(({ direction }) => direction === 'top').key;
  assert.equal(actionsText(really.press_actions), 'input(text="really ")');
  const one = entryAt('num', 1, 0);
  assert.deepEqual(keyVariants(one).map(({ direction, key }) => [direction, labelText(key.design.label)]), [
    ['center', '1'], ['top', '↑'], ['left', '←'], ['right', '→'], ['bottom', '↓'],
  ]);
});

test('shared symbol keys preserve Markdown backtick counts and the right-flick greater than', () => {
  for (const name of Object.keys(layouts)) {
    const variants = keyVariants(entryAt(name, 0, 2));
    assert.deepEqual(variants.map(({ direction, key }) => [direction, labelText(key.design.label)]), [
      ['center', '@'], ['top', '``'], ['right', '>'], ['bottom', '``````'],
    ]);
    for (const { key } of variants) {
      assert.equal(actionsText(key.press_actions), `input(text=${JSON.stringify(labelText(key.design.label))})`);
    }
  }
});

test('system keys are identified without inventing their behavior', () => {
  const entry = entryAt('ja', 1, 3);
  assert.equal(entry.key_type, 'system');
  assert.equal(entry.key.type, 'flick_kogaki');
  assert.equal(keyLabel(entry), 'Small/Voiced');
  assert.deepEqual(keyVariants(entry), []);
});

test('SF Symbols and directions have English labels', () => {
  for (const [system_image, expected] of Object.entries({
    'chevron.left': '←',
    'chevron.right': '→',
    'chevron.left.2': '⇤',
    'chevron.right.2': '⇥',
    'delete.left': '⌫',
    'delete.left.fill': 'Clear',
    'doc.on.clipboard': 'Paste',
    'keyboard.chevron.compact.down.fill': 'Hide',
    'list.bullet.clipboard': 'History',
  })) {
    assert.equal(labelText({ system_image }), expected);
  }
  assert.deepEqual(keyVariants(entryAt('ja', 1, 0)).map(({ label }) => label),
    ['Tap', 'Up', 'Left', 'Right', 'Down']);
  assert.throws(() => labelText({ system_image: 'unknown.symbol' }), /Unsupported system image/);
  assert.throws(() => labelText({ unknown: 'label' }), /Unsupported label/);
  assert.throws(() => keyLabel({ key_type: 'system', key: { type: 'unknown' } }), /Unsupported system key/);
  assert.equal(labelText({ type: 'main_and_directions', main: 'r', directions: { top: 'really' } }), 'r');
});

test('all center and flick keys disable long-press without timing overrides', () => {
  for (const [name, layout] of Object.entries(layouts)) {
    for (const entry of layout.interface.keys) {
      for (const { direction, key } of keyVariants(entry)) {
        assert.deepEqual(key.longpress_actions, { start: [], repeat: [] },
          `${name}: ${keyLabel(entry)} ${direction}`);
      }
    }
  }
});

test('help layouts derive every hint from the flick label without changing typing behavior', () => {
  for (const layout of Object.values(layouts)) {
    const before = structuredClone(layout);
    const help = createHelpLayout(layout);
    assert.equal(help.identifier, `${layout.identifier}-help`);
    assert.deepEqual(help.metadata, { ...layout.metadata, display_name: help.identifier });
    assert.deepEqual(help.interface.key_layout, layout.interface.key_layout);
    assert.equal(help.interface.key_style, layout.interface.key_style);
    assert.equal(help.input_style, layout.input_style);
    assert.equal(help.language, layout.language);
    assert.equal(help.interface.keys.length, layout.interface.keys.length);
    for (const [index, entry] of layout.interface.keys.entries()) {
      const actual = help.interface.keys[index];
      assert.deepEqual(actual.specifier, entry.specifier);
      assert.equal(actual.specifier_type, entry.specifier_type);
      assert.equal(actual.key_type, entry.key_type);
      if (entry.key_type === 'system') {
        assert.deepEqual(actual, entry);
        continue;
      }
      const isToggle = entry.specifier.x === 0 && entry.specifier.y === 0;
      const expected = structuredClone(entry);
      for (const { key } of keyVariants(expected)) {
        for (const action of key.press_actions) {
          if (action.type === 'move_tab' && action.tab_type === 'custom') {
            action.identifier = isToggle ? layout.identifier : `${action.identifier}-help`;
          }
        }
      }
      if (entry.key.variations.length > 0) {
        expected.key.design.label = {
          type: 'main_and_directions',
          main: keyLabel(entry),
          directions: Object.fromEntries(entry.key.variations.map(({ direction, key }) => [
            direction, labelText(key.design.label),
          ])),
        };
      }
      assert.deepEqual(actual, expected);
    }
    assert.deepEqual(layout, before);
  }
});

test('help toggles round-trip to the current layout and tab switches retain help mode', () => {
  const all = Object.values(layouts).flatMap((layout) => [layout, createHelpLayout(layout)]);
  const identifiers = new Set(all.map((layout) => layout.identifier));
  assert.equal(identifiers.size, 6);
  for (const layout of all) {
    const toggle = layout.interface.keys.find((entry) => entry.specifier.x === 0 && entry.specifier.y === 0);
    assert.deepEqual(toggle.key.press_actions, [{
      identifier: layout.identifier.endsWith('-help')
        ? layout.identifier.slice(0, -5) : `${layout.identifier}-help`,
      tab_type: 'custom',
      type: 'move_tab',
    }]);
    assert.deepEqual(toggle.key.variations, []);
    for (const entry of layout.interface.keys) {
      for (const { key } of keyVariants(entry)) {
        for (const action of key.press_actions) {
          if (action.type !== 'move_tab' || action.tab_type !== 'custom') continue;
          assert.ok(identifiers.has(action.identifier));
          if (entry !== toggle) {
            assert.equal(action.identifier.endsWith('-help'), layout.identifier.endsWith('-help'));
          }
        }
      }
    }
  }
});

test('the import ZIP and direct JSON contain one array of all six layouts', () => {
  const directory = mkdtempSync(join(tmpdir(), 'azookey-export-'));
  try {
    execFileSync(process.execPath, [fileURLToPath(new URL('../scripts/export-layouts.js', import.meta.url)), directory]);
    const files = unzipSync(readFileSync(join(directory, 'azookey-layouts.zip')));
    const json = readFileSync(join(directory, 'azookey-layouts.json'), 'utf8');
    const bundle = JSON.parse(json);
    const expected = Object.values(layouts).flatMap((layout) => [layout, createHelpLayout(layout)]);
    assert.deepEqual(Object.keys(files), ['azookey-layouts.json']);
    assert.equal(strFromU8(files['azookey-layouts.json']), json);
    assert.ok(Array.isArray(bundle));
    assert.equal(bundle.length, 6);
    assert.equal(new Set(bundle.map((layout) => layout.identifier)).size, 6);
    assert.deepEqual(bundle, expected);
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test('kana punctuation and number symbol flicks keep their tap actions', () => {
  const ya = keyVariants(entryAt('ja', 2, 2));
  for (const [direction, text] of [['left', '['], ['right', ']']]) {
    const { key } = ya.find((item) => item.direction === direction);
    assert.equal(labelText(key.design.label), text);
    assert.deepEqual(key.press_actions, [{ type: 'input', text }]);
    assert.deepEqual(key.longpress_actions, { start: [], repeat: [] });
  }
  const punctuation = keyVariants(entryAt('ja', 3, 3));
  for (const [direction, text] of [['top', '?'], ['right', '!']]) {
    const { key } = punctuation.find((item) => item.direction === direction);
    assert.deepEqual(key.press_actions, [{ type: 'input', text }]);
  }
  const mark = keyVariants(entryAt('num', 1, 2)).find((item) => item.direction === 'bottom').key;
  assert.equal(actionsText(mark.press_actions), 'input(text="※")');
  const degree = keyVariants(entryAt('num', 2, 0)).find((item) => item.direction === 'top').key;
  assert.equal(actionsText(degree.press_actions), 'input(text="°")');
});

test('actions preserve whitespace, parameter values, and execution order', () => {
  assert.equal(actionsText([]), 'None');
  assert.equal(actionsText([
    { type: 'input', text: ' ' },
    { type: 'input', text: '\t' },
    { type: 'input', text: '\n' },
    { type: 'complete' },
  ]), 'input(text=" ")\ninput(text="\\t")\ninput(text="\\n")\ncomplete');
  assert.equal(actionsText([{ type: 'move_cursor', count: -1 }]), 'move_cursor(count=-1)');
  assert.equal(actionsText([{ type: 'move_tab', tab_type: 'custom', identifier: 'num' }]),
    'move_tab(tab_type="custom", identifier="num")');
});

test('kana and cursor center and flick taps remain intact', () => {
  const a = keyVariants(entryAt('ja', 1, 0));
  assert.equal(actionsText(a[0].key.press_actions), 'input(text="あ")');
  const left = a.find((item) => item.direction === 'left').key;
  assert.equal(actionsText(left.press_actions), 'input(text="い")');
  const cursor = entryAt('num', 0, 1);
  assert.equal(actionsText(cursor.key.press_actions), 'move_cursor(count=-1)');
  const right = keyVariants(cursor).find((item) => item.direction === 'right').key;
  assert.equal(actionsText(right.press_actions), 'move_cursor(count=1)');
});
