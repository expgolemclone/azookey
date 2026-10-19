from copy import deepcopy
import json
from pathlib import Path
import unittest


REPOSITORY = Path(__file__).resolve().parents[1]


def objects(value):
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from objects(child)
    elif isinstance(value, list):
        for child in value:
            yield from objects(child)


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
            if (
                direction == "left" and position["x"] == 0
                or direction == "right"
                and position["x"] + position["width"] == width
            ):
                violations.append((position["x"], position["y"], direction))
    return violations


def shared_control_keys(layouts):
    by_label = {}
    for name, layout in layouts.items():
        for entry in layout["interface"]["keys"]:
            if entry["key_type"] != "custom":
                continue
            label = entry["key"]["design"]["label"]
            if "system_image" in label:
                identity = ("system_image", label["system_image"])
            else:
                identity = ("text", label["main"] if "main" in label else label["text"])
            by_label.setdefault(identity, []).append((name, entry))
    return {
        label: entries
        for label, entries in by_label.items()
        if len({name for name, _ in entries}) > 1
        and any(
            all(
                action["type"] != "input" or action["text"].isspace()
                for action in entry["key"]["press_actions"]
            )
            for _, entry in entries
        )
    }


def key_behavior(key):
    behavior = {field: value for field, value in key.items() if field != "design"}
    if "variations" in key:
        behavior["variations"] = sorted(
            (
                {**variation, "key": key_behavior(variation["key"])}
                for variation in key["variations"]
            ),
            key=lambda variation: (
                variation["type"],
                variation["direction"] if variation["type"] == "flick_variation" else "",
            ),
        )
    return behavior


