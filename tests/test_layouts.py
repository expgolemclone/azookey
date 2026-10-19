import json
from pathlib import Path
import unittest


REPOSITORY = Path(__file__).resolve().parents[1]


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
            path.name: json.loads(path.read_text(encoding="utf-8"))
            for path in sorted(REPOSITORY.glob("*.json"))
        }
        if not cls.layouts:
            raise AssertionError("No keyboard layouts found")

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
