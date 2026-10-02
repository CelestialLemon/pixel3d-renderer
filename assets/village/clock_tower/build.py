"""A four-sided village clock tower, with a belfry and a tall slate spire."""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from architecture import *

reset(131)
m=palette()
clock=material('Village clock warm enamel',(.96,.72,.31),emission=.5)
box('Clock_tower_stone_plinth',(0,0,.20),(3.35,3.35,.40),m['stone'])
box('Clock_tower_lower_base',(0,0,1.85),(2.96,2.96,2.90),m['stone'])
box('Clock_tower_slim_shaft',(0,0,5.73),(2.55,2.55,4.86),m['plaster'])
box('Clock_tower_clock_stage',(0,0,8.84),(3.0,3.0,1.50),m['stone'])
for z,w in [(.51,3.12),(3.20,3.16),(6.30,2.76),(8.11,3.22),(9.61,3.38)]:
    box('Clock_tower_limestone_course',(0,0,z),(w,w,.18),m['trim'])
for x in [-1.21,1.21]:
    for y in [-1.21,1.21]:
        box('Clock_tower_vertical_timber',(x,y,5.78),(.16,.16,4.60),m['wood'])
# Quoins break the broad stone base into readable courses, on every corner.
for z in [.82,1.35,1.88,2.41,2.94]:
    for x in [-1.45,1.45]:
        for y in [-1.45,1.45]:
            box('Clock_tower_corner_quoin',(x,y,z),(.24,.24,.22),m['trim'])
doorway('Clock_tower_front',0,-1.53,.09,m,0,w=1.02,h=2.25)
for angle in [0,math.pi/2,math.pi,-math.pi/2]:
    for z in [4.56,6.97]:
        facade_box('Clock_tower_recessed_arrow_window',0,-1.30,z,.36,.12,.90,m['wood'],angle)
        facade_box('Clock_tower_quiet_lit_window',0,-1.38,z,.21,.06,.72,m['dim'],angle)
        for dx in [-.16,.16]:
            facade_box('Clock_tower_window_jamb',dx,-1.42,z,.07,.07,.90,m['trim'],angle)
        facade_box('Clock_tower_window_sill',0,-1.40,z-.48,.45,.17,.10,m['trim'],angle)
    # All four clock faces make the landmark readable through the orbit.
    position=facing((0,-1.55,8.86),angle)
    cyl=cylinder('Clock_tower_brass_clock_rim',position,.64,.12,m['brass'],32,rot=(math.pi/2,0,angle))
    face_position=facing((0,-1.63,8.86),angle)
    cylinder('Clock_tower_emissive_clock_face',face_position,.55,.06,clock,32,rot=(math.pi/2,0,angle))
    for i in range(12):
        a=i*math.tau/12
        dx,dz=.44*math.sin(a),.44*math.cos(a)
        tick=facade_box('Clock_tower_hour_marker',dx,-1.675,8.86+dz,.07,.055,.12,m['wood'],angle)
        tick.rotation_euler.y=-a
    # Hands at ten past ten; chunky enough to remain visible at game scale.
    beam('Clock_tower_hour_hand',facing((0,-1.73,8.86),angle),facing((-.26,-1.73,9.02),angle),.065,m['wood'],4)
    beam('Clock_tower_minute_hand',facing((0,-1.74,8.86),angle),facing((.31,-1.74,9.06),angle),.060,m['wood'],4)
    sphere('Clock_tower_hand_hub',facing((0,-1.75,8.86),angle),(.075,.05,.075),m['brass'],12,6)
# Open belfry: separate timber posts and a suspended brass bell, no solid box.
box('Clock_tower_belfry_floor',(0,0,9.78),(2.55,2.55,.18),m['wood'])
for x in [-1.1,1.1]:
    for y in [-1.1,1.1]:
        box('Clock_tower_belfry_post',(x,y,10.35),(.18,.18,1.10),m['wood'])
for angle in [0,math.pi/2,math.pi,-math.pi/2]:
    facade_box('Clock_tower_belfry_lintel',0,-1.11,10.92,2.45,.18,.18,m['wood'],angle)
    for x in [-.64,.64]:
        beam('Clock_tower_belfry_brace',facing((x,-1.11,10.86),angle),facing((x*1.65,-1.11,10.43),angle),.12,m['wood'],4)
lathe('Clock_tower_brass_bell',(0,0,0),[(.49,10.07),(.47,10.18),(.29,10.36),(.24,10.58),(.12,10.66)],m['brass'],24)
sphere('Clock_tower_bell_clapper',(0,0,10.05),(.095,.095,.12),m['iron'],12,6)
beam('Clock_tower_bell_mount',(0,0,10.65),(0,0,10.93),.085,m['iron'])
# Four-sided taper and stepped skirt give a strong silhouette against the moonlit sky.
box('Clock_tower_spire_eave',(0,0,11.04),(3.33,3.33,.16),m['wood'])
verts=[(-1.70,-1.70,11.10),(1.70,-1.70,11.10),(1.70,1.70,11.10),(-1.70,1.70,11.10),(0,0,13.42)]
spire=mesh('Clock_tower_slate_spire',verts,[(0,1,4),(1,2,4),(2,3,4),(3,0,4),(3,2,1,0)],m['roof'])
for row in range(6):
    t=(row+.5)/6
    width=3.4*(1-t)
    for angle in [0,math.pi/2,math.pi,-math.pi/2]:
        half=width/2
        z=11.10+2.32*t
        beam('Clock_tower_spire_slate_course',facing((-half,-half,z),angle),facing((half,-half,z),angle),.085,m['roof2'],4)
sphere('Clock_tower_spire_gold_finial',(0,0,13.48),(.11,.11,.15),m['brass'],12,6)
export_village('clock_tower','Four warm emissive clock faces, stone base and timber shaft, open brass-bell belfry, tall slate spire; no additional lamp empties.',
               footprint=(4,4),front_door=(0,-1.53,0),max_height=14)
