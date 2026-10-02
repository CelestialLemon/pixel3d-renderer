"""Shared architectural grammar, with a distinct silhouette and facade for each building."""
from village_common import *


def facing(point, angle):
    return Matrix.Rotation(angle,4,'Z') @ Vector(point)


def facade_box(name,u,surface,z,w,d,h,mat,angle=0,bevel=0):
    obj=box(name,facing((u,surface,z),angle),(w,d,h),mat,bevel)
    obj.rotation_euler.z=angle
    return obj


def open_wall(name,half_width,surface,bottom,top,holes,mat,angle):
    xs=sorted(set([-half_width,half_width]+[x+s*w/2 for x,z,w,h in holes for s in [-1,1]]))
    zs=sorted(set([bottom,top]+[z+s*h/2 for x,z,w,h in holes for s in [-1,1] if bottom<z+s*h/2<top]))
    assert xs[0]>=-half_width-.001 and xs[-1]<=half_width+.001
    assert zs[0]>=bottom-.001 and zs[-1]<=top+.001
    for x0,x1 in zip(xs,xs[1:]):
        for z0,z1 in zip(zs,zs[1:]):
            x,z=(x0+x1)/2,(z0+z1)/2
            if any(abs(x-cx)<w/2-.001 and abs(z-cz)<h/2-.001 for cx,cz,w,h in holes):
                continue
            facade_box(name,x,surface+.085,z,x1-x0,.17,z1-z0,mat,angle)


def architectural_window(label,x,surface,z,w,h,m,angle,glow='amber',spill=None,shutters=False,stock=False):
    # Solid emission is behind a true opening. Glass is an exported, skipped placeholder.
    recess=.34 if stock else .20
    facade_box(label+'_interior',x,surface+recess,z,w,.06,h,m[glow],angle)
    facade_box('glass_'+label,x,surface+.02,z,w,.02,h,m['glass'],angle)
    for dx in [-w/2-.045,0,w/2+.045]:
        facade_box(label+'_mullion',x+dx,surface-.06,z,.09,.12,h+.17,m['wood'],angle)
    for dz in [-h/2-.045,0,h/2+.045]:
        facade_box(label+'_crossbar',x,surface-.065,z+dz,w+.18,.12,.09,m['wood'],angle)
    facade_box(label+'_sill',x,surface-.11,z-h/2-.14,w+.32,.34,.12,m['trim'],angle,.02)
    if shutters:
        for side in [-1,1]:
            u=x+side*(w/2+.27)
            facade_box(label+'_shutter',u,surface-.02,z,.36,.085,h,m['teal'],angle)
            for dz in [-h*.33,h*.33]:
                facade_box(label+'_shutter_hinge',u,surface-.08,z+dz,.33,.06,.07,m['iron'],angle)
    if stock:
        for shelf in [-.32,.27]:
            facade_box(label+'_display_shelf',x,surface+.16,z+shelf,w-.12,.27,.08,m['oak'],angle)
            for i in range(6):
                u=x-w*.40+i*w*.16
                p=facing((u,surface+.15,z+shelf+.17),angle)
                if glow=='teal_glow':
                    cylinder(label+'_medicine_bottle',p,.075,.23,m['teal'] if i%2 else m['brass'],10)
                    p.z+=.14
                    cylinder(label+'_bottle_stop',p,.042,.07,m['oak'],8)
                else:
                    loaf=sphere(label+'_golden_loaf',p,(.14,.095,.095),m['flower'],12,6)
                    loaf.rotation_euler.z=angle
    if spill is not None:
        light=lamp(label,facing((x+w*.23,surface+.065,z+h*.41 if stock else z+h*.31),angle),spill,3.9 if stock else 3.5)
        light['clearance']=.07


