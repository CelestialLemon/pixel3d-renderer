"""Hollow stone well, roof, crank and an intentionally thin rope."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from common import *

reset(76)
stones = [material('Well limestone '+str(i), c) for i,c in enumerate([(.54,.54,.47),(.66,.62,.51),(.43,.46,.43)])]
wood = material('Dark well oak', (.30,.16,.075))
tile = material('Well clay roof', (.55,.15,.09))
iron = material('Well crank iron', (.09,.12,.14),metallic=.6)
rope = material('Well hemp rope', (.64,.45,.23))
dark = material('Well interior darkness', (.035,.065,.075))
for row in range(3):
    for i in range(12):
        start = (i+(row%2)*.5)*math.tau/12
        annular_segment('Hollow well masonry', (0,0,row*.27), .48,.73,start+.008,start+math.tau/12-.008,.26,
                        stones[(i+row)%3])
for i in range(16):
    start=i*math.tau/16
    annular_segment('Well coping stone', (0,0,.81), .45,.79,start+.004,start+math.tau/16-.004,.12,stones[1])
cylinder('Dark hollow bottom', (0,0,.04), .475,.035,dark,vertices=32)
for x in [-.84,.84]:
    box('Well roof post', (x,0,1.08), (.13,.15,2.16),wood,.01)
    box('Well roof side rail', (x,0,2.08), (.14,1.42,.12),wood)
beam('Well winding axle', (-.97,0,1.60),(.98,0,1.60),.13,wood,vertices=16)
cylinder('Well winding drum', (0,0,1.60),.14,.37,wood,vertices=24,rot=(0,math.pi/2,0))
for i in range(6):
    torus('thin_rope_wrap', (-.135+i*.055,0,1.60),.147,.013,rope,rot=(0,math.pi/2,0),segments=24,tube=4)
beam('thin_well_rope_0025m',(0,-.14,1.59),(0,-.14,.23),.025,rope)
beam('Well crank lever',(.99,0,1.60),(.99,0,1.30),.065,iron)
beam('Well crank handle',(.99,0,1.30),(1.20,0,1.30),.075,wood)
# Two thick roof slopes; separate clay strips provide deliberately clear material changes.
for side in [-1,1]:
    for i in range(7):
        x=-1.06+i*.303
        y0,y1 = (0,.83) if side > 0 else (-.83,0)
        z0,z1 = (2.62,2.14) if side > 0 else (2.14,2.62)
        verts=[(xx,y,z+dz) for dz in [0,.08] for xx in [x,x+.303] for y,z in [(y0,z0),(y1,z1)]]
        mesh('Clay well roof tile', verts, [(0,1,3,2),(4,6,7,5),(0,4,5,1),(2,3,7,6),(0,2,6,4),(1,5,7,3)],tile)
box('Well roof ridge', (0,0,2.67), (2.20,.10,.10),wood,.01)
center_xy()
export_and_preview('well', 'Actual hollow annular stone interior, sheltered roof, crank and 0.025 m hanging rope.',
                   camera_direction=(5,-8,6))
