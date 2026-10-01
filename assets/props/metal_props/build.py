"""Four metals carried by deliberate base colours, plus smooth curve banding."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from common import *

reset(77)
copper = material('Burnished orange copper', (.65,.25,.095),metallic=.85)
copper_dark = material('Copper pot inner patina', (.27,.095,.04),metallic=.7)
iron = material('Blue charcoal forged iron', (.10,.14,.18),metallic=.85)
steel = material('Pale blue steel kettle', (.56,.65,.70),metallic=.9)
brass = material('Golden yellow bell brass', (.69,.46,.12),metallic=.85)
wood = material('Anvil stump bark', (.30,.16,.08))
cut = material('Anvil stump cut face', (.55,.34,.16))
dark = material('Black kettle handle', (.045,.055,.06))

cx=-1.7
lathe('Copper pot outer bowl',(cx,0,0),[(.22,.04),(.33,.10),(.39,.30),(.34,.53),(.33,.60)],copper,segments=32)
lathe('Copper pot real inner bowl',(cx,0,0),[(.31,.60),(.32,.53),(.36,.30),(.30,.13),(.22,.09)],copper_dark,segments=32)
cylinder('Copper pot bottom',(cx,0,.055),.23,.035,copper,vertices=32)
torus('Copper pot rolled lip',(cx,0,.60),.32,.035,copper,segments=32)
for side in [-1,1]:
    points=[(cx+side*(.34+.15*math.sin(i*math.pi/12)),0,.50-.26*i/12) for i in range(13)]
    path('Copper pot loop handle',points,.065,copper)

cx=-.48
cylinder('Anvil round stump',(cx,0,.24),.33,.48,wood,vertices=16,smooth=False)
cylinder('Anvil stump top',(cx,0,.485),.315,.04,cut,vertices=16)
extrude_xz('Anvil shaped body',[(cx-.35,.51),(cx+.29,.51),(cx+.24,.61),(cx+.10,.67),(cx+.16,.79),
                             (cx+.38,.86),(cx+.38,.98),(cx-.33,.98),(cx-.33,.83),(cx-.13,.76),(cx-.13,.64)],
           0,.30,iron)
box('Anvil striking face',(cx+.015,0,1.005),(.73,.34,.075),steel,.015)
horn=cone('Anvil tapered horn',(cx-.52,0,.92),.12,.025,.40,iron,vertices=16)
horn.rotation_euler.y=-math.pi/2

cx=.80
lathe('Brass bell outside',(cx,0,0),[(.37,.045),(.31,.10),(.25,.24),(.20,.47),(.11,.61),(.065,.65)],brass,segments=32)
lathe('Brass bell inside',(cx,0,0),[(.07,.61),(.17,.45),(.22,.24),(.28,.10),(.34,.045)],brass,segments=32)
torus('Bell rolled mouth',(cx,0,.055),.355,.03,brass,segments=32)
torus('Bell crown handle',(cx,0,.725),.085,.027,brass,rot=(math.pi/2,0,0),segments=24)
sphere('Bell dark clapper',(cx,0,.13),(.08,.08,.10),iron,segments=12,rings=6)

cx=1.9
sphere('Steel kettle belly',(cx,0,.34),(.32,.29,.31),steel,segments=24,rings=12)
cylinder('Kettle flat foot',(cx,0,.035),.20,.07,steel,vertices=24)
cylinder('Kettle lid',(cx,0,.655),.18,.07,steel,vertices=24)
sphere('Kettle lid knob',(cx,0,.73),(.07,.07,.06),dark,segments=12,rings=6)
points=[(cx-.25,0,.50),(cx-.42,0,.64),(cx-.56,0,.79)]
path('Kettle raised spout',points,.11,steel,sides=8)
for side in [-1,1]:
    beam('Kettle handle bracket',(cx,side*.24,.47),(cx,side*.27,.61),.065,steel)
points=[(cx,.27*math.cos(i*math.pi/16),.61+.29*math.sin(i*math.pi/16)) for i in range(17)]
path('Kettle arched handle',points,.075,dark,sides=8)
center_xy()
export_and_preview('metal_props','Copper hollow pot, iron anvil on a stump, hollow brass bell and curved steel kettle.',
                   camera_direction=(3,-9,5),preview_size=(1100,550))
