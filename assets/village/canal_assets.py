"""Canal-town models, authored against the six-metre canal cross-section.

Blender Z is height; bridge spans and boat bows follow Y. No water is exported.
"""
from architecture import *


def lantern(label, position, m, radius=3.5, color=(1, .55, .22), post=0, base=0):
    x, y, z = position
    if post:
        cylinder(label+'_post', (x,y,(base+z-.30)/2), .075, z-.30-base, m['iron'], 12)
        cylinder(label+'_foot', (x,y,base+.08), .16, .16, m['iron'], 12)
    box(label+'_amber',position,(.22,.22,.32),m['amber'])
    for dx in [-.15,.15]:
        for dy in [-.15,.15]:
            box(label+'_frame',(x+dx,y+dy,z),(.06,.06,.43),m['iron'])
    for dz in [-.25,.25]:
        box(label+'_cap',(x,y,z+dz),(.38,.38,.09),m['iron'])
    light=lamp(label,position,color,radius)
    light['clearance']=.28
    return light


def yz_solid(label, polygon, x, width, mat):
    obj=extrude_xz(label,polygon,-x,width,mat)
    obj.rotation_euler.z=math.pi/2
    return obj


def deck_height(y):
    return 1.3*(1-(abs(y)/6.5)**2)


def bridge_stone(m):
    # Real openings across the full roadway width. Central soffit >= .6 for |Y| <= 1.5.
    arches=[(-2.575,.425,-.65,1.18),(0,1.8,.20,.76),(2.575,.425,-.65,1.18)]
    for index,(centre,radius,spring,rise) in enumerate(arches):
        for i in range(18):
            a,b=math.pi*i/18,math.pi*(i+1)/18
            ya,yb=centre+radius*math.cos(a),centre+radius*math.cos(b)
            za,zb=spring+rise*math.sin(a),spring+rise*math.sin(b)
            yz_solid('Bridge_arch_spandrel',[(yb,zb),(ya,za),(ya,deck_height(ya)-.15),(yb,deck_height(yb)-.15)],
                     0,3.82,m['stone'])
            # A broad band of voussoirs on each visible flank; never fills the aperture.
            for x in [-1.96,1.96]:
                polygon=[(yb,zb),(ya,za),(ya,za+.17),(yb,zb+.17)]
                yz_solid('Bridge_radial_voussoir',polygon,x,.18,m['trim'] if i%3 else m['fieldstone2'])
    # Bed-reaching abutments and two water piers between the three clear arches.
    for a,b in [(-6.5,-3),(-2.15,-1.8),(1.8,2.15),(3,6.5)]:
        yz_solid('Bridge_pier_or_abutment',[(a,-1.5),(b,-1.5),(b,deck_height(b)-.15),(a,deck_height(a)-.15)],
                 0,3.82,m['stone'])
    for y in [-1.975,1.975]:
        for side in [-1,1]:
            # Triangular cutwaters protect the actual load-bearing piers.
            verts=[(side*x,yy,z) for z in [-1.5,.30] for x,yy in [(1.91,y-.175),(2.23,y),(1.91,y+.175)]]
            faces=[(2,1,0),(3,4,5),(0,1,4,3),(1,2,5,4),(2,0,3,5)]
            if side<0: faces=[tuple(reversed(f)) for f in faces]
            mesh('Bridge_triangular_cutwater',verts,faces,m['fieldstone'])
    for i in range(40):
        a,b=-6.5+13*i/40,-6.5+13*(i+1)/40
        yz_solid('Bridge_road_slab',[(a,deck_height(a)-.15),(b,deck_height(b)-.15),(b,deck_height(b)),(a,deck_height(a))],
                 0,3.82,m['fieldstone'] if i%4==0 else m['stone'])
        for x in [-2.04,2.04]:
            yz_solid('Bridge_solid_parapet',[(a,deck_height(a)),(b,deck_height(b)),(b,deck_height(b)+.72),(a,deck_height(a)+.72)],
                     x,.30,m['stone'] if i%3 else m['fieldstone2'])
            yz_solid('Bridge_parapet_coping',[(a,deck_height(a)+.72),(b,deck_height(b)+.72),(b,deck_height(b)+.84),(a,deck_height(a)+.84)],
                     x,.42,m['trim'])
    for x in [-2.04,2.04]:
        lantern('Bridge_crown_lantern',(x,0,3.0),m,4.8,post=1,base=1.3)
    export_village('bridge_stone','Three real stone arches, cutwaters, solid coping and a curved road landing at quay height; 1.6 m boat headroom across the central 3 m.',
        budget=5000,footprint=(4.5,13),front_door=None,max_height=3.3,min_height=-1.5,
        attachments={'spanAxisBlender':[0,1,0],'waterEdgesBlenderY':[-3,3],
                     'landingPositionsBlender':[[0,-6.5,0],[0,6.5,0]],'navigableWidthMetres':3,'minimumSoffitMetres':.6})


