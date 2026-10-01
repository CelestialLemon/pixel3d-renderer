"""Deterministic Blender helpers for the renderer's material-colour-only props.

Run each prop's build.py with Blender; export happens before preview setup.
All mesh dimensions are metres, Z-up here and Y-up in exported GLB.
"""
import bpy
import json
import math
import random
import struct
from pathlib import Path
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[2]


def reset(seed=71):
    random.seed(seed)
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for materials in list(bpy.data.materials):
        if not materials.users:
            bpy.data.materials.remove(materials)


def material(name, rgb, metallic=0, emission=0):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*rgb, 1)
    m.use_nodes = True
    shader = m.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = (*rgb, 1)
    shader.inputs['Roughness'].default_value = .65
    shader.inputs['Metallic'].default_value = metallic
    if emission:
        shader.inputs['Emission Color'].default_value = (*rgb, 1)
        shader.inputs['Emission Strength'].default_value = emission
    return m


def finish(obj, name, mat, bevel=0, smooth=False):
    obj.name = name
    if mat:
        obj.data.materials.append(mat)
    if bevel:
        modifier = obj.modifiers.new('One-segment worn edge', 'BEVEL')
        modifier.width = bevel
        modifier.segments = 1
        obj.modifiers.new('Weighted corner normals', 'WEIGHTED_NORMAL')
    if smooth:
        for polygon in obj.data.polygons:
            polygon.use_smooth = True
    return obj


def box(name, loc, size, mat, bevel=0, rot=None):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    obj = bpy.context.object
    obj.dimensions = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if rot:
        obj.rotation_euler = rot
    return finish(obj, name, mat, bevel)


def cylinder(name, loc, radius, height, mat, vertices=24, rot=None, smooth=True):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=height, location=loc)
    obj = bpy.context.object
    if rot:
        obj.rotation_euler = rot
    return finish(obj, name, mat, smooth=smooth)


def cone(name, loc, bottom, top, height, mat, vertices=24):
    bpy.ops.mesh.primitive_cone_add(vertices=vertices, radius1=bottom, radius2=top, depth=height, location=loc)
    return finish(bpy.context.object, name, mat)


def sphere(name, loc, scale, mat, segments=16, rings=8):
    # Explicit latitude topology avoids the UV-sphere operator's BMesh pole
    # welding, which can reorder faces and change float normal accumulation.
    vertices = [(0,0,1)]
    for j in range(1,rings):
        latitude = j*math.pi/rings
        for i in range(segments):
            longitude = i*math.tau/segments
            vertices.append((math.sin(latitude)*math.cos(longitude),
                             math.sin(latitude)*math.sin(longitude),math.cos(latitude)))
    south = len(vertices)
    vertices.append((0,0,-1))
    faces = [(0,1+i,1+(i+1)%segments) for i in range(segments)]
    for j in range(rings-2):
        for i in range(segments):
            a,b=1+j*segments+i,1+j*segments+(i+1)%segments
            faces.append((a,a+segments,b+segments,b))
    start=1+(rings-2)*segments
    faces += [(start+i,south,start+(i+1)%segments) for i in range(segments)]
    obj = mesh(name,vertices,faces,mat)
    obj.location = loc
    obj.scale = scale
    return finish(obj, name, None, smooth=True)


def beam(name, a, b, width, mat, vertices=8):
    a, b = Vector(a), Vector(b)
    obj = cylinder(name, (a+b)/2, width/2, (b-a).length, mat, vertices)
    obj.rotation_euler = (b-a).to_track_quat('Z', 'Y').to_euler()
    return obj


def mesh(name, vertices, faces, mat):
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], faces)
    data.update()
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    return finish(obj, name, mat)


def torus(name, loc, major, minor, mat, rot=None, segments=32, tube=6):
    bpy.ops.mesh.primitive_torus_add(major_segments=segments, minor_segments=tube,
                                   major_radius=major, minor_radius=minor, location=loc)
    obj = bpy.context.object
    if rot:
        obj.rotation_euler = rot
    return finish(obj, name, mat, smooth=True)


def path(name, points, width, mat, sides=6):
    """Tube with explicit polygon topology, so GLTF always receives mesh geometry."""
    vertices = []
    for i, point in enumerate(points):
        tangent = Vector(points[min(i+1, len(points)-1)]) - Vector(points[max(0, i-1)])
        tangent.normalize()
        reference = Vector((0, 0, 1)) if abs(tangent.z) < .9 else Vector((0, 1, 0))
        u = tangent.cross(reference).normalized()
        v = tangent.cross(u).normalized()
        for j in range(sides):
            offset = (u*math.cos(j*math.tau/sides) + v*math.sin(j*math.tau/sides))*width/2
            vertices.append(Vector(point)+offset)
    faces = [tuple(range(sides-1, -1, -1)), tuple(range((len(points)-1)*sides, len(points)*sides))]
    for i in range(len(points)-1):
        for j in range(sides):
            a, b = i*sides+j, i*sides+(j+1)%sides
            faces.append((a, b, b+sides, a+sides))
    return mesh(name, vertices, faces, mat)


