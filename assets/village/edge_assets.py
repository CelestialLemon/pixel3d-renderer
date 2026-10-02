"""Old relics, ruined masonry and everyday village clutter, with stable seeded builds."""
from town_buildings import goods_table, rounded_thatch
from canal_assets import lantern, roof_family
from architecture import *


def runes(label, x, y, z, m, scale=1):
    # Deliberately chunky luminous cuts sit just ahead of dark recessed channels.
    segments=[((-.20,0),(-.20,.42)),((-.20,.27),(.15,.43)),((-.20,.27),(.15,.10)),((.15,.10),(.15,-.08))]
    for (a,b),(c,d) in segments:
        beam(label+'_rune_recess',(x+a*scale,y+.024,z+b*scale),(x+c*scale,y+.024,z+d*scale),.11*scale,m['iron'],4)
        beam(label+'_glowing_rune',(x+a*scale,y,z+b*scale),(x+c*scale,y,z+d*scale),.066*scale,m['rune'],4)


def guardian_statue(m):
    box('Guardian_plinth_base',(0,0,.10),(1.96,1.96,.20),m['fieldstone2'],.04)
    box('Guardian_runic_plinth',(0,0,.42),(1.67,1.67,.45),m['stone'],.035)
    box('Guardian_plinth_cap',(0,0,.74),(1.82,1.82,.19),m['trim'],.035)
    for x in [-.48,.03,.52]: runes('Guardian_plinth',x,-.849,.25,m,.57)
    cone('Guardian_robe',(0,0,1.64),.65,.37,1.63,m['stone'],12)
    for i in range(7):
        a=math.pi+math.pi*i/6
        beam('Guardian_carved_robe_fold',(.57*math.cos(a),.57*math.sin(a),.91),(.34*math.cos(a),.34*math.sin(a),2.40),.075,m['fieldstone2'],4)
    cone('Guardian_stone_torso',(0,0,2.52),.37,.47,.85,m['stone'],10)
    sphere('Guardian_hood',(0,0,3.18),(.34,.30,.40),m['stone'],12,6)
    sphere('Guardian_shadowed_face',(0,-.247,3.15),(.21,.10,.23),m['fieldstone'],10,5)
    for side in [-1,1]:
        beam('Guardian_raised_upper_arm',(side*.40,0,2.78),(side*.64,-.16,3.20),.25,m['stone'],8)
        beam('Guardian_raised_forearm',(side*.64,-.16,3.20),(side*.23,-.12,3.73),.21,m['stone'],8)
        sphere('Guardian_cradling_hand',(side*.20,-.13,3.75),(.14,.13,.17),m['trim'],10,5)
    # Large faceted crystal, a solid emissive material with one contained coloured lamp.
    verts=[(0,-.10,3.69)]+[(.29*math.cos(i*math.tau/6),-.10+.29*math.sin(i*math.tau/6),4.03) for i in range(6)]+[(0,-.10,4.50)]
    mesh('Guardian_luminous_crystal',verts,[(0,1+(i+1)%6,1+i) for i in range(6)]+[(7,1+i,1+(i+1)%6) for i in range(6)],m['relic'])
    light=lamp('Guardian_crystal',(0,-.10,4.06),(.40,.24,1),6)
    light['clearance']=.50
    for x,y,z in [(-.56,-.44,.89),(.50,.34,.91),(-.34,.20,1.20),(.13,-.29,2.11)]:
        sphere('decor_Guardian_moss',(x,y,z),(.20,.15,.09),m['moss'],10,5)
    export_village('guardian_statue','Weathered robed stone guardian raising a violet crystal; carved folds, raised hands, moss and faint luminous runes on its square plinth.',
        budget=5000,footprint=(2,2),front_door=None,max_height=4.6)


def wardstone(m):
    # Uneven tilted stone grown from the ground, with true thickness and a broken tip.
    vertices=[(-.43,-.32,0),(.38,-.32,0),(.40,.33,0),(-.43,.33,0),
              (-.68,-.30,2.31),(.14,-.25,2.56),(.15,.30,2.50),(-.60,.36,2.18)]
    mesh('Wardstone_leaning_monolith',vertices,[(3,2,1,0),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],m['fieldstone'])
    for z in [.57,1.27,1.97]: runes('Wardstone',-.06-z*.10,-.347,z,m,.80)
    for x,y,h in [(-.70,.58,.69),(.69,.48,.95),(.66,-.55,.49)]:
        stone=box('Wardstone_broken_satellite',(x,y,h/2),(.37,.36,h),m['fieldstone2'],.03,rot=(0,.08 if x<0 else -.12,.2))
        bpy.context.view_layer.update()
        stone.location.z-=min((stone.matrix_world@Vector(p)).z for p in stone.bound_box)
    for x,y in [(-.48,.45),(.60,.18),(-.38,-.26)]: sphere('decor_Wardstone_moss',(x,y,.12),(.19,.18,.08),m['moss'],10,5)
    light=lamp('Wardstone_runes',(-.25,-.45,1.40),(.35,.20,.85),3.2)
    light['clearance']=.35
    export_village('wardstone','Leaning violet-runed monolith ringed by three broken standing stones, with moss and a dim violet spill light.',
        budget=5000,footprint=(2,2),front_door=None,max_height=3)


