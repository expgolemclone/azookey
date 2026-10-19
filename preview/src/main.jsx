import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Accordion,
  Alert,
  Badge,
  Box,
  Button,
  Code,
  Container,
  Group,
  MantineProvider,
  Paper,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core';
import '@mantine/core/styles.css';
import { actionsText, gridRows, keyLabel, keyVariants, labelText } from './layout.js';

const layouts = Object.values(import.meta.glob('../../*.json', {
  eager: true,
  import: 'default',
})).toSorted((left, right) => left.identifier.localeCompare(right.identifier));

function App() {
  const [activeId, setActiveId] = useState('ja');
  const [selectedKey, setSelectedKey] = useState(null);
  const layout = layouts.find((item) => item.identifier === activeId);
  const { row_count: width, column_count: height } = layout.interface.key_layout;

  return (
    <Container size="lg" py="xl">
      <Stack gap="lg">
        <Group justify="space-between">
          <Title order={1}>Keyboard preview</Title>
          <Badge color="gray">Read-only</Badge>
        </Group>
        <Text>
          View layouts and flick options from JSON. Selecting a key does not type or change files.
        </Text>
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
        <Group>
          <Code>{layout.identifier}.json</Code>
          <Text size="sm">{width} columns x {height} rows</Text>
          <Text size="sm">Flick options surround each key. Select its center to inspect actions.</Text>
        </Group>
        <Table.ScrollContainer minWidth={900}>
          <Table
            aria-label={`${activeId} key layout`}
            withTableBorder
            withColumnBorders
            layout="fixed"
            horizontalSpacing="xs"
            verticalSpacing="sm"
          >
            <Table.Tbody>
              {gridRows(layout).map((row, y) => (
                <Table.Tr key={y}>
                  {row.map(({ x, y, entry }) => {
                    if (!entry) return <Table.Td key={x} data-key-position={`${x},${y}`} />;
                    const { width, height } = entry.specifier;
                    const variants = keyVariants(entry);
                    const flicks = Object.fromEntries(variants
                      .filter((item) => item.direction !== 'center')
                      .map((item) => [item.direction, labelText(item.key.design.label)]));
                    return (
                      <Table.Td
                        key={x}
                        colSpan={width}
                        rowSpan={height}
                        data-key-position={`${x},${y}`}
                      >
                        <SimpleGrid
                          cols={3}
                          spacing={0}
                          verticalSpacing="xs"
                          style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 2fr) minmax(0, 1fr)' }}
                        >
                          <Box />
                          <Text size="xs" ta="center">{flicks.top}</Text>
                          <Box />
                          <Text size="xs" ta="center">{flicks.left}</Text>
                          <Button
                            size="compact-sm"
                            fullWidth
                            h="auto"
                            p={4}
                            styles={{ label: { whiteSpace: 'normal', overflowWrap: 'anywhere', lineHeight: 1.5 } }}
                            variant={selectedKey === entry ? 'filled' : 'light'}
                            color={entry.key_type === 'system' || entry.key.design.color === 'special' ? 'gray' : 'blue'}
                            aria-label={`${keyLabel(entry)}, x=${x}, y=${y}`}
                            aria-pressed={selectedKey === entry}
                            onClick={() => setSelectedKey(entry)}
                          >
                            {keyLabel(entry)}
                          </Button>
                          <Text size="xs" ta="center">{flicks.right}</Text>
                          <Box />
                          <Text size="xs" ta="center">{flicks.bottom}</Text>
                          <Box />
                        </SimpleGrid>
                      </Table.Td>
                    );
                  })}
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
        <Text size="sm">
          Icons are shown as text. Device themes and system key behavior are not simulated.
        </Text>
        <Paper withBorder p="md">
          <Stack gap="sm">
            <Title order={2}>Selected key</Title>
            {!selectedKey ? (
              <Text>Select the center button of a key.</Text>
            ) : (
              <>
                <Group>
                  <Text fw={700}>{keyLabel(selectedKey)}</Text>
                  <Code>x={selectedKey.specifier.x}, y={selectedKey.specifier.y}</Code>
                  <Text size="sm">Width {selectedKey.specifier.width} x height {selectedKey.specifier.height}</Text>
                </Group>
                {selectedKey.key_type === 'system' ? (
                  <Alert title="System key" color="gray">
                    <Code>{selectedKey.key.type}</Code>
                    <Text size="sm">
                      Small kana and voicing behavior depends on azooKey settings and cannot be determined from JSON alone.
                    </Text>
                  </Alert>
                ) : (
                  <Accordion
                    key={`${activeId}:${selectedKey.specifier.x},${selectedKey.specifier.y}`}
                    defaultValue="center"
                  >
                    {keyVariants(selectedKey).map(({ direction, label, key }) => (
                      <Accordion.Item key={direction} value={direction}>
                        <Accordion.Control>{label}: {labelText(key.design.label)}</Accordion.Control>
                        <Accordion.Panel>
                          <Stack gap="sm">
                            <Code>{JSON.stringify(key.design.label)}</Code>
                            <Table.ScrollContainer minWidth={600}>
                              <Table aria-label={`${label} actions`}>
                                <Table.Thead>
                                  <Table.Tr>
                                    <Table.Th>Gesture</Table.Th>
                                    <Table.Th>Actions</Table.Th>
                                  </Table.Tr>
                                </Table.Thead>
                                <Table.Tbody>
                                  <Table.Tr>
                                    <Table.Td>Tap</Table.Td>
                                    <Table.Td><Code block>{actionsText(key.press_actions)}</Code></Table.Td>
                                  </Table.Tr>
                                </Table.Tbody>
                              </Table>
                            </Table.ScrollContainer>
                          </Stack>
                        </Accordion.Panel>
                      </Accordion.Item>
                    ))}
                  </Accordion>
                )}
              </>
            )}
          </Stack>
        </Paper>
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
