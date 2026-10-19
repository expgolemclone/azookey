import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { actionsText, gridRows, keyLabel, keyVariants, labelText } from '../src/layout.js';

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
    for (const row of gridRows(layout)) {
      for (const { entry } of row) {
        if (!entry) continue;
        assert.ok(keyLabel(entry));
        for (const variant of keyVariants(entry)) {
          assert.ok(labelText(variant.key.design.label));
          actionsText(variant.key.press_actions);
        }
      }
    }
    assert.equal(JSON.stringify(layout), before);
  }
});

test('row_count is horizontal, column_count is vertical, and merged keys appear once', () => {
  for (const layout of Object.values(layouts)) {
    const rows = gridRows(layout);
    assert.equal(rows.length, 4);
    assert.deepEqual(rows.map((row) => row.length), [5, 5, 5, 4]);
    assert.equal(rows.flat().filter(({ entry }) => entry).length, 18);
    assert.deepEqual(rows[2][4].entry.specifier, { height: 2, width: 1, x: 4, y: 2 });
    assert.equal(keyLabel(rows[2][4].entry), 'ENTER');
    assert.deepEqual(rows[3][0], { x: 0, y: 3, entry: null });
    rows.forEach((row, y) => {
      assert.deepEqual(row.map((cell) => cell.x), y === 3 ? [0, 1, 2, 3] : [0, 1, 2, 3, 4]);
      assert.ok(row.every((cell) => cell.y === y));
    });
  }
});

test('grid position, not source array order, controls placement', () => {
  const layout = structuredClone(layouts.ja);
  layout.interface.keys.reverse();
  assert.deepEqual(gridRows(layout), gridRows(layouts.ja));
});

test('empty cells retain their coordinates while merged cells are not duplicated', () => {
  const wide = { specifier: { x: 1, y: 0, width: 2, height: 2 } };
  const rows = gridRows({ interface: {
    key_layout: { type: 'grid_fit', row_count: 4, column_count: 3 },
    keys: [wide],
  } });
  assert.deepEqual(rows, [
    [{ x: 0, y: 0, entry: null }, { x: 1, y: 0, entry: wide }, { x: 3, y: 0, entry: null }],
    [{ x: 0, y: 1, entry: null }, { x: 3, y: 1, entry: null }],
    Array.from({ length: 4 }, (_, x) => ({ x, y: 2, entry: null })),
  ]);
});

test('compound labels preserve case, caps, and directional text', () => {
  const r = entryAt('eng', 1, 0);
  assert.equal(keyLabel(r), 'R');
  assert.equal(actionsText(r.key.press_actions), 'input(text="r")');
  assert.equal(keyLabel(entryAt('eng', 1, 3)), 'caps');
  assert.deepEqual(keyVariants(r).map(({ direction, key }) => [direction, labelText(key.design.label)]), [
    ['center', 'R'], ['top', 'the'], ['left', 'to'], ['right', 'and'], ['bottom', 'of'],
  ]);
  const the = keyVariants(r).find(({ direction }) => direction === 'top').key;
  assert.equal(actionsText(the.press_actions), 'input(text="the ")');
  const one = entryAt('num', 1, 0);
  assert.deepEqual(keyVariants(one).map(({ direction, key }) => [direction, labelText(key.design.label)]), [
    ['center', '1'], ['top', '↑'], ['left', '←'], ['right', '→'], ['bottom', '↓'],
  ]);
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
    'chevron.left.2': 'Line start',
    'chevron.right.2': 'Line end',
    'delete.left': 'Delete',
    'delete.left.fill': 'Smart delete',
    'doc.on.clipboard': 'Paste',
    'face.smiling': 'Emoji',
    'keyboard.chevron.compact.down.fill': 'Hide',
    'list.bullet.clipboard': 'History',
  })) {
    assert.equal(labelText({ system_image }), expected);
  }
  assert.deepEqual(keyVariants(entryAt('ja', 1, 0)).map(({ label }) => label),
    ['Center', 'Up', 'Left', 'Right', 'Down']);
  assert.throws(() => labelText({ system_image: 'unknown.symbol' }), /Unsupported system image/);
  assert.throws(() => labelText({ unknown: 'label' }), /Unsupported label/);
  assert.throws(() => keyLabel({ key_type: 'system', key: { type: 'unknown' } }), /Unsupported system key/);
  assert.throws(() => gridRows({ interface: { key_layout: { type: 'grid_scroll' } } }), /Unsupported layout/);
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