def lamp(name, position, color, radius):
    obj = bpy.data.objects.new('lamp_'+name, None)
    bpy.context.collection.objects.link(obj)
    obj.location = position
    obj.empty_display_type = 'PLAIN_AXES'
    obj['color'] = list(color)
    obj['radius'] = radius
    return obj


def pivot(obj, position):
    bpy.context.scene.cursor.location = position
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.origin_set(type='ORIGIN_CURSOR')


def join(objects, name, position):
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    obj = bpy.context.object
    obj.name = name
    pivot(obj, position)
    return obj


def orient_pivot_x(obj, direction):
    """Aim a moving mesh's local X shaft without changing its world-space shape."""
    bpy.context.view_layer.update()
    old = obj.matrix_world.copy()
    quaternion = Vector(direction).normalized().to_track_quat('X', 'Z')
    world = Matrix.LocRotScale(old.translation, quaternion, Vector((1,1,1)))
    obj.data.transform(world.inverted()@old)
    obj.matrix_world = world


def parent_at_pivot(child, parent, position):
    pivot(child, position)
    bpy.context.view_layer.update()
    world = child.matrix_world.copy()
    child.parent = parent
    child.matrix_world = world


def center_xy():
    """Centre complete horizontal bounds, translating roots so pivots stay coherent."""
    bpy.context.view_layer.update()
    points = [obj.matrix_world@Vector(p) for obj in bpy.context.scene.objects
              if obj.type == 'MESH' for p in obj.bound_box]
    offset = Vector(tuple(-(min(p[i] for p in points)+max(p[i] for p in points))/2 for i in range(2))+(0,))
    for obj in list(bpy.context.scene.objects):
        if obj.parent is None:
            obj.location += offset


def extrude_xz(name, polygon, y, depth, mat):
    """Extrude a counterclockwise X/Z polygon along Y with outward faces."""
    n = len(polygon)
    vertices = [(x, y+dy, z) for dy in [-depth/2, depth/2] for x, z in polygon]
    faces = [tuple(range(n)), tuple(range(2*n-1, n-1, -1))]
    faces += [(i, i+n, (i+1)%n+n, (i+1)%n) for i in range(n)]
    return mesh(name, vertices, faces, mat)


def annular_segment(name, centre, inner, outer, start, end, height, mat):
    x, y, z = centre
    footprint = [(r*math.cos(a), r*math.sin(a)) for r,a in
                 [(inner,start), (outer,start), (outer,end), (inner,end)]]
    vertices = [(x+dx,y+dy,z+dz) for dz in [0,height] for dx,dy in footprint]
    return mesh(name, vertices, [(3,2,1,0),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)], mat)


def lathe(name, centre, profile, mat, segments=24):
    """Open surface of revolution: profile proceeds from bottom to top (radius, Z)."""
    x,y,z = centre
    vertices = [(x+r*math.cos(i*math.tau/segments), y+r*math.sin(i*math.tau/segments), z+h)
                for r,h in profile for i in range(segments)]
    faces = []
    for j in range(len(profile)-1):
        for i in range(segments):
            a,b=j*segments+i,j*segments+(i+1)%segments
            faces.append((a,b,b+segments,a+segments))
    return finish(mesh(name,vertices,faces,mat),name,None,smooth=True)


def canonicalize_glb_triangles(filepath):
    """Blender's UV-sphere operator can emit identical faces in different orders.

    Sort only index triples, preserving each triangle's winding and all vertex
    data. This makes rebuilt GLBs stable, including palette input traversal.
    """
    data = bytearray(filepath.read_bytes())
    offset, document, binary_offset = 12, None, None
    while offset < len(data):
        length, kind = struct.unpack_from('<II', data, offset)
        if kind == 0x4e4f534a:
            document = json.loads(data[offset+8:offset+8+length])
        elif kind == 0x004e4942:
            binary_offset = offset+8
        offset += length+8
    assert document is not None and binary_offset is not None
    for exported_mesh in document['meshes']:
        for primitive in exported_mesh['primitives']:
            assert primitive.get('mode',4) == 4
            accessor = document['accessors'][primitive['indices']]
            view = document['bufferViews'][accessor['bufferView']]
            assert view.get('buffer',0) == 0 and not view.get('byteStride')
            fmt = {5121:'B',5123:'H',5125:'I'}[accessor['componentType']]
            count = accessor['count']
            assert count%3 == 0
            start = binary_offset+view.get('byteOffset',0)+accessor.get('byteOffset',0)
            indices = struct.unpack_from('<'+fmt*count,data,start)
            triangles = []
            for i in range(0,count,3):
                tri = indices[i:i+3]
                triangles.append(min(tri,tri[1:]+tri[:1],tri[2:]+tri[:2]))
            ordered = [index for tri in sorted(triangles) for index in tri]
            struct.pack_into('<'+fmt*count,data,start,*ordered)
    filepath.write_bytes(data)


