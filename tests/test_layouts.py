from collections import Counter
from copy import deepcopy
import json
from pathlib import Path
from string import ascii_letters
import unittest
from unittest.mock import patch


REPOSITORY = Path(__file__).resolve().parents[1]
DIRECTIONS = {"left", "top", "right", "bottom"}
# The project's used subset of azooKey's CustardKit/CustardActions.swift contract.
ACTION_FIELDS = {
    "input": {"text": str},
    "delete": {"count": int},
    "move_cursor": {"count": int},
    "smart_move_cursor": {"direction": str, "targets": list},
    "move_tab": {"tab_type": str, "identifier": str},
    "replace_last_characters": {"table": dict},
    **{name: {} for name in (
        "complete", "dismiss_keyboard", "enable_resizing_mode", "paste",
        "smart_delete_default", "toggle_caps_lock_state", "toggle_cursor_bar",
    )},
}
CONTROL_ACTIONS = {
    ("system_image", "delete.left"): [{"type": "delete", "count": 1}],
    ("system_image", "chevron.left"): [{"type": "move_cursor", "count": -1}],
    ("system_image", "face.smiling"): [
        {"type": "move_tab", "tab_type": "system", "identifier": "emoji_tab"},
    ],
    ("text", "空白"): [{"type": "input", "text": " "}],
    ("text", "改行"): [{"type": "input", "text": "\n"}],
}
CONTROL_POSITIONS = {
    ("system_image", "delete.left"): (4, 0, 1, 1),
    ("system_image", "face.smiling"): (0, 3, 1, 1),
    ("text", "空白"): (4, 1, 1, 1),
    ("text", "改行"): (4, 2, 1, 2),
}


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"Duplicate JSON key: {key}")
        result[key] = value
    return result


def objects(value):
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from objects(child)
    elif isinstance(value, list):
        for child in value:
            yield from objects(child)


def primary_label(key):
    label = key["design"]["label"]
    if "system_image" in label:
        return "system_image", label["system_image"]
    return "text", label["main"] if "main" in label else label["text"]


def key_behavior(key):
    behavior = {field: value for field, value in key.items() if field != "design"}
    if "variations" in key:
        behavior["variations"] = sorted(
            ({**variation, "key": key_behavior(variation["key"])}
             for variation in key["variations"]),
            key=lambda variation: (
                variation["type"],
                variation.get("direction", ""),
            ),
        )
    return behavior


def is_text_alternative(longpress):
    return (
        bool(longpress["start"])
        and not longpress["repeat"]
        and any(action["type"] == "input" for action in longpress["start"])
        and all(action["type"] in {"input", "complete"}
                for action in longpress["start"])
    )


def outward_side_flicks(layout):
    interface = layout["interface"]
    width = interface["key_layout"]["row_count"]
    violations = []
    for entry in interface["keys"]:
        if entry["key_type"] != "custom":
            continue
        position = entry["specifier"]
        for variation in entry["key"]["variations"]:
            if variation["type"] != "flick_variation":
                continue
            direction = variation["direction"]
            if (direction == "left" and position["x"] == 0
                    or direction == "right"
                    and position["x"] + position["width"] == width):
                violations.append((position["x"], position["y"], direction))
    return violations