def ruins(m):
    for i in range(10):
        x=-3.72+i*.80
        height=[3.25,3.25,3.75,4.15,3.75,3.35,2.65,2.20,2.20,1.75][i]
        for row in range(int(height/.45)):
            box('Ruins_broken_north_wall',(x,3.30,(row+.5)*.45),(.78,.49,.43),m['fieldstone2'] if (row+i)%5==0 else m['fieldstone'],.018)
    for i in range(8):
        y=-2.64+i*.80
        height=[1.7,1.7,2.3,2.75,3.2,3.6,3.6,3.15][i]
        for row in range(int(height/.45)):
            box('Ruins_broken_west_wall',(-3.99,y,(row+.5)*.45),(.50,.77,.43),m['fieldstone2'] if (row+i)%5==0 else m['fieldstone'],.018)
    # A broken arch once led into the keep, now with its crown fallen out.
    for x in [-2.20,.60]: box('Ruins_arch_pier',(x,-2.55,.94),(.38,.58,1.88),m['fieldstone'],.025)
    for i in list(range(4))+list(range(8,12)):
        a,b=i*math.pi/12,(i+1)*math.pi/12
        p=[(-.8+1.21*math.cos(a),1.85+1.21*math.sin(a)),(-.8+1.51*math.cos(a),1.85+1.51*math.sin(a)),
           (-.8+1.51*math.cos(b),1.85+1.51*math.sin(b)),(-.8+1.21*math.cos(b),1.85+1.21*math.sin(b))]
        extrude_xz('Ruins_broken_arch_voussoir',p,-2.55,.58,m['fieldstone2'])
    for i in range(12):
        x=random.uniform(-2.7,3.4)
        y=random.uniform(-3.0,2.5)
        size=(random.uniform(.35,.65),random.uniform(.30,.55),random.uniform(.25,.47))
        box('Ruins_fallen_rubble',(x,y,size[2]/2),size,m['fieldstone2'] if i%3 else m['fieldstone'],.025,rot=(0,0,random.uniform(-.6,.6)))
    for x in [-3.5,-2.0,.60,2.35]:
        height=[3.10,3.65,2.58,2.10][[-3.5,-2.0,.60,2.35].index(x)]
        points=[(x,3.04,height),(x+.19,3.00,height*.70),(x-.08,3.01,height*.35),(x+.11,3.00,.35)]
        path('decor_vine_Ruins_trailing_stem',points,.09,m['green'],5)
        for i in range(6):
            z=.4+(height-.4)*i/5
            sphere('decor_vine_Ruins_ivy',(x+(.18 if i%2 else -.13),2.99,z),(.25,.10,.18),m['green'] if i%2 else m['moss'],8,4)
    for y,z in [(-1.6,1.65),(.50,2.70),(2.3,3.15)]:
        path('decor_vine_Ruins_west_stem',[(-3.71,y,z),(-3.70,y+.18,z*.60),(-3.70,y-.12,.20)],.08,m['green'],5)
        for i in range(4): sphere('decor_vine_Ruins_west_ivy',(-3.69,y+(.14 if i%2 else -.14),.30+i*z/4),(.10,.24,.19),m['moss'] if i%2 else m['green'],8,4)
    export_village('ruins','Roofless ruined keep with jagged masonry heights, a broken arch, scattered fallen blocks and trailing two-tone ivy.',
        footprint=(9,8),front_door=None,max_height=4.5)


def hay_bales(m):
    for i,(x,y,z) in enumerate([(-.50,-.31,.36),(.53,-.31,.36),(0,.41,.36),(0,-.12,1.05)]):
        box('Hay_bale',(x,y,z),(.93,.64,.68),m['thatch'] if i%2 else m['thatch2'],.06)
        for dx in [-.29,.29]: box('Hay_bale_binding',(x+dx,y,z),(.075,.67,.72),m['oak'])
    export_village('hay_bales','Small stack of four golden reed hay bales with chunky twine bindings.',budget=5000,footprint=(2.2,1.6),front_door=None,max_height=1.5)


def woodpile(m):
    for row in range(3):
        count=5-row
        for i in range(count):
            x=(i-(count-1)/2)*.34
            z=.20+row*.33
            cylinder('Woodpile_bark_log',(x,0,z),.18,1.42,m['wood'],12,rot=(math.pi/2,0,0),smooth=False)
            for y in [-.715,.715]: cylinder('Woodpile_cut_log_end',(x,y,z),.148,.025,m['oak'],12,rot=(math.pi/2,0,0))
    for x in [-1.0,1.0]:
        for y in [-.78,.78]: box('Woodpile_shelter_post',(x,y,.72),(.14,.14,1.44),m['tar'])
    box('Woodpile_lean_roof',(0,0,1.48),(2.36,1.92,.18),m['tar'],rot=(.16,0,0))
    export_village('woodpile','Stacked split logs with visible cut ends, sheltered by a small sloping tarred-timber roof.',budget=5000,footprint=(2.5,2.2),front_door=None,max_height=1.9)


