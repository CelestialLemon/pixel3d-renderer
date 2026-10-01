"""Small produce stall: chunky stripes, a 0.6 m overhang and saturated fruit."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from common import *

reset(74)
wood = material('Warm market oak', (.43,.23,.10))
edge = material('Worn pale oak', (.61,.39,.18))
red = material('Faded cranberry canvas', (.48,.075,.055))
light_red = material('Sunlit coral canvas', (.72,.16,.11))
fruit = [material('Saturated apple red', (.76,.035,.045)), material('Golden pear yellow', (.92,.59,.045)),
         material('Deep plum purple', (.28,.065,.40))]
leaf = material('Produce leaf green', (.12,.36,.09))
for x in [-1.13,1.13]:
    for y in [-.55,.55]:
        box('Market corner post', (x,y,1.20), (.12,.12,2.40), wood, .015)
for x in [-1.13,1.13]:
    box('Side canopy rail', (x,0,2.32), (.14,1.22,.12), edge)
for y in [-.55,.55]:
    box('Cross canopy rail', (0,y,2.32), (2.40,.13,.13), edge)
for i in range(8):
    x = -1.24+i*.31
    mat = red if i%2 == 0 else light_red
    # Gently bowed strip along Y, authored as a closed thick mesh.
    points = [(-1.15,2.55),(-.70,2.67),(-.10,2.87),(.55,2.74),(.85,2.60)]
    verts = [(xx,y,z+dz) for dz in [0,.06] for xx in [x,x+.30] for y,z in points]
    n = len(points)
    faces = []
    for j in range(n-1):
        faces.extend([(j,j+1,n+j+1,n+j),(2*n+j,3*n+j,3*n+j+1,2*n+j+1),
                      (j,2*n+j,2*n+j+1,j+1),(n+j,n+j+1,3*n+j+1,3*n+j)])
    faces += [(0,n,3*n,2*n),(n-1,2*n-1,4*n-1,3*n-1)]
    mesh('Canvas stripe_%02d'%i, verts, faces, mat)
    box('Scalloped canvas valance', (x+.15,-1.15,2.47), (.30,.06,.19), mat, .025)

for y in [-.56,.56]:
    box('Counter long edge', (0,y,.94), (2.46,.10,.15), wood, .015)
for i in range(8):
    box('Counter vertical board', (-1.075+i*.307, -.56,.50), (.255,.09,.82), edge if i%3 == 0 else wood)
box('Market counter top', (0,0,1.015), (2.5,1.20,.10), edge, .02)
for k,cx in enumerate([-.78,0,.78]):
    box('Produce crate bottom', (cx,0,1.09), (.67,.80,.06), wood)
    for x in [cx-.335,cx+.335]:
        box('Produce crate side', (x,0,1.20), (.06,.80,.22), edge)
    for y in [-.39,.39]:
        box('Produce crate end', (cx,y,1.20), (.67,.06,.22), wood)
    for ix in range(3):
        for iy in range(3):
            px,py = cx-.20+ix*.20,-.22+iy*.21
            sphere('Market fruit', (px,py,1.29), (.095,.095,.105 if k != 1 else .13), fruit[k], segments=12,rings=6)
            if iy == 1:
                box('Fruit stem', (px,py,1.40 if k != 1 else 1.43), (.05,.05,.055), leaf)
center_xy()
export_and_preview('market_stall', 'Produce canopy with 0.6 m front overhang, two distinct red stripe tones and saturated fruit.',
                   camera_direction=(5,-8,4))
