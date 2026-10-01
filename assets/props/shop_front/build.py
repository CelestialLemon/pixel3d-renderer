"""Open shop interior behind skipped glass, lit rear wall, lamp and pivoted sign."""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from common import *

reset(79)
plaster=material('Shop soft ochre plaster',(.72,.50,.28))
wood=material('Shop walnut framing',(.25,.12,.055))
oak=material('Shop honey oak shelves',(.54,.31,.12))
roof=material('Shop blue slate roof',(.16,.24,.30))
stone=material('Shop pale stone trim',(.67,.65,.53))
glass=material('Clear display glass placeholder',(.26,.46,.50))
glow=material('Shop warm emissive rear wall',(.95,.43,.12),emission=.4)
teal=material('Teal enamel goods',(.055,.38,.33))
red=material('Cranberry preserves',(.52,.045,.065))
brass=material('Shop sign brass emblem',(.75,.46,.10),metallic=.5)
iron=material('Shop iron bracket',(.07,.10,.12),metallic=.6)

box('Shop left wall',(-1.31,0,1.35),(.18,1.60,2.70),plaster)
box('Shop right wall',(1.31,0,1.35),(.18,1.60,2.70),plaster)
box('Shop rear wall',(0,.73,1.35),(2.60,.14,2.70),plaster)
box('Shop solid floor',(0,0,.035),(2.62,1.58,.07),stone)
box('Shop display lower wall',(-.43,-.74,.40),(1.65,.16,.80),plaster)
box('Shop window left pier',(-1.18,-.74,1.77),(.13,.17,1.94),wood)
box('Shop window right pier',(.39,-.74,1.77),(.13,.17,1.94),wood)
box('Shop front lintel',(0,-.74,2.57),(2.68,.17,.22),wood)
box('Shop display sill',(-.43,-.84,.84),(1.82,.30,.13),stone,.02)
box('Shop window top frame',(-.43,-.78,2.43),(1.75,.13,.10),wood)
box('Shop centre window mullion',(-.43,-.80,1.64),(.075,.09,1.54),wood)
box('glass_shop_display',(-.43,-.765,1.64),(1.49,.025,1.50),glass)
box('Shop oak door',(.88,-.75,1.09),(.83,.10,2.18),oak,.02)
for z in [.43,1.32]:
    box('Shop door dark strap',(.88,-.82,z),(.71,.06,.075),iron)
sphere('Shop brass handle',(.62,-.84,1.09),(.065,.065,.065),brass,segments=12,rings=6)
box('Shop warm lit display rear',(-.43,.49,1.62),(1.48,.06,1.54),glow)
for z in [1.0,1.60,2.13]:
    box('Shop display shelf',(-.43,-.04,z),(1.48,.86,.08),oak)
    for i in range(5):
        x=-1.01+i*.29
        cylinder('Shop preserve jar',(x,-.11,z+.15),.075,.21,red if i%2 else teal,vertices=12)
        cylinder('Shop preserve lid',(x,-.11,z+.275),.082,.04,brass,vertices=12)
lamp('shop_interior',(-.43,-.14,2.19),(1,.55,.21),2.5)

# Gabled roof extrudes along X; front/back slopes stay thick and texture-free.
for side in [-1,1]:
    y0,y1=(-.95,0) if side < 0 else (0,.95)
    z0,z1=(2.72,3.42) if side < 0 else (3.42,2.72)
    vertices=[(x,y,z+dz) for dz in [0,.10] for x in [-1.52,1.52] for y,z in [(y0,z0),(y1,z1)]]
    mesh('Shop thick slate roof',vertices,[(0,1,3,2),(4,6,7,5),(0,4,5,1),(2,3,7,6),(0,2,6,4),(1,5,7,3)],roof)
for x in [-1.31,1.31]:
    tri=[(x-.06,y,z) for y,z in [(-.80,2.7),(.80,2.7),(0,3.31)]]
    tri += [(x+.06,y,z) for y,z in [(-.80,2.7),(.80,2.7),(0,3.31)]]
    mesh('Shop gable infill',tri,[(0,2,1),(3,4,5),(0,1,4,3),(1,2,5,4),(2,0,3,5)],plaster)
beam('Shop hanging sign bracket',(-1.20,-.80,2.53),(-1.92,-.80,2.53),.075,iron)
sign=box('move_sway_shop_sign',(-1.72,-.80,2.17),(.52,.10,.45),teal,.025)
pivot(sign,(-1.72,-.80,2.53))
for x in [-1.87,-1.57]:
    chain=beam('thin_sign_chain_003m',(x,-.80,2.53),(x,-.80,2.39),.03,iron)
    parent_at_pivot(chain,sign,(-1.72,-.80,2.53))
emblem=sphere('Shop sign golden loaf',(-1.72,-.87,2.17),(.16,.055,.09),brass,segments=12,rings=6)
parent_at_pivot(emblem,sign,(-1.72,-.80,2.53))
center_xy()
export_and_preview('shop_front','Open lit shop display behind glass_ panel; warm lamp; stocked shelves; move_sway_ hanging sign.',
                   camera_direction=(3,-9,5))
