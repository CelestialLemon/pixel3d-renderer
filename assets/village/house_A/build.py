"""Lantern Row's first style model: a jettied, front-gabled townhouse."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from village_common import *

reset(101)
m = palette()


def face_box(name, u, depth, z, width, thickness, height, mat, angle=0, bevel=0):
    # Local -Y is outward; positive depth goes into the house.
    obj = box(name, (u, depth, z), (width, thickness, height), mat, bevel)
    obj.location = Matrix.Rotation(angle, 4, 'Z') @ obj.location
    obj.rotation_euler.z = angle
    return obj


def wall(name, half_width, surface, bottom, top, holes, angle=0):
    # True openings rather than luminous planes pasted over an occluding solid wall.
    xs = sorted(set([-half_width, half_width]+[x+s*w/2 for x,z,w,h in holes for s in [-1,1]]))
    zs = sorted(set([bottom, top]+[z+s*h/2 for x,z,w,h in holes for s in [-1,1]]))
    for x0,x1 in zip(xs,xs[1:]):
        for z0,z1 in zip(zs,zs[1:]):
            x,z = (x0+x1)/2, (z0+z1)/2
            if any(abs(x-cx) < w/2-.001 and abs(z-cz) < h/2-.001 for cx,cz,w,h in holes):
                continue
            face_box(name, x, surface+.09, z, x1-x0, .18, z1-z0, m['plaster'], angle)


def window(label, x, surface, z, angle=0, lit=True, spill=False, shutters=False, flowers=False):
    w,h = 1.0,1.2
    face_box(f'{label}_interior', x, surface+.20, z, w, .06, h, m['amber' if lit else 'dim'], angle)
    face_box(f'glass_{label}', x, surface+.035, z, w, .02, h, m['glass'], angle)
    for dx in [-.54, 0, .54]:
        face_box(f'{label}_mullion', x+dx, surface-.06, z, .08, .12, 1.38, m['wood'], angle)
    for dz in [-.66,0,.66]:
        face_box(f'{label}_crossbar', x, surface-.07, z+dz, 1.16, .12, .08, m['wood'], angle)
    face_box(f'{label}_stone_sill', x, surface-.10, z-.72, 1.36, .34, .12, m['trim'], angle, .025)
    if spill:
        pos = Matrix.Rotation(angle, 4, 'Z') @ Vector((x+.22,surface+.10,z+.20))
        light = lamp(label, pos, (1,.55,.22), 3.6)
        light['clearance'] = .07
    if shutters:
        for side in [-1,1]:
            face_box(f'{label}_teal_shutter', x+side*.83, surface-.03, z, .40, .09, 1.22, m['teal'], angle)
            for dz in [-.42, .42]:
                face_box(f'{label}_shutter_strap', x+side*.83, surface-.09, z+dz, .36, .06, .075, m['iron'], angle)
    if flowers:
        face_box(f'{label}_flower_box', x, surface-.21, z-.91, 1.18, .34, .26, m['oak'], angle)
        for i in range(5):
            p = Matrix.Rotation(angle,4,'Z') @ Vector((x-.44+i*.22,surface-.24,z-.70))
            sphere(f'decor_{label}_leaves', p, (.16,.14,.16), m['green'], 8,4)
            p.z += .13
            sphere(f'decor_{label}_marigold', p, (.08,.08,.075), m['flower'], 8,4)


# Footprint centre stays at the origin. Eaves, doorstep and shutters fit within 5 × 5 m.
box('House_A_stone_footing', (0,0,.16), (4.26,4.26,.32), m['stone'])
ground_holes = [(-1.24,1.56,1,1.2),(1.24,1.56,1,1.2),(0,1.13,1.04,2.10)]
upper_holes = [(-1.08,4.05,1,1.2),(1.08,4.05,1,1.2)]
for side,angle in [('front',0),('right',math.pi/2),('back',math.pi),('left',-math.pi/2)]:
    openings = ground_holes if side == 'front' else [(0,1.56,1,1.2)]
    wall(f'House_A_{side}_ground_plaster',2.05,-2.05,.32,2.72,openings,angle)
    wall(f'House_A_{side}_upper_plaster',2.20,-2.20,2.72,5.38,upper_holes,angle)
    for z in [.42,2.62,2.84,5.33]:
        face_box(f'House_A_{side}_timber_course',0,-(2.10 if z<2.72 else 2.24),z,
                 4.32 if z<2.72 else 4.58,.14,.16,m['wood'],angle)
    for x in [-2.13,0,2.13]:
        face_box(f'House_A_{side}_upper_post',x,-2.25,4.08,.16,.13,2.54,m['wood'],angle)
    for x in [-1.96,1.96]:
        face_box(f'House_A_{side}_lower_post',x,-2.10,1.53,.16,.13,2.42,m['wood'],angle)
    for x in [-1.72,-.58,.58,1.72]:
        a=Matrix.Rotation(angle,4,'Z')@Vector((x,-2.16,2.54))
        b=Matrix.Rotation(angle,4,'Z')@Vector((x,-2.31,2.77))
        beam(f'House_A_{side}_jetty_corbel',a,b,.13,m['oak'],vertices=4)
    for i,(x,z,w,h) in enumerate(openings):
        if side == 'front' and i == 2:
            continue
        window(f'House_A_{side}_lower_{i}',x,-2.05,z,angle,
               spill=(side=='front' and i==0), flowers=(side=='front'))
    for i,(x,z,w,h) in enumerate(upper_holes):
        window(f'House_A_{side}_upper_{i}',x,-2.20,z,angle,
               lit=(side in ['front','right']),shutters=True)
    # Diagonal half-timber panels below the upper windows, clear of the openings.
    for x in [-1.08,1.08]:
        a=Matrix.Rotation(angle,4,'Z')@Vector((x-.45,-2.27,2.97))
        b=Matrix.Rotation(angle,4,'Z')@Vector((x+.45,-2.27,3.35))
        beam(f'House_A_{side}_diagonal_brace',a,b,.12,m['wood'],vertices=4)

for z in [2.72,5.30]:
    box('House_A_solid_internal_floor',(0,0,z),(4.25,4.25,.12),m['wood'])
box('House_A_oak_door',(0,-2.04,1.13),(1.04,.10,2.10),m['oak'])
for x in [-.55,.55]:
    box('House_A_door_frame',(x,-2.12,1.16),(.12,.18,2.23),m['wood'])
box('House_A_door_lintel',(0,-2.12,2.27),(1.22,.18,.15),m['wood'])
for z in [.55,1.55]:
    box('House_A_door_iron_strap',(0,-2.13,z),(.93,.07,.08),m['iron'])
sphere('House_A_brass_door_handle',(.34,-2.17,1.1),(.07,.065,.07),m['brass'],12,6)
box('House_A_stone_doorstep',(0,-2.30,.075),(1.48,.40,.15),m['trim'],.025)

# Front/back gables and a steep shingled roof, ridge parallel to Y.
for y in [-2.19,2.19]:
    outer_y = y + (-.13 if y < 0 else .13)
    extrude_xz('House_A_gable_plaster',[(-2.20,5.38),(2.20,5.38),(0,7.33)],y,.18,m['plaster'])
    beam('House_A_gable_kingpost',(0,outer_y,5.40),(0,outer_y,7.32),.16,m['wood'],4)
    for side in [-1,1]:
        beam('House_A_gable_rake',(side*2.22,outer_y,5.38),(0,outer_y,7.35),.15,m['wood'],4)
        beam('House_A_gable_fan',(side*1.54,outer_y,5.50),(0,outer_y,6.84),.12,m['wood'],4)
    angle = 0 if y < 0 else math.pi
    for label,depth,size,mat in [('frame',-.19,.53,m['wood']),('glow',-.25,.34,m['amber'])]:
        diamond=face_box(f'House_A_attic_diamond_{label}',0,-abs(y)+depth,6.15,size,.06,size,mat,angle)
        diamond.rotation_euler.y=math.pi/4

slope=1.95/2.40
for side in [-1,1]:
    # Thick closed roof shells; separate tile meshes provide visible bands without textures.
    vertices=[(side*x,y,7.43-slope*x+dz) for dz in [-.12,0] for y in [-2.50,2.50] for x in [0,2.40]]
    roof=mesh('House_A_slate_roof_shell',vertices,
              [(0,2,3,1),(4,5,7,6),(0,1,5,4),(2,6,7,3),(0,4,6,2),(1,3,7,5)],m['roof'])
    if side<0:
        for polygon in roof.data.polygons:
            polygon.flip()
    for row in range(7):
        x=(row+.5)*2.40/7
        for col in range(10):
            y=-2.25+col*.5
            box('House_A_individual_slate',(side*x,y,7.43-slope*x+.025),
                (.42,.48,.07),m[['roof','roof2','roof3'][(row*3+col)%3]],
                rot=(0,side*math.atan(slope),0))
    box('House_A_eave_fascia',(side*2.43,0,5.46),(.13,5,.18),m['wood'])
for y in [-2.43,2.43]:
    for side in [-1,1]:
        beam('House_A_roof_edge',(side*2.42,y,5.47),(0,y,7.46),.13,m['wood'],4)
beam('House_A_slate_ridge',(0,-2.45,7.47),(0,2.45,7.47),.17,m['roof2'],8)

# A chimney interrupts the back-right slope and has a real dark mouth.
box('House_A_brick_chimney',(1.2,.95,6.78),(.56,.62,1.7),m['brick'])
for row in range(5):
    box('House_A_chimney_course',(1.2,.95,6.4+row*.25),(.60,.66,.065),m['trim'])
for x in [.86,1.54]:
    box('House_A_chimney_cap_side',(x,.95,7.67),(.16,.82,.14),m['trim'])
for y in [.62,1.28]:
    box('House_A_chimney_cap_end',(1.2,y,7.67),(.52,.16,.14),m['trim'])
box('House_A_chimney_dark_flue',(1.2,.95,7.61),(.50,.48,.07),m['iron'])

# Warm doorstep lantern: emissive fixture and the second (and last) spill lamp.
box('House_A_lantern_mount',(.83,-2.14,2.2),(.12,.18,.23),m['iron'])
beam('House_A_lantern_bracket',(.83,-2.10,2.40),(.83,-2.39,2.40),.075,m['iron'])
box('House_A_lantern_glow',(.83,-2.34,2.17),(.20,.20,.30),m['amber'])
for x in [.69,.97]:
    for y in [-2.47,-2.21]:
        box('House_A_lantern_corner',(x,y,2.17),(.06,.06,.38),m['iron'])
for z in [1.96,2.39]:
    box('House_A_lantern_cap',(.83,-2.34,z),(.32,.32,.08),m['iron'])
light=lamp('House_A_door_lantern',(.83,-2.34,2.17),(1,.55,.22),3.1)
light['clearance']=.23

export_village('house_A', 'Front-gabled two-floor half-timbered townhouse; jettied upper floor, teal shutters, marigold boxes, tiled slate roof, open warm window recesses and two occluded spill lights.')
