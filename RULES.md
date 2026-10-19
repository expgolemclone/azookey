# Rules

- After changing keyboard layout JSON or preview code, run `python -X utf8 -B -m unittest discover -v`
  and `npm --prefix preview test`. Then synchronize the registered repository and run
  `npm --prefix preview start -- --open` there to open the updated layout preview without importing into azooKey.
