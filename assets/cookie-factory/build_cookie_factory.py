import bpy, math, random, os
from mathutils import Vector
random.seed(19)
OUT = os.path.dirname(os.path.abspath(__file__))
os.makedirs(OUT, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for c in list(bpy.data.collections):
    if c.name != 'Collection' and c.users == 0: bpy.data.collections.remove(c)

def material(name, color, roughness=.65, metallic=0, emission=0):
    m=bpy.data.materials.new(name); m.diffuse_color=(*color,1); m.use_nodes=True
    s=m.node_tree.nodes.get('Principled BSDF'); s.inputs['Base Color'].default_value=(*color,1)
    s.inputs['Roughness'].default_value=roughness; s.inputs['Metallic'].default_value=metallic
    if emission: s.inputs['Emission Color'].default_value=(*color,1); s.inputs['Emission Strength'].default_value=emission
    return m
cream=material('Warm vanilla plaster',(.91,.67,.43)); white=material('Clotted cream canvas',(.98,.89,.68))
wood=material('Toasted walnut timber',(.25,.105,.055)); oak=material('Honey oak',(.57,.29,.10))
red=material('Cherry red canvas',(.72,.085,.055)); darkred=material('Terracotta underroof',(.36,.075,.043))
tiles=[material('Handmade terracotta %02d'%i,c) for i,c in enumerate([(.67,.17,.08),(.78,.235,.10),(.86,.29,.13),(.72,.195,.09),(.91,.34,.17)])]
bricks=[material('Baked brick %02d'%i,c) for i,c in enumerate([(.48,.16,.09),(.59,.21,.12),(.68,.27,.16),(.57,.19,.105)])]
stone=material('Warm stone',(.48,.49,.40)); stones=[material('Paving stone '+str(i),c) for i,c in enumerate([(.63,.61,.49),(.72,.70,.56),(.57,.58,.49)])]
grass=material('Pistachio turf',(.39,.52,.21)); earth=material('Caramel earth cut',(.49,.30,.15))
greens=[material('Garden green '+str(i),c) for i,c in enumerate([(.20,.34,.11),(.36,.51,.16),(.52,.64,.22)])]
metal=material('Sage painted machinery',(.18,.37,.32),.4,.25); iron=material('Blackened iron',(.075,.10,.09),.35,.55)
gold=material('Warm brass',(.74,.46,.14),.32,.65); belt=material('Conveyor charcoal rubber',(.105,.12,.095))
dough=material('Golden cookie crumb',(.83,.46,.17)); edge=material('Baked cookie edge',(.64,.29,.085)); chip=material('Dark chocolate',(.16,.061,.029),.45)
glass=material('Warm bakery window',(.95,.48,.12),.25,emission=.32); shine=material('Window cream glint',(.99,.87,.62),.25)
sackmat=material('Flour sack linen',(.77,.66,.44)); steam=material('Marshmallow steam',(.94,.90,.77)); teal=material('Enamel blue green',(.10,.40,.36),.3)

groups={}
def group(name):
    if name not in groups:
        c=bpy.data.collections.new(name); bpy.context.scene.collection.children.link(c); groups[name]=c
    return groups[name]
current='01 • Bakery architecture'
def finish(o,name,mat,bev=0):
    o.name=name
    for c in list(o.users_collection): c.objects.unlink(o)
    group(current).objects.link(o)
    if mat:o.data.materials.append(mat)
    if bev:
        b=o.modifiers.new('Soft handcrafted edges','BEVEL'); b.width=bev; b.segments=3
        o.modifiers.new('Weighted corner normals','WEIGHTED_NORMAL')
    return o
def box(name,loc,size,mat,bev=.04,rot=None):
    bpy.ops.mesh.primitive_cube_add(size=1,location=loc); o=bpy.context.object; o.dimensions=size
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    if rot:o.rotation_euler=rot
    return finish(o,name,mat,bev)
def sphere(name,loc,size,mat,ico=False):
    if ico:bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2,radius=1,location=loc)
    else:bpy.ops.mesh.primitive_uv_sphere_add(segments=24,ring_count=12,radius=1,location=loc)
    o=bpy.context.object; o.scale=size; finish(o,name,mat)
    for p in o.data.polygons:p.use_smooth=True
    return o
