"""Village modelling helpers; the batch-one geometry helpers remain read-only."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'props'))
from common import *


def palette():
    # Shared by the entire street: few deliberate colours, no per-building near-neighbours.
    return {key: material(name, rgb, emission=emission) for key, name, rgb, emission in [
        ('plaster', 'Village warm ivory plaster', (.70, .61, .46), 0),
        ('rose', 'Village dusty rose plaster', (.53, .30, .30), 0),
        ('sage', 'Village sage plaster', (.36, .46, .38), 0),
        ('wood', 'Village smoked walnut frame', (.16, .095, .10), 0),
        ('oak', 'Village honey oak boards', (.40, .23, .10), 0),
        ('stone', 'Village lavender grey limestone', (.38, .40, .47), 0),
        ('trim', 'Village pale limestone trim', (.59, .57, .53), 0),
        ('roof', 'Village midnight blue slate', (.10, .16, .25), 0),
        ('roof2', 'Village weathered blue slate', (.17, .23, .32), 0),
        ('roof3', 'Village violet slate', (.20, .19, .29), 0),
        ('teal', 'Village apothecary teal', (.065, .32, .29), 0),
        ('iron', 'Village blackened iron', (.065, .08, .12), 0),
        ('brass', 'Village antique brass', (.63, .38, .10), 0),
        ('brick', 'Village russet chimney brick', (.36, .17, .12), 0),
        ('green', 'Village foliage dark sage', (.12, .27, .18), 0),
        ('flower', 'Village marigold flowers', (.85, .46, .10), 0),
        ('glass', 'Village glass placeholder', (.18, .31, .38), 0),
        ('amber', 'Village amber lit interior', (1, .48, .14), .65),
        ('dim', 'Village quiet amber interior', (.50, .27, .10), .35),
        ('teal_glow', 'Village teal luminous glass', (.10, .70, .58), .55),
        ('rose_sign', 'Village tavern rose enamel', (.57, .12, .24), 0),
    ]}


def export_village(name, description, budget=10000, footprint=(5, 5), front_door=(0, -2.05, 0), max_height=None, attachments=None):
    """Export before creating a studio rig; retain the authored footprint origin."""
    output = ROOT / 'assets' / 'village' / name
    output.mkdir(parents=True, exist_ok=True)
    runtime = ROOT / 'public' / 'village'
    runtime.mkdir(parents=True, exist_ok=True)
    bpy.context.view_layer.update()
    graph = bpy.context.evaluated_depsgraph_get()
    points, count = [], 0
    for obj in bpy.context.scene.objects:
        if obj.type != 'MESH':
            continue
        evaluated = obj.evaluated_get(graph)
        data = evaluated.to_mesh()
        data.calc_loop_triangles()
        count += len(data.loop_triangles)
        points += [obj.matrix_world @ vertex.co for vertex in data.vertices]
        for tri in data.loop_triangles:
            a, b, c = (data.vertices[i].co for i in tri.vertices)
            assert (b-a).cross(c-a).length > 1e-9, f'Degenerate triangle: {obj.name}'
        evaluated.to_mesh_clear()
    low = Vector(tuple(min(p[i] for p in points) for i in range(3)))
    high = Vector(tuple(max(p[i] for p in points) for i in range(3)))
    assert low.z >= -.001, f'Below ground: {low.z}'
    assert count <= budget, f'Triangle budget: {count} > {budget}'
    assert max(abs(low.x), abs(high.x)) <= footprint[0]/2+.001, f'X envelope: {low.x}, {high.x}'
    assert max(abs(low.y), abs(high.y)) <= footprint[1]/2+.001, f'Y envelope: {low.y}, {high.y}'
    if max_height is not None:
        assert high.z <= max_height+.001, f'Height envelope: {high.z} > {max_height}'
    glb_path = runtime / f'{name}.glb'
    bpy.ops.export_scene.gltf(filepath=str(glb_path), export_format='GLB', export_yup=True,
                              export_apply=True, export_cameras=False, export_lights=False,
                              export_image_format='NONE', export_texcoords=False, export_extras=True)
    canonicalize_glb_triangles(glb_path)
    metadata = {
        'id': name, 'description': description, 'triangles': count, 'triangleBudget': budget,
        'footprintMetres': list(footprint), 'frontBlender': [0, -1, 0],
        'doorPositionBlender': list(front_door) if front_door is not None else None,
        'maxHeightMetres': max_height,
        'attachmentsBlender': attachments or {},
        'boundsBlender': {'min': list(low), 'max': list(high)},
        'dimensionsMetres': list(high-low),
        'lamps': [{'name': obj.name, 'positionBlender': list(obj.location),
                   'colorLinear': list(obj['color']), 'radius': obj['radius'],
                   'clearance': obj.get('clearance', .45)}
                  for obj in bpy.context.scene.objects if obj.name.startswith('lamp_')],
    }
    (output/'metadata.json').write_text(json.dumps(metadata, indent=2)+'\n')
    # Optional editable Blender file contains architecture only, never preview lights/camera.
    bpy.ops.wm.save_as_mainfile(filepath=str(output/f'{name}.blend'))
    scene = bpy.context.scene
    for obj in scene.objects:
        if obj.name.startswith('glass_'):
            obj.hide_render = True
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.display.shading.light = 'STUDIO'
    scene.display.shading.color_type = 'MATERIAL'
    scene.display.shading.show_shadows = True
    scene.display.shading.show_cavity = True
    scene.display.shading.cavity_type = 'BOTH'
    scene.display.shading.show_specular_highlight = False
    scene.display.shading.background_type = 'WORLD'
    scene.world.color = (.10, .12, .17)
    scene.view_settings.view_transform = 'Standard'
    scene.view_settings.look = 'None'
    scene.render.resolution_x = scene.render.resolution_y = 900
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    bpy.ops.object.camera_add()
    camera = bpy.context.object
    camera.data.type = 'ORTHO'
    target = (low+high)/2
    scene.camera = camera
    for filename, direction in [('preview.png', (7, -10, 7)), ('preview-back.png', (-7, 10, 6))]:
        direction = Vector(direction).normalized()
        camera.location = target+direction*25
        camera.rotation_euler = (-direction).to_track_quat('-Z', 'Y').to_euler()
        inverse = camera.rotation_euler.to_matrix().transposed()
        projected = [inverse@(p-target) for p in points]
        camera.data.ortho_scale = max(max(p.x for p in projected)-min(p.x for p in projected),
                                     max(p.y for p in projected)-min(p.y for p in projected))*1.16
        scene.render.filepath = str(output/filename)
        bpy.ops.render.render(write_still=True)
    print('VILLAGE_READY', name, count, 'triangles', tuple(round(v, 3) for v in high-low))
