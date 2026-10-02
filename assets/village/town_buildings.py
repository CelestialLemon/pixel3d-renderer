"""Distinct civic and rural silhouettes for Lantern Row's canal-town expansion."""
from canal_assets import lantern, roof_family
from architecture import *


def masonry(label, half, surface, bottom, top, holes, m, angle=0, brick=False):
    """Chunky relief blocks, with conservative clearance around every real aperture."""
    step=.33 if brick else .46
    pitch=.58 if brick else .76
    for row in range(int((top-bottom)/step)):
        z=bottom+(row+.5)*step
        columns=int(2*half/pitch)
        for col in range(columns):
            x=-half+.35+col*pitch+(row%2)*pitch*.5
            ww=pitch-.09
            hh=step-.09
            if x+ww/2>half-.06 or x-ww/2<-half+.06: continue
            if any(abs(x-hx)<(ww+hw)/2+.15 and abs(z-hz)<(hh+height)/2+.15 for hx,hz,hw,height in holes): continue
            if not brick and (row+col)%3==0: continue
            mat=m['red_brick'] if brick else m['fieldstone2'] if (col+row)%4==0 else m['fieldstone']
            facade_box(label+'_relief_block',x,surface-.035,z,ww,.12,hh,mat,angle,.025 if not brick and (row+col)%4==0 else 0)


def thatch_profile(w,eave,rise):
    return [(-w/2,eave),(-w*.46,eave+.32),(-w*.32,eave+rise*.63),(-w*.16,eave+rise*.92),
         (0,eave+rise),(w*.16,eave+rise*.92),(w*.32,eave+rise*.63),(w*.46,eave+.32),(w/2,eave)]


def rounded_thatch(label,w,d,eave,rise,m):
    # An actual thick curved section, rather than a slate roof recoloured yellow.
    top=thatch_profile(w,eave,rise)
    # Reverse top for CCW section; bottom runs left to right.
    section=[(x,z-.36) for x,z in top]+list(reversed(top))
    cols=max(8,int(d/.36))
    for i in range(cols):
        y=-d/2+(i+.5)*d/cols
        extrude_xz(label+'_thatch_bundle',section,y,d/cols,m['thatch'] if i%4 else m['thatch2'])
    path(label+'_thatched_ridge',[(0,-d/2+.09,eave+rise+.05),(0,d/2-.09,eave+rise+.05)],.25,m['thatch2'],8)
    for y in [-d*.34,0,d*.34]:
        path(label+'_thatch_binding',[(x,y,z+.025) for x,z in top],.085,m['thatch2'],4)


def arched_arcade(label,half,surface,bottom,spring,radius,centres,m,angle=0):
    # Continuous wall assembled around true empty arches; no boolean instability.
    left=-half
    for centre in centres:
        edge=centre-radius
        if edge>left:
            facade_box(label+'_pier',(left+edge)/2,surface+.12,(bottom+spring+radius)/2,
                       edge-left,.30,spring+radius-bottom,m['fieldstone'],angle)
        for i in range(12):
            a,b=math.pi*i/12,math.pi*(i+1)/12
            x0,x1=centre+radius*math.cos(a),centre+radius*math.cos(b)
            z0,z1=spring+radius*math.sin(a),spring+radius*math.sin(b)
            poly=[(x1,z1),(x0,z0),(x0,spring+radius+.26),(x1,spring+radius+.26)]
            obj=extrude_xz(label+'_arch_spandrel',poly,surface+.12,.30,m['fieldstone'])
            obj.rotation_euler.z=angle
            ring=[(centre+radius*math.cos(b),spring+radius*math.sin(b)),
                  (centre+radius*math.cos(a),spring+radius*math.sin(a)),
                  (centre+(radius+.18)*math.cos(a),spring+(radius+.18)*math.sin(a)),
                  (centre+(radius+.18)*math.cos(b),spring+(radius+.18)*math.sin(b))]
            obj=extrude_xz(label+'_radial_arch_stone',ring,surface-.06,.13,m['trim'])
            obj.rotation_euler.z=angle
        left=centre+radius
    if left<half:
        facade_box(label+'_end_pier',(left+half)/2,surface+.12,(bottom+spring+radius)/2,
                   half-left,.30,spring+radius-bottom,m['fieldstone'],angle)