def cyl(name,loc,r,depth,mat,rot=None,vertices=32,bev=.025):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices,radius=r,depth=depth,location=loc)
    o=bpy.context.object
    if rot:o.rotation_euler=rot
    finish(o,name,mat,bev)
    for p in o.data.polygons:p.use_smooth=True
    return o
def beam(name,a,b,r,mat):
    a,b=Vector(a),Vector(b); o=cyl(name,(a+b)/2,r,(b-a).length,mat,bev=.012)
    o.rotation_euler=(b-a).to_track_quat('Z','Y').to_euler(); return o
def mesh(name,verts,faces,mat,bev=0):
    m=bpy.data.meshes.new(name); m.from_pydata(verts,[],faces); m.update()
    o=bpy.data.objects.new(name,m); group(current).objects.link(o)
    if mat:m.materials.append(mat)
    if bev:
        mod=o.modifiers.new('Rounded edges','BEVEL');mod.width=bev;mod.segments=3
        o.modifiers.new('Weighted normals','WEIGHTED_NORMAL')
    return o
def front_text(name,text,loc,size,mat):
    cu=bpy.data.curves.new(name,'FONT');cu.body=text;cu.align_x='CENTER';cu.align_y='CENTER';cu.size=size;cu.extrude=.008;cu.bevel_depth=.003
    o=bpy.data.objects.new(name,cu);group(current).objects.link(o);o.location=loc;o.rotation_euler=(math.pi/2,0,0);cu.materials.append(mat);return o
def arch(name,x,y,z,w,h,depth,mat):
    rad=w/2; spring=h-rad
    pts=[(-rad,0),(rad,0),(rad,spring)]
    for i in range(1,17):
        a=math.pi*i/16;pts.append((rad*math.cos(a),spring+rad*math.sin(a)))
    n=len(pts);vs=[(x+px,y+dy,z+pz) for dy in [-depth/2,depth/2] for px,pz in pts]
    # Wound outward (pts run counter-clockwise seen from the front, -y): an inside-out solid shows its back faces.
    fs=[tuple(range(n)),tuple(range(2*n-1,n-1,-1))]+[(i,i+n,(i+1)%n+n,(i+1)%n) for i in range(n)]
    return mesh(name,vs,fs,mat,.025)

# The model is entirely mesh geometry; the sprite is only a design reference.
box('Stone bakery footing',(0,0,.47),(6.32,4.22,.45),stone,.12)
box('Vanilla plaster building',(0,0,2.10),(6,4,3.05),cream,.09)
box('Brick mortar base',(0,0,.98),(6.08,4.08,.88),stone,.025)
for row in range(3):
    z=.67+row*.27
    for side in [-1,1]:
        for i in range(11):
            x=-2.78+i*.56+(row%2)*.25
            if x>2.97:continue
            box('Front/back fired brick',(x,side*2.065,z),(.515,.13,.225),random.choice(bricks),.025)
        for i in range(7):
            y=-1.76+i*.57+(row%2)*.23
            if y>1.99:continue
            box('Side fired brick',(side*3.065,y,z),(.13,.525,.225),random.choice(bricks),.025)
for x in [-2.93,2.93]:
    for y in [-2.03,2.03]:box('Corner timber upright',(x,y,2.55),(.15,.16,2.22),wood,.025)
for y in [-2.05,2.05]:
    box('Oak sill course',(0,y,1.38),(6.13,.13,.17),wood,.025)
    box('Timber eave',(0,y,3.60),(6.13,.16,.22),wood,.03)