def footbridge(m):
    # Raise the whole navigable centre, including +/-1.5 m, above +.6.
    height=lambda y: .92*(1-(y/4)**2)
    for i in range(32):
        a,b=-4+i*.25,-4+(i+1)*.25
        yz_solid('Footbridge_plank',[(a,height(a)-.13),(b,height(b)-.13),(b,height(b)),(a,height(a))],
                 0,1.5,m['oak'] if i%3 else m['tar'])
        if i%4==0 or i==31:
            y=(a+b)/2
            for x in [-.78,.78]:
                box('Footbridge_rail_post',(x,y,height(y)+.48),(.12,.12,1.0),m['wood'])
    for x in [-.78,.78]:
        for offset in [.47,.92]:
            path('Footbridge_curved_handrail',[(x,-3.90+7.80*i/32,height(-3.90+7.80*i/32)+offset) for i in range(33)],.09,m['oak'],4)
        path('Footbridge_side_stringer',[(x,-3.90+7.80*i/32,height(-3.90+7.80*i/32)-.08) for i in range(33)],.16,m['wood'],4)
    export_village('footbridge','Arched timber footbridge with separate chunky planks and curved handrails; navigable centre clears 1.6 m over water.',
        budget=5000,footprint=(1.8,8),front_door=None,max_height=2,min_height=-.2,
        attachments={'spanAxisBlender':[0,1,0],'landingPositionsBlender':[[0,-4,0],[0,4,0]],'minimumSoffitMetres':.6})


def roof_family(m,kind):
    r=m.copy()
    for key,new in zip(['roof','roof2','roof3'],[kind,kind+'2',kind+'3'] if kind=='tile' else [kind,kind+'2',kind]):
        r[key]=m[new]
    return r


def watermill(m):
    from town_buildings import masonry
    cx=-.85
    w,d=5.3,4.65
    for side,angle in [('front',0),('right',math.pi/2),('back',math.pi),('left',-math.pi/2)]:
        half=(w if side in ['front','back'] else d)/2
        surface=-(d if side in ['front','back'] else w)/2
        before=set(bpy.context.scene.objects)
        holes=[(0,1.1,1.0,2.05)] if side=='front' else [(0,1.55,.8,.9)]
        open_wall('Mill_fieldstone_wall',half,surface,0,2.55,holes,m['fieldstone'],angle)
        masonry('Mill_ground',half,surface,.05,2.55,holes,m,angle)
        if side=='front': doorway('Mill_front',0,surface,.075,m,angle)
        else: architectural_window('Mill_lower_'+side,0,surface,1.55,.8,.9,m,angle,glow='dim')
        holes=[(-half*.46,3.62,.85,1.0),(half*.46,3.62,.85,1.0)]
        open_wall('Mill_timber_infill',half+.10,surface-.10,2.55,4.75,holes,m['oak'],angle)
        for x in [-half+.06,0,half-.06]:
            facade_box('Mill_black_frame',x,surface-.22,3.65,.15,.14,2.2,m['tar'],angle)
        for z in [2.61,4.69]: facade_box('Mill_crossbeam',0,surface-.22,z,2*half+.22,.14,.15,m['tar'],angle)
        for x,z,ww,hh in holes: architectural_window('Mill_upper_'+side,x,surface-.10,z,ww,hh,m,angle)
        for obj in set(bpy.context.scene.objects)-before: obj.location.x+=cx
    box('Mill_first_floor',(cx,0,2.57),(5.45,4.7,.15),m['wood'])
    before=set(bpy.context.scene.objects)
    rm=roof_family(m,'tile')
    roof('Mill',6.08,5.65,4.82,1.75,rm,hip=True)
    for obj in set(bpy.context.scene.objects)-before: obj.location.x+=cx
    chimney('Mill',-2,.8,5.8,7.2,m)
    lantern('Mill_front_lantern',(cx+.95,-2.5,2.05),m,3.8)
    axle=Vector((3.02,0,.5))
    parts=[]
    for x in [2.68,3.36]:
        parts.append(torus('Mill_wheel_rim',(x,0,.5),1.50,.105,m['tar'],rot=(0,math.pi/2,0),segments=32,tube=4))
        for i in range(10):
            angle=math.tau*i/10
            parts.append(beam('Mill_wheel_spoke',(x,0,.5),(x,1.48*math.sin(angle),.5+1.48*math.cos(angle)),.13,m['oak'],4))
    for i in range(24):
        a=math.tau*i/24
        parts.append(box('Mill_wheel_paddle',(3.02,1.62*math.sin(a),.5+1.62*math.cos(a)),(.86,.27,.14),m['oak'] if i%3 else m['tar'],rot=(-a,0,0)))
    parts.append(cylinder('Mill_wheel_hub',axle,.23,1.18,m['wood'],16,rot=(0,math.pi/2,0)))
    wheel=join(parts,'move_spin_wheel',axle)
    orient_pivot_x(wheel,(1,0,0))
    wheel['axisBlender']=[1,0,0]
    beam('Mill_fixed_axle',(1.7,0,.5),(3.65,0,.5),.18,m['iron'],12)
    # Undershot: scene placement must align the wheel's vertical plane with the
    # canal current. The shaft is perpendicular to that plane, into the mill.
    export_village('watermill','Fieldstone and tarred-timber mill with red hipped roof and a separately pivoted 24-paddle undershot wheel on +X.',
        footprint=(8,6),front_door=(cx,-d/2,0),max_height=7.5,min_height=-1.3,
        attachments={'wheelAxleBlender':list(axle),'wheelAxisBlender':[1,0,0],'quayEdgeBlenderX':2.5,'waterlineMetres':-1})