class LayoutTests(unittest.TestCase):
    layouts = {
        path.stem: json.loads(path.read_text(encoding="utf-8"),
                              object_pairs_hook=unique_object)
        for path in sorted(REPOSITORY.glob("*.json"))
    }

    def assert_label_contract(self, label):
        if "text" in label or "system_image" in label:
            field = "text" if "text" in label else "system_image"
            self.assertEqual(set(label), {field})
            self.assertIs(type(label[field]), str)
            self.assertTrue(label[field])
        else:
            self.assertEqual(set(label), {"type", "main", "directions"})
            self.assertEqual(label["type"], "main_and_directions")
            self.assertIs(type(label["main"]), str)
            self.assertTrue(label["main"])
            self.assertIs(type(label["directions"]), dict)
            self.assertLessEqual(set(label["directions"]), DIRECTIONS)
            for text in label["directions"].values():
                self.assertIs(type(text), str)
                self.assertTrue(text)

    def assert_action_contract(self, actions):
        self.assertIs(type(actions), list)
        for action in actions:
            self.assertIn(action["type"], ACTION_FIELDS)
            fields = ACTION_FIELDS[action["type"]]
            self.assertEqual(set(action), {"type", *fields})
            for field, expected_type in fields.items():
                self.assertIs(type(action[field]), expected_type)
            if action["type"] == "input":
                self.assertTrue(action["text"])
            elif action["type"] in {"delete", "move_cursor"}:
                self.assertNotEqual(action["count"], 0)
            elif action["type"] == "move_tab":
                self.assertIn(action["tab_type"], {"custom", "system"})
                targets = self.layouts if action["tab_type"] == "custom" else {
                    "emoji_tab", "clipboard_history_tab",
                }
                self.assertIn(action["identifier"], targets)
            elif action["type"] == "smart_move_cursor":
                self.assertIn(action["direction"], {"forward", "backward"})
                self.assertTrue(action["targets"])
                for target in action["targets"]:
                    self.assertIs(type(target), str)
                    self.assertTrue(target)
            elif action["type"] == "replace_last_characters":
                self.assertTrue(action["table"])
                for before, after in action["table"].items():
                    self.assertIs(type(before), str)
                    self.assertIs(type(after), str)
                    self.assertTrue(before)

    def assert_key_contract(self, key, *, variation=False):
        fields = {"design", "press_actions", "longpress_actions"}
        if not variation:
            fields.add("variations")
        self.assertEqual(set(key), fields)
        self.assertEqual(set(key["design"]), {"label"} if variation else {"label", "color"})
        self.assert_label_contract(key["design"]["label"])
        if not variation:
            self.assertIn(key["design"]["color"], {"normal", "special", "selected", "unimportant"})
        self.assertTrue(key["press_actions"])
        self.assert_action_contract(key["press_actions"])
        longpress = key["longpress_actions"]
        self.assertLessEqual(set(longpress), {"start", "repeat", "duration"})
        self.assertGreaterEqual(set(longpress), {"start", "repeat"})
        self.assertIn(longpress.get("duration", "normal"), {"normal", "light"})
        self.assert_action_contract(longpress["start"])
        self.assert_action_contract(longpress["repeat"])
        if not variation:
            self.assertIs(type(key["variations"]), list)
            for flick in key["variations"]:
                self.assertEqual(set(flick), {"type", "direction", "key"})
                self.assertEqual(flick["type"], "flick_variation")
                self.assertIn(flick["direction"], DIRECTIONS)
                self.assert_key_contract(flick["key"], variation=True)

    def test_layout_set_and_supported_format(self):
        self.assertEqual(set(self.layouts), {"abc", "kana", "num"})
        for name, layout in self.layouts.items():
            with self.subTest(layout=name):
                self.assertEqual(set(layout), {"identifier", "input_style", "language", "metadata", "interface"})
                self.assertEqual(layout["identifier"], name)
                self.assertEqual(layout["input_style"], "direct")
                self.assertEqual(layout["language"], "en_US" if name == "abc" else "ja_JP")
                self.assertEqual(layout["metadata"], {"custard_version": "1.2", "display_name": name})
                interface = layout["interface"]
                self.assertEqual(set(interface), {"key_layout", "key_style", "keys"})
                self.assertEqual(interface["key_layout"], {"type": "grid_fit", "row_count": 5, "column_count": 4})
                self.assertEqual(interface["key_style"], "tenkey_style")
                self.assertIs(type(interface["keys"]), list)
                for entry in interface["keys"]:
                    self.assertEqual(set(entry), {"key", "key_type", "specifier", "specifier_type"})
                    self.assertEqual(entry["specifier_type"], "grid_fit")
                    self.assertEqual(set(entry["specifier"]), {"x", "y", "width", "height"})
                    for value in entry["specifier"].values():
                        self.assertIs(type(value), int)
                    self.assertIn(entry["key_type"], {"custom", "system"})
                    if entry["key_type"] == "system":
                        self.assertEqual(name, "kana")
                        self.assertEqual(entry["key"], {"type": "flick_kogaki"})
                    else:
                        self.assert_key_contract(entry["key"])

    def test_grid_is_fully_tiled_without_overlaps(self):
        for name, layout in self.layouts.items():
            cells = Counter()
            for entry in layout["interface"]["keys"]:
                position = entry["specifier"]
                with self.subTest(layout=name, position=position):
                    self.assertGreater(position["width"], 0)
                    self.assertGreater(position["height"], 0)
                    self.assertGreaterEqual(position["x"], 0)
                    self.assertGreaterEqual(position["y"], 0)
                    self.assertLessEqual(position["x"] + position["width"], 5)
                    self.assertLessEqual(position["y"] + position["height"], 4)
                    cells.update((x, y)
                                 for x in range(position["x"], position["x"] + position["width"])
                                 for y in range(position["y"], position["y"] + position["height"]))
            with self.subTest(layout=name):
                self.assertEqual(cells, Counter({(x, y): 1 for x in range(5) for y in range(4)}))

    def test_shared_controls_are_present_correct_and_consistent(self):
        for label, actions in CONTROL_ACTIONS.items():
            reference = None
            for name, layout in self.layouts.items():
                with self.subTest(layout=name, control=label):
                    entries = [entry for entry in layout["interface"]["keys"]
                               if entry["key_type"] == "custom" and primary_label(entry["key"]) == label]
                    self.assertEqual(len(entries), 1)
                    entry = entries[0]
                    self.assertEqual(entry["key"]["press_actions"], actions)
                    position = tuple(entry["specifier"][field] for field in ("x", "y", "width", "height"))
                    expected = ((0, {"num": 0, "abc": 1, "kana": 2}[name], 1, 1)
                                if label == ("system_image", "chevron.left") else CONTROL_POSITIONS[label])
                    self.assertEqual(position, expected)
                    behavior = key_behavior(entry["key"])
                    if reference is None:
                        reference = behavior
                    self.assertEqual(behavior, reference)
        system_keys = [entry["key"] for entry in self.layouts["kana"]["interface"]["keys"]
                       if entry["key_type"] == "system"]
        self.assertEqual(system_keys, [{"type": "flick_kogaki"}])

    def test_tab_links_are_complete_valid_and_labelled(self):
        for name, layout in self.layouts.items():
            targets = Counter()
            for key in objects(layout):
                if "press_actions" not in key:
                    continue
                for action in key["press_actions"]:
                    if action["type"] == "move_tab" and action["tab_type"] == "custom":
                        with self.subTest(layout=name, target=action["identifier"]):
                            self.assertIn(action["identifier"], self.layouts)
                            self.assertEqual(primary_label(key), ("text", action["identifier"]))
                            targets[action["identifier"]] += 1
            with self.subTest(layout=name):
                self.assertEqual(targets, Counter({target: 1 for target in self.layouts if target != name}))

    def test_required_characters_remain_reachable(self):
        required = {
            "abc": set(ascii_letters),
            "kana": set("あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをんー"
                        "ぁぃぅぇぉゃゅょゎがぎぐげござじずぜぞだぢづでどばびぶべぼぱぴぷぺぽ"),
            "num": set("0123456789") | {chr(0xFF10 + value) for value in range(10)},
        }
        for name, layout in self.layouts.items():
            inputs = {action["text"] for action in objects(layout) if action.get("type") == "input"}
            with self.subTest(layout=name):
                self.assertFalse((required[name] | {" ", "\t", "\n", "\u3000"}) - inputs)

    def test_directional_hints_match_their_actions(self):
        for name, layout in self.layouts.items():
            for entry in layout["interface"]["keys"]:
                if entry["key_type"] != "custom":
                    continue
                key = entry["key"]
                label = key["design"]["label"]
                if label.get("type") != "main_and_directions":
                    continue
                with self.subTest(layout=name, position=entry["specifier"]):
                    center_actions = (
                        [{"type": "toggle_caps_lock_state"}] if label["main"] == "caps"
                        else [{"type": "input", "text": label["main"].lower()}]
                    )
                    self.assertEqual(key["press_actions"], center_actions)
                    flicks = {flick["direction"]: flick["key"] for flick in key["variations"]}
                    self.assertEqual(set(label["directions"]), set(flicks))
                    for direction, hint in label["directions"].items():
                        self.assertEqual(primary_label(flicks[direction]), ("text", hint))
                        word = hint.isascii() and hint.isalpha() and len(hint) > 1
                        self.assertEqual(flicks[direction]["press_actions"], [
                            {"type": "input", "text": hint.lower() + (" " if word else "")},
                        ])

    def test_longpress_timing_matches_its_purpose(self):
        for name, layout in self.layouts.items():
            for key in objects(layout):
                if "longpress_actions" in key:
                    longpress = key["longpress_actions"]
                    with self.subTest(layout=name, label=key["design"]["label"]):
                        expected = "light" if is_text_alternative(longpress) else "normal"
                        self.assertEqual(longpress.get("duration", "normal"), expected)

    def test_flick_directions_are_unique_and_stay_on_screen(self):
        for name, layout in self.layouts.items():
            with self.subTest(layout=name):
                self.assertEqual(outward_side_flicks(layout), [])
            for entry in layout["interface"]["keys"]:
                if entry["key_type"] == "custom":
                    directions = [flick["direction"] for flick in entry["key"]["variations"]]
                    with self.subTest(layout=name, position=entry["specifier"]):
                        self.assertEqual(len(directions), len(set(directions)))