def town_hall(m):
    w,d=8.9,5.75
    # Arcaded ground floor on front and sides, with a solid back and lit rear doors.
    arched_arcade('Hall_front',w/2,-d/2,0,1.48,1.12,[-2.95,0,2.95],m)
    for angle in [math.pi/2,-math.pi/2]:
        arched_arcade('Hall_side',d/2,-w/2,0,1.48,1.12,[-1.30,1.30],m,angle)
    box('Hall_rear_stone_wall',(0,d/2-.10,1.5),(w,.25,3),m['fieldstone'])
    for x in [-2.95,0,2.95]:
        box('Hall_arcade_rear_door',(x,2.61,1.28),(1.0,.10,2.25),m['oak'])
        box('Hall_rear_amber_transom',(x,2.545,2.49),(.80,.06,.32),m['amber'])
    for x in [-2.95,2.95]:
        lantern('Hall_arcade_lantern',(x,-.90,2.32),m,4.0)
        beam('Hall_lantern_hanger',(x,-.90,2.57),(x,-.90,3.03),.08,m['iron'])
    box('Hall_first_floor',(0,0,3.05),(9.0,5.88,.20),m['wood'])
    for side,angle in [('front',0),('right',math.pi/2),('back',math.pi),('left',-math.pi/2)]:
        half=(w if side in ['front','back'] else d)/2
        surf=-(d if side in ['front','back'] else w)/2
        positions=[-2.95,0,2.95] if side in ['front','back'] else [-1.30,1.30]
        holes=[(x,4.80,1.20,1.50) for x in positions]
        open_wall('Hall_upper_ivory',half,surf,3.15,6.48,holes,m['plaster'],angle)
        for x in positions:
            architectural_window('Hall_'+side,x,surf,4.80,1.20,1.50,m,angle)
        for x in [-half+.08,half-.08]: facade_box('Hall_upper_frame',x,surf-.08,4.82,.19,.16,3.3,m['wood'],angle)
        for z in [3.24,6.45]: facade_box('Hall_ornate_course',0,surf-.08,z,2*half+.10,.19,.22,m['wood'],angle)
    roof('Hall',6.40,9.50,6.61,2.35,roof_family(m,'tile'),angle=math.pi/2,hip=True)
    # Balcony and its central pediment stay within the seven-metre depth.
    box('Hall_balcony_platform',(0,-3.15,4.0),(2.20,.63,.16),m['trim'])
    for x in [-.99,-.66,-.33,0,.33,.66,.99]: box('Hall_balcony_baluster',(x,-3.42,4.42),(.10,.10,.70),m['wood'])
    box('Hall_balcony_rail',(0,-3.42,4.84),(2.24,.12,.12),m['oak'])
    extrude_xz('Hall_central_pediment',[(-1.48,6.54),(1.48,6.54),(0,8.45)],-2.98,.26,m['plaster'])
    for side in [-1,1]: beam('Hall_pediment_rake',(side*1.48,-3.17,6.54),(0,-3.17,8.45),.15,m['wood'],4)
    cylinder('Hall_pediment_clock',(0,-3.18,7.26),.40,.09,m['trim'],24,rot=(math.pi/2,0,0))
    beam('Hall_clock_hand',(0,-3.24,7.26),(.21,-3.24,7.45),.075,m['iron'],4)
    beam('Hall_clock_hand',(0,-3.24,7.26),(0,-3.24,7.56),.065,m['iron'],4)
    for x in [-2.0,2.0]:
        banner=box('move_sway_Hall_banner',(x,-3.10,5.65),(.56,.08,1.45),m['teal'] if x<0 else m['rose_sign'])
        pivot(banner,(x,-3.10,6.38))
        emblem=box('Hall_banner_emblem',(x,-3.16,5.80),(.23,.06,.28),m['brass'])
        parent_at_pivot(emblem,banner,(x,-3.10,6.38))
    box('Hall_turret_plinth',(0,0,9.0),(1.72,1.72,.25),m['trim'])
    for x in [-.63,.63]:
        for y in [-.63,.63]: box('Hall_belfry_post',(x,y,9.95),(.17,.17,1.80),m['wood'])
    bell=lathe('Hall_bronze_bell',(0,0,9.35),[(.43,0),(.34,.15),(.25,.48),(.22,.64)],m['brass'],24)
    cylinder('Hall_bell_clapper',(0,0,9.30),.09,.32,m['iron'],12)
    roof('Hall_turret',1.95,1.95,10.83,.85,roof_family(m,'tile'),hip=True)
    cone('Hall_turret_finial',(0,0,11.92),.12,.01,.46,m['brass'],12)
    export_village('town_hall','Grand civic hall: three open front arcades, side arcades, ivory upper floor, red hipped roof, balcony, clock pediment, banners and bronze belfry.',
        footprint=(10,7),front_door=(0,-2.875,0),max_height=13)