def hull(label,length,width,m):
    # A closed shell formed from nested polygon rings; open cockpit, actual hollow interior.
    # Bow is -Y; flat transom aft. The inner floor stays above the scene's continuous
    # water plane, while the closed outer shell still displaces water below it.
    outline=[(-.16,-.5),(.16,-.5),(.43,-.35),(.5,-.1),(.49,.28),(.33,.5),(-.33,.5),(-.49,.28),(-.5,-.1),(-.43,-.35)]
    rings=[(.46,-.39),(1,.26),(.86,.26),(.50,.035)]
    verts=[(u*width*scale,v*length*scale,z) for scale,z in rings for u,v in outline]
    n=len(outline)
    faces=[]
    for a,b in [(0,1),(1,2),(2,3)]:
        for i in range(n):
            j=(i+1)%n
            faces.append((a*n+i,a*n+j,b*n+j,b*n+i))
    faces+=[tuple(range(n-1,-1,-1)),tuple(range(3*n,4*n))]
    obj=mesh(label+'_hollow_hull',verts,faces,m['tar'])
    for z,scale in [(.28,1),(.08,.90),(-.10,.78)]:
        path(label+'_hull_strake',[(u*width*scale,v*length*scale,z) for u,v in outline+[outline[0]]],.07,m['oak'],4)
    return obj


def rowboat(m):
    hull('Rowboat',3.1,1.20,m)
    for y in [-.6,.20,.75]: box('Rowboat_thwart',(0,y,.12),(1.0,.23,.12),m['oak'])
    for x in [-.49,.49]:
        cylinder('Rowboat_oarlock',(x,.25,.34),.06,.17,m['iron'],10)
    for x in [-.29,.29]:
        beam('Rowboat_stowed_oar',(x,-.95,.31),(x,.9,.31),.07,m['oak'])
        box('Rowboat_oar_blade',(x,.95,.31),(.17,.42,.07),m['oak'])
    export_village('rowboat','Hollow tarred rowboat with three thwarts, stowed oars and oak strakes; bow faces -Y and origin is the waterline.',
        budget=5000,footprint=(1.3,3.2),front_door=None,max_height=.5,min_height=-.4,origin='waterline at footprint centre',
        attachments={'waterlineMetres':0,'bowAxisBlender':[0,-1,0]})


