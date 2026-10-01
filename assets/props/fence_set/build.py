"""Three adjacent 2.4 m bays: chunky pickets, thin iron, sagging thin rope."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from common import *

reset(72)
pine = material('Deep forest painted pine', (.09, .23, .13))
pine_light = material('Worn brighter forest pickets', (.23, .43, .24))
iron = material('Blue black wrought iron', (.065, .095, .12), metallic=.6)
rope = material('Golden hemp rope', (.65, .43, .21))
oak = material('Honey oak rope posts', (.43, .24, .11))
centres = [-2.65, 0, 2.65]

cx = centres[0]
for x in [cx-1.2, cx+1.2]:
    box('Picket fence endpost', (x, 0, .60), (.13, .15, 1.2), pine, .01)
    cone('Picket post cap', (x, 0, 1.24), .115, 0, .08, pine_light, vertices=4).rotation_euler.z = math.pi/4
for z in [.30, .82]:
    box('Fence horizontal rail', (cx, .055, z), (2.40, .09, .09), pine)
for i in range(13):
    x = cx-1.08+i*.18
    # 0.08 m actual slat width, with a continuous peaked silhouette.
    verts = [(x+dx, y, z) for y in [-.055, .025]
             for dx, z in [(-.04, .08), (.04, .08), (.04, 1.03), (0, 1.12), (-.04, 1.03)]]
    faces = [(4,3,2,1,0), (5,6,7,8,9)]+[(i,(i+1)%5,(i+1)%5+5,i+5) for i in range(5)]
    mesh('Picket_slat_008m', verts, faces, pine_light if i%3 == 0 else pine)

cx = centres[1]
for x in [cx-1.2, cx+1.2]:
    box('Iron railing endpost', (x, 0, .58), (.10, .10, 1.16), iron)
    sphere('Iron post finial', (x, 0, 1.19), (.075, .075, .075), iron, segments=12, rings=6)
for z in [.18, 1.0]:
    box('Iron horizontal rail', (cx, 0, z), (2.4, .06, .06), iron)
for i in range(15):
    x = cx-1.08+i*2.16/14
    beam('thin_iron_bar_003m', (x,0,.17), (x,0,1.07), .03, iron)
    cone('thin_iron_spear', (x,0,1.10), .024, 0, .09, iron, vertices=4)

cx = centres[2]
for x in [cx-1.2, cx+1.2]:
    cylinder('Rope barrier oak post', (x, 0, .55), .07, 1.10, oak, vertices=12)
    cylinder('Rope barrier collar', (x, 0, .97), .085, .10, iron, vertices=12)
for z in [.57, .95]:
    points = [(cx-1.20+2.40*i/20, -.025, z-.21*4*(i/20)*(1-i/20)) for i in range(21)]
    path('thin_hemp_rope_003m', points, .03, rope)

export_and_preview('fence_set', 'Three width tests: 0.08 m pine pickets, 0.03 m iron bars and 0.03 m sagging rope.',
                   camera_direction=(2, -10, 4), preview_size=(1100, 500))