def pointed_window(label,x,surface,bottom,w,h,m,angle=0):
    spring=bottom+h-.70
    top=bottom+h
    # Fill just the upper outside corners of the rectangular wall aperture.
    for side in [-1,1]:
        poly=[(x,top),(x+side*w/2,spring),(x+side*w/2,top)]
        if side<0: poly.reverse()
        obj=extrude_xz(label+'_pointed_corner',poly,surface+.085,.17,m['fieldstone'])
        obj.rotation_euler.z=angle
    for i,key in enumerate(['stained_blue','stained_rose','stained_gold']):
        facade_box(label+'_coloured_pane',x-w/2+(i+.5)*w/3,surface+.15,(bottom+spring)/2,w/3-.035,.055,spring-bottom,m[key],angle)
    poly=[(x-w/2,spring),(x+w/2,spring),(x,top)]
    obj=extrude_xz(label+'_gold_point',poly,surface+.15,.055,m['stained_gold'])
    obj.rotation_euler.z=angle
    outline=[(x-w/2,surface-.075,bottom),(x-w/2,surface-.075,spring),(x,surface-.075,top),
             (x+w/2,surface-.075,spring),(x+w/2,surface-.075,bottom),(x-w/2,surface-.075,bottom)]
    path(label+'_stone_reveal',[facing(p,angle) for p in outline],.14,m['trim'],4)
    for xx in [x-w/6,x+w/6]: facade_box(label+'_lead_mullion',xx,surface-.03,(bottom+spring)/2,.055,.07,spring-bottom,m['iron'],angle)
    facade_box(label+'_lead_crossbar',x,surface-.03,bottom+(spring-bottom)*.55,w,.07,.07,m['iron'],angle)


