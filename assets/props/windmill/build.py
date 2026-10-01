"""Small mill; one pivoted four-sail assembly with separate thin lattice children."""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from common import *

reset(81)
plaster=material('Windmill warm cream plaster',(.77,.65,.43))
stone=material('Windmill grey stone footing',(.40,.44,.42))
wood=material('Windmill walnut sail beams',(.28,.14,.055))
canvas=material('Windmill ivory sail canvas',(.90,.84,.66))
roof=material('Windmill weathered teal roof',(.12,.30,.29))
iron=material('Windmill iron shaft',(.07,.095,.12),metallic=.6)
cone('Windmill tapered tower',(0,0,1.34),.76,.53,2.68,plaster,vertices=24)
cone('Windmill stone skirt',(0,0,.15),.79,.75,.30,stone,vertices=24)
cone('Windmill conical roof',(0,0,3.06),.86,.08,.78,roof,vertices=24)
cylinder('Windmill roof finial',(0,0,3.49),.05,.13,iron,vertices=12)
box('Windmill front oak door',(0,-.713,.55),(.49,.10,1.10),wood,.02)
for z in [.22,.76]:
    box('Windmill door iron strap',(0,-.777,z),(.44,.06,.07),iron)
for side in [-1,1]:
    box('Windmill upper window',(side*.28,-.505,1.72),(.23,.08,.32),roof)
    box('Windmill window sill',(side*.28,-.57,1.55),(.29,.13,.07),stone)

origin=(0,-.93,2.40)
parts=[cylinder('Windmill central sail hub',origin,.15,.20,iron,vertices=24,rot=(math.pi/2,0,0))]
for i in range(4):
    angle=i*math.pi/2+math.pi/8
    u=Vector((math.cos(angle),0,math.sin(angle)))
    centre=Vector(origin)+u*.91
    parts.append(box('Windmill main sail spar',Vector(origin)+u*.76,(1.52,.09,.10),wood,rot=(0,-angle,0)))
    parts.append(box('Windmill broad canvas sail',centre,(1.12,.06,.32),canvas,rot=(0,-angle,0)))
sails=join(parts,'move_spin_windmill_sails',origin)
# Shared future motion convention: local X points along the shaft, here Blender +Y.
orient_pivot_x(sails,(0,1,0))
for i in range(4):
    angle=i*math.pi/2+math.pi/8
    u=Vector((math.cos(angle),0,math.sin(angle)))
    v=Vector((-math.sin(angle),0,math.cos(angle)))
    for r in [.45,.68,.91,1.14,1.40]:
        centre=Vector(origin)+u*r+Vector((0,-.06,0))
        rung=beam('thin_sail_lattice_003m',centre-v*.20,centre+v*.20,.03,wood)
        parent_at_pivot(rung,sails,origin)
center_xy()
export_and_preview('windmill','Cream mill with one move_spin_ four-sail mesh and twenty thin_ lattice children; local X shaft.',
                   camera_direction=(4,-10,5))
