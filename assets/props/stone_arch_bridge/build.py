"""True open arch with a clear 1.5 x 1.5 m water patch below the curved deck."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from common import *

reset(75)
stone = [material('Weathered bridge stone '+str(i), rgb) for i,rgb in enumerate(
    [(.48,.47,.40),(.59,.57,.48),(.42,.45,.42),(.65,.62,.52)])]
water = material('River teal water', (.075,.36,.39))
segments = 14
for i in range(segments):
    t0,t1 = i*math.pi/segments,(i+1)*math.pi/segments
    # Increasing X order for positive X/Z polygon winding.
    x0,x1 = -1.8*math.cos(t0),-1.8*math.cos(t1)
    z0,z1 = .18+.95*math.sin(t0),.18+.95*math.sin(t1)
    extrude_xz('Arch deck voussoir_%02d'%i, [(x0,z0),(x1,z1),(x1,z1+.26),(x0,z0+.26)],
               0,1.80,stone[i%4])
    for y in [-.88,.88]:
        extrude_xz('Stone arch parapet', [(x0,z0+.26),(x1,z1+.26),(x1,z1+.62),(x0,z0+.62)],
                   y,.18,stone[(i+1)%4])
        extrude_xz('Pale parapet coping', [(x0,z0+.62),(x1,z1+.62),(x1,z1+.70),(x0,z0+.70)],
                   y,.24,stone[3])
for x in [-1.85,1.85]:
    box('Bridge end footing', (x,0,.18), (.32,1.94,.36),stone[2],.02)
    for y in [-.88,.88]:
        box('Bridge endpost', (x,y,.52), (.30,.30,1.04),stone[1],.02)
        box('Endpost coping', (x,y,1.085), (.36,.36,.09),stone[3],.015)
mesh('water_clear_patch_under_arch', [(-.75,-.75,.035),(.75,-.75,.035),(.75,.75,.035),(-.75,.75,.035)],
     [(0,1,2,3)],water)
center_xy()
export_and_preview('stone_arch_bridge', 'Open curved stone footbridge; unobstructed 1.5 m square upward-facing water_ plane.',
                   camera_direction=(6,-9,4))
