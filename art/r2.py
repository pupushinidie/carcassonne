"""第 2 轮：灌木（v2 最小 16px）、结算花环。用法同 r1。"""
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import r1
r1.OUT = r1.pixellab.ART / "out" / "r2"
r1.JOBS = {
    "obj-bush": ("/generate-image-v2", "pixel art of a small round green bush with a few tiny white and yellow flowers, seen from directly above, "
                 "soft light from top left, bold dark outline, " + r1.LOOK, 16, 16, True, (314,)),
    "ui-wreath": ("/create-image-pixflux", "pixel art decorative laurel wreath garland of fresh green leaves with small red and white "
                  "wildflowers and a golden ribbon, curving in a wide shallow arc, empty center, transparent background, " + r1.LOOK + ", " + r1.NO,
                  160, 64, True, (701, 702, 703)),
}
if __name__ == "__main__":
    from concurrent.futures import ThreadPoolExecutor
    tasks = [(n, s) for n in r1.JOBS for s in r1.JOBS[n][5]]
    with ThreadPoolExecutor(max_workers=10) as pool:
        list(pool.map(lambda t: r1.run(*t), tasks))
    print("done", flush=True)
