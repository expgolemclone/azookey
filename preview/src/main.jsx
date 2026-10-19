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
  const [activeId, setActiveId] = useState('kana');
  const [selectedKey, setSelectedKey] = useState(null);
  const layout = layouts.find((item) => item.identifier === activeId);
  const { row_count: width, column_count: height } = layout.interface.key_layout;

  return (
    <Container size="lg" py="xl">
      <Stack gap="lg">
        <Group justify="space-between">
          <Title order={1}>キーボードプレビュー</Title>
          <Badge color="gray">閲覧専用</Badge>
        </Group>
        <Text c="dimmed">
          JSONから配置とフリック先を表示します. キーを選択しても入力やファイル変更は行いません.
        </Text>
        <SegmentedControl
          aria-label="レイアウト"
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
          <Text size="sm">{width}列 x {height}行</Text>
          <Text size="sm" c="dimmed">上下左右はフリック先. 中央のボタンで動作を確認できます.</Text>
        </Group>
        <Table.ScrollContainer minWidth={900}>
          <Table
            aria-label={`${activeId}のキー配置`}
            withTableBorder
            withColumnBorders
            tableLayout="fixed"
            horizontalSpacing="xs"
            verticalSpacing="sm"
          >
            <Table.Tbody>
              {gridRows(layout).map((row, y) => (
                <Table.Tr key={y}>
                  {row.map((entry) => {
                    const { x, y, width, height } = entry.specifier;
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
                        <SimpleGrid cols={3} spacing={0} verticalSpacing="xs">
                          <Box />
                          <Text size="xs" ta="center">{flicks.top}</Text>
                          <Box />
                          <Text size="xs" ta="center">{flicks.left}</Text>
                          <Button
                            size="compact-sm"
                            fullWidth
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
        <Text size="sm" c="dimmed">
          アイコンは文字で表現しています. 端末のテーマやシステムキーの動作は再現しません.
        </Text>
        <Paper withBorder p="md">
          <Stack gap="sm">
            <Title order={2}>選択したキー</Title>
            {!selectedKey ? (
              <Text c="dimmed">キー中央のボタンを選択してください.</Text>
            ) : (
              <>
                <Group>
                  <Text fw={700}>{keyLabel(selectedKey)}</Text>
                  <Code>x={selectedKey.specifier.x}, y={selectedKey.specifier.y}</Code>
                  <Text size="sm">幅{selectedKey.specifier.width} x 高さ{selectedKey.specifier.height}</Text>
                </Group>
                {selectedKey.key_type === 'system' ? (
                  <Alert title="システムキー" color="gray">
                    <Code>{selectedKey.key.type}</Code>
                    <Text size="sm">
                      小文字や濁点の操作はazooKey側の設定に依存するため, JSONだけでは動作を特定できません.
                    </Text>
                  </Alert>
                ) : (
                  <Accordion
                    key={`${activeId}:${selectedKey.specifier.x},${selectedKey.specifier.y}`}
                    defaultValue="center"
                  >
                    {keyVariants(selectedKey).map(({ direction, label, key }) => {
                      const { duration = 'normal', start, repeat } = key.longpress_actions;
                      return (
                        <Accordion.Item key={direction} value={direction}>
                          <Accordion.Control>{label}: {labelText(key.design.label)}</Accordion.Control>
                          <Accordion.Panel>
                            <Stack gap="sm">
                              <Code>{JSON.stringify(key.design.label)}</Code>
                              <Text size="sm">長押し判定: {duration}</Text>
                              <Table.ScrollContainer minWidth={600}>
                                <Table aria-label={`${label}の動作`}>
                                  <Table.Thead>
                                    <Table.Tr>
                                      <Table.Th>操作</Table.Th>
                                      <Table.Th>動作</Table.Th>
                                    </Table.Tr>
                                  </Table.Thead>
                                  <Table.Tbody>
                                    {[
                                      ['タップ', key.press_actions],
                                      ['長押し開始', start],
                                      ['長押し中の繰り返し', repeat],
                                    ].map(([name, actions]) => (
                                      <Table.Tr key={name}>
                                        <Table.Td>{name}</Table.Td>
                                        <Table.Td><Code block>{actionsText(actions)}</Code></Table.Td>
                                      </Table.Tr>
                                    ))}
                                  </Table.Tbody>
                                </Table>
                              </Table.ScrollContainer>
                            </Stack>
                          </Accordion.Panel>
                        </Accordion.Item>
                      );
                    })}
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
    <MantineProvider>
      <App />
    </MantineProvider>
  </StrictMode>,
);
