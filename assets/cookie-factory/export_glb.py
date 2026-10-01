# Re-export the cookie factory diorama to public/cookie_factory_current.glb (the Cookie Co. scene)
#   blender -b assets/cookie-factory/cookie_factory.blend --python assets/cookie-factory/export_glb.py
# Drops the built-in lawn slab and studio rig: the renderer builds its own meadow.
# public/cookie_factory.glb is the frozen export the Pass 0/1 references load; never overwrite it. It predates
# the arch winding fix in build_cookie_factory.py (its door and door casing are inside-out).
import bpy, os
for n in ("Rounded earth diorama", "Thick pistachio lawn"):
    bpy.data.objects.remove(bpy.data.objects[n], do_unlink=True)
for c in bpy.data.collections:
    if c.name.startswith("07"):
        for o in list(c.objects): bpy.data.objects.remove(o, do_unlink=True)
root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
out = os.path.join(root, "public", "cookie_factory_current.glb")
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_apply=True, export_cameras=False, export_lights=False,
    export_yup=True, export_image_format='NONE', export_texcoords=False)
