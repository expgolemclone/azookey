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

export function keyVariants(entry) {
  if (entry.key_type === 'system') return [];
  return [
    { direction: 'center', label: 'Tap', key: entry.key },
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
