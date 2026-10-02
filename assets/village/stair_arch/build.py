"""An open stone gateway with a 1.9 metre passage and 2.5 metre spring line."""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from village_common import *

reset(137)
m=palette()
for side in [-1,1]:
    for row in range(5):
        box('Stair_arch_limestone_pier',(side*1.1,0,(row+.5)*.5),(.30,.68,.49),
            m['stone'] if row%2 else m['trim'])
    box('Stair_arch_pier_foot',(side*1.1,0,.08),(.30,.80,.16),m['trim'])
    box('Stair_arch_spring_cap',(side*1.1,0,2.49),(.30,.80,.14),m['trim'])
# Voussoirs are individually extruded annular wedges, never a filled arch silhouette.
for i in range(13):
    a,b=i*math.pi/13+.004,(i+1)*math.pi/13-.004
    inner,outer=.95,1.25
    polygon=[(inner*math.cos(a),2.5+inner*math.sin(a)),
             (outer*math.cos(a),2.5+outer*math.sin(a)),
             (outer*math.cos(b),2.5+outer*math.sin(b)),
             (inner*math.cos(b),2.5+inner*math.sin(b))]
    extrude_xz('Stair_arch_radial_stone',polygon,0,.68,m['trim'] if i%3 else m['stone'])
for y in [-.375,.375]:
    cylinder('Stair_arch_brass_moon_medallion',(0,y,3.62),.105,.05,m['brass'],16,rot=(math.pi/2,0,0))
# Small inset luminous niches, only emission; the scene supplies stair lamps.
for side in [-1,1]:
    box('Stair_arch_iron_niche',(side*1.1,-.365,1.92),(.23,.06,.41),m['iron'])
    box('Stair_arch_amber_niche',(side*1.1,-.397,1.92),(.13,.006,.27),m['amber'])
    # Face thickness is subpixel, so mark these recessed emission planes explicitly.
    bpy.context.object.name='thin_Stair_arch_amber_niche'
export_village('stair_arch','Thirteen-stone gateway: clear 1.9 m span to a 2.5 m spring line, 3.45 m centre headroom, inset amber niches, no lamp empties.',
               budget=5000,footprint=(2.5,.8),front_door=None,max_height=4.2,
               attachments={'passageWidthMetres':1.9,'springHeightMetres':2.5,'centreHeadroomMetres':3.45})