def chapel(m):
    w,d=4.8,7.5
    cy=.95
    for side,angle in [('front',0),('right',math.pi/2),('back',math.pi),('left',-math.pi/2)]:
        half=(w if side in ['front','back'] else d)/2
        surf=-(d if side in ['front','back'] else w)/2
        positions=[0] if side in ['front','back'] else [-2.40,0,2.40]
        holes=[(x,3.52,.92,2.64) for x in positions]
        if side=='front': holes=[(0,1.18,1.1,2.36)]
        before=set(bpy.context.scene.objects)
        open_wall('Chapel_nave_fieldstone',half,surf,0,5.22,holes,m['fieldstone'],angle)
        masonry('Chapel_nave',half,surf,.05,5.22,holes,m,angle)
        if side!='front':
            for x in positions: pointed_window('Chapel_'+side,x,surf,2.20,.92,2.64,m,angle)
        else: doorway('Chapel_nave',0,surf,.08,m,angle,w=1.1,h=2.28)
        for x in [-half+.16,half-.16]: facade_box('Chapel_corner_buttress',x,surf-.18,2.35,.33,.46,4.7,m['fieldstone2'],angle)
        for obj in set(bpy.context.scene.objects)-before: obj.location.y+=cy
    for y in [-d/2,d/2]:
        extrude_xz('Chapel_stone_gable',[(-w/2,5.2),(w/2,5.2),(0,8.05)],y+cy,.18,m['fieldstone'])
    before=set(bpy.context.scene.objects)
    roof('Chapel_nave',5.45,8.15,5.24,3.0,m)
    for obj in set(bpy.context.scene.objects)-before: obj.location.y+=cy
    # Small square front bell tower, stepped into the nave facade.
    before=set(bpy.context.scene.objects)
    for side,angle in [('front',0),('right',math.pi/2),('back',math.pi),('left',-math.pi/2)]:
        half=1.05
        surf=-1.05
        holes=[(0,1.20,1.1,2.4)] if side=='front' else []
        open_wall('Chapel_front_tower',half,surf,0,6.68,holes,m['fieldstone'],angle)
        masonry('Chapel_tower',half,surf,0,6.68,holes,m,angle)
        if side=='front': doorway('Chapel_entry',0,surf,.08,m,angle,w=1.1,h=2.32)
    for x in [-.82,.82]:
        for y in [-.82,.82]: box('Chapel_belfry_corner',(x,y,7.36),(.30,.30,1.42),m['fieldstone2'])
    box('Chapel_belfry_lintel',(0,0,8.07),(2.17,2.17,.20),m['trim'])
    lathe('Chapel_hanging_bell',(0,0,6.99),[(.41,0),(.30,.17),(.22,.48),(.18,.61)],m['brass'],24)
    cone('Chapel_slate_spire',(0,0,9.06),1.65,0,1.85,m['roof'],4)
    beam('Chapel_cross_vertical',(0,0,10.0),(0,0,10.55),.11,m['brass'],4)
    beam('Chapel_cross_arms',(-.23,0,10.31),(.23,0,10.31),.10,m['brass'],4)
    lantern('Chapel_door_lantern',(.66,-1.24,2.82),m,3.5)
    for obj in set(bpy.context.scene.objects)-before: obj.location.y-=3.84
    export_village('chapel','Long fieldstone nave, steep blue slate roof, square front belfry and tall cobalt/rose/gold pointed stained-glass windows; one door lamp.',
        footprint=(6,11),front_door=(0,-4.89,0),max_height=11)