def export_and_preview(name, description, camera_direction=(5, -8, 5), preview_size=(800, 800)):
    output = ROOT/'assets'/'props'/name
    output.mkdir(parents=True, exist_ok=True)
    (ROOT/'public'/'props').mkdir(parents=True, exist_ok=True)
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
        for vertex in data.vertices:
            points.append(obj.matrix_world @ vertex.co)
        for tri in data.loop_triangles:
            a, b, c = (data.vertices[i].co for i in tri.vertices)
            assert (b-a).cross(c-a).length > 1e-9, f'Degenerate triangle: {obj.name}'
        evaluated.to_mesh_clear()
    low = Vector(tuple(min(p[i] for p in points) for i in range(3)))
    high = Vector(tuple(max(p[i] for p in points) for i in range(3)))
    assert low.z >= -.001, f'Below ground: {low.z}'
    assert count <= 5000, f'Triangle budget exceeded: {count}'
    assert abs((high.x+low.x)/2) < .05 and abs((high.y+low.y)/2) < .05, 'Prop must be centred in XY'
    glb_path = ROOT/'public'/'props'/f'{name}.glb'
    bpy.ops.export_scene.gltf(filepath=str(glb_path), export_format='GLB',
                              export_yup=True, export_apply=True, export_cameras=False, export_lights=False,
                              export_image_format='NONE', export_texcoords=False, export_extras=True)
    canonicalize_glb_triangles(glb_path)
    metadata = {'id': name, 'description': description, 'triangles': count,
                'boundsBlender': {'min': list(low), 'max': list(high)},
                'dimensionsMetres': list(high-low),
                'lamps': [{'name': obj.name, 'positionBlender': list(obj.location),
                           'colorLinear': list(obj['color']), 'radius': obj['radius']}
                          for obj in bpy.context.scene.objects if obj.name.startswith('lamp_')]}
    (output/'metadata.json').write_text(json.dumps(metadata, indent=2)+'\n')

    scene = bpy.context.scene
    # Mirror the runtime's see-through convention in the studio preview too.
    # This happens after export, so the named placeholder remains in the GLB.
    for obj in scene.objects:
        if obj.name.startswith('glass_'):
            obj.hide_render = True
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.display.shading.light = 'STUDIO'
    scene.display.shading.studiolight_rotate_z = math.radians(20)
    scene.display.shading.color_type = 'MATERIAL'
    scene.display.shading.show_shadows = True
    scene.display.shading.show_cavity = True
    scene.display.shading.cavity_type = 'BOTH'
    scene.display.shading.curvature_ridge_factor = 1.2
    scene.display.shading.curvature_valley_factor = 1.0
    scene.display.shading.show_specular_highlight = False
    scene.display.shading.background_type = 'WORLD'
    scene.world.color = (.19, .21, .24)
    scene.view_settings.view_transform = 'Standard'
    scene.view_settings.look = 'None'
    scene.render.resolution_x, scene.render.resolution_y = preview_size
    scene.render.resolution_percentage = 100
    bpy.ops.object.camera_add()
    camera = bpy.context.object
    camera.name = 'Preview_camera_not_exported'
    target = (low+high)/2
    direction = Vector(camera_direction).normalized()
    camera.location = target+direction*20
    camera.rotation_euler = (-direction).to_track_quat('-Z', 'Y').to_euler()
    camera.data.type = 'ORTHO'
    inverse = camera.rotation_euler.to_matrix().transposed()
    projected = [inverse@(p-target) for p in points]
    width = max(p.x for p in projected)-min(p.x for p in projected)
    height = max(p.y for p in projected)-min(p.y for p in projected)
    aspect = preview_size[0]/preview_size[1]
    # Blender's AUTO sensor fit uses horizontal ortho scale in landscape renders.
    camera.data.ortho_scale = (max(width, height*aspect) if aspect >= 1 else max(height, width/aspect))*1.22
    scene.camera = camera
    scene.render.image_settings.file_format = 'PNG'
    scene.render.filepath = str(output/'preview.png')
    bpy.ops.render.render(write_still=True)
    print('PROP_READY', name, count, 'triangles', tuple(round(v, 3) for v in high-low))
