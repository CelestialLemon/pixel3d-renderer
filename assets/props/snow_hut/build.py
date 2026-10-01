"""Bright-end palette: snowy hut, three-ball snowman and a snow-covered pine."""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from common import *

reset(82)
snow=material('Fresh near white snow',(.93,.96,1.0))
shade=material('Blue shade near white snow',(.68,.77,.87))
ice=material('Cold blue ice',(.43,.64,.79))
wall=material('Hut warm pale plaster',(.73,.66,.51))
wood=material('Snow hut pine beams',(.31,.19,.095))
roof=material('Snow hut blue grey roof',(.16,.24,.31))
pine=material('Winter pine deep green',(.055,.20,.14))
orange=material('Snowman carrot orange',(.87,.29,.04))
coal=material('Snowman charcoal eyes',(.035,.045,.055))
scarf=material('Snowman cherry scarf',(.64,.045,.065))

box('Snow hut plaster body',(0,0,1.0),(2.1,1.65,2.0),wall,.025)
box('Snow hut front door',(0,-.855,.81),(.67,.12,1.62),wood,.02)
box('Snow hut icy window',(.71,-.87,1.36),(.42,.09,.46),ice)
for x in [.47,.95]:
    box('Snow hut window frame',(x,-.94,1.36),(.075,.08,.55),wood)
for z in [1.08,1.64]:
    box('Snow hut window frame',(.71,-.94,z),(.55,.08,.075),wood)
box('Snow hut snowy window sill',(.71,-.98,1.05),(.61,.21,.10),snow,.02)
for side in [-1,1]:
    y0,y1=(-1.0,0) if side < 0 else (0,1.0)
    z0,z1=(2.04,2.78) if side < 0 else (2.78,2.04)
    for name,zoffset,thickness,mat in [('Hut thick roof',0,.09,roof),('Hut deep snow roof',.09,.16,snow if side < 0 else shade)]:
        vertices=[(x,y,z+zoffset+dz) for dz in [0,thickness] for x in [-1.25,1.25] for y,z in [(y0,z0),(y1,z1)]]
        mesh(name,vertices,[(0,1,3,2),(4,6,7,5),(0,4,5,1),(2,3,7,6),(0,2,6,4),(1,5,7,3)],mat)
for x in [-1.03,1.03]:
    tri=[(x-.025,y,z) for y,z in [(-.82,1.99),(.82,1.99),(0,2.59)]]
    tri += [(x+.025,y,z) for y,z in [(-.82,1.99),(.82,1.99),(0,2.59)]]
    mesh('Hut gable triangle',tri,[(0,2,1),(3,4,5),(0,1,4,3),(1,2,5,4),(2,0,3,5)],wall)
for x in [-.98,-.58,.34,.91]:
    cone('Chunky ice eave icicle',(x,-1.0,2.02),0,.05,.25,ice,vertices=8)

cx,cy=1.88,-.38
for z,r,mat in [(.38,.38,shade),(.91,.29,snow),(1.35,.23,snow)]:
    sphere('Snowman packed snow ball',(cx,cy,z),(r,r,r),mat,segments=24,rings=12)
cylinder('Snowman hat brim',(cx,cy,1.57),.29,.06,coal,vertices=24)
cone('Snowman top hat',(cx,cy,1.69),.18,.155,.20,coal,vertices=20)
cylinder('Snowman scarf collar',(cx,cy,1.13),.205,.10,scarf,vertices=20)
box('Snowman hanging scarf',(cx+.10,cy-.235,.99),(.11,.065,.31),scarf)
for dx in [-.08,.08]:
    sphere('Snowman coal eye',(cx+dx,cy-.209,1.40),(.037,.025,.037),coal,segments=8,rings=4)
carrot=cone('Snowman carrot nose',(cx,cy-.30,1.34),.065,0,.21,orange,vertices=8)
carrot.rotation_euler.x=math.pi/2
for side in [-1,1]:
    beam('thin_snowman_twig_arm_0025m',(cx+side*.22,cy,.95),(cx+side*.59,cy,1.14),.025,wood)

cx,cy=-1.85,.25
cylinder('Winter pine trunk',(cx,cy,.38),.10,.76,wood,vertices=12)
for z,r,h in [(.95,.67,1.02),(1.58,.50,.97),(2.15,.34,.94)]:
    cone('Winter pine green bough',(cx,cy,z),r,0,h,pine,vertices=16)
    cone('Winter pine snowy tier',(cx,cy,z+.12),r*.86,0,h*.88,snow if z > 1 else shade,vertices=16)
center_xy()
export_and_preview('snow_hut','Snow-covered hut, snowman and winter pine; distinct near-white, blue-shadow snow and ice materials.',
                   camera_direction=(4,-10,5),preview_size=(1000,750))