def doorway(label,x,surface,z,m,angle,w=.94,h=2.10):
    facade_box(label+'_oak_door',x,surface+.035,z+h/2,w,.10,h,m['oak'],angle)
    for dx in [-w/2-.07,w/2+.07]:
        facade_box(label+'_jamb',x+dx,surface-.055,z+h/2,.12,.15,h+.16,m['wood'],angle)
    facade_box(label+'_lintel',x,surface-.055,z+h+.04,w+.30,.15,.15,m['wood'],angle)
    for dz in [.40,1.43]:
        facade_box(label+'_door_strap',x,surface-.04,z+dz,w-.09,.06,.08,m['iron'],angle)
    sphere(label+'_brass_handle',facing((x+w*.29,surface-.09,z+1.0),angle),(.065,.065,.065),m['brass'],12,6)
    facade_box(label+'_doorstep',x,surface-.20,.07,w+.42,.40,.14,m['trim'],angle,.025)


def canopy(label,x,surface,z,width,m,angle,depth=.44):
    for i in range(6):
        obj=facade_box(label+'_awning_stripe',x+(i-2.5)*width/6,surface-depth/2,z,
                      width/6-.008,depth,.085,m['teal'] if i%2 else m['plaster'],angle)
        obj.rotation_euler.x=.10
        facade_box(label+'_awning_valance',x+(i-2.5)*width/6,surface-depth,z-.13,
                   width/6-.008,.07,.18,m['teal'] if i%2 else m['plaster'],angle)


def hanging_sign(label,u,surface,z,m,angle):
    # Motion root at the suspension point; chains and brass emblem inherit the pivot.
    pivot_position=facing((u,surface-.37,z),angle)
    beam(label+'_iron_sign_arm',facing((u,surface,z),angle),pivot_position,.08,m['iron'])
    sign=facade_box('move_sway_'+label,u,surface-.37,z-.46,.73,.11,.52,m['rose_sign'],angle,.025)
    pivot(sign,pivot_position)
    for dx in [-.25,.25]:
        chain=beam('thin_'+label+'_chain',facing((u+dx,surface-.37,z),angle),
                   facing((u+dx,surface-.37,z-.20),angle),.025,m['iron'])
        parent_at_pivot(chain,sign,pivot_position)
    mug=facade_box(label+'_brass_tankard',u-.04,surface-.445,z-.45,.23,.06,.23,m['brass'],angle)
    parent_at_pivot(mug,sign,pivot_position)
    handle=torus(label+'_tankard_handle',facing((u+.14,surface-.46,z-.44),angle),.09,.03,
                 m['brass'],rot=(math.pi/2,0,angle),segments=12,tube=4)
    handle.name='thin_'+label+'_tankard_handle'
    parent_at_pivot(handle,sign,pivot_position)


