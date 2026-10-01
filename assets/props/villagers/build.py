"""Four static low-poly people, diverse skin tones and clear head/hand silhouettes."""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from common import *

reset(78)
skins=[material('Skin '+name,rgb) for name,rgb in [
    ('light peach',(.88,.60,.43)),('warm medium',(.58,.32,.17)),
    ('deep brown',(.20,.085,.045)),('olive tan',(.48,.34,.21))]]
clothes=[material('Teal work shirt',(.065,.37,.34)),material('Cranberry apron',(.52,.065,.10)),
         material('Golden ochre coat',(.72,.39,.065)),material('Cobalt blue tunic',(.075,.18,.48))]
trousers=material('Indigo work trousers',(.065,.085,.15))
boots=material('Dark leather boots',(.12,.075,.04))
hair=[material('Hair dark walnut',(.07,.035,.025)),material('Hair wheat blond',(.63,.39,.12)),
      material('Hair silver grey',(.48,.51,.52))]
hat=material('Straw sun hat',(.77,.58,.27))
for i,cx in enumerate([-1.5,-.5,.5,1.5]):
    scale=[1,.96,1.04,.99][i]
    def loc(x,y,z): return (cx+x*scale,y*scale,z*scale)
    def size(x,y,z): return (x*scale,y*scale,z*scale)
    for side in [-1,1]:
        box('Villager leather boot',loc(side*.105,-.07,.105),size(.17,.31,.21),boots,.015)
        box('Villager trouser leg',loc(side*.105,0,.48),size(.15,.19,.57),trousers,.01)
    box('Villager hips',loc(0,0,.79),size(.37,.23,.14),trousers,.015)
    torso=cone('Villager coloured torso',loc(0,0,1.08),.255,.225,.51,clothes[i],vertices=8)
    torso.scale.y=.65
    cylinder('Villager neck',loc(0,0,1.40),.07*scale,.14*scale,skins[i],vertices=8)
    sphere('Villager head',loc(0,-.005,1.565),size(.155,.14,.19),skins[i],segments=16,rings=8)
    if i != 3:
        sphere('Villager hair cap',loc(0,.015,1.69),size(.162,.143,.10),hair[i%3],segments=12,rings=6)
        box('Villager back hair',loc(0,.12,1.59),size(.24,.06,.17),hair[i%3],.01)
    for side in [-1,1]:
        shoulder=loc(side*.22,0,1.28)
        cuff=loc(side*(.29+.025*(i%2)),-.035,1.01)
        beam('Villager sleeve',shoulder,cuff,.15*scale,clothes[i],vertices=8)
        beam('Villager exposed forearm',cuff,loc(side*.32,-.07,.91),.105*scale,skins[i],vertices=8)
        sphere('Villager clearly readable hand',loc(side*.32,-.08,.885),size(.075,.075,.09),skins[i],segments=12,rings=6)
    if i == 1:
        box('Villager apron front',loc(0,-.18,.99),size(.31,.06,.45),hat,.01)
    if i == 3:
        cylinder('Villager straw hat brim',loc(0,0,1.735),.285*scale,.065*scale,hat,vertices=24)
        cone('Villager straw hat crown',loc(0,0,1.84),.17*scale,.13*scale,.20*scale,hat,vertices=20)
center_xy()
export_and_preview('villagers','Four 1.7–1.9 m standing figures: light, medium, deep and olive skin; contrasting clothes; one straw hat.',
                   camera_direction=(2,-10,4),preview_size=(1100,650))
