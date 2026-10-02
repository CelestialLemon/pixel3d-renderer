"""Small, independently placeable night-street furniture and market clutter."""
from village_common import *


def build_clutter(name):
    reset(113)
    m=palette()
    description=''
    if name=='barrel':
        profile=[(.30,0),(.35,.08),(.40,.34),(.40,.62),(.35,.86),(.30,.94)]
        for i in range(16):
            a,b=i*math.tau/16+.01,(i+1)*math.tau/16-.01
            verts=[(r*math.cos(t),r*math.sin(t),z) for r,z in profile for t in [a,b]]
            # Each stave has a broad external surface. Gaps expose the dark inner core.
            mesh('Barrel_oak_stave',verts,[(j*2,j*2+1,j*2+3,j*2+2) for j in range(len(profile)-1)],m['oak'])
        cylinder('Barrel_dark_core',(0,0,.46),.30,.90,m['wood'],24)
        for z,r in [(.12,.365),(.34,.408),(.64,.405),(.84,.362)]:
            lathe('Barrel_iron_hoop',(0,0,0),[(r,z-.035),(r,z+.035)],m['iron'],32)
        cylinder('Barrel_lid',(0,0,.93),.30,.06,m['oak'],24)
        for x in [-.12,.12]:
            box('Barrel_lid_brace',(x,0,.975),(.075,.51,.05),m['wood'])
        footprint=(.85,.85)
        description='Bulging sixteen-stave oak barrel with four iron hoops and a boarded lid.'
    elif name=='crate':
        for x in [-.46,.46]:
            for y in [-.36,.36]:
                box('Crate_corner_post',(x,y,.38),(.09,.09,.76),m['wood'])
        for row in range(3):
            z=.13+row*.23
            for y in [-.36,.36]:
                box('Crate_front_back_board',(0,y,z),(.94,.08,.17),m['oak'])
            for x in [-.46,.46]:
                box('Crate_side_board',(x,0,z),(.08,.73,.17),m['oak'])
        for i in range(4):
            box('Crate_floor_board',(-.33+i*.22,0,.055),(.20,.72,.11),m['oak'])
        for y in [-.41,.41]:
            beam('Crate_diagonal_brace',(-.40,y,.10),(.40,y,.70),.085,m['wood'],4)
        footprint=(1.1,.95)
        description='Open slatted market crate with corner posts, visible floor and diagonal braces.'
    elif name=='bench':
        for x in [-.72,.72]:
            for y in [-.22,.22]:
                box('Bench_iron_leg',(x,y,.23),(.09,.09,.46),m['iron'])
            box('Bench_seat_bracket',(x,0,.43),(.12,.63,.09),m['iron'])
            beam('Bench_back_support',(x,.23,.41),(x,.30,1.0),.085,m['iron'],6)
        for y in [-.20,0,.20]:
            box('Bench_oak_seat',(0,y,.51),(1.80,.17,.09),m['oak'])
        for z in [.76,.97]:
            box('Bench_oak_back',(0,.30,z),(1.80,.08,.16),m['oak'])
        for x in [-.82,.82]:
            box('Bench_iron_arm',(x,0,.73),(.08,.59,.08),m['iron'])
            beam('Bench_arm_front_support',(x,-.24,.51),(x,-.24,.73),.07,m['iron'])
        footprint=(1.9,.75)
        description='Honey-oak three-plank bench with a two-plank back and sturdy iron arms.'
    elif name=='flower_box':
        box('Flower_box_soil',(0,0,.28),(1.21,.37,.20),m['wood'])
        for y in [-.23,.23]:
            box('Flower_box_long_wall',(0,y,.20),(1.40,.09,.40),m['oak'])
        for x in [-.66,.66]:
            box('Flower_box_end',(x,0,.20),(.09,.45,.40),m['oak'])
        for x in [-.55,.55]:
            for y in [-.25,.25]:
                box('Flower_box_iron_band',(x,y,.20),(.07,.06,.40),m['iron'])
        for i in range(7):
            x=-.54+i*.18
            sphere('decor_Flower_box_foliage',(x,0,.44),(.17,.20,.16),m['green'],10,5)
            sphere('decor_Flower_box_marigold',(x,-.025,.59),(.085,.085,.085),m['flower'],10,5)
        footprint=(1.5,.7)
        description='Oak planter with iron straps, dense sage leaves and seven golden marigolds.'
    elif name=='signpost':
        cylinder('Signpost_stone_foot',(0,0,.075),.24,.15,m['stone'],16)
        box('Signpost_timber_post',(0,0,1.13),(.16,.16,2.26),m['wood'])
        sphere('Signpost_brass_finial',(0,0,2.36),(.13,.13,.13),m['brass'],12,6)
        for side,z,mat in [(-1,1.78,m['teal']),(1,2.12,m['rose_sign'])]:
            pts=[(-.64,z-.13),(.49,z-.13),(.69,z),(.49,z+.13),(-.64,z+.13)]
            if side<0: pts=[(-x,h) for x,h in reversed(pts)]
            extrude_xz('Signpost_direction_arrow',pts,-.10,.09,mat)
            cylinder('Signpost_round_brass_marker',(-side*.32,-.17,z),.075,.05,m['brass'],12,rot=(math.pi/2,0,0))
        footprint=(1.45,.55)
        description='Village signpost with teal and rose directional arrows and brass markers.'
    elif name=='closed_stall':
        for x in [-1.15,1.15]:
            for y in [-.65,.65]:
                box('Closed_stall_timber_post',(x,y,1.1),(.14,.14,2.2),m['wood'])
        box('Closed_stall_counter',(0,-.05,.98),(2.5,1.55,.13),m['oak'])
        for i in range(10):
            x=-1.08+i*.24
            box('Closed_stall_lower_board',(x,-.67,.48),(.22,.10,.90),m['oak'])
            box('Closed_stall_shutter_board',(x,-.10,1.58),(.22,.10,1.04),m['teal'])
        for z in [1.16,1.91]:
            box('Closed_stall_shutter_strap',(0,-.18,z),(2.35,.075,.09),m['iron'])
        for x in [-1.17,1.17]:
            box('Closed_stall_side',(x,0,.47),(.10,1.35,.90),m['oak'])
        for i in range(8):
            x=-1.225+i*.35
            box('Closed_stall_canopy_stripe',(x,0,2.30),(.34,1.75,.10),
                m['teal'] if i%2 else m['plaster'],rot=(.13,0,0))
            box('Closed_stall_canopy_valance',(x,-.88,2.09),(.34,.08,.25),m['teal'] if i%2 else m['plaster'])
        box('Closed_stall_rose_closed_sign',(0,-.24,1.55),(.64,.08,.31),m['rose_sign'])
        for x in [-.16,.16]:
            box('Closed_stall_brass_sign_mark',(x,-.30,1.55),(.09,.05,.17),m['brass'])
        footprint=(2.9,1.9)
        description='Closed night market stall, striped teal/ivory canopy, boarded teal shutters and rose sign.'
    elif name=='festoon':
        for x in [-2.70,2.70]:
            cylinder('Festoon_iron_post',(x,0,1.87),.07,3.74,m['iron'],12)
            cylinder('Festoon_post_foot',(x,0,.055),.14,.11,m['iron'],12)
            sphere('Festoon_brass_post_cap',(x,0,3.80),(.11,.11,.11),m['brass'],12,6)
        points=[(-2.7+5.4*i/32,0,3.70-.62*math.sin(math.pi*i/32)) for i in range(33)]
        path('thin_Festoon_sagging_wire',points,.025,m['iron'],6)
        for i in range(15):
            t=(i+1)/16
            x=-2.7+5.4*t
            z=3.70-.62*math.sin(math.pi*t)
            beam('thin_Festoon_bulb_drop',(x,0,z),(x,0,z-.14),.025,m['iron'],6)
            cylinder('Festoon_bulb_socket',(x,0,z-.16),.055,.08,m['brass'],10)
            sphere('Festoon_amber_bulb',(x,0,z-.27),(.085,.085,.115),m['amber'],12,6)
        footprint=(6,.65)
        description='Six-metre festive string on two grounded iron posts, fifteen emissive amber bulbs and thin_ sagging wire; no lamps.'
    else:
        raise ValueError(name)
    export_village(name,description,budget=5000,footprint=footprint,front_door=None)
