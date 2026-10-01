"""Grounded handcart. Each wheel rim/hub owns thin spoke children at its axle pivot."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from common import *

reset(73)
wood = material('Weathered honey pine', (.48, .28, .12))
light = material('Fresh pine worn edges', (.63, .41, .20))
dark = material('Walnut endgrain', (.26, .13, .06))
iron = material('Forged blue iron wheel bands', (.085, .115, .14), metallic=.65)
linen = material('Wheat coloured flour sack', (.72, .61, .39))

# Bed rests above the axle; plank gaps are 0.055 m, deliberately readable.
for i in range(6):
    y = -.58+i*.205
    box('Cart floor plank', (0, y, .76), (1.10, .15, .09), light if i%2 else wood, .012)
for x in [-.49, .49]:
    box('Cart undercarriage runner', (x, -.025, .65), (.10, 1.32, .14), dark)
    for y in [-.675, .675]:
        box('Cart corner upright', (x, y, 1.03), (.09, .10, .64), dark, .01)
    for z in [.92, 1.15]:
        box('Cart side plank', (x, 0, z), (.08, 1.40, .17), wood if z < 1 else light, .012)
for y in [-.675, .675]:
    for z in [.92, 1.15]:
        box('Cart end plank', (0, y, z), (.98, .08, .17), wood, .012)

beam('Cart iron axle', (-.80, .10, .46), (.80, .10, .46), .09, iron, vertices=12)
for side in [-1, 1]:
    x, y, z = side*.73, .10, .46
    rim = torus('Wheel wooden rim', (x,y,z), .41, .05, dark, (0,math.pi/2,0), segments=32, tube=6)
    tyre = torus('Wheel iron tread', (x,y,z), .425, .035, iron, (0,math.pi/2,0), segments=32, tube=6)
    hub = cylinder('Wheel oak hub', (x,y,z), .105, .19, light, vertices=16, rot=(0,math.pi/2,0))
    wheel = join([rim, tyre, hub], 'move_spin_wheel_left' if side < 0 else 'move_spin_wheel_right', (x,y,z))
    for i in range(10):
        angle = i*math.tau/10
        spoke = beam('thin_spoke_003m', (x,y+math.cos(angle)*.09,z+math.sin(angle)*.09),
                     (x,y+math.cos(angle)*.405,z+math.sin(angle)*.405), .03, light)
        parent_at_pivot(spoke, wheel, (x,y,z))
    cylinder('Axle iron cap', (x+side*.12,y,z), .063, .06, iron, vertices=12, rot=(0,math.pi/2,0))

for x in [-.41, .41]:
    beam('Handcart long shaft', (x,-.61,.68), (x,-2.0,.44), .085, dark)
    cylinder('Handcart hand grip', (x,-2.03,.43), .062, .24, wood, vertices=12, rot=(math.pi/2,0,0))
    beam('Cart resting leg', (x,-.66,.64), (x,-.76,.04), .08, iron)

# One stylised sack and a shallow open crate exercise overlap without hiding the wheels.
sphere('Loaded flour sack', (-.18,.22,1.07), (.25,.31,.28), linen, segments=16, rings=8)
cylinder('Sack tied neck', (-.18,.22,1.37), .075, .12, linen, vertices=10)
box('Cargo crate bottom', (.20,-.30,.84), (.46,.48,.06), dark)
for x in [-.04,.44]:
    box('Cargo crate side', (x,-.30,.99), (.06,.48,.25), wood)
for y in [-.54,-.06]:
    box('Cargo crate end', (.20,y,.99), (.48,.06,.25), light)

# Centre the entire prop including shafts. Preserve local pivots by translating roots only.
bpy.context.view_layer.update()
meshes = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
points = [obj.matrix_world@Vector(p) for obj in meshes for p in obj.bound_box]
offset = -(min(p.y for p in points)+max(p.y for p in points))/2
for obj in list(bpy.context.scene.objects):
    if obj.parent is None:
        obj.location.y += offset

export_and_preview('cart', 'Spoked handcart with two axle-origin move_spin_ wheels and thin_ spoke children.',
                   camera_direction=(5,-7,4))