def barge(m):
    hull('Barge',7.85,2.10,m)
    # Taper the boards with the hull, rather than projecting a rectangular raft past the bow.
    def halfwidth(y):
        outline=[(.16,-.5),(.43,-.35),(.5,-.1),(.49,.28),(.33,.5)]
        v=y/7.85
        for (x0,y0),(x1,y1) in zip(outline,outline[1:]):
            if y0<=v<=y1: return 2.10*(x0+(x1-x0)*(v-y0)/(y1-y0))-.04
        raise ValueError(y)
    for start,end in [(-3.78,-1.45),(1.18,3.77)]:
        for i in range(12):
            a=start+(end-start)*i/12+.005
            b=start+(end-start)*(i+1)/12-.005
            wa,wb=halfwidth(a),halfwidth(b)
            verts=[(x,y,z) for z in [.23,.34] for x,y in [(-wa,a),(wa,a),(wb,b),(-wb,b)]]
            mesh('Barge_boarded_deck',verts,[(3,2,1,0),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],m['oak'] if i%3 else m['tar'])
    # Low cabin leaves working cargo deck visible.
    w,d=1.58,2.2
    cy=1.50
    for side,angle in [('front',0),('right',math.pi/2),('back',math.pi),('left',-math.pi/2)]:
        half=(w if side in ['front','back'] else d)/2
        surf=-(d if side in ['front','back'] else w)/2
        before=set(bpy.context.scene.objects)
        holes=[(0,.90,.63,.54)]
        open_wall('Barge_cabin',half,surf,.31,1.28,holes,m['tar'],angle)
        architectural_window('Barge_'+side,0,surf,.90,.63,.54,m,angle,glow='dim')
        for obj in set(bpy.context.scene.objects)-before: obj.location.y+=cy
    box('Barge_flat_cabin_roof',(0,cy,1.32),(2.03,2.48,.12),m['red_timber'])
    cylinder('Barge_stovepipe',(.45,2.05,1.445),.095,.13,m['iron'],12)
    beam('Barge_stovepipe_elbow',(.45,2.05,1.46),(.74,2.05,1.46),.19,m['iron'],12)
    cylinder('Barge_stovepipe_cap',(.74,2.05,1.53),.15,.07,m['iron'],12)
    box('Barge_dark_flue',(.74,2.05,1.585),(.10,.10,.02),m['iron'])
    for i in range(4):
        box('Barge_cargo_crate',(-.47+(i%2)*.9,-2.30+(i//2)*.72,.58),(.75,.58,.51),m['oak'])
        for dz in [-.18,.18]: box('Barge_crate_iron_band',(-.47+(i%2)*.9,-2.30+(i//2)*.72,.58+dz),(.78,.61,.06),m['iron'])
    lantern('Barge_lantern',(-.70,.31,.90),m,3.0)
    export_village('barge','Working canal barge with hollow cargo hold, boarded deck, low lit cabin, crates, stovepipe and one warm lantern; bow -Y.',
        budget=5000,footprint=(2.2,8),front_door=None,max_height=1.6,min_height=-.4,origin='waterline at footprint centre',
        attachments={'waterlineMetres':0,'bowAxisBlender':[0,-1,0]})


def jetty(m):
    for i in range(12):
        box('Jetty_deck_plank',(0,-.12-(i+.5)*2.28/12,-.61),(3.95,2.28/12-.012,.12),m['oak'] if i%3 else m['tar'])
    for x in [-1.65,1.65]:
        box('Jetty_underbeam',(x,-1.25,-.75),(.16,2.5,.16),m['tar'])
        for y in [-.24,-2.2]:
            cylinder('Jetty_bed_pile',(x,y,-1.02),.13,.96,m['tar'],12)
    for x in [-1.60,1.60]:
        cylinder('Jetty_mooring_post',(x,-2.20,-.23),.13,.70,m['oak'],12)
        beam('Jetty_mooring_crosspin',(x-.22,-2.2,-.04),(x+.22,-2.2,-.04),.10,m['iron'])
    for x in [-.25,.25]: beam('Jetty_ladder_rail',(x,-.15,-.70),(x,-.08,.30),.10,m['wood'],4)
    for z in [-.50,-.25,0,.25]: beam('Jetty_ladder_rung',(-.28,-.12,z),(.28,-.12,z),.09,m['oak'],4)
    export_village('jetty','Lower timber landing at Z=-.55 on bed-reaching piles, two mooring posts and a ladder to the quay; deck extends -Y from the quay-edge origin.',
        budget=5000,footprint=(4,2.5),footprint_bounds=((-2,-2.5),(2,0)),front_door=None,max_height=.4,min_height=-1.5,
        origin='quay edge at Y=0, Z=0',attachments={'deckHeightMetres':-.55,'quayEdgeBlenderY':0,'waterlineMetres':-1,'bedHeightMetres':-1.5})


BUILDERS={name:globals()[name] for name in ['bridge_stone','footbridge','watermill','rowboat','barge','jetty']}


def build(name):
    reset(303)
    BUILDERS[name](palette())
