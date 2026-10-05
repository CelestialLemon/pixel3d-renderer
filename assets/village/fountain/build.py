"""A hollow stone town fountain with two fluid pools, falling streams and four teal rim lanterns."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from village_common import *

reset(109)
m=palette()
water=material('Village midnight teal water',(.075,.25,.31))
for i in range(24):
    a,b=i*math.tau/24,(i+1)*math.tau/24
    annular_segment('Fountain_foundation_stone',(0,0,0),1.17,1.48,a,b,.17,m['stone'])
    annular_segment('Fountain_basin_wall',(0,0,.17),1.17,1.37,a+.006,b-.006,.37,
                    m['trim'] if i%3==0 else m['stone'])
    annular_segment('Fountain_limestone_rim',(0,0,.54),1.14,1.44,a+.005,b-.005,.14,m['trim'])
cylinder('Fountain_recessed_floor',(0,0,.12),1.20,.10,m['stone'],32)
verts=[(0,0,.46)]+[(1.17*math.cos(i*math.tau/48),1.17*math.sin(i*math.tau/48),.46) for i in range(48)]
mesh('water_Fountain_basin',verts,[(0,i+1,(i+1)%48+1) for i in range(48)],water)
cylinder('Fountain_column_plinth',(0,0,.32),.43,.38,m['trim'],16)
lathe('Fountain_carved_column',(0,0,0),[(.32,.49),(.26,.58),(.19,.70),(.19,1.02),(.29,1.10),(.30,1.18)],m['stone'],24)
# Upper bowl profile returns along its interior, so it is visibly hollow from above.
lathe('Fountain_upper_bowl',(0,0,0),[(.25,1.07),(.48,1.14),(.69,1.32),(.70,1.40),
      (.59,1.40),(.46,1.23),(.20,1.19)],m['trim'],32)
cylinder('Fountain_upper_bowl_floor',(0,0,1.20),.23,.08,m['stone'],24)
verts=[(0,0,1.37)]+[(.57*math.cos(i*math.tau/48),.57*math.sin(i*math.tau/48),1.37) for i in range(48)]
mesh('water_Fountain_upper_pool',verts,[(0,i+1,(i+1)%48+1) for i in range(48)],water)
lathe('Fountain_finial',(0,0,0),[(.13,1.20),(.12,1.62),(.19,1.70),(.12,1.81),(.07,1.91)],m['brass'],16)
sphere('Fountain_finial_orb',(0,0,1.98),(.13,.13,.13),m['brass'],16,8)
# Four stone lion-mouth suggestions: visible brass spouts at the upper bowl.
for i in range(4):
    a=i*math.pi/2
    x,y=math.cos(a),math.sin(a)
    sphere('Fountain_brass_spout',(x*.57,y*.57,1.28),(.12,.12,.10),m['brass'],12,6)
    # Closed hexagonal streams show from every orbit angle. water_ routes all their sides into the fluid layer;
    # tangent gravity scrolls their highlights down, and the lower endpoints stir the receiving basin.
    beam('water_Fountain_spill',(x*.65,y*.65,1.25),(x*.82,y*.82,.47),.09,water,6)
# Each low rim lantern emits turquoise light onto the surrounding stone and paving.
for i in range(4):
    a=i*math.pi/2
    x,y=1.27*math.cos(a),1.27*math.sin(a)
    cylinder('Fountain_rim_lantern_foot',(x,y,.71),.14,.06,m['iron'],12)
    sphere('Fountain_teal_lantern',(x,y,.84),(.10,.10,.14),m['teal_glow'],12,6)
    cone('Fountain_lantern_cap',(x,y,.99),.15,.035,.12,m['brass'],12)
    light=lamp(f'Fountain_teal_rim_{i}',(x,y,.84),(.20,.90,.70),3.5)
    light['clearance']=.18
export_village('fountain','Hollow round stone basin and upper-bowl water_ pools, four falling water_ streams, carved column, four teal rim lanterns with four coloured lamps.',budget=5000,footprint=(3,3),front_door=None)
