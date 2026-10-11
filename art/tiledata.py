"""规则书 2.2 的 24 种地块（未旋转朝向），美术合成和接缝检查用。引擎以 data/tiles.json 为准，这里只抄了美术要用的部分。
edges：北东南西；roads：每条 (起, 止)，'*' = 到地块中心为止；cities：城市段（边集合, 有无盾徽）；fields：农田分区的端口列表。
"""
TILES = {
    "A": dict(count=2, edges="FFRF", roads=[("S", "*")], cities=[], monastery=True, fields=[["N0", "N1", "E0", "E1", "S0", "S1", "W0", "W1"]]),
    "B": dict(count=4, edges="FFFF", roads=[], cities=[], monastery=True, fields=[["N0", "N1", "E0", "E1", "S0", "S1", "W0", "W1"]]),
    "C": dict(count=1, edges="CCCC", roads=[], cities=[("NESW", True)], monastery=False, fields=[]),
    "D": dict(count=4, edges="CRFR", roads=[("E", "W")], cities=[("N", False)], monastery=False, fields=[["E0", "W1"], ["E1", "S0", "S1", "W0"]]),
    "E": dict(count=5, edges="CFFF", roads=[], cities=[("N", False)], monastery=False, fields=[["E0", "E1", "S0", "S1", "W0", "W1"]]),
    "F": dict(count=2, edges="FCFC", roads=[], cities=[("EW", True)], monastery=False, fields=[["N0", "N1"], ["S0", "S1"]]),
    "G": dict(count=1, edges="FCFC", roads=[], cities=[("EW", False)], monastery=False, fields=[["N0", "N1"], ["S0", "S1"]]),
    "H": dict(count=3, edges="FCFC", roads=[], cities=[("E", False), ("W", False)], monastery=False, fields=[["N0", "N1", "S0", "S1"]]),
    "I": dict(count=2, edges="CFFC", roads=[], cities=[("N", False), ("W", False)], monastery=False, fields=[["E0", "E1", "S0", "S1"]]),
    "J": dict(count=3, edges="CRRF", roads=[("E", "S")], cities=[("N", False)], monastery=False, fields=[["E0", "S1", "W0", "W1"], ["E1", "S0"]]),
    "K": dict(count=3, edges="CFRR", roads=[("S", "W")], cities=[("N", False)], monastery=False, fields=[["E0", "E1", "S0", "W1"], ["S1", "W0"]]),
    "L": dict(count=3, edges="CRRR", roads=[("E", "*"), ("S", "*"), ("W", "*")], cities=[("N", False)], monastery=False, fields=[["E0", "W1"], ["E1", "S0"], ["S1", "W0"]]),
    "M": dict(count=2, edges="CFFC", roads=[], cities=[("NW", True)], monastery=False, fields=[["E0", "E1", "S0", "S1"]]),
    "N": dict(count=3, edges="CFFC", roads=[], cities=[("NW", False)], monastery=False, fields=[["E0", "E1", "S0", "S1"]]),
    "O": dict(count=2, edges="CRRC", roads=[("E", "S")], cities=[("NW", True)], monastery=False, fields=[["E0", "S1"], ["E1", "S0"]]),
    "P": dict(count=3, edges="CRRC", roads=[("E", "S")], cities=[("NW", False)], monastery=False, fields=[["E0", "S1"], ["E1", "S0"]]),
    "Q": dict(count=1, edges="CCFC", roads=[], cities=[("NEW", True)], monastery=False, fields=[["S0", "S1"]]),
    "R": dict(count=3, edges="CCFC", roads=[], cities=[("NEW", False)], monastery=False, fields=[["S0", "S1"]]),
    "S": dict(count=2, edges="CCRC", roads=[("S", "*")], cities=[("NEW", True)], monastery=False, fields=[["S0"], ["S1"]]),
    "T": dict(count=1, edges="CCRC", roads=[("S", "*")], cities=[("NEW", False)], monastery=False, fields=[["S0"], ["S1"]]),
    "U": dict(count=8, edges="RFRF", roads=[("N", "S")], cities=[], monastery=False, fields=[["N1", "E0", "E1", "S0"], ["S1", "W0", "W1", "N0"]]),
    "V": dict(count=9, edges="FFRR", roads=[("S", "W")], cities=[], monastery=False, fields=[["S1", "W0"], ["N0", "N1", "E0", "E1", "S0", "W1"]]),
    "W": dict(count=4, edges="FRRR", roads=[("E", "*"), ("S", "*"), ("W", "*")], cities=[], monastery=False, fields=[["W1", "N0", "N1", "E0"], ["E1", "S0"], ["S1", "W0"]]),
    "X": dict(count=1, edges="RRRR", roads=[("N", "*"), ("E", "*"), ("S", "*"), ("W", "*")], cities=[], monastery=False, fields=[["N1", "E0"], ["E1", "S0"], ["S1", "W0"], ["W1", "N0"]]),
}
assert sum(t["count"] for t in TILES.values()) == 72
DIRS = "NESW"
