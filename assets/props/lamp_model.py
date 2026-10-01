from common import *


def build_lamp(name, cool=False):
    reset()
    iron = material('Blue black cast iron', (.045, .075, .09), metallic=.65)
    trim = material('Weathered brass fittings', (.52, .32, .10), metallic=.7)
    color = (.30, .62, 1.0) if cool else (1.0, .52, .16)
    glow = material('Cool blue white luminous panes' if cool else 'Warm amber luminous panes', color, emission=.65)
    # Foot and collars are part of the pole, with no extra ground slab.
    cone('Flared cast foot', (0, 0, .13), .17, .095, .26, iron)
    cylinder('Foot brass collar', (0, 0, .29), .102, .07, trim)
    cylinder('Cast iron post_008m', (0, 0, 1.23), .04, 1.90, iron, vertices=24)
    cylinder('Post shoulder', (0, 0, 2.12), .075, .12, iron)
    box('Lantern lower tray', (0, 0, 2.24), (.46, .46, .09), iron, .015)
    # Four bright panels, framed by chunky corner posts; never named glass_.
    for side in [-1, 1]:
        box('Luminous pane_front_back', (0, side*.178, 2.51), (.28, .025, .42), glow)
        box('Luminous pane_left_right', (side*.178, 0, 2.51), (.025, .28, .42), glow)
        for other in [-1, 1]:
            box('Lantern corner frame', (side*.19, other*.19, 2.51), (.065, .065, .47), iron)
    box('Lantern upper cornice', (0, 0, 2.775), (.48, .48, .10), iron, .015)
    cone('Four sided lantern roof', (0, 0, 2.90), .365, .08, .20, iron, vertices=4).rotation_euler.z = math.pi/4
    cylinder('Roof brass button', (0, 0, 3.035), .05, .08, trim, vertices=12)
    lamp('cool' if cool else 'warm', (0, 0, 2.51), color, 3.4)
    export_and_preview(name, '0.08 m post; emissive framed lantern; '+('cool' if cool else 'warm')+' lamp extras.')