current='02 • Terracotta roof and chimney'
v=[(-3.4,-2.4,3.75),(3.4,-2.4,3.75),(3.4,2.4,3.75),(-3.4,2.4,3.75),(-1.35,0,5.30),(1.35,0,5.30)]
mesh('Hipped roof solid',v,[(0,1,5,4),(1,2,5),(2,3,4,5),(3,0,4),(3,2,1,0)],darkred,.04)
slope=1.55/2.4
for side in [-1,1]:
    for row in range(7):
        y=side*(2.26-row*.335); z=5.30-slope*abs(y)+.075; limit=1.35+2.05*abs(y)/2.4
        count=int((limit*2)/.47)
        for i in range(count):
            x=(i-(count-1)/2)*.475
            box('Overlapping roof shingle',(x,y,z),(.46,.43,.09),random.choice(tiles),.045,(side*-math.atan(slope),0,0))
    for row in range(5):
        x=side*(3.20-row*.37);z=5.30-(abs(x)-1.35)*1.55/2.05+.065; limit=(abs(x)-1.35)*2.4/2.05
        count=max(1,int(limit*2/.47))
        for i in range(count):
            y=(i-(count-1)/2)*.47
            box('Hip roof shingle',(x,y,z),(.43,.46,.09),random.choice(tiles),.045,(0,side*math.atan(1.55/2.05),0))
for i in range(7):cyl('Terracotta ridge cap',(-1.40+i*.47,0,5.35),.13,.48,tiles[2],(0,math.pi/2,0))
for side in [-1,1]:
    for y in [-2.4,2.4]:beam('Hip seam', (side*1.35,0,5.35),(side*3.4,y,3.83),.065,tiles[1])
for y in [-2.39,2.39]:box('Eave fascia',(0,y,3.74),(6.88,.13,.18),oak,.025)
for x in [-3.39,3.39]:box('Side eave fascia',(x,0,3.74),(.13,4.86,.18),oak,.025)
box('Chimney stack',(1.92,.74,5.08),(.70,.74,2.0),bricks[0],.055)
for row in range(7):
    for i in range(2):
        x=1.64+i*.32
        box('Chimney front brick',(x,.353,4.30+row*.25),(.285,.05,.215),bricks[(row+i)%4],.015)
        box('Chimney right brick',(2.286,.50+i*.34,4.30+row*.25),(.05,.30,.215),bricks[(row+i+1)%4],.015)
box('Chimney cap',(1.92,.74,6.09),(.91,.94,.17),stone,.05)
box('Chimney dark mouth',(1.92,.74,6.183),(.57,.60,.016),iron,.025)
for i,(dx,dy,z,r) in enumerate([(0,0,6.39,.24),(.12,0,6.73,.30),(.02,.06,7.11,.37),(.30,.09,7.54,.43)]):
    sphere('Sculpted steam puff %d'%i,(1.92+dx,.74+dy,z),(r,r*.80,r*.85),steam,True)

current='03 • Shopfront and giant cookie emblem'
arch('Arched door walnut casing',0,-2.12,.64,1.35,2.32,.18,wood)
arch('Golden oak arched door',0,-2.231,.69,1.11,2.16,.08,oak)
for x in [-.40,-.20,0,.20,.40]:
    h=1.60+math.sqrt(max(0,.53**2-x*x))
    box('Door plank groove',(x,-2.278,.70+h/2),(.015,.008,h-.02),wood,.003)
for z in [1.08,2.0]:box('Door iron strap',(0,-2.295,z),(1.02,.04,.07),iron,.014)
sphere('Brass door knob',(.34,-2.34,1.60),(.065,.04,.065),gold)
box('Threshold',(0,-2.45,.58),(1.55,.70,.20),stones[1],.05)
box('Front lower step',(0,-2.84,.41),(1.85,.67,.17),stones[0],.06)