def watch_tower(m):
    verts=[(x*half,y*half,z) for half,z in [(1.70,.20),(1.25,10.75)] for x,y in [(-1,-1),(1,-1),(1,1),(-1,1)]]
    mesh('Watch_tapered_fieldstone_shaft',verts,[(3,2,1,0),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],m['fieldstone'])
    box('Watch_stone_foot',(0,0,.10),(3.6,3.6,.20),m['fieldstone2'])
    for row in range(16):
        z=.5+row*.625
        half=1.7-(z-.2)/10.55*.45
        for angle in [0,math.pi/2,math.pi,-math.pi/2]:
            for x in [-half*.55,half*.55]:
                facade_box('Watch_rough_stone',x,-half-.015,z,.65,.10,.32,m['fieldstone2'] if row%4==0 else m['fieldstone'],angle,.025)
    for angle in [0,math.pi/2,math.pi,-math.pi/2]:
        for z in [3.0,7.0]:
            facade_box('Watch_arrow_slit_recess',0,-1.72+(z/10.55)*.45,z,.21,.09,.85,m['iron'],angle)
            facade_box('Watch_arrow_slit_amber',0,-1.78+(z/10.55)*.45,z,.10,.08,.60,m['dim'],angle)
    before=set(bpy.context.scene.objects)
    doorway('Watch_tower',0,-1.76,.08,m,0,w=.85,h=2.1)
    for obj in set(bpy.context.scene.objects)-before:
        if obj.name.endswith('_doorstep'): bpy.data.objects.remove(obj,do_unlink=True)
    box('Watch_tower_doorstep',(0,-1.81,.07),(1.27,.35,.14),m['trim'],.025)
    box('Watch_hoarding_floor',(0,0,10.82),(3.72,3.72,.22),m['oak'])
    for angle in [0,math.pi/2,math.pi,-math.pi/2]:
        for x in [-1.5,-.5,.5,1.5]:
            beam('Watch_hoarding_corbel',facing((x*.7,-1.28,9.9),angle),facing((x,-1.76,10.78),angle),.17,m['wood'],4)
            facade_box('Watch_lookout_post',x,-1.70,11.96,.16,.16,2.16,m['wood'],angle)
        for x in [-1.6,-1.3,-1,-.7,-.4,-.1,.2,.5,.8,1.1,1.4]:
            facade_box('Watch_hoarding_board',x,-1.75,11.36,.27,.10,.83,m['oak'],angle)
        facade_box('Watch_lookout_crossbeam',0,-1.74,12.95,3.65,.14,.17,m['wood'],angle)
    roof('Watch',3.82,3.82,13.05,1.38,m,hip=True)
    lathe('Watch_brazier',(.65,-1.28,11.89),[(.16,0),(.32,.30),(.36,.45)],m['iron'],16)
    sphere('Watch_brazier_coals',(.65,-1.28,12.28),(.28,.28,.10),m['coal'],12,6)
    cone('Watch_brazier_flame',(.65,-1.28,12.56),.18,.035,.55,m['amber'],10)
    light=lamp('Watch_brazier',(.65,-1.28,12.54),(1,.34,.065),8.0)
    light['clearance']=.28
    export_village('watch_tower','Tapered fieldstone watchtower, arrow slits, cantilevered timber hoarding and a warm brazier under its hipped slate cap.',
        footprint=(4,4),front_door=(0,-1.76,0),max_height=15)


def cottage(m,long=False):
    name='cottage_long' if long else 'cottage_thatch'
    w,d=(5.6,3.1) if long else (4.0,3.05)
    h=2.6
    for side,angle in [('front',0),('right',math.pi/2),('back',math.pi),('left',-math.pi/2)]:
        half=(w if side in ['front','back'] else d)/2
        surf=-(d if side in ['front','back'] else w)/2
        positions=[-half*.57,half*.57] if side in ['front','back'] else [0]
        holes=[(x,1.50,.65,.75) for x in positions]
        if side=='front': holes.append((0,1.04,.84,2.08))
        open_wall(name+'_low_wall',half,surf,0,h,holes,m['whitewash'] if long else m['fieldstone'],angle)
        masonry(name,half,surf,.10,.85 if long else h,holes,m,angle)
        for x in positions: architectural_window(name+'_'+side,x,surf,1.50,.65,.75,m,angle,glow='dim',shutters=side=='front')
        if side=='front': doorway(name,0,surf,.08,m,angle,w=.84,h=2.0)
    if long:
        # Asymmetrical whitewashed lean-to gives a long farmhouse silhouette and recessed porch.
        box('Long_cottage_lean_to_body',(2.16,1.35,1.12),(1.40,1.65,2.24),m['whitewash'])
        box('Long_cottage_lean_to_thatch',(2.34,1.39,2.42),(1.70,1.65,.34),m['thatch'],rot=(0,.25,0))
        for y in [.70,2.04]: box('Long_cottage_lean_to_post',(3.10,y,1.15),(.14,.14,2.30),m['wood'])
    for y in [-d/2,d/2]:
        top=thatch_profile(w+.72,2.71,1.44)
        def underside(x):
            for (a,za),(b,zb) in zip(top,top[1:]):
                if a<=x<=b: return za+(zb-za)*(x-a)/(b-a)-.32
            raise ValueError(x)
        clipped=[(-w/2,underside(-w/2))]+[(x,z-.32) for x,z in top if -w/2<x<w/2]+[(w/2,underside(w/2))]
        extrude_xz(name+'_rounded_gable',[(-w/2,h),(w/2,h)]+list(reversed(clipped)),y,.17,m['whitewash'] if long else m['fieldstone'])
    rounded_thatch(name,w+.72,d+.67,2.71,1.44,m)
    chimney(name,-w*.27,.40,3.25,4.70,m)
    lantern(name+'_door_lantern',(.72,-d/2-.17,1.97),m,3.0)
    export_village(name,'Long whitewashed thatched farmhouse with lean-to' if long else 'Low fieldstone cottage with a thick rounded reed roof, deep eaves and small recessed shuttered windows',
        footprint=(7,4.5) if long else (5,4),front_door=(0,-d/2,0),max_height=5)


