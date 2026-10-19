export const directions = [
  { value: 'top', label: 'Up' },
  { value: 'left', label: 'Left' },
  { value: 'right', label: 'Right' },
  { value: 'bottom', label: 'Down' },
];

const symbolLabels = {
  'chevron.left': '←',
  'chevron.right': '→',
  'chevron.left.2': '⇤',
  'chevron.right.2': '⇥',
  'delete.left': '⌫',
  'delete.left.fill': 'Clear',
  'doc.on.clipboard': 'Paste',
  'keyboard.chevron.compact.down.fill': 'Hide',
  'list.bullet.clipboard': 'History',
};

export function labelText(label) {
  if (label.type === 'main_and_directions') return label.main;
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

export const helpIdentifier = (identifier) => `${identifier}-help`;

export function isHelpToggle(entry, identifier) {
  const target = identifier.endsWith('-help') ? identifier.slice(0, -5) : helpIdentifier(identifier);
  return entry.key_type === 'custom' && entry.key.press_actions.some((action) => (
    action.type === 'move_tab' && action.tab_type === 'custom' && action.identifier === target
  ));
}

export function createHelpLayout(layout) {
  const help = structuredClone(layout);
  help.identifier = helpIdentifier(layout.identifier);
  help.metadata.display_name = help.identifier;
  for (const entry of help.interface.keys) {
    if (entry.key_type === 'system') continue;
    if (isHelpToggle(entry, layout.identifier)) {
      entry.key.press_actions[0].identifier = layout.identifier;
      continue;
    }
    for (const { key } of keyVariants(entry)) {
      for (const action of key.press_actions) {
        if (action.type === 'move_tab' && action.tab_type === 'custom') {
          action.identifier = helpIdentifier(action.identifier);
        }
      }
    }
    if (entry.key.variations.length > 0) {
      entry.key.design.label = {
        type: 'main_and_directions',
        main: keyLabel(entry),
        directions: Object.fromEntries(entry.key.variations.map(({ direction, key }) => [
          direction, labelText(key.design.label),
        ])),
      };
    }
  }
  return help;
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
