export const directions = [
  { value: 'top', label: '上' },
  { value: 'left', label: '左' },
  { value: 'right', label: '右' },
  { value: 'bottom', label: '下' },
];

const symbolLabels = {
  'chevron.left': '←',
  'chevron.right': '→',
  'chevron.left.2': '行頭',
  'chevron.right.2': '行末',
  'delete.left': '削除',
  'delete.left.fill': '全削除',
  'doc.on.clipboard': '貼付',
  'face.smiling': '絵文字',
  'keyboard.chevron.compact.down.fill': '閉じる',
  'keyboard.onehanded.right.fill': '片手',
  'list.bullet.clipboard': '履歴',
};

export function labelText(label) {
  if (Object.hasOwn(label, 'text')) return label.text;
  if (label.type === 'main_and_directions') return label.main;
  if (Object.hasOwn(label, 'system_image')) {
    if (!Object.hasOwn(symbolLabels, label.system_image)) {
      throw new Error(`Unsupported system image: ${label.system_image}`);
    }
    return symbolLabels[label.system_image];
  }
  throw new Error(`Unsupported label: ${JSON.stringify(label)}`);
}

export function keyLabel(entry) {
  if (entry.key_type === 'system') {
    if (entry.key.type !== 'flick_kogaki') {
      throw new Error(`Unsupported system key: ${entry.key.type}`);
    }
    return '小/濁';
  }
  return labelText(entry.key.design.label);
}

export function gridRows(layout) {
  const { type, column_count } = layout.interface.key_layout;
  if (type !== 'grid_fit') throw new Error(`Unsupported layout: ${type}`);
  return Array.from({ length: column_count }, (_, y) =>
    layout.interface.keys
      .filter((entry) => entry.specifier.y === y)
      .toSorted((left, right) => left.specifier.x - right.specifier.x),
  );
}

export function keyVariants(entry) {
  if (entry.key_type === 'system') return [];
  return [
    { direction: 'center', label: '中央', key: entry.key },
    ...directions.flatMap(({ value, label }) => {
      const variation = entry.key.variations.find((item) => item.direction === value);
      return variation ? [{ direction: value, label, key: variation.key }] : [];
    }),
  ];
}

export function actionsText(actions) {
  if (actions.length === 0) return 'なし';
  return actions.map(({ type, ...parameters }) => {
    const argumentsText = Object.entries(parameters)
      .map(([name, value]) => `${name}=${JSON.stringify(value)}`)
      .join(', ');
    return argumentsText ? `${type}(${argumentsText})` : type;
  }).join('\n');
}