def awning(cx,y,z,width,side=False):
    # Curved canvas strips, each with a little scalloped valance.
    strips=9; sw=width/strips
    for i in range(strips):
        x0=cx-width/2+i*sw; x1=x0+sw-.006; vs=[]
        for x in [x0,x1]:
            for j in range(7):
                t=j/6;vs.append((x,y-.70*t,z-.11*t-.25*t*t))
        fs=[(j,j+1,8+j,7+j) for j in range(6)]
        o=mesh('Striped canvas canopy',vs,fs,red if i%2==0 else white)
        solid=o.modifiers.new('Canvas thickness','SOLIDIFY');solid.thickness=.025
        box('Awning hanging hem',((x0+x1)/2,y-.707,z-.46),(sw-.008,.04,.21),red if i%2==0 else white,.035)
    beam('Awning brass rail',(cx-width/2,y-.71,z-.32),(cx+width/2,y-.71,z-.32),.025,gold)
    for x in [cx-width/2+.1,cx+width/2-.1]:beam('Awning iron brace',(x,y, z-.48),(x,y-.68,z-.37),.018,iron)

def front_cookie(name,x,y,z,r=.25):
    cyl(name+' toasted rim',(x,y,z),r,.11,edge,(math.pi/2,0,0),24,.025)
    cyl(name+' golden face',(x,y-.065,z),r*.92,.045,dough,(math.pi/2,0,0),24,.025)
    for a,rr in [(0,.48),(1.05,.64),(2.1,.50),(3.2,.69),(4.4,.57),(5.35,.62)]:
        xx=x+math.cos(a)*r*rr;zz=z+math.sin(a)*r*rr
        o=sphere(name+' chocolate chunk',(xx,y-.096,zz),(r*.12,.035,r*.105),chip,True);o.rotation_euler[1]=a

for x in [-1.86,1.86]:
    box('Recessed shop window',(x,-2.083,2.29),(1.43,.11,1.24),wood,.045)
    box('Amber bakery glass',(x,-2.15,2.30),(1.23,.04,1.06),glass,.02)
    for xx in [x-.66,x,x+.66]:box('Window vertical mullion',(xx,-2.196,2.32),(.07,.055,1.20),wood,.012)
    for zz in [1.73,2.20,2.91]:box('Window horizontal mullion',(x,-2.20,zz),(1.40,.06,.075),wood,.012)
    box('Cream stone window sill',(x,-2.26,1.69),(1.58,.39,.12),white,.04)
    for xx in [x-.30,x+.27]:front_cookie('Display cookie',xx,-2.245,1.99,.17)
    box('Window reflection',(x-.43,-2.225,2.63),(.045,.012,.23),shine,.015,rot=(0,-.40,0))
    awning(x,-2.08,3.23,1.77)
for x in [-.53,.53]:
    box('Cookie emblem oak support',(x,-2.07,4.74),(.09,.10,1.56),wood,.025)
front_cookie('Giant cookie sign',0,-2.20,4.91,.86)
for i in range(22):
    a=random.uniform(0,math.tau);r=random.uniform(.30,.78)
    sphere('Cookie crumb pore',(r*math.cos(a),-2.302,4.91+r*math.sin(a)),(.018,.007,.018),edge)
box('Bakery name plaque',(0,-2.18,3.36),(1.80,.15,.36),wood,.075)
front_text('Bakery painted lettering','COOKIE CO.',(0,-2.268,3.36),.185,white)
box('Open sign',(.43,-2.34,2.43),(.40,.055,.23),teal,.027)
front_text('Open lettering','OPEN',(.43,-2.375,2.43),.11,white)

current='04 • Cookie production conveyor'
# Right-hand service hatch and working conveyor, visible from the three-quarter camera.
box('Oven hatch surround',(3.11,-.35,2.01),(.25,1.33,1.12),metal,.09)
box('Oven dark interior',(3.253,-.35,2.05),(.035,1.05,.80),iron,.045)
box('Oven warm interior',(3.278,-.35,1.84),(.02,.87,.32),glass,.04)
box('Service hood',(3.35,-.35,2.68),(.72,1.52,.18),metal,.06)
for y in [-.94,.24]:box('Hatch brass rivet',(3.26,y,2.40),(.055,.075,.075),gold,.025)
box('Conveyor machine frame',(4.33,-.35,1.58),(2.68,1.12,.23),metal,.07)
box('Continuous cookie conveyor',(4.37,-.35,1.735),(2.79,.88,.13),belt,.07)
for y in [-.93,.23]:
    box('Conveyor guard rail',(4.37,y,1.84),(2.83,.09,.11),metal,.025)
    for x in [3.57,5.23]:box('Conveyor steel leg',(x,y,1.04),(.14,.14,1.05),metal,.035)
    box('Conveyor foot',(5.23,y,.52),(.39,.33,.12),iron,.03)
