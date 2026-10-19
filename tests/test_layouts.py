from collections import Counter
from copy import deepcopy
import json
from pathlib import Path
from string import ascii_lowercase
import unittest
from unittest.mock import patch
from unicodedata import category, east_asian_width


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
        "complete", "dismiss_keyboard", "paste",
        "smart_delete_default", "toggle_caps_lock_state",
    )},
}
CONTROL_ACTIONS = {
    ("system_image", "delete.left"): [{"type": "delete", "count": 1}],
    ("system_image", "chevron.left"): [{"type": "move_cursor", "count": -1}],
    ("text", "Space"): [{"type": "input", "text": " "}],
    ("text", "ENTER"): [{"type": "complete"}],
}
CONTROL_POSITIONS = {
    ("system_image", "delete.left"): (4, 0, 1, 1),
    ("system_image", "chevron.left"): (0, 1, 1, 1),
    ("text", "Space"): (4, 1, 1, 1),
    ("text", "ENTER"): (4, 2, 1, 2),
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
    return "text", label["text"]


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
        field = "system_image" if "system_image" in label else "text"
        self.assertEqual(set(label), {field})
        self.assertIs(type(label[field]), str)
        self.assertTrue(label[field])

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
                targets = {*self.layouts, *(f"{name}-help" for name in self.layouts)} if action["tab_type"] == "custom" else {
                    "clipboard_history_tab",
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
        self.assertTrue(key["press_actions"] or key.get("variations"))
        self.assert_action_contract(key["press_actions"])
        longpress = key["longpress_actions"]
        self.assertEqual(set(longpress), {"start", "repeat"})
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
        self.assertEqual(set(self.layouts), {"eng", "ja", "num"})
        for name, layout in self.layouts.items():
            with self.subTest(layout=name):
                self.assertEqual(set(layout), {"identifier", "input_style", "language", "metadata", "interface"})
                self.assertEqual(layout["identifier"], name)
                self.assertEqual(layout["input_style"], "direct")
                self.assertEqual(layout["language"], "en_US" if name == "eng" else "ja_JP")
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
                        self.assertEqual(name, "ja")
                        self.assertEqual(entry["key"], {"type": "flick_kogaki"})
                    else:
                        self.assert_key_contract(entry["key"])

    def test_grid_is_full_without_overlaps(self):
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

    def test_bottom_left_toggles_the_current_layout_help(self):
        for name, layout in self.layouts.items():
            entries = [entry for entry in layout["interface"]["keys"]
                       if entry["specifier"]["x"] == 0 and entry["specifier"]["y"] == 3]
            with self.subTest(layout=name):
                self.assertEqual(len(entries), 1)
                self.assertEqual(entries[0], {
                    "key_type": "custom",
                    "specifier_type": "grid_fit",
                    "specifier": {"x": 0, "y": 3, "width": 1, "height": 1},
                    "key": {
                        "design": {"color": "special", "label": {"text": "?"}},
                        "press_actions": [{"type": "move_tab", "tab_type": "custom", "identifier": f"{name}-help"}],
                        "longpress_actions": {"start": [], "repeat": []},
                        "variations": [],
                    },
                })

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
                    self.assertEqual(entry["key"]["design"]["color"], "special")
                    position = tuple(entry["specifier"][field] for field in ("x", "y", "width", "height"))
                    self.assertEqual(position, CONTROL_POSITIONS[label])
                    behavior = key_behavior(entry["key"])
                    if reference is None:
                        reference = behavior
                    self.assertEqual(behavior, reference)
        system_keys = [entry["key"] for entry in self.layouts["ja"]["interface"]["keys"]
                       if entry["key_type"] == "system"]
        self.assertEqual(system_keys, [{"type": "flick_kogaki"}])

    def test_top_left_taps_ja_and_flicks_num_or_eng(self):
        for name, layout in self.layouts.items():
            entries = [entry for entry in layout["interface"]["keys"]
                       if entry["key_type"] == "custom"
                       and primary_label(entry["key"]) == ("text", "ja")]
            with self.subTest(layout=name):
                self.assertEqual(len(entries), 1)
                self.assertEqual(entries[0]["specifier"], {"x": 0, "y": 0, "width": 1, "height": 1})
                self.assertEqual(entries[0]["key"], {
                    "design": {"color": "special", "label": {"text": "ja"}},
                    "press_actions": [{"type": "move_tab", "tab_type": "custom", "identifier": "ja"}],
                    "longpress_actions": {"start": [], "repeat": []},
                    "variations": [
                        {"type": "flick_variation", "direction": direction, "key": {
                            "design": {"label": {"text": target}},
                            "press_actions": [{"type": "move_tab", "tab_type": "custom", "identifier": target}],
                            "longpress_actions": {"start": [], "repeat": []},
                        }}
                        for direction, target in (("top", "num"), ("right", "eng"))
                    ],
                })

    def test_left_column_symbol_key_keeps_markdown_pairs_and_right_flick(self):
        for name, layout in self.layouts.items():
            symbols = next(entry["key"] for entry in layout["interface"]["keys"]
                           if entry["specifier"]["x"] == 0 and entry["specifier"]["y"] == 2)
            with self.subTest(layout=name):
                self.assertEqual(symbols["design"], {"color": "normal", "label": {"text": "@"}})
                self.assertEqual(symbols["press_actions"], [{"type": "input", "text": "@"}])
                self.assertEqual(symbols["longpress_actions"], {"start": [], "repeat": []})
                self.assertEqual({flick["direction"]: flick["key"] for flick in symbols["variations"]}, {
                    direction: {
                        "design": {"label": {"text": text}},
                        "press_actions": [{"type": "input", "text": text}],
                        "longpress_actions": {"start": [], "repeat": []},
                    }
                    for direction, text in (("top", "``"), ("right", ">"), ("bottom", "``````"))
                })

    def test_enter_left_flick_inserts_newline_without_hold_actions(self):
        for name, layout in self.layouts.items():
            enter = next(entry["key"] for entry in layout["interface"]["keys"]
                         if entry["specifier"]["x"] == 4 and entry["specifier"]["y"] == 2)
            with self.subTest(layout=name):
                self.assertEqual(enter["longpress_actions"], {"start": [], "repeat": []})
                self.assertEqual(enter["variations"], [{
                    "type": "flick_variation", "direction": "left", "key": {
                        "design": {"label": {"text": "Return"}},
                        "press_actions": [{"type": "input", "text": "\n"}],
                        "longpress_actions": {"start": [], "repeat": []},
                    },
                }])

    def test_tab_links_are_complete_valid_and_labelled(self):
        for name, layout in self.layouts.items():
            targets = Counter()
            for key in objects(layout):
                if "press_actions" not in key:
                    continue
                for action in key["press_actions"]:
                    if action["type"] == "move_tab" and action["tab_type"] == "custom":
                        with self.subTest(layout=name, target=action["identifier"]):
                            target = action["identifier"]
                            self.assertIn(target, {*self.layouts, f"{name}-help"})
                            self.assertEqual(primary_label(key), ("text", "?" if target == f"{name}-help" else target))
                            targets[target] += 1
            with self.subTest(layout=name):
                self.assertEqual(targets, Counter({target: 1 for target in (*self.layouts, f"{name}-help")}))

    def test_required_characters_remain_reachable(self):
        required = {
            "eng": set(ascii_lowercase),
            "ja": set("あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをんー"),
            "num": set("0123456789"),
        }
        for name, layout in self.layouts.items():
            inputs = {action["text"] for key in objects(layout) if "press_actions" in key
                      for action in key["press_actions"] if action["type"] == "input"}
            with self.subTest(layout=name):
                self.assertFalse((required[name] | {" ", "\t", "\n", ",", ".", "?", "!"}) - inputs)
        self.assertIn({"type": "toggle_caps_lock_state"}, list(objects(self.layouts["eng"])))
        self.assertIn({"type": "flick_kogaki"}, list(objects(self.layouts["ja"])))

    def test_fullwidth_forms_and_wide_punctuation_are_absent(self):
        for name, layout in self.layouts.items():
            characters = set(json.dumps(layout, ensure_ascii=False))
            forbidden = {f"U+{ord(char):04X}" for char in characters
                         if east_asian_width(char) == "F"
                         or east_asian_width(char) == "W" and category(char).startswith("P")}
            with self.subTest(layout=name):
                self.assertEqual(forbidden, set())

    def test_delete_flicks_only_smart_delete_or_hide(self):
        for name, layout in self.layouts.items():
            delete = next(entry["key"] for entry in layout["interface"]["keys"]
                          if entry["specifier"]["x"] == 4 and entry["specifier"]["y"] == 0)
            with self.subTest(layout=name):
                self.assertEqual({flick["direction"]: flick["key"]["press_actions"]
                                  for flick in delete["variations"]}, {
                    "left": [{"type": "smart_delete_default"}],
                    "bottom": [{"type": "dismiss_keyboard"}],
                })

    def test_english_word_shortcuts_follow_frequency_ranking(self):
        # Robyn Speer, wordfreq 3.1.1, English large list (CC BY-SA 4.0).
        # https://pypi.org/project/wordfreq/3.1.1/; top words per tap initial.
        expected = (
            "really right real read of on have he not no new the in is it "
            "and as are so she like life last love"
        ).split()
        words = []
        entries = sorted(self.layouts["eng"]["interface"]["keys"],
                         key=lambda entry: (entry["specifier"]["y"], entry["specifier"]["x"]))
        for entry in entries:
            key = entry["key"]
            label = primary_label(key)[1]
            if label not in set(ascii_lowercase):
                continue
            flicks = {flick["direction"]: flick["key"] for flick in key["variations"]}
            for direction in ("top", "left", "right", "bottom"):
                if direction not in flicks:
                    continue
                flick = flicks[direction]
                word = primary_label(flick)[1]
                if len(word) <= 1:
                    continue
                words.append(word)
                with self.subTest(key=label, direction=direction, word=word):
                    self.assertTrue(word.startswith(key["press_actions"][0]["text"]))
                    self.assertEqual(flick["press_actions"], [{"type": "input", "text": word + " "}])
        self.assertEqual(words, expected)

    def test_input_labels_match_their_actions(self):
        for name, layout in self.layouts.items():
            for key in objects(layout):
                actions = key.get("press_actions", [])
                if len(actions) != 1 or actions[0]["type"] != "input":
                    continue
                text = actions[0]["text"]
                expected = {" ": "Space", "\t": "tab", "\n": "Return"}.get(text, text.removesuffix(" "))
                with self.subTest(layout=name, label=key["design"]["label"], input=text):
                    self.assertEqual(primary_label(key), ("text", expected))

    def test_all_longpress_actions_are_disabled(self):
        for name, layout in self.layouts.items():
            for key in objects(layout):
                if "longpress_actions" in key:
                    with self.subTest(layout=name, label=key["design"]["label"]):
                        self.assertEqual(key["longpress_actions"], {"start": [], "repeat": []})

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
            entry = next(entry for entry in layouts["eng"]["interface"]["keys"]
                         if entry["specifier"]["x"] == 2 and entry["specifier"]["y"] == 1)
            entry["specifier"]["x"] = 1

        def remove_delete(layouts):
            layouts["num"]["interface"]["keys"] = [
                entry for entry in layouts["num"]["interface"]["keys"]
                if entry["specifier"]["x"] != 4 or entry["specifier"]["y"] != 0
            ]

        def replace_word(layouts, word):
            parent = key(layouts, "eng", 1, 0)
            flick = next(item["key"] for item in parent["variations"] if item["direction"] == "top")
            flick["design"]["label"]["text"] = word
            flick["press_actions"][0]["text"] = word + " "

        mutations = [
            ("grid_is_full_without_overlaps", "overlapping keys", overlap),
            ("grid_is_full_without_overlaps", "unexpected gap", remove_delete),
            ("grid_is_full_without_overlaps", "missing help toggle",
             lambda layouts: layouts["num"]["interface"]["keys"].pop(0)),
            ("bottom_left_toggles_the_current_layout_help", "help opens the wrong layout",
             lambda layouts: key(layouts, "eng", 0, 3)["press_actions"][0].update(identifier="ja-help")),
            ("bottom_left_toggles_the_current_layout_help", "help toggles on hold",
             lambda layouts: key(layouts, "ja", 0, 3)["longpress_actions"]["start"].append(
                 {"type": "move_tab", "tab_type": "custom", "identifier": "ja-help"})),
            ("bottom_left_toggles_the_current_layout_help", "help emits a question mark",
             lambda layouts: key(layouts, "num", 0, 3).update(press_actions=[{"type": "input", "text": "?"}])),
            ("top_left_taps_ja_and_flicks_num_or_eng", "layout restored to bottom left",
             lambda layouts: next(entry for entry in layouts["eng"]["interface"]["keys"]
                                  if entry["specifier"]["x"] == 0 and entry["specifier"]["y"] == 0)["specifier"].update(y=3)),
            ("top_left_taps_ja_and_flicks_num_or_eng", "missing Japanese tap",
             lambda layouts: key(layouts, "eng", 0, 0)["press_actions"].clear()),
            ("top_left_taps_ja_and_flicks_num_or_eng", "wrong Japanese tap target",
             lambda layouts: key(layouts, "num", 0, 0)["press_actions"][0].update(identifier="eng")),
            ("top_left_taps_ja_and_flicks_num_or_eng", "missing right flick",
             lambda layouts: key(layouts, "eng", 0, 0)["variations"].pop()),
            ("top_left_taps_ja_and_flicks_num_or_eng", "missing up flick",
             lambda layouts: key(layouts, "num", 0, 0)["variations"].pop(0)),
            ("top_left_taps_ja_and_flicks_num_or_eng", "layout-dependent flick target",
             lambda layouts: key(layouts, "ja", 0, 0)["variations"][0]["key"]["press_actions"][0].update(identifier="eng")),
            ("top_left_taps_ja_and_flicks_num_or_eng", "retired emoji tap",
             lambda layouts: key(layouts, "eng", 0, 0)["press_actions"].append(
                 {"type": "move_tab", "tab_type": "system", "identifier": "emoji_tab"})),
            ("top_left_taps_ja_and_flicks_num_or_eng", "retired emoji label",
             lambda layouts: key(layouts, "ja", 0, 0)["design"]["label"].update(text="Emoji")),
            ("layout_set_and_supported_format", "retired emoji flick",
             lambda layouts: key(layouts, "num", 0, 0)["variations"][0]["key"]["press_actions"][0].update(
                 tab_type="system", identifier="emoji_tab")),
            ("layout_set_and_supported_format", "empty character key",
             lambda layouts: key(layouts, "eng", 1, 0).update(press_actions=[], variations=[])),
            ("layout_set_and_supported_format", "empty flick action",
             lambda layouts: key(layouts, "eng", 1, 0)["variations"][0]["key"].update(press_actions=[])),
            ("left_column_symbol_key_keeps_markdown_pairs_and_right_flick", "missing symbol",
             lambda layouts: key(layouts, "num", 0, 2)["variations"].pop()),
            ("left_column_symbol_key_keeps_markdown_pairs_and_right_flick", "wrong symbol input",
             lambda layouts: key(layouts, "eng", 0, 2)["press_actions"][0].update(text="!")),
            ("left_column_symbol_key_keeps_markdown_pairs_and_right_flick", "misplaced greater than",
             lambda layouts: key(layouts, "ja", 0, 2)["variations"][1].update(direction="bottom")),
            ("left_column_symbol_key_keeps_markdown_pairs_and_right_flick", "single backtick",
             lambda layouts: key(layouts, "eng", 0, 2)["variations"][0]["key"]["press_actions"][0].update(text="`")),
            ("left_column_symbol_key_keeps_markdown_pairs_and_right_flick", "restored double quote",
             lambda layouts: key(layouts, "num", 0, 2)["variations"][1]["key"]["press_actions"][0].update(text='"')),
            ("left_column_symbol_key_keeps_markdown_pairs_and_right_flick", "incomplete fenced pair",
             lambda layouts: key(layouts, "ja", 0, 2)["variations"][2]["key"]["press_actions"][0].update(text="```")),
            ("shared_controls_are_present_correct_and_consistent", "cursor in wrong row",
             lambda layouts: next(entry for entry in layouts["ja"]["interface"]["keys"]
                                  if entry["specifier"]["x"] == 0 and entry["specifier"]["y"] == 1)["specifier"].update(y=2)),
            ("shared_controls_are_present_correct_and_consistent", "cursor uses normal key color",
             lambda layouts: key(layouts, "eng", 0, 1)["design"].update(color="normal")),
            ("required_characters_remain_reachable", "missing lowercase b",
             lambda layouts: key(layouts, "eng", 3, 2)["variations"][0]["key"]["press_actions"][0].update(text="s")),
            ("required_characters_remain_reachable", "missing caps control",
             lambda layouts: key(layouts, "eng", 1, 3).update(press_actions=[])),
            ("required_characters_remain_reachable", "missing small/voiced control",
             lambda layouts: key(layouts, "ja", 1, 3).update(type="flick_space")),
            ("english_word_shortcuts_follow_frequency_ranking", "wrong tap initial",
             lambda layouts: replace_word(layouts, "the")),
            ("english_word_shortcuts_follow_frequency_ranking", "lower frequency word",
             lambda layouts: replace_word(layouts, "run")),
            ("english_word_shortcuts_follow_frequency_ranking", "missing word trailing space",
             lambda layouts: key(layouts, "eng", 1, 0)["variations"][0]["key"]["press_actions"][0].update(text="really")),
            ("all_longpress_actions_are_disabled", "letter hold",
             lambda layouts: key(layouts, "eng", 1, 0)["longpress_actions"]["start"].append(
                 {"type": "input", "text": "R"})),
            ("all_longpress_actions_are_disabled", "word flick hold",
             lambda layouts: key(layouts, "eng", 1, 0)["variations"][0]["key"]["longpress_actions"]["start"].append(
                 {"type": "input", "text": "The "})),
            ("all_longpress_actions_are_disabled", "kana flick hold",
             lambda layouts: key(layouts, "ja", 1, 0)["variations"][0]["key"]["longpress_actions"]["start"].append(
                 {"type": "input", "text": "ぃ"})),
            ("all_longpress_actions_are_disabled", "delete repeat",
             lambda layouts: key(layouts, "num", 4, 0)["longpress_actions"]["repeat"].append(
                 {"type": "delete", "count": 1})),
            ("all_longpress_actions_are_disabled", "cursor flick repeat",
             lambda layouts: key(layouts, "num", 0, 1)["variations"][0]["key"]["longpress_actions"]["repeat"].append(
                 {"type": "move_cursor", "count": 1})),
            ("all_longpress_actions_are_disabled", "space hold",
             lambda layouts: key(layouts, "ja", 4, 1)["longpress_actions"]["start"].append(
                 {"type": "toggle_cursor_bar"})),
            ("layout_set_and_supported_format", "permanent directional hints",
             lambda layouts: key(layouts, "eng", 1, 0)["design"].update(label={
                 "type": "main_and_directions", "main": "r", "directions": {"top": "really"},
             })),
            ("layout_set_and_supported_format", "directional hints mixed with plain text",
             lambda layouts: key(layouts, "num", 1, 0)["design"]["label"].update(directions={"top": "↑"})),
            ("input_labels_match_their_actions", "wrong flick input",
             lambda layouts: key(layouts, "eng", 1, 0)["variations"][0]["key"]["press_actions"][0].update(text="why ")),
            ("input_labels_match_their_actions", "uppercase center label for lowercase input",
             lambda layouts: key(layouts, "eng", 1, 0)["design"]["label"].update(text="R")),
            ("input_labels_match_their_actions", "uppercase flick label for lowercase input",
             lambda layouts: key(layouts, "eng", 3, 2)["variations"][0]["key"]["design"]["label"].update(text="B")),
            ("input_labels_match_their_actions", "misleading punctuation group label",
             lambda layouts: key(layouts, "ja", 3, 3)["design"]["label"].update(text=",.?!")),
            ("input_labels_match_their_actions", "wrong kana flick label",
             lambda layouts: key(layouts, "ja", 1, 0)["variations"][0]["key"]["design"]["label"].update(text="う")),
            ("layout_set_and_supported_format", "unsupported action",
             lambda layouts: key(layouts, "eng", 1, 0)["press_actions"][0].update(type="inptu")),
            ("layout_set_and_supported_format", "retired resize action",
             lambda layouts: key(layouts, "eng", 0, 0)["press_actions"].append(
                 {"type": "enable_resizing_mode"})),
            ("fullwidth_forms_and_wide_punctuation_are_absent", "fullwidth digit input",
             lambda layouts: key(layouts, "num", 1, 0)["press_actions"][0].update(text="\uff11")),
            ("fullwidth_forms_and_wide_punctuation_are_absent", "fullwidth space input",
             lambda layouts: key(layouts, "eng", 4, 1)["press_actions"][0].update(text="\u3000")),
            ("fullwidth_forms_and_wide_punctuation_are_absent", "fullwidth punctuation label",
             lambda layouts: key(layouts, "ja", 3, 3)["design"]["label"].update(text="\uff1f")),
            ("fullwidth_forms_and_wide_punctuation_are_absent", "wide punctuation input",
             lambda layouts: key(layouts, "ja", 3, 3)["press_actions"][0].update(text="\u3002")),
            ("fullwidth_forms_and_wide_punctuation_are_absent", "fullwidth replacement output",
             lambda layouts: key(layouts, "num", 1, 3)["press_actions"][0]["table"].update({"1": "\uff11"})),
            ("delete_flicks_only_smart_delete_or_hide", "extra delete flick",
             lambda layouts: key(layouts, "num", 4, 0)["variations"].append({
                 "direction": "top", "key": {"press_actions": [{"type": "dismiss_keyboard"}]},
             })),
            ("layout_set_and_supported_format", "invalid action parameter",
             lambda layouts: key(layouts, "num", 4, 0)["press_actions"][0].update(count="1")),
            ("layout_set_and_supported_format", "unsupported language",
             lambda layouts: layouts["eng"].update(language="zz_ZZ")),
            ("layout_set_and_supported_format", "wrong key style",
             lambda layouts: layouts["num"]["interface"].update(key_style="pc_style")),
            ("layout_set_and_supported_format", "obsolete English identifier",
             lambda layouts: layouts["eng"].update(identifier="abc")),
            ("layout_set_and_supported_format", "obsolete Japanese display name",
             lambda layouts: layouts["ja"]["metadata"].update(display_name="kana")),
            ("shared_controls_are_present_correct_and_consistent", "missing delete control", remove_delete),
            ("shared_controls_are_present_correct_and_consistent", "renamed delete control",
             lambda layouts: key(layouts, "num", 4, 0)["design"]["label"].update(system_image="trash")),
            ("shared_controls_are_present_correct_and_consistent", "changed control action",
             lambda layouts: key(layouts, "num", 4, 0)["press_actions"][0].update(count=2)),
            ("shared_controls_are_present_correct_and_consistent", "newline on enter tap",
             lambda layouts: key(layouts, "num", 4, 2).update(
                 press_actions=[{"type": "input", "text": "\n"}])),
            ("enter_left_flick_inserts_newline_without_hold_actions", "completion on return flick",
             lambda layouts: key(layouts, "num", 4, 2)["variations"][0]["key"].update(
                 press_actions=[{"type": "complete"}])),
            ("tab_links_are_complete_valid_and_labelled", "obsolete words tab",
             lambda layouts: key(layouts, "eng", 0, 0)["variations"][0]["key"]["press_actions"][0].update(identifier="words")),
            ("tab_links_are_complete_valid_and_labelled", "obsolete English tab link",
             lambda layouts: key(layouts, "num", 0, 0)["variations"][1]["key"]["press_actions"][0].update(identifier="abc")),
            ("tab_links_are_complete_valid_and_labelled", "obsolete Japanese tab link",
             lambda layouts: key(layouts, "eng", 0, 0)["press_actions"][0].update(identifier="kana")),
            ("tab_links_are_complete_valid_and_labelled", "missing current layout shortcut",
             lambda layouts: key(layouts, "num", 0, 0)["variations"].pop(0)),
            ("all_longpress_actions_are_disabled", "obsolete longpress timing",
             lambda layouts: key(layouts, "eng", 1, 0)["longpress_actions"].update(duration="light")),
            ("layout_set_and_supported_format", "longpress variation",
             lambda layouts: key(layouts, "eng", 1, 0)["variations"][0].update(type="longpress_variation")),
            ("layout_set_and_supported_format", "unknown flick direction",
             lambda layouts: key(layouts, "eng", 1, 0)["variations"][0].update(direction="up")),
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
        key = deepcopy(LayoutTests.layouts["eng"]["interface"]["keys"][4]["key"])
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
