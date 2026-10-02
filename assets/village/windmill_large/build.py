"""Full-size field-edge tower mill; cap 10.6 m, 8.5 m turning sails."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from town_buildings import *

reset(317)
m=palette()
# Round tapered tower, a different outline from the square watch tower.
cone('Windmill_fieldstone_tower',(0,0,4.1),1.79,1.15,8.2,m['fieldstone'],24)
cylinder('Windmill_stone_foot',(0,0,.12),1.90,.24,m['fieldstone2'],24)
for row in range(14):
    z=.43+row*.54
    radius=1.79-z/8.2*.64
    for i in range(12):
        a=math.tau*(i+(row%2)*.5)/12
        if math.sin(a)<-.94 and z<2.3: continue
        stone=box('Windmill_weathered_stone',(radius*math.cos(a),radius*math.sin(a),z),(.48,.10,.28),m['fieldstone2'] if (row+i)%5==0 else m['fieldstone'])
        stone.rotation_euler.z=a+math.pi/2
# Front entrance painted in relief ahead of the shaft; no lamp needed out in the fields.
box('Windmill_oak_door',(0,-1.805,1.13),(.92,.10,2.10),m['oak'])
for x in [-.53,.53]: box('Windmill_door_jamb',(x,-1.82,1.15),(.14,.15,2.30),m['wood'])
box('Windmill_door_lintel',(0,-1.82,2.28),(1.20,.15,.16),m['wood'])
box('Windmill_threshold',(0,-1.92,.07),(1.30,.34,.14),m['trim'])
for angle in [0,math.pi/2,math.pi,-math.pi/2]:
    for z in [3.55,6.10]:
        radius=1.79-z/8.2*.64
        facade_box('Windmill_dark_window',0,-radius-.025,z,.48,.09,.76,m['wood'],angle)
        facade_box('Windmill_quiet_window',0,-radius-.085,z,.28,.05,.56,m['dim'],angle)
        facade_box('Windmill_window_crossbar',0,-radius-.12,z,.34,.05,.07,m['oak'],angle)
# Wooden rotating cap (sails move independently; no hidden rotation assumed on the cap).
cylinder('Windmill_cap_platform',(0,0,8.25),1.47,.23,m['oak'],24)
cone('Windmill_timber_cap',(0,0,8.77),1.47,1.38,.85,m['tar'],24)
cone('Windmill_slate_cap',(0,0,9.73),1.69,.12,1.46,m['roof2'],24)
cone('Windmill_brass_finial',(0,0,10.58),.12,.02,.27,m['brass'],12)
axle=Vector((0,-2.25,8.35))
parts=[cylinder('Windmill_sail_hub',axle,.32,.55,m['oak'],16,rot=(math.pi/2,0,0))]
lattice=[]
# Four broad cloth sails on tapering lattice frames, each built in the X/Z plane.
for i in range(4):
    a=i*math.pi/2+.16
    def p(u,v):
        return axle+Vector((u*math.cos(a)+v*math.sin(a),0,-u*math.sin(a)+v*math.cos(a)))
    parts.append(beam('Windmill_main_sail_arm',p(0,.25),p(0,4.13),.18,m['wood'],4))
    for side in [-1,1]: parts.append(beam('Windmill_sail_edge',p(side*.44,1.1),p(side*.33,4.20),.075,m['oak'],4))
    for j in range(9):
        v=1.15+j*.37
        lattice.append(beam('thin_Windmill_lattice',p(-.43,v),p(.43,v),.036,m['oak'],4))
    # Cloth stops short of the end, leaving open lattice visible and named thin.
    panel=box('Windmill_sail_cloth',p(0,2.1),(.72,.085,1.78),m['whitewash'])
    panel.rotation_euler.y=a
    parts.append(panel)
sails=join(parts,'move_spin_Windmill_large_sails',axle)
orient_pivot_x(sails,(0,-1,0))
sails['speed']=.27
for obj in lattice: parent_at_pivot(obj,sails,axle)
beam('Windmill_fixed_shaft',(0,-1.0,8.35),(0,-2.60,8.35),.17,m['iron'],12)
export_village('windmill_large','Full-size tapered fieldstone tower mill with dark timber cap and four pivoted cloth sails on named thin oak lattice.',
    footprint=(9,5.4),front_door=(0,-1.805,0),max_height=13,
    attachments={'baseDiameterMetres':3.8,'capHeightMetres':10.715,'sailPivotBlender':list(axle),'sailAxisBlender':[0,-1,0],'sailRadiusMetres':4.25})