for x in [3.08,5.66]:cyl('End conveyor roller',(x,-.35,1.69),.13,1.09,iron,(math.pi/2,0,0),24)
for x in [3.43+i*.23 for i in range(10)]:box('Belt transverse seam',(x,-.35,1.806),(.012,.86,.007),stone,.001)
def cookie_top(x,y,z,r=.27):
    cyl('Fresh cookie toasted edge',(x,y,z),r,.09,edge,vertices=24)
    cyl('Fresh cookie golden top',(x,y,z+.047),r*.95,.045,dough,vertices=24)
    for i in range(5):
        a=i*1.256+.2;rr=r*(.45 if i%2 else .62)
        sphere('Conveyor chocolate chip',(x+rr*math.cos(a),y+rr*math.sin(a),z+.08),(.045,.042,.018),chip,True)
for x,y in [(3.46,-.40),(4.16,-.27),(4.88,-.40),(5.48,-.30)]:cookie_top(x,y,1.86,.25)
box('Motor casing',(4.90,.48,1.40),(.62,.38,.43),metal,.09)
cyl('Motor gear cap',(5.22,.48,1.40),.16,.08,gold,(0,math.pi/2,0))
for i in range(3):box('Motor cooling vent',(4.76+i*.11,.682,1.41),(.045,.015,.21),iron,.01)
# Small pressure dial on the service facade.
cyl('Pressure dial bezel',(3.16,1.07,2.64),.25,.12,gold,(0,math.pi/2,0))
cyl('Pressure dial ivory face',(3.228,1.07,2.64),.21,.018,white,(0,math.pi/2,0))
beam('Pressure gauge needle',(3.247,1.07,2.64),(3.247,.98,2.76),.015,red)
beam('Copper oven pipe',(3.15,1.45,1.48),(3.15,1.45,3.33),.065,gold)
beam('Copper pipe elbow',(3.15,1.45,3.33),(3.43,1.45,3.33),.065,gold)

current='05 • Ingredients and bakery props'
def sack(x,y,z,s=1):
    sphere('Flour sack body',(x,y,z+.39*s),(.34*s,.28*s,.43*s),sackmat)
    sphere('Gathered flour sack neck',(x,y,z+.78*s),(.13*s,.13*s,.14*s),sackmat)
    cyl('Flour sack cord',(x,y,z+.77*s),.14*s,.045,wood)
    box('Flour sack label',(x,y-.276*s,z+.42*s),(.33*s,.025,.24*s),white,.025)
    front_text('Flour label','FLOUR',(x,y-.296*s,z+.42*s),.09*s,wood)
    for dx in [-.22,0,.22]:beam('Gathered linen fold',(x+dx*s,y-.17*s,z+.58*s),(x+dx*.32*s,y-.10*s,z+.76*s),.009,sackmat)
sack(-3.77,-1.22,.52,1.10);sack(-3.67,-2.03,.52,.90);sack(-4.24,-1.64,.52,.78)
def crate(x,y,z,w=.85):
    box('Crate dark interior',(x,y,z+.27),(w,.72,.55),wood,.035)
    for side in [-1,1]:
        for row in range(3):box('Honey oak crate slat',(x,y+side*.37,z+.10+row*.18),(w+.06,.055,.135),oak,.02)
        for row in range(3):box('Crate side slat',(x+side*(w/2+.02),y,z+.10+row*.18),(.06,.73,.135),oak,.02)
        for xx in [x-w/2+.07,x+w/2-.07]:box('Crate corner strap',(xx,y+side*.407,z+.27),(.075,.025,.54),wood,.014)