def laundry_line(m):
    for x in [-2.38,2.38]: box('Laundry_line_post',(x,0,1.32),(.15,.15,2.64),m['oak'])
    points=[(-2.38+4.76*i/16,0,2.55-.32*math.sin(math.pi*i/16)) for i in range(17)]
    path('thin_Laundry_line_rope',points,.028,m['wood'],5)
    for i,x in enumerate([-1.65,-.55,.55,1.65]):
        z=2.55-.32*math.sin(math.pi*(x+2.38)/4.76)
        cloth=box('move_sway_Laundry_cloth',(x,0,z-.46),(.70,.065,.92),m[['whitewash','teal','rose_sign','plaster'][i]])
        pivot(cloth,(x,0,z))
        cloth['speed']=.8+i*.1
        cloth['amplitude']=.11
        for dx in [-.24,.24]: box('Laundry_clothespeg',(x+dx,-.02,z+.04),(.075,.10,.18),m['oak'])
    export_village('laundry_line','Four contrasting cloths pivoted on a thin sagging rope between stout wooden posts.',budget=5000,footprint=(5.1,.5),front_door=None,max_height=2.8)


def notice_board(m):
    for x in [-.65,.65]: box('Notice_board_post',(x,0,1.19),(.17,.18,2.38),m['oak'])
    box('Notice_board_back',(0,0,1.47),(1.61,.14,1.32),m['wood'])
    for x in [-.76,.76]: box('Notice_board_border',(x,-.10,1.47),(.10,.11,1.35),m['oak'])
    for z in [.80,2.14]: box('Notice_board_border',(0,-.10,z),(1.65,.11,.12),m['oak'])
    for i,(x,z,w,h) in enumerate([(-.40,1.68,.39,.52),(.28,1.63,.43,.63),(-.27,1.10,.51,.29),(.40,1.10,.25,.29)]):
        box('Notice_board_paper',(x,-.10,z),(w,.065,h),m['whitewash'] if i%2 else m['plaster'],rot=(0,0,.06 if i%2 else -.07))
        for dz in [-.1,.05]: box('Notice_board_ink',(x,-.141,z+dz),(w*.66,.015,.05),m['wood'])
    before=set(bpy.context.scene.objects)
    roof('Notice_board',.83,1.92,2.33,.39,m,angle=math.pi/2)
    export_village('notice_board','Roofed oak village notice board with four overlapping paper notices and readable ink strokes.',budget=5000,footprint=(2.1,1.1),front_door=None,max_height=3)


def market_stall_lit(m):
    for x in [-1.16,1.16]:
        for y in [-.56,.56]: box('Lit_stall_post',(x,y,1.24),(.14,.14,2.48),m['oak'])
    box('Lit_stall_counter',(0,-.12,1.03),(2.38,1.02,.15),m['oak'])
    box('Lit_stall_front_boards',(0,-.60,.56),(2.32,.12,.80),m['wood'])
    for i in range(8):
        x=-1.30+(i+.5)*2.60/8
        box('Lit_stall_awning_stripe',(x,-.08,2.50),(2.60/8-.008,1.62,.085),m['rose_sign'] if i%2 else m['red_timber'],rot=(.13,0,0))
        box('Lit_stall_awning_valance',(x,-.87,2.31),(2.60/8-.008,.07,.21),m['rose_sign'] if i%2 else m['red_timber'])
    for i in range(12): sphere('Lit_stall_fruit',(-.91+(i%6)*.31,-.28+(i//6)*.34,1.23),(.15,.14,.14),m['flower'] if i%3 else m['teal'],10,5)
    lantern('Lit_stall_hanging_lantern',(.84,-.08,2.0),m,3.2)
    export_village('market_stall_lit','Open striped market stall with fruit, dark-red canvas bands and a hanging amber lantern.',budget=5000,footprint=(3,2),front_door=None,max_height=2.8)


def mooring_bollard(m):
    cylinder('Bollard_flanged_foot',(0,0,.03),.12,.06,m['iron'],16)
    cylinder('Bollard_iron_shaft',(0,0,.14),.065,.22,m['iron'],16)
    cylinder('Bollard_mushroom_cap',(0,0,.26),.10,.055,m['iron'],16)
    export_village('mooring_bollard','Small flanged mushroom-headed cast-iron mooring bollard.',budget=5000,footprint=(.25,.25),front_door=None,max_height=.32)


BUILDERS={name:globals()[name] for name in ['guardian_statue','wardstone','ruins','hay_bales','woodpile','laundry_line','notice_board','market_stall_lit','mooring_bollard']}


def build(name):
    reset(311)
    BUILDERS[name](palette())