def cottage_thatch(m): cottage(m)
def cottage_long(m): cottage(m,True)


def smithy(m):
    w,d=4.85,3.80
    # Open workshop front: no wall or opaque window disguising the forge.
    for side,angle in [('right',math.pi/2),('back',math.pi),('left',-math.pi/2)]:
        half=(w if side=='back' else d)/2
        surf=-(d if side=='back' else w)/2
        open_wall('Smithy_brick_wall',half,surf,0,3.0,[],m['fieldstone'],angle)
        masonry('Smithy_brickwork',half,surf,0,3.0,[],m,angle,brick=True)
    for x in [-2.35,2.35]: box('Smithy_front_post',(x,-1.9,1.52),(.20,.20,3.04),m['wood'])
    box('Smithy_front_beam',(0,-1.9,2.96),(4.9,.20,.23),m['wood'])
    for x in [-2.35,2.35]: beam('Smithy_front_brace',(x,-1.91,2.1),(x-math.copysign(.65,x),-1.91,2.90),.16,m['wood'],4)
    roof('Smithy',5.65,4.70,3.11,1.20,roof_family(m,'tile'),hip=True)
    # A real hearth under a brick hood, open toward the front.
    box('Smithy_hearth_base',(.95,.98,.42),(1.85,1.24,.84),m['fieldstone2'])
    for x in [.18,1.72]: box('Smithy_hearth_jamb',(x,1.2,1.33),(.26,1.12,1.0),m['red_brick'])
    box('Smithy_hearth_back',(.95,1.66,1.37),(1.28,.17,1.13),m['iron'])
    box('Smithy_hearth_hot_back',(.95,1.54,1.28),(1.10,.07,.62),m['coal'])
    for x in [.57,.95,1.33]:
        for y in [.65,1.0]: sphere('Smithy_glowing_coal',(x,y,.88),(.18,.15,.11),m['coal'],8,4)
    box('Smithy_forge_hood',(.95,1.12,2.06),(1.82,1.27,.32),m['red_brick'])
    chimney('Smithy',.95,1.12,2.17,6.8,{**m,'brick':m['red_brick']})
    light=lamp('Smithy_forge',(.95,.84,1.31),(1,.19,.025),5)
    light['clearance']=.20
    cylinder('Smithy_anvil_stump',(-.90,-.72,.40),.38,.80,m['oak'],12)
    box('Smithy_anvil_waist',(-.90,-.72,.97),(.25,.32,.33),m['iron'])
    box('Smithy_anvil_face',(-.90,-.72,1.16),(.77,.45,.16),m['iron'],.04)
    horn=cone('Smithy_anvil_horn',(-1.40,-.72,1.16),.14,.035,.47,m['iron'],12)
    horn.rotation_euler.y=-math.pi/2
    lathe('Smithy_quench_barrel',(-1.62,.77,0),[(.34,0),(.40,.15),(.41,.69),(.33,.83),(.28,.83),(.31,.14)],m['oak'],16)
    cylinder('Smithy_quench_dark_surface',(-1.62,.77,.73),.28,.025,m['teal'],16)
    for z in [.19,.67]: torus('Smithy_barrel_hoop',(-1.62,.77,z),.39,.04,m['iron'],segments=16,tube=4)
    for x in [-1.6,-1.12,-.64]:
        beam('Smithy_wall_tool_handle',(x,1.75,1.45),(x,1.75,2.35),.075,m['oak'])
        box('Smithy_wall_tool_head',(x,1.70,2.22),(.29,.13,.13),m['iron'])
    export_village('smithy','Open brick-and-timber workshop with glowing forge, brick hood and smoking chimney, horned anvil, quench barrel and hung tools.',
        footprint=(6,5),front_door=None,max_height=7)