crate(4.74,-1.78,.52,1.02)
for xx,yy in [(4.5,-1.97),(4.93,-1.92),(4.71,-1.61)]:cookie_top(xx,yy,1.12,.18)
crate(-3.85,.15,.52,.87)
# Little lidded ingredient canister.
cyl('Enamel ingredient canister',(-3.85,.15,1.35),.24,.43,teal)
cyl('Canister cream lid',(-3.85,.15,1.59),.27,.08,white)
sphere('Canister lid handle',(-3.85,.15,1.66),(.065,.065,.045),gold)
# A-frame menu board.
board=box('Chalkboard timber frame',(1.43,-3.05,1.07),(.78,.12,1.02),oak,.05,rot=(-.13,0,-.10))
box('Sage chalkboard',(1.43,-3.13,1.09),(.65,.03,.85),metal,.025,rot=(-.13,0,-.10))
front_text('Menu title','FRESH',(1.43,-3.21,1.35),.115,white)
front_text('Menu subtitle','COOKIES',(1.43,-3.19,1.17),.095,white)
front_cookie('Menu cookie doodle',1.43,-3.20,.91,.12)
for xx in [1.11,1.75]:beam('A frame rear leg',(xx,-2.76,.52),(xx,-3.10,1.54),.035,oak)
# Lantern beside the door.
box('Wall lantern bracket',(.93,-2.14,2.61),(.11,.22,.13),iron,.02)
box('Lantern glowing glass',(.93,-2.36,2.44),(.22,.22,.31),glass,.035)
for z in [2.25,2.62]:box('Lantern black cap',(.93,-2.36,z),(.29,.28,.07),iron,.025)
for x in [.82,1.04]:box('Lantern upright',(x,-2.485,2.44),(.025,.025,.30),iron,.005)

current='06 • Garden diorama'
box('Rounded earth diorama',(0.80,0,.14),(11.7,8.3,.45),earth,.30)
box('Thick pistachio lawn',(0.80,0,.39),(11.73,8.33,.18),grass,.27)
# Courtyard stones and the entrance path.
for row in range(4):
    for col in range(4):
        x=-.70+col*.49+(row%2)*.11;y=-2.95-row*.32
        o=box('Entrance cobblestone',(x,y,.514),(.43,.27,.07),random.choice(stones),.055);o.rotation_euler[2]=random.uniform(-.07,.07)
for row in range(5):
    for col in range(5):
        x=3.45+col*.48;y=-1.40+row*.46
        box('Factory yard paving',(x,y,.50),(.44,.41,.07),random.choice(stones),.045)
def plant(x,y,scale=1):
    for k in range(6):
        a=k*math.tau/6;length=random.uniform(.16,.28)*scale
        o=sphere('Garden leaf',(x+math.cos(a)*.10*scale,y+math.sin(a)*.10*scale,.54+length/2),(.045*scale,.07*scale,length),random.choice(greens),True)
        o.rotation_euler=(math.sin(a)*.4,math.cos(a)*.4,a)
def pot(x,y):
    bpy.ops.mesh.primitive_cone_add(vertices=24,radius1=.18,radius2=.26,depth=.39,location=(x,y,.70));finish(bpy.context.object,'Terracotta herb pot',tiles[2],.035)
    cyl('Flower pot lip',(x,y,.89),.28,.07,tiles[1])
    cyl('Potting earth',(x,y,.932),.23,.014,earth,bev=0)
    for a in [0,1,2,3,4,5]:
        sphere('Potted herb',(x+math.cos(a)*.14,y+math.sin(a)*.14,1.06),(.10,.10,.17),random.choice(greens),True)
pot(-2.90,-2.76);pot(2.58,-2.70)
for x,y,s in [(-4.3,-3.2,1.1),(-4.4,2.7,1.2),(-2.3,3.25,1),(3.4,3.3,1.2),(5.55,-3.1,1),(5.90,2.6,1.1),(2.8,-3.5,.75),(-2.1,-3.6,.8)]:plant(x,y,s)
for x,y in [(-4.5,2.8),(-4,3.2),(-3.5,3.3),(4.1,2.8),(4.7,2.9),(5.4,3.0)]:
    sphere('Low garden shrub',(x,y,.73),(.42,.38,.35),random.choice(greens),True)