class SharedControlDetectionTests(unittest.TestCase):
    def key(self, label, *, flicks=True):
        key = {
            "design": {"color": "normal", "label": label},
            "press_actions": [{"type": "move_cursor", "count": 1}],
            "longpress_actions": {
                "start": [{"type": "move_cursor", "count": 1}],
                "repeat": [{"type": "move_cursor", "count": 1}],
            },
        }
        if flicks:
            key["variations"] = [
                {
                    "type": "flick_variation",
                    "direction": direction,
                    "key": self.key({"text": direction}, flicks=False),
                }
                for direction in ("left", "right")
            ]
        return key

    def layout(self, *keys):
        return {
            "interface": {
                "keys": [
                    {
                        "key_type": "custom",
                        "specifier": {"x": index, "y": 0},
                        "key": key,
                    }
                    for index, key in enumerate(keys)
                ]
            }
        }

    def test_shared_controls_are_discovered_by_primary_label(self):
        text = self.key({"text": "Shared"})
        compound = self.key({
            "type": "main_and_directions", "main": "Shared",
            "directions": {"left": "Hint"},
        })
        icon = self.key({"system_image": "shared.icon"})
        unique = self.key({"text": "Only here"})
        layouts = {
            "first": self.layout(text, icon, unique, unique, text),
            "new": self.layout(icon, compound),
            "later": self.layout(text),
        }
        layouts["later"]["interface"]["keys"].append({
            "key_type": "system", "key": {"type": "flick_kogaki"},
        })
        self.assertEqual(
            {label: [name for name, _ in entries]
             for label, entries in shared_control_keys(layouts).items()},
            {
                ("text", "Shared"): ["first", "first", "new", "later"],
                ("system_image", "shared.icon"): ["first", "new"],
            },
        )

    def test_control_action_drift_does_not_hide_a_shared_key(self):
        for action, expected in (
            ({"type": "move_cursor", "count": 1}, True),
            ({"type": "input", "text": " \t\n"}, True),
            ({"type": "input", "text": ","}, False),
        ):
            with self.subTest(action=action):
                original = self.key({"text": "Shared"})
                original["press_actions"] = [action]
                changed = deepcopy(original)
                changed["press_actions"] = [{"type": "input", "text": "changed"}]
                shared = shared_control_keys({
                    "first": self.layout(original), "second": self.layout(changed),
                })
                self.assertEqual(bool(shared), expected)
                if expected:
                    self.assertEqual(len(shared[("text", "Shared")]), 2)
                    self.assertNotEqual(key_behavior(original), key_behavior(changed))

    def test_behavior_ignores_design_and_flick_list_order(self):
        original = self.key({"text": "Shared"})
        snapshot = deepcopy(original)
        changed = deepcopy(original)
        changed["design"] = {"color": "special", "label": {"text": "Redesigned"}}
        changed["variations"].reverse()
        for variation in changed["variations"]:
            variation["key"]["design"]["label"] = {"text": "New hint"}
        self.assertEqual(key_behavior(original), key_behavior(changed))
        self.assertEqual(original, snapshot)

    def test_behavior_preserves_actions_parameters_and_action_order(self):
        original = self.key({"text": "Shared"})
        for prefix in ((), ("variations", 0, "key")):
            for suffix in (
                ("press_actions",),
                ("longpress_actions", "start"),
                ("longpress_actions", "repeat"),
            ):
                path = prefix + suffix
                with self.subTest(path=path):
                    changed = deepcopy(original)
                    actions = changed
                    for field in path:
                        actions = actions[field]
                    actions[0]["count"] += 1
                    self.assertNotEqual(key_behavior(original), key_behavior(changed))
                    actions.append({"type": "complete"})
                    ordered = deepcopy(key_behavior(changed))
                    actions.reverse()
                    self.assertNotEqual(ordered, key_behavior(changed))
                    actions.clear()
                    self.assertNotEqual(key_behavior(original), key_behavior(changed))

    def test_longpress_variation_order_is_preserved(self):
        original = self.key({"text": "Shared"})
        for variation in original["variations"]:
            variation["type"] = "longpress_variation"
            del variation["direction"]
        original["variations"][1]["key"]["press_actions"][0]["count"] = 2
        changed = deepcopy(original)
        changed["variations"].reverse()
        self.assertNotEqual(key_behavior(original), key_behavior(changed))

    def test_behavior_detects_missing_extra_and_redirected_flicks(self):
        original = self.key({"text": "Shared"})
        changed = deepcopy(original)
        changed["variations"].pop()
        self.assertNotEqual(key_behavior(original), key_behavior(changed))
        changed = deepcopy(original)
        changed["variations"][0]["direction"] = "top"
        self.assertNotEqual(key_behavior(original), key_behavior(changed))
        changed["variations"].append(deepcopy(original["variations"][0]))
        self.assertNotEqual(key_behavior(original), key_behavior(changed))


class EdgeDetectionTests(unittest.TestCase):
    def layout(self, x, y, direction, *, key_width=1, width=5, height=4):
        return {
            "interface": {
                "key_layout": {"row_count": width, "column_count": height},
                "keys": [
                    {
                        "key_type": "custom",
                        "specifier": {"x": x, "y": y, "width": key_width, "height": 1},
                        "key": {
                            "variations": [
                                {"type": "flick_variation", "direction": direction}
                            ]
                        },
                    }
                ],
            }
        }

    def test_outward_side_flicks_are_rejected(self):
        for y in (0, 1, 3):
            for x, direction in ((0, "left"), (4, "right")):
                with self.subTest(x=x, y=y, direction=direction):
                    self.assertEqual(
                        outward_side_flicks(self.layout(x, y, direction)),
                        [(x, y, direction)],
                    )

    def test_inward_and_interior_flicks_are_allowed(self):
        for x, direction in ((0, "right"), (4, "left"), (2, "left"), (2, "right")):
            with self.subTest(x=x, direction=direction):
                self.assertEqual(outward_side_flicks(self.layout(x, 1, direction)), [])

    def test_wide_key_uses_its_right_edge(self):
        self.assertEqual(
            outward_side_flicks(self.layout(3, 1, "right", key_width=2)),
            [(3, 1, "right")],
        )

    def test_row_count_is_horizontal_even_for_tall_layouts(self):
        self.assertEqual(
            outward_side_flicks(self.layout(3, 8, "right", width=4, height=10)),
            [(3, 8, "right")],
        )
        self.assertEqual(outward_side_flicks(self.layout(3, 1, "right")), [])

    def test_vertical_grid_edges_are_not_screen_side_edges(self):
        for x, y, direction in (
            (0, 0, "top"), (4, 0, "top"), (0, 3, "bottom"), (4, 3, "bottom")
        ):
            with self.subTest(x=x, y=y, direction=direction):
                self.assertEqual(outward_side_flicks(self.layout(x, y, direction)), [])


class LayoutTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.layouts = {
            path.stem: json.loads(path.read_text(encoding="utf-8"))
            for path in sorted(REPOSITORY.glob("*.json"))
        }
        if not cls.layouts:
            raise AssertionError("No keyboard layouts found")

    def test_shared_controls_have_identical_behavior(self):
        shared = shared_control_keys(self.layouts)
        self.assertTrue(shared, "No shared control keys found")
        for label, entries in shared.items():
            reference_name, reference = entries[0]
            for name, entry in entries[1:]:
                with self.subTest(
                    label=label,
                    reference=(reference_name, reference["specifier"]),
                    file=name,
                    position=entry["specifier"],
                ):
                    self.assertEqual(
                        key_behavior(entry["key"]), key_behavior(reference["key"])
                    )

    def test_identifiers_match_file_stems(self):
        for name, layout in self.layouts.items():
            with self.subTest(layout=name):
                self.assertEqual(layout["identifier"], name)

    def test_display_names_match_file_stems(self):
        for name, layout in self.layouts.items():
            with self.subTest(layout=name):
                self.assertEqual(layout["metadata"]["display_name"], name)

    def test_custom_tab_targets_are_file_stems(self):
        for name, layout in self.layouts.items():
            for action in objects(layout):
                if action.get("type") == "move_tab" and action["tab_type"] == "custom":
                    with self.subTest(layout=name, target=action["identifier"]):
                        self.assertIn(action["identifier"], self.layouts)

    def test_named_tab_keys_display_their_targets(self):
        for name, layout in self.layouts.items():
            for key in objects(layout):
                if "press_actions" not in key:
                    continue
                for action in key["press_actions"]:
                    if action["type"] == "move_tab" and action["tab_type"] == "custom":
                        with self.subTest(layout=name, target=action["identifier"]):
                            self.assertEqual(
                                key["design"]["label"]["text"], action["identifier"]
                            )

    def test_keys_fit_their_grid(self):
        for name, layout in self.layouts.items():
            interface = layout["interface"]
            width = interface["key_layout"]["row_count"]
            height = interface["key_layout"]["column_count"]
            for entry in interface["keys"]:
                position = entry["specifier"]
                with self.subTest(file=name, position=position):
                    self.assertGreater(position["width"], 0)
                    self.assertGreater(position["height"], 0)
                    self.assertGreaterEqual(position["x"], 0)
                    self.assertGreaterEqual(position["y"], 0)
                    self.assertLessEqual(position["x"] + position["width"], width)
                    self.assertLessEqual(position["y"] + position["height"], height)

    def test_flick_directions_are_unique(self):
        for name, layout in self.layouts.items():
            for entry in layout["interface"]["keys"]:
                if entry["key_type"] != "custom":
                    continue
                directions = [
                    variation["direction"]
                    for variation in entry["key"]["variations"]
                    if variation["type"] == "flick_variation"
                ]
                with self.subTest(file=name, position=entry["specifier"]):
                    self.assertEqual(len(directions), len(set(directions)))

    def test_no_outward_flicks_at_screen_sides(self):
        for name, layout in self.layouts.items():
            with self.subTest(file=name):
                self.assertEqual(outward_side_flicks(layout), [])


if __name__ == "__main__":
    unittest.main()