def barn(m):
    w,d=6.70,4.70
    for side,angle in [('front',0),('right',math.pi/2),('back',math.pi),('left',-math.pi/2)]:
        half=(w if side in ['front','back'] else d)/2
        surf=-(d if side in ['front','back'] else w)/2
        holes=[(0,1.5,2.70,3.0)] if side=='front' else []
        open_wall('Barn_red_board_wall',half,surf,0,3.40,holes,m['red_timber'],angle)
        for x in [(-half+.17+i*.33) for i in range(int(2*half/.33))]:
            if side=='front' and abs(x)<1.47: continue
            facade_box('Barn_board_batten',x,surf-.04,1.7,.075,.08,3.40,m['tile3'],angle)
        for x in [-half+.08,half-.08]: facade_box('Barn_corner_frame',x,surf-.12,1.70,.20,.16,3.40,m['wood'],angle)
        facade_box('Barn_sill_beam',0,surf-.09,.15,2*half,.18,.22,m['wood'],angle)
    # Gambrel section makes this instantly different from a townhouse.
    profile=[(-3.78,3.48),(-2.15,5.48),(0,6.30),(2.15,5.48),(3.78,3.48)]
    for y in [-d/2,d/2]:
        poly=[(-w/2,3.40),(w/2,3.40),(2.15,5.43),(0,6.23),(-2.15,5.43)]
        # Hayloft opening is a real rectangular gap in the front gable.
        if y<0:
            open_wall('Barn_front_gable_lower',2.7,y,3.40,4.70,[(0,4.10,1.3,1.10)],m['red_timber'],0)
            for side in [-1,1]:
                p=[(side*2.70,3.40),(side*3.35,3.40),(side*2.70,4.70)]
                if side<0: p.reverse()
                extrude_xz('Barn_front_gable_shoulder',p,y,.17,m['red_timber'])
            extrude_xz('Barn_front_gable_peak',[(-2.70,4.70),(2.70,4.70),(2.15,5.43),(0,6.23),(-2.15,5.43)],y,.17,m['red_timber'])
        else: extrude_xz('Barn_rear_gable',poly,y,.17,m['red_timber'])
    for (xa,za),(xb,zb) in zip(profile,profile[1:]):
        length=math.hypot(xb-xa,zb-za)
        slope=-math.atan2(zb-za,xb-xa)
        for i in range(12):
            box('Barn_gambrel_slate',((xa+xb)/2,-2.76+(i+.5)*5.52/12,(za+zb)/2),(length+.08,5.52/12-.015,.16),m['roof2'] if i%4 else m['roof'],rot=(0,slope,0))
        for y in [-2.78,2.78]: beam('Barn_gambrel_rake',(xa,y,za+.10),(xb,y,zb+.10),.15,m['wood'],4)
    beam('Barn_gambrel_ridge',(0,-2.77,6.39),(0,2.77,6.39),.19,m['roof2'],8)
    box('Barn_shadowed_back_wall',(0,2.23,1.5),(6.4,.10,3),m['tar'])
    box('Barn_interior_floor',(0,0,.04),(6.45,4.5,.08),m['thatch2'])
    box('Barn_left_door',(-.70,-2.41,1.50),(1.30,.14,2.95),m['red_timber'])
    # One leaf hangs visibly open, pivoting around its actual jamb.
    door=box('Barn_ajar_door',(.782,-2.637,1.50),(1.30,.14,2.95),m['red_timber'],rot=(0,0,.48))
    for z in [.50,2.50]:
        box('Barn_closed_door_strap',(-.70,-2.51,z),(1.16,.07,.09),m['iron'])
    beam('Barn_closed_door_diagonal',(-1.24,-2.52,.20),(-.17,-2.52,2.85),.11,m['wood'],4)
    box('Barn_hayloft_interior',(0,-2.12,4.10),(1.30,.14,1.10),m['tar'])
    for i in range(4): sphere('Barn_hayloft_hay',(-.46+i*.31,-2.20,3.78),(.21,.25,.18),m['thatch'],10,5)
    beam('Barn_hayloft_lintel',(-.80,-2.43,4.77),(.80,-2.43,4.77),.17,m['wood'],4)
    export_village('barn','Red vertical-board barn with blue gambrel roof, one double-door leaf ajar onto a dim interior and an open hayloft.',
        footprint=(8,6),front_door=(0,-2.35,0),max_height=7)