class ValidationRegressionTests(unittest.TestCase):
    def test_invalid_layout_mutations_are_rejected(self):
        def key(layouts, name, x, y):
            return next(entry["key"] for entry in layouts[name]["interface"]["keys"]
                        if entry["specifier"]["x"] == x and entry["specifier"]["y"] == y)

        def overlap(layouts):
            entry = next(entry for entry in layouts["abc"]["interface"]["keys"]
                         if entry["specifier"]["x"] == 2 and entry["specifier"]["y"] == 1)
            entry["specifier"]["x"] = 1

        def remove_delete(layouts):
            layouts["num"]["interface"]["keys"] = [
                entry for entry in layouts["num"]["interface"]["keys"]
                if entry["specifier"]["x"] != 4 or entry["specifier"]["y"] != 0
            ]

        mutations = [
            ("grid_is_fully_tiled_without_overlaps", "overlapping keys", overlap),
            ("required_characters_remain_reachable", "missing lowercase b",
             lambda layouts: key(layouts, "abc", 3, 2)["variations"][0]["key"]["press_actions"][0].update(text="s")),
            ("directional_hints_match_their_actions", "wrong flick hint",
             lambda layouts: key(layouts, "abc", 1, 0)["design"]["label"]["directions"].update(top="why")),
            ("directional_hints_match_their_actions", "wrong flick input",
             lambda layouts: key(layouts, "abc", 1, 0)["variations"][0]["key"]["press_actions"][0].update(text="why ")),
            ("layout_set_and_supported_format", "unsupported action",
             lambda layouts: key(layouts, "abc", 1, 0)["press_actions"][0].update(type="inptu")),
            ("layout_set_and_supported_format", "invalid action parameter",
             lambda layouts: key(layouts, "num", 4, 0)["press_actions"][0].update(count="1")),
            ("layout_set_and_supported_format", "unsupported language",
             lambda layouts: layouts["abc"].update(language="zz_ZZ")),
            ("layout_set_and_supported_format", "wrong key style",
             lambda layouts: layouts["num"]["interface"].update(key_style="pc_style")),
            ("shared_controls_are_present_correct_and_consistent", "missing delete control", remove_delete),
            ("shared_controls_are_present_correct_and_consistent", "renamed delete control",
             lambda layouts: key(layouts, "num", 4, 0)["design"]["label"].update(system_image="trash")),
            ("shared_controls_are_present_correct_and_consistent", "changed control action",
             lambda layouts: key(layouts, "num", 4, 0)["press_actions"][0].update(count=2)),
            ("tab_links_are_complete_valid_and_labelled", "obsolete words tab",
             lambda layouts: key(layouts, "abc", 0, 0)["press_actions"][0].update(identifier="words")),
            ("layout_set_and_supported_format", "invalid duration",
             lambda layouts: key(layouts, "abc", 1, 0)["longpress_actions"].update(duration="fast")),
            ("longpress_timing_matches_its_purpose", "slow text alternative",
             lambda layouts: key(layouts, "abc", 1, 0)["longpress_actions"].update(duration="normal")),
            ("longpress_timing_matches_its_purpose", "fast repeating delete",
             lambda layouts: key(layouts, "num", 4, 0)["longpress_actions"].update(duration="light")),
            ("layout_set_and_supported_format", "unknown flick direction",
             lambda layouts: key(layouts, "abc", 1, 0)["variations"][0].update(direction="up")),
        ]
        for method, description, mutate in mutations:
            with self.subTest(mutation=description):
                method = f"test_{method}"
                baseline = unittest.TestResult()
                LayoutTests(method).run(baseline)
                self.assertTrue(baseline.wasSuccessful(), (baseline.failures, baseline.errors))
                layouts = deepcopy(LayoutTests.layouts)
                mutate(layouts)
                with patch.object(LayoutTests, "layouts", layouts):
                    result = unittest.TestResult()
                    LayoutTests(method).run(result)
                self.assertTrue(result.failures, description)
                self.assertFalse(result.errors, result.errors)

    def test_duplicate_json_keys_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "Duplicate JSON key: type"):
            json.loads('{"type": "input", "type": "delete"}', object_pairs_hook=unique_object)