def roof(name,w,d,eave,rise,m,angle=0,hip=False):
    # Construct around a Y ridge and rotate as a group for crosswise roofs.
    before=set(bpy.context.scene.objects)
    if hip:
        ridge=d*.22
        verts=[(-w/2,-d/2,eave),(w/2,-d/2,eave),(w/2,d/2,eave),(-w/2,d/2,eave),
               (0,-ridge,eave+rise),(0,ridge,eave+rise)]
        mesh(name+'_hipped_roof',verts,[(0,4,1),(1,4,5,2),(2,5,3),(3,5,4,0),(0,1,2,3)],m['roof'])
        for side in [-1,1]:
            beam(name+'_hip_ridge',(side*w/2,-d/2,eave),(0,-ridge,eave+rise),.13,m['roof2'],8)
            beam(name+'_hip_ridge',(side*w/2,d/2,eave),(0,ridge,eave+rise),.13,m['roof2'],8)
        # Wide slope bands preserve the hand-laid slate rhythm without a triangle explosion.
        for row in range(7):
            x=(row+.5)*w/14
            ylimit=ridge+(d/2-ridge)*x/(w/2)
            cols=max(2,int(2*ylimit/.52))
            for side in [-1,1]:
                for col in range(cols):
                    y=-ylimit+(col+.5)*2*ylimit/cols
                    box(name+'_hip_slate',(side*x,y,eave+rise-rise*x/(w/2)+.025),
                        (w/14+.05,2*ylimit/cols-.02,.07),m[['roof','roof2','roof3'][(row+col)%3]],
                        rot=(0,side*math.atan(rise/(w/2)),0))
        for side in [-1,1]:
            for row in range(6):
                t0,t1=row/6+.012,(row+1)/6-.008
                y0,y1=(side*(d/2-(d/2-ridge)*t) for t in [t0,t1])
                half0,half1=(w/2*(1-t)-.045 for t in [t0,t1])
                cols=max(1,int(half0*2/.61))
                for col in range(cols):
                    a,b=col/cols+.006,(col+1)/cols-.006
                    outline=[(-half0+a*2*half0,y0,eave+rise*t0+.045),
                             (-half0+b*2*half0,y0,eave+rise*t0+.045),
                             (-half1+b*2*half1,y1,eave+rise*t1+.045),
                             (-half1+a*2*half1,y1,eave+rise*t1+.045)]
                    if side>0: outline.reverse()
                    verts=[(x,y,z+dz) for dz in [-.06,0] for x,y,z in outline]
                    mesh(name+'_hip_end_slate',verts,[(3,2,1,0),(4,5,6,7),(0,1,5,4),
                         (1,2,6,5),(2,3,7,6),(3,0,4,7)],m[['roof','roof2','roof3'][(row+col)%3]])
    else:
        slope=rise/(w/2)
        for side in [-1,1]:
            verts=[(side*x,y,eave+rise-slope*x+dz)
                   for dz in [-.12,0] for y in [-d/2,d/2] for x in [0,w/2]]
            shell=mesh(name+'_thick_slate_slope',verts,
                       [(0,2,3,1),(4,5,7,6),(0,1,5,4),(2,6,7,3),(0,4,6,2),(1,3,7,5)],m['roof'])
            if side<0:
                for polygon in shell.data.polygons: polygon.flip()
        cols=max(6,int(d/.52))
        for side in [-1,1]:
            for row in range(7):
                x=(row+.5)*w/14
                for col in range(cols):
                    y=-d/2+(col+.5)*d/cols
                    box(name+'_handlaid_slate',(side*x,y,eave+rise-slope*x+.025),
                        (w/14+.04,d/cols-.025,.07),m[['roof','roof2','roof3'][(row+col)%3]],
                        rot=(0,side*math.atan(slope),0))
        for y in [-d/2,d/2]:
            for side in [-1,1]:
                beam(name+'_gable_roof_edge',(side*w/2,y,eave),(0,y,eave+rise),.13,m['wood'],4)
    for x in [-w/2,w/2]:
        box(name+'_eave_fascia',(x,0,eave),(.13,d,.17),m['wood'])
    ridge_extent=ridge if hip else d*.49
    beam(name+'_roof_ridge',(0,-ridge_extent,eave+rise+.025),(0,ridge_extent,eave+rise+.025),.15,m['roof2'],8)
    for obj in set(bpy.context.scene.objects)-before:
        obj.location=facing(obj.location,angle)
        obj.rotation_euler=(Matrix.Rotation(angle,3,'Z')@obj.rotation_euler.to_matrix()).to_euler()


def dormer(name,x,surface,eave,m):
    w=1.16
    box(name+'_dormer_body',(x,surface+.26,eave+.73),(w,.65,.92),m['plaster'])
    extrude_xz(name+'_dormer_gable',[(x-w/2,eave+1.19),(x+w/2,eave+1.19),(x,eave+1.63)],surface,.12,m['plaster'])
    # The dormer window glows without using another lamp.
    facade_box(name+'_dormer_recess',x,surface-.08,eave+.76,.67,.08,.61,m['amber'])
    for dx in [-.38,0,.38]:
        facade_box(name+'_dormer_mullion',x+dx,surface-.14,eave+.76,.08,.08,.75,m['wood'])
    for dz in [-.34,.34]:
        facade_box(name+'_dormer_crossbar',x,surface-.14,eave+.76+dz,.82,.08,.08,m['wood'])
    for side in [-1,1]:
        beam(name+'_dormer_roof_rake',(x+side*.67,surface-.06,eave+1.19),(x,surface-.06,eave+1.70),.13,m['roof2'],4)
        slab=box(name+'_dormer_roof',(x+side*.30,surface+.21,eave+1.47),(.80,.78,.10),m['roof2'],rot=(0,side*math.atan(.51/.67),0))