def goods_table(label,x,y,m):
    for dx in [-.62,.62]:
        for dy in [-.25,.25]: box(label+'_trestle_leg',(x+dx,y+dy,.42),(.12,.12,.84),m['wood'])
    box(label+'_tabletop',(x,y,.91),(1.6,.75,.14),m['oak'])
    return .98


def market_hall(m):
    for x in [-2.75,0,2.75]:
        for y in [-1.52,1.52]:
            box('Market_hall_stone_post',(x,y,.40),(.44,.44,.80),m['fieldstone2'])
            box('Market_hall_timber_post',(x,y,1.85),(.22,.22,2.10),m['wood'])
            for side in [-1,1]: beam('Market_hall_knee_brace',(x,y,2.1),(x+side*.50,y,2.9),.14,m['oak'],4)
    for y in [-1.52,1.52]: box('Market_hall_beam',(0,y,2.95),(6.14,.22,.22),m['wood'])
    roof('Market_hall',4.05,6.65,3.11,1.37,roof_family(m,'tile'),angle=math.pi/2,hip=True)
    goods_table('Market_fruit',-1.95,0,m)
    for i in range(10): sphere('Market_hall_fruit',(-2.45+(i%5)*.24,-.16+(i//5)*.29,1.12),(.12,.12,.13),m['flower'] if i%3 else m['rose_sign'],10,5)
    goods_table('Market_cloth',0,0,m)
    for i in range(3): cylinder('Market_hall_cloth_bolt',(-.42+i*.42,0,1.11),.13,.58,m['teal'] if i%2 else m['rose_sign'],12,rot=(math.pi/2,0,0))
    goods_table('Market_pottery',1.95,0,m)
    for i in range(3): lathe('Market_hall_pottery',(1.50+i*.42,0,.99),[(.12,0),(.18,.12),(.16,.28),(.10,.39),(.085,.39),(.13,.26)],m['tile2'],16)
    for x in [-1.4,1.4]:
        lantern('Market_hall_lantern',(x,-.65,2.49),m,3.8)
        beam('Market_hall_hanger',(x,-.65,2.74),(x,-.65,3.13),.07,m['iron'])
    export_village('market_hall','Open timber market hall on six stone posts, red hipped roof, trestles with fruit, cloth bolts and pottery, two hanging warm lanterns.',
        footprint=(7,4.5),front_door=None,max_height=5)


BUILDERS={name:globals()[name] for name in ['town_hall','chapel','watch_tower','smithy','cottage_thatch','cottage_long','barn','market_hall']}


def build(name):
    reset(307)
    BUILDERS[name](palette())