class BehaviorComparisonTests(unittest.TestCase):
    def test_design_and_flick_order_do_not_change_behavior(self):
        key = deepcopy(LayoutTests.layouts["abc"]["interface"]["keys"][4]["key"])
        snapshot = deepcopy(key)
        changed = deepcopy(key)
        changed["design"] = {"label": {"text": "New"}, "color": "normal"}
        changed["variations"].reverse()
        for flick in changed["variations"]:
            flick["key"]["design"]["label"] = {"text": "New hint"}
        self.assertEqual(key_behavior(key), key_behavior(changed))
        self.assertEqual(key, snapshot)

    def test_action_parameters_order_and_presence_change_behavior(self):
        original = {
            "design": {},
            "press_actions": [{"type": "input", "text": "x"}, {"type": "complete"}],
            "longpress_actions": {"start": [], "repeat": []},
            "variations": [],
        }
        for actions in (
            [{"type": "input", "text": "y"}, {"type": "complete"}],
            list(reversed(original["press_actions"])),
            [],
        ):
            with self.subTest(actions=actions):
                changed = deepcopy(original)
                changed["press_actions"] = actions
                self.assertNotEqual(key_behavior(original), key_behavior(changed))

    def test_longpress_variation_order_is_preserved(self):
        key = {"variations": [
            {"type": "longpress_variation", "key": {"press_actions": [{"type": "input", "text": text}]}}
            for text in ("a", "b")
        ]}
        changed = deepcopy(key)
        changed["variations"].reverse()
        self.assertNotEqual(key_behavior(key), key_behavior(changed))