def chimney(name,x,y,base,top,m):
    box(name+'_russet_chimney',(x,y,(base+top-.12)/2),(.50,.55,top-.12-base),m['brick'])
    for z in [top-.70,top-.43]:
        box(name+'_chimney_course',(x,y,z),(.54,.59,.065),m['trim'])
    box(name+'_chimney_cap',(x,y,top-.07),(.67,.72,.14),m['trim'])
    box(name+'_dark_chimney_mouth',(x,y,top+.027),(.37,.42,.055),m['iron'])


CONFIG={
    'house_B':dict(w=5.5,d=5,h=9,floors=3,eave=6.96,rise=1.40,colour='sage',cross=True,shop=True,dormers=[0],chimney=8.80),
    'tavern':dict(w=7,d=6,h=10,floors=2,eave=6.05,rise=2.53,colour='plaster',cross=False,hip=True,corner=True,chimney=9.30),
    'house_C':dict(w=6,d=5,h=9,floors=2,eave=5.55,rise=1.73,colour='plaster',cross=True,dormers=[-1.28,1.28],chimney=8.30),
    'house_D':dict(w=5,d=5,h=9,floors=3,eave=6.79,rise=1.69,colour='rose',cross=False,chimney=8.81),
    'bakery':dict(w=4.5,d=4,h=6,floors=1,eave=2.98,rise=1.44,colour='plaster',cross=True,shop=True,bakery=True,chimney=5.50),
    'house_E':dict(w=5,d=4.5,h=8,floors=2,eave=4.93,rise=1.43,colour='sage',cross=True,dormers=[0],chimney=7.35),
}


