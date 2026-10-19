export const directions = [
  { value: 'top', label: 'Up' },
  { value: 'left', label: 'Left' },
  { value: 'right', label: 'Right' },
  { value: 'bottom', label: 'Down' },
];

const symbolLabels = {
  'chevron.left': '←',
  'chevron.right': '→',
  'chevron.left.2': 'Line start',
  'chevron.right.2': 'Line end',
  'delete.left': 'Delete',
  'delete.left.fill': 'Smart delete',
  'doc.on.clipboard': 'Paste',
  'keyboard.chevron.compact.down.fill': 'Hide',
  'list.bullet.clipboard': 'History',
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
    return 'Small/Voiced';
  }
  return labelText(entry.key.design.label);
}

export function gridRows(layout) {
  const { type, row_count, column_count } = layout.interface.key_layout;
  if (type !== 'grid_fit') throw new Error(`Unsupported layout: ${type}`);
  return Array.from({ length: column_count }, (_, y) =>
    Array.from({ length: row_count }, (_, x) => {
      const entry = layout.interface.keys.find(({ specifier: position }) =>
        x >= position.x && x < position.x + position.width
        && y >= position.y && y < position.y + position.height);
      if (entry && (entry.specifier.x !== x || entry.specifier.y !== y)) return null;
      return { x, y, entry: entry ?? null };
    }).filter((cell) => cell !== null),
  );
}

export function keyVariants(entry) {
  if (entry.key_type === 'system') return [];
  return [
    { direction: 'center', label: 'Center', key: entry.key },
    ...directions.flatMap(({ value, label }) => {
      const variation = entry.key.variations.find((item) => item.direction === value);
      return variation ? [{ direction: value, label, key: variation.key }] : [];
    }),
  ];
}

export function actionsText(actions) {
  if (actions.length === 0) return 'None';
  return actions.map(({ type, ...parameters }) => {
    const argumentsText = Object.entries(parameters)
      .map(([name, value]) => `${name}=${JSON.stringify(value)}`)
      .join(', ');
    return argumentsText ? `${type}(${argumentsText})` : type;
  }).join('\n');
}
