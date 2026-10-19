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
  assert.deepEqual(Object.keys(layouts), ['abc', 'kana', 'num']);
  for (const layout of Object.values(layouts)) {
    const before = JSON.stringify(layout);
    for (const row of gridRows(layout)) {
      for (const entry of row) {
        assert.ok(keyLabel(entry));
        for (const variant of keyVariants(entry)) {
          assert.ok(labelText(variant.key.design.label));
          actionsText(variant.key.press_actions);
          actionsText(variant.key.longpress_actions.start);
          actionsText(variant.key.longpress_actions.repeat);
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
    assert.equal(rows.flat().length, 19);
    assert.deepEqual(rows[2][4].specifier, { height: 2, width: 1, x: 4, y: 2 });
    assert.equal(keyLabel(rows[2][4]), '改行');
    rows.forEach((row, y) => {
      assert.deepEqual(row.map((entry) => entry.specifier.x), y === 3 ? [0, 1, 2, 3] : [0, 1, 2, 3, 4]);
      assert.ok(row.every((entry) => entry.specifier.y === y));
    });
  }
});

test('grid position, not source array order, controls placement', () => {
  const layout = structuredClone(layouts.kana);
  layout.interface.keys.reverse();
  assert.deepEqual(gridRows(layout), gridRows(layouts.kana));
});

test('compound labels preserve case, caps, and directional text', () => {
  const r = entryAt('abc', 1, 0);
  assert.equal(keyLabel(r), 'R');
  assert.equal(actionsText(r.key.press_actions), 'input(text="r")');
  assert.equal(keyLabel(entryAt('abc', 1, 3)), 'caps');
  assert.deepEqual(keyVariants(r).map(({ direction, key }) => [direction, labelText(key.design.label)]), [
    ['center', 'R'], ['top', 'what'], ['left', 'who'], ['right', 'when'], ['bottom', 'where'],
  ]);
  const one = entryAt('num', 1, 0);
  assert.deepEqual(keyVariants(one).map(({ direction, key }) => [direction, labelText(key.design.label)]), [
    ['center', '1'], ['top', '↑'], ['left', '←'], ['right', '→'], ['bottom', '↓'],
  ]);
});

test('system keys are identified without inventing their behavior', () => {
  const entry = entryAt('kana', 1, 3);
  assert.equal(entry.key_type, 'system');
  assert.equal(entry.key.type, 'flick_kogaki');
  assert.equal(keyLabel(entry), '小/濁');
  assert.deepEqual(keyVariants(entry), []);
});

test('SF Symbols have compact textual labels', () => {
  assert.equal(labelText({ system_image: 'delete.left' }), '削除');
  assert.equal(labelText({ system_image: 'chevron.left' }), '←');
  assert.equal(labelText({ system_image: 'face.smiling' }), '絵文字');
  assert.throws(() => labelText({ system_image: 'unknown.symbol' }), /Unsupported system image/);
  assert.throws(() => labelText({ unknown: 'label' }), /Unsupported label/);
  assert.throws(() => keyLabel({ key_type: 'system', key: { type: 'unknown' } }), /Unsupported system key/);
  assert.throws(() => gridRows({ interface: { key_layout: { type: 'grid_scroll' } } }), /Unsupported layout/);
});

test('actions preserve whitespace, parameter values, and execution order', () => {
  assert.equal(actionsText([]), 'なし');
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

test('tap, hold start, and hold repeat remain distinct for center and flick keys', () => {
  const a = keyVariants(entryAt('kana', 1, 0));
  assert.equal(actionsText(a[0].key.press_actions), 'input(text="あ")');
  assert.equal(actionsText(a[0].key.longpress_actions.start), 'input(text="ぁ")');
  assert.equal(actionsText(a[0].key.longpress_actions.repeat), 'なし');
  const left = a.find((item) => item.direction === 'left').key;
  assert.equal(actionsText(left.press_actions), 'input(text="い")');
  assert.equal(actionsText(left.longpress_actions.start), 'input(text="ぃ")');
  const cursor = entryAt('num', 0, 0).key;
  assert.equal(actionsText(cursor.press_actions), 'move_cursor(count=-1)');
  assert.equal(actionsText(cursor.longpress_actions.start), 'move_cursor(count=-1)');
  assert.equal(actionsText(cursor.longpress_actions.repeat), 'move_cursor(count=-1)');
});