# A short picket fence behind the workshop.
for x in [-4.3+i*.52 for i in range(19)]:
    box('Cream picket fence',(x,3.55,.99),(.18,.10,1.04),white,.04)
    bpy.ops.mesh.primitive_cone_add(vertices=4,radius1=.13,radius2=0,depth=.18,location=(x,3.55,1.59),rotation=(0,0,math.pi/4));finish(bpy.context.object,'Picket pointed cap',white)
for z in [.77,1.28]:box('Fence rail',(.37,3.59,z),(9.60,.09,.10),oak,.02)
for i in range(17):
    x=random.uniform(-4.8,6.1);y=random.choice([-1,1])*random.uniform(3.5,3.8)
    if abs(x)<1 and y<0:continue
    cyl('Daisy center',(x,y,.76),.035,.04,gold)
    beam('Daisy stem',(x,y,.50),(x,y,.74),.008,greens[0])
    for k in range(5):
        a=k*math.tau/5;sphere('Daisy petal',(x+.055*math.cos(a),y+.055*math.sin(a),.755),(.044,.027,.017),white)

current='07 • Studio, camera and lighting'
floor=material('Apricot studio backdrop',(.76,.65,.51))
box('Infinite matte studio floor',(0,0,-.20),(200,200,.15),floor,.02)
scene=bpy.context.scene
scene.render.engine='CYCLES';scene.cycles.samples=48;scene.cycles.use_denoising=True
scene.render.resolution_x=1600;scene.render.resolution_y=1400;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA'
scene.render.film_transparent=False
scene.world.color=(.25,.25,.25);scene.world.use_nodes=True
scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.68,.74,.78,1)
scene.world.node_tree.nodes['Background'].inputs[1].default_value=.45
def area(name,loc,power,color,size):
    bpy.ops.object.light_add(type='AREA',location=loc);o=bpy.context.object;finish(o,name,None)
    o.data.energy=power;o.data.color=color;o.data.shape='DISK';o.data.size=size
    o.rotation_euler=(Vector((0,0,2))-o.location).to_track_quat('-Z','Y').to_euler()
area('Large warm key',(-6,-8,13),1800,(1,.85,.65),8)
area('Cool soft fill',(8,-2,9),1050,(.77,.88,1),7)
area('Warm rim behind roof',(-1,7,11),1550,(1,.78,.53),6)
bpy.ops.object.camera_add(location=(12.8,-18.5,12.8));cam=bpy.context.object;finish(cam,'Cookie Factory • Hero camera',None)
target=Vector((.60,0,2.65));cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler()
cam.data.type='ORTHO';cam.data.ortho_scale=15.7;cam.data.lens=50;scene.camera=cam
scene.view_settings.view_transform='AgX'
scene.render.filepath=os.path.join(OUT,'cookie_factory.png')
scene['Design notes']='Original Blender mesh interpretation of the Farm Frenzy Bakery sprite. Terracotta hip roof, cookie emblem, striped awnings; added conveyor and garden diorama. No reference textures used.'
# Store a convenient camera view in the saved workspace.
for screen in bpy.data.screens:
    for a in screen.areas:
        if a.type=='VIEW_3D':
            a.spaces.active.region_3d.view_perspective='CAMERA'
            a.spaces.active.overlay.show_overlays=False
            a.spaces.active.shading.type='MATERIAL'
bpy.ops.object.select_all(action='DESELECT')
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT,'cookie_factory.blend'))
print('COOKIE_FACTORY_MODEL_READY',len(bpy.data.objects),flush=True)
if os.environ.get('COOKIE_FACTORY_RENDER')=='1':
    bpy.ops.render.render(write_still=True)
    print('COOKIE_FACTORY_RENDER_COMPLETE',flush=True)
