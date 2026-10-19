import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Box,
  Code,
  Container,
  Group,
  MantineProvider,
  SegmentedControl,
  Stack,
  Table,
  Text,
  Title,
  UnstyledButton,
} from '@mantine/core';
import '@mantine/core/styles.css';
import { actionsText, createHelpLayout, helpIdentifier, keyLabel, keyVariants, labelText } from './layout.js';
import classes from './main.module.css';

const layouts = Object.values(import.meta.glob('../../*.json', {
  eager: true,
  import: 'default',
})).toSorted((left, right) => left.identifier.localeCompare(right.identifier));
const helpLayouts = layouts.map(createHelpLayout);

function App() {
  const [activeId, setActiveId] = useState('ja');
  const [showHelp, setShowHelp] = useState(false);
  const [selectedKey, setSelectedKey] = useState(null);
  const layout = showHelp
    ? helpLayouts.find((item) => item.identifier === helpIdentifier(activeId))
    : layouts.find((item) => item.identifier === activeId);
  const { row_count: width, column_count: height } = layout.interface.key_layout;
  const keys = layout.interface.keys.toSorted((a, b) => a.specifier.y - b.specifier.y || a.specifier.x - b.specifier.x);

  return (
    <Container size={640} py="xl">
      <Stack gap="lg">
        <Group justify="space-between">
          <Title order={1} size="h3">Keyboard preview</Title>
          <SegmentedControl
            aria-label="Layout"
            value={activeId}
            data={layouts.map((item) => ({
              value: item.identifier,
              label: item.metadata.display_name,
            }))}
            onChange={(value) => {
              setActiveId(value);
              setSelectedKey(null);
            }}
          />
        </Group>
        <Text size="sm" c="gray.5">
          Tap ? to toggle flick hints. Select another key to inspect its actions. Device appearance may differ.
        </Text>
        <Box
          id="keyboard-layout"
          role="group"
          aria-label={`${activeId} key layout`}
          className={classes.keyboard}
          style={{ '--columns': width, '--rows': height }}
        >
          {keys.map((entry) => {
            const { x, y, width, height } = entry.specifier;
            const isHelpToggle = x === 0 && y === 0;
            const hints = entry.key_type === 'custom' && entry.key.design.label.type === 'main_and_directions'
              ? entry.key.design.label.directions
              : null;
            return (
              <UnstyledButton
                key={`${x},${y}`}
                type="button"
                className={classes.key}
                data-key-position={`${x},${y}`}
                data-hints={hints ? true : undefined}
                data-special={entry.key_type === 'system' || entry.key.design.color === 'special' || undefined}
                style={{
                  gridColumn: `${x + 1} / span ${width}`,
                  gridRow: `${y + 1} / span ${height}`,
                }}
                aria-label={`${keyLabel(entry)}, x=${x}, y=${y}`}
                aria-pressed={isHelpToggle ? showHelp : selectedKey === entry}
                aria-controls={isHelpToggle ? 'keyboard-layout' : 'key-details'}
                onClick={() => {
                  if (isHelpToggle) {
                    setShowHelp(!showHelp);
                    setSelectedKey(null);
                  } else {
                    setSelectedKey(entry);
                  }
                }}
              >
                <Text component="span" inherit className={classes.keyLabel}>{keyLabel(entry)}</Text>
                {hints && Object.entries(hints).map(([direction, text]) => (
                  <span key={direction} className={classes.hint} data-direction={direction} aria-hidden="true">
                    {text}
                  </span>
                ))}
              </UnstyledButton>
            );
          })}
        </Box>
        <Box component="section" id="key-details" aria-label="Selected key" aria-live="polite">
          {selectedKey && (
            <Stack gap="sm">
              <Title order={2} size="h4">{keyLabel(selectedKey)}</Title>
              {selectedKey.key_type === 'system' ? (
                <Text size="sm">
                  System key <Code>{selectedKey.key.type}</Code>. Small kana and voicing behavior
                  depends on azooKey settings and cannot be determined from JSON alone.
                </Text>
              ) : (
                <Table aria-label="Key actions" layout="fixed" verticalSpacing="xs" horizontalSpacing="xs">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th scope="col" className={classes.gestureColumn}>Gesture</Table.Th>
                      <Table.Th scope="col" className={classes.labelColumn}>Label</Table.Th>
                      <Table.Th scope="col">Actions</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {keyVariants(selectedKey).map(({ direction, label, key }) => (
                      <Table.Tr key={direction} data-direction={direction}>
                        <Table.Th scope="row">{label}</Table.Th>
                        <Table.Td className={classes.actionLabel}>{labelText(key.design.label)}</Table.Td>
                        <Table.Td><Code block className={classes.action}>{actionsText(key.press_actions)}</Code></Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              )}
            </Stack>
          )}
        </Box>
      </Stack>
    </Container>
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <MantineProvider forceColorScheme="dark">
      <App />
    </MantineProvider>
  </StrictMode>,
);