class EdgeDetectionTests(unittest.TestCase):
    def layout(self, x, y, direction, *, key_width=1, width=5, height=4):
        return {"interface": {
            "key_layout": {"row_count": width, "column_count": height},
            "keys": [{"key_type": "custom", "specifier": {
                "x": x, "y": y, "width": key_width, "height": 1,
            }, "key": {"variations": [{"type": "flick_variation", "direction": direction}]}}],
        }}

    def test_outward_side_flicks_are_rejected(self):
        for y in (0, 1, 3):
            for x, direction in ((0, "left"), (4, "right")):
                with self.subTest(x=x, y=y, direction=direction):
                    self.assertEqual(outward_side_flicks(self.layout(x, y, direction)), [(x, y, direction)])

    def test_inward_and_interior_flicks_are_allowed(self):
        for x, direction in ((0, "right"), (4, "left"), (2, "left"), (2, "right")):
            with self.subTest(x=x, direction=direction):
                self.assertEqual(outward_side_flicks(self.layout(x, 1, direction)), [])

    def test_wide_key_uses_its_right_edge(self):
        self.assertEqual(outward_side_flicks(self.layout(3, 1, "right", key_width=2)), [(3, 1, "right")])

    def test_row_count_is_horizontal_even_for_tall_layouts(self):
        self.assertEqual(outward_side_flicks(self.layout(3, 8, "right", width=4, height=10)), [(3, 8, "right")])
        self.assertEqual(outward_side_flicks(self.layout(3, 1, "right")), [])

    def test_vertical_edges_are_not_screen_side_edges(self):
        for x, y, direction in ((0, 0, "top"), (4, 0, "top"), (0, 3, "bottom"), (4, 3, "bottom")):
            with self.subTest(x=x, y=y, direction=direction):
                self.assertEqual(outward_side_flicks(self.layout(x, y, direction)), [])


if __name__ == "__main__":
    unittest.main()