def build_building(name):
    c=CONFIG[name]
    reset(127)
    m=palette()
    w,d=c['w'],c['d']
    bw,bd=w-1.05,d-1.02
    jetty=.12 if c['floors']>1 else 0
    box(name+'_stone_footing',(0,0,.14),(bw+.12,bd+.12,.28),m['stone'])
    floor_height=(c['eave']-.27)/c['floors']
    doors=[]
    for side,angle in [('front',0),('right',math.pi/2),('back',math.pi),('left',-math.pi/2)]:
        half=(bw if side in ['front','back'] else bd)/2
        surf=-(bd if side in ['front','back'] else bw)/2
        active=side=='front' or (c.get('corner') and side=='left')
        for level in range(c['floors']):
            bottom=.27+level*floor_height
            top=.27+(level+1)*floor_height
            s=surf-(jetty if level else 0)
            hw=half+(jetty if level else 0)
            h=1.22 if level else min(1.62,floor_height-.53)
            z=bottom+.43+h/2 if not level else (bottom+top)/2
            shop=bool(c.get('shop') and active and level==0)
            if shop:
                window_w=hw*1.08
                window_x=-hw*.34
                door_x=hw-.61
                holes=[(window_x,z,window_w,h),(door_x,1.14,.92,2.10)]
            elif active and level==0:
                window_w=.92 if hw<2.35 else 1.34
                window_x=hw*.60
                holes=[(-window_x,z,window_w,h),(window_x,z,window_w,h),(0,1.14,.94,2.10)]
                door_x=0
            else:
                count=2 if level or hw>2.3 else 1
                window_w=.90 if hw<2.1 else 1.02
                positions=[-hw*.50,hw*.50] if count==2 else [0]
                holes=[(x,z,window_w,h) for x in positions]
            open_wall(f'{name}_{side}_wall',hw,s,bottom,top,holes,m[c['colour']],angle)
            for x in [-hw+.045,hw-.045]:
                facade_box(f'{name}_{side}_corner_post',x,s-.035,(bottom+top)/2,.15,.12,top-bottom,m['wood'],angle)
            if level:
                facade_box(f'{name}_{side}_middle_post',0,s-.035,(bottom+top)/2,.14,.12,top-bottom,m['wood'],angle)
            for course in [bottom+.04,top-.035]:
                facade_box(f'{name}_{side}_beam',0,s-.04,course,hw*2+.10,.13,.15,m['wood'],angle)
            window_number=0
            for x,hz,ww,wh in holes:
                if active and level==0 and x==door_x:
                    doorway(f'{name}_{side}',x,s,.09,m,angle,w=ww)
                    doors.append(list(facing((x,s,0),angle)))
                    if c.get('corner'):
                        canopy(f'{name}_{side}_door',x,s,2.40,1.42,m,angle)
                    continue
                is_spill=(active and level==0 and window_number==0) or (
                    side=='front' and level==1 and window_number==0 and not c.get('corner'))
                spill=(.20,.90,.80) if shop and not c.get('bakery') else (1,.55,.22)
                architectural_window(f'{name}_{side}_floor{level}_window{window_number}',x,s,hz,ww,wh,m,angle,
                    glow='teal_glow' if shop and not c.get('bakery') else ('amber' if active or side=='right' else 'dim'),
                    spill=spill if is_spill else None,shutters=level>0 and not c.get('corner'),stock=shop)
                window_number+=1
            if level:
                for x in [-hw*.56,hw*.56]:
                    a=facing((x-.31,s-.06,bottom+.17),angle)
                    b=facing((x+.31,s-.06,bottom+.53),angle)
                    beam(f'{name}_{side}_diagonal',a,b,.105,m['wood'],4)
        # Corbels are clearly below the first upper storey jetty.
        if jetty:
            for x in [-half*.75,-half*.25,half*.25,half*.75]:
                beam(f'{name}_{side}_jetty_corbel',facing((x,surf,.27+floor_height-.17),angle),
                     facing((x,surf-.20,.27+floor_height+.02),angle),.13,m['oak'],4)
    for level in range(1,c['floors']+1):
        box(name+'_internal_floor',(0,0,.27+level*floor_height),(bw,bd,.10),m['wood'])
    cross=c.get('cross',False)
    if cross:
        roof(name,d-.30,w-.30,c['eave'],c['rise'],m,math.pi/2,hip=c.get('hip',False))
    else:
        roof(name,w-.30,d-.30,c['eave'],c['rise'],m,hip=c.get('hip',False))
    if not c.get('hip'):
        # Plaster gable fronts occupy the vertical ends of the roof prism.
        gwidth=bd if cross else bw
        depth=bw if cross else bd
        before=set(bpy.context.scene.objects)
        for y in [-depth/2-jetty-.04,depth/2+jetty+.04]:
            extrude_xz(name+'_gable_infill',[(-gwidth/2-jetty,c['eave']),
                       (gwidth/2+jetty,c['eave']),(0,c['eave']+c['rise']-.10)],y,.12,m[c['colour']])
            outer=y+(-.095 if y<0 else .095)
            beam(name+'_gable_kingpost',(0,outer,c['eave']),(0,outer,c['eave']+c['rise']-.13),.14,m['wood'],4)
            for side in [-1,1]:
                beam(name+'_gable_brace',(side*gwidth*.36,outer,c['eave']+.10),
                     (0,outer,c['eave']+c['rise']*.72),.11,m['wood'],4)
        if cross:
            for obj in set(bpy.context.scene.objects)-before:
                obj.location=facing(obj.location,math.pi/2)
                obj.rotation_euler=(Matrix.Rotation(math.pi/2,3,'Z')@obj.rotation_euler.to_matrix()).to_euler()
    for x in c.get('dormers',[]):
        dormer(name,x,-d/2+.29,c['eave'],m)
    chimney(name,bw*.28,bd*.23,c['eave']+.30,c['chimney'],m)
    if c.get('corner'):
        hanging_sign(name+'_tavern_sign',-bw*.30,-bd/2,3.25,m,0)
        # Corner entrance is accompanied by a glowing fixture with no additional lamp.
        facade_box(name+'_corner_rose_inlay',0,-bw/2-.08,3.18,1.15,.08,.26,m['rose_sign'],-math.pi/2)
    if c.get('bakery'):
        canopy(name+'_bakery_canopy',-bw*.17,-bd/2,2.51,bw*.68,m,0,.40)
        # Chunky loaf emblem above the entrance remains legible at game scale.
        sphere(name+'_brass_loaf_sign',facing((bw/2-.61,-bd/2-.09,2.53),0),(.23,.065,.12),m['brass'],16,8)
    export_village(name,'Lantern Row '+name+'; finished four-sided half-timber architecture, true recessed windows, slate roof and authored lamp extras.',
                   footprint=(w,d),front_door=doors[0],max_height=c['h'],attachments={'doors':doors})
