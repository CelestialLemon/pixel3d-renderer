"""Two grounded posts joined by three genuinely sagging 0.02 m wire meshes."""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from common import *

reset(80)
wood=material('Telegraph warm creosote timber',(.29,.16,.075))
cut=material('Telegraph pale crossarm ends',(.47,.29,.14))
iron=material('Telegraph iron fittings',(.07,.095,.12),metallic=.6)
ceramic=material('Pale mint ceramic insulators',(.60,.79,.72))
wire=material('Dark overhead wire',(.035,.045,.055),metallic=.7)
for x in [-2.5,2.5]:
    cylinder('Tall telegraph timber pole',(x,0,1.80),.085,3.60,wood,vertices=16)
    box('Telegraph crossarm',(x,0,3.40),(.12,1.65,.13),cut)
    for y in [-.70,.70]:
        beam('Crossarm diagonal iron brace',(x,0,3.05),(x,y,3.36),.06,iron)
    for y in [-.55,0,.55]:
        cylinder('Insulator pin',(x,y,3.53),.03,.19,iron,vertices=8)
        cone('Ceramic insulator',(x,y,3.62),.075,.06,.15,ceramic,vertices=16)
        torus('Ceramic insulator flange',(x,y,3.61),.065,.026,ceramic,segments=16,tube=4)
for y in [-.55,0,.55]:
    points=[(-2.5+5*i/32,y,3.69-.54*4*(i/32)*(1-i/32)) for i in range(33)]
    path('thin_sagging_telegraph_wire_002m',points,.02,wire,sides=6)
center_xy()
export_and_preview('telegraph_pole','Two 3.6 m poles and three 0.02 m sagging overhead wires; deliberate worst-case flicker.',
                   camera_direction=(3,-10,5),preview_size=(1000,750))
