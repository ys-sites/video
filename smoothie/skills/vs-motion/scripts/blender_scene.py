"""Build and render a 3D shot in Blender, headless, from a small JSON spec.

Run (Blender's own Python; nothing to install):
  blender -b --factory-startup -P blender_scene.py -- --spec shot.json --out renders/shot
Then join frames with FFmpeg (vs-edit), e.g.
  ffmpeg -framerate 30 -i renders/shot/frame_%04d.png -c:v libx264 -pix_fmt yuv420p -crf 18 shot.mp4

Kinds:
  floorplan  - 3D "dollhouse" plan from a room list (metres), labels, slow orbit (listing reels)
  title      - extruded 3D text with bevel, camera push-in (kinetic titles, stats)
  turntable  - a model file (.glb/.gltf/.obj/.stl/.fbx/.ply) or a primitive on a turntable (products, lesson objects)

Spec keys (all optional except kind): see SPEC_DEFAULTS below and references/blender.md.
Written fresh for this workspace (ideas from arjun988/blender-skills archviz/camera notes, MIT).
"""
import argparse
import json
import math
import os
import sys

import bpy
from mathutils import Vector

SPEC_DEFAULTS = {
    "width": 1080, "height": 1920, "fps": 30, "seconds": 6, "scale_percent": 100,
    "samples": 32, "engine": "eevee", "background": [0.86, 0.85, 0.83],
    "accent": [0.80, 0.55, 0.30], "frame_step": 1,
}


def args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--spec", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--still", action="store_true", help="render only the middle frame (proof frame)")
    return p.parse_args(argv)


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def pick_engine(name):
    items = [i.identifier for i in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items]
    if name == "cycles":
        return "CYCLES"
    if name == "workbench":
        return "BLENDER_WORKBENCH"
    for cand in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT"):
        if cand in items:
            return cand
    return "BLENDER_WORKBENCH"


def material(name, rgb, rough=0.6, metal=0.0, alpha=1.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = (*rgb, 1.0)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if alpha < 1.0:
        b.inputs["Alpha"].default_value = alpha
    return m


def box(name, center, size, mat):
    bpy.ops.mesh.primitive_cube_add(location=center)
    o = bpy.context.active_object
    o.name = name
    o.scale = (size[0] / 2, size[1] / 2, size[2] / 2)
    bpy.ops.object.transform_apply(scale=True)
    o.data.materials.append(mat)
    return o


def text(body, size, extrude, bevel, mat, location=(0, 0, 0), rotation=(0, 0, 0), font=None):
    cu = bpy.data.curves.new("txt", type="FONT")
    cu.body = body
    cu.size = size
    cu.extrude = extrude
    cu.bevel_depth = bevel
    cu.align_x = "CENTER"
    cu.align_y = "CENTER"
    if font and os.path.exists(font):
        cu.font = bpy.data.fonts.load(font)
    o = bpy.data.objects.new("text_" + body[:12], cu)
    bpy.context.collection.objects.link(o)
    o.location = location
    o.rotation_euler = rotation
    o.data.materials.append(mat)
    return o


def world_and_lights(spec, center, radius):
    w = bpy.data.worlds.new("world")
    bpy.context.scene.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (*spec["background"], 1.0)
    bg.inputs[1].default_value = spec.get("world_strength", 0.35)
    sun = bpy.data.lights.new("sun", "SUN")
    sun.energy = spec.get("sun", 3.5)
    sun.angle = math.radians(8)
    so = bpy.data.objects.new("sun", sun)
    so.rotation_euler = (math.radians(50), math.radians(10), math.radians(35))
    bpy.context.collection.objects.link(so)
    fill = bpy.data.lights.new("fill", "AREA")
    fill.energy = 150 * max(radius, 1) ** 2 / 25
    fill.size = radius * 2
    fo = bpy.data.objects.new("fill", fill)
    fo.location = center + Vector((-radius, -radius, radius * 1.5))
    fo.rotation_euler = (math.radians(45), 0, math.radians(-45))
    bpy.context.collection.objects.link(fo)


def fit_distance(span, lens, margin=1.15):
    """Distance at which an object `span` wide fills the narrow side of the frame."""
    r = bpy.context.scene.render
    w, h = r.resolution_x, r.resolution_y
    sensor = 36.0  # sensor_fit AUTO: 36 mm across the longer side
    narrow = sensor * min(w, h) / max(w, h)
    half_fov = math.atan(narrow / 2 / lens)
    return span * margin / 2 / math.tan(half_fov)


def orbit_camera(center, radius, elevation_deg, start_deg, sweep_deg, frames, lens=35):
    pivot = bpy.data.objects.new("pivot", None)
    bpy.context.collection.objects.link(pivot)
    pivot.location = center
    cam = bpy.data.cameras.new("cam")
    cam.lens = lens
    co = bpy.data.objects.new("cam", cam)
    bpy.context.collection.objects.link(co)
    el = math.radians(elevation_deg)
    co.parent = pivot
    co.location = Vector((0, -radius * math.cos(el), radius * math.sin(el)))
    t = co.constraints.new("TRACK_TO")
    t.target = pivot
    t.track_axis = "TRACK_NEGATIVE_Z"
    t.up_axis = "UP_Y"
    pivot.rotation_euler = (0, 0, math.radians(start_deg))
    pivot.keyframe_insert("rotation_euler", index=2, frame=1)
    pivot.rotation_euler = (0, 0, math.radians(start_deg + sweep_deg))
    pivot.keyframe_insert("rotation_euler", index=2, frame=frames)
    ease(pivot)
    bpy.context.scene.camera = co
    return co


def ease(obj):
    ad = obj.animation_data
    if not ad or not ad.action:
        return
    curves = getattr(ad.action, "fcurves", None)
    if curves is None:  # Blender 5 layered actions
        curves = [fc for layer in ad.action.layers for strip in layer.strips
                  for bag in strip.channelbags for fc in bag.fcurves]
    for fc in curves:
        for k in fc.keyframe_points:
            k.interpolation = "SINE"
            k.easing = "EASE_IN_OUT"


def build_floorplan(spec):
    rooms = spec["rooms"]
    wall_h = spec.get("wall_height", 1.2)  # cut-away dollhouse walls; 2.7 for full height
    wall_t = spec.get("wall_thickness", 0.12)
    wall_mat = material("wall", spec.get("wall_color", [0.97, 0.97, 0.96]), 0.8)
    label_mat = material("label", spec.get("label_color", [0.12, 0.12, 0.13]), 0.5)
    palette = spec.get("floor_colors", [[0.62, 0.44, 0.28], [0.80, 0.78, 0.74], [0.55, 0.62, 0.60], [0.70, 0.58, 0.44]])
    xs, ys = [], []
    for i, r in enumerate(rooms):
        x, y, w, d = r["x"], r["y"], r["w"], r["d"]
        xs += [x, x + w]
        ys += [y, y + d]
        fm = material("floor_" + r["name"], r.get("floor", palette[i % len(palette)]), 0.7)
        box("floor_" + r["name"], (x + w / 2, y + d / 2, -0.03), (w, d, 0.06), fm)
        door = r.get("door")  # {"side": "n|s|e|w", "at": 0..1, "width": m}
        sides = {
            "s": ((x, y), (x + w, y)), "n": ((x, y + d), (x + w, y + d)),
            "w": ((x, y), (x, y + d)), "e": ((x + w, y), (x + w, y + d)),
        }
        for side, (a, b) in sides.items():
            segs = [(a, b)]
            if door and door.get("side") == side:
                L = math.dist(a, b)
                dw = door.get("width", 0.9)
                c = door.get("at", 0.5) * L
                t0, t1 = max(0, c - dw / 2) / L, min(L, c + dw / 2) / L
                lerp = lambda t: (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
                segs = [(a, lerp(t0)), (lerp(t1), b)]
            for p, q in segs:
                L = math.dist(p, q)
                if L < 0.05:
                    continue
                horiz = abs(q[1] - p[1]) < 1e-6
                size = (L + wall_t, wall_t, wall_h) if horiz else (wall_t, L + wall_t, wall_h)
                box("wall", ((p[0] + q[0]) / 2, (p[1] + q[1]) / 2, wall_h / 2), size, wall_mat)
        label = r.get("label", r["name"])
        text(label, min(w, d) * 0.14 + 0.15, 0.01, 0.0, label_mat, (x + w / 2, y + d / 2, 0.02))
    cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    span = math.hypot(max(xs) - min(xs), max(ys) - min(ys))  # diagonal: stays framed while orbiting
    return Vector((cx, cy, wall_h / 3)), span


def build_title(spec):
    mat = material("title", spec["accent"], 0.35, spec.get("metal", 0.2))
    lines = spec.get("text", "3D TITLE").split("\n")
    size = spec.get("size", 1.0)
    for i, line in enumerate(lines):
        y = (len(lines) - 1) / 2 * size * 1.15 - i * size * 1.15
        text(line, size, spec.get("extrude", 0.25), spec.get("bevel", 0.02), mat, (0, 0, y),
             (math.radians(90), 0, 0), spec.get("font"))
    width = max(len(l) for l in lines) * size * 0.6
    return Vector((0, 0, 0)), max(width, size * len(lines) * 1.2)


def build_turntable(spec):
    model = spec.get("model")
    before = set(bpy.data.objects)
    if model:
        ext = os.path.splitext(model)[1].lower()
        if ext in (".glb", ".gltf"):
            bpy.ops.import_scene.gltf(filepath=model)
        elif ext == ".obj":
            bpy.ops.wm.obj_import(filepath=model)
        elif ext == ".stl":
            bpy.ops.wm.stl_import(filepath=model)
        elif ext == ".ply":
            bpy.ops.wm.ply_import(filepath=model)
        elif ext == ".fbx":
            bpy.ops.import_scene.fbx(filepath=model)
        else:
            raise SystemExit(f"unsupported model type {ext}")
    else:
        bpy.ops.mesh.primitive_monkey_add(location=(0, 0, 1))
        o = bpy.context.active_object
        o.modifiers.new("smooth", "SUBSURF").levels = 2
        bpy.ops.object.shade_smooth()
        o.data.materials.append(material("obj", spec["accent"], 0.3))
    objs = [o for o in bpy.data.objects if o not in before and o.type == "MESH"]
    pts = [o.matrix_world @ Vector(c) for o in objs for c in o.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    center, span = (lo + hi) / 2, max((hi - lo).length, 0.1)
    disc = material("disc", [0.9, 0.9, 0.9], 0.5)
    bpy.ops.mesh.primitive_cylinder_add(radius=span * 0.45, depth=0.02, location=(center.x, center.y, lo.z - 0.01))
    bpy.context.active_object.data.materials.append(disc)
    return center, span


def main():
    a = args()
    spec = dict(SPEC_DEFAULTS)
    spec.update(json.load(open(a.spec, encoding="utf-8-sig")))  # -sig: PowerShell writes a BOM
    reset()
    sc = bpy.context.scene
    frames = int(spec["fps"] * spec["seconds"])
    sc.frame_start, sc.frame_end, sc.frame_step = 1, frames, spec["frame_step"]
    sc.render.fps = spec["fps"]
    sc.render.resolution_x, sc.render.resolution_y = spec["width"], spec["height"]
    sc.render.resolution_percentage = spec["scale_percent"]
    sc.render.engine = pick_engine(spec["engine"])
    if sc.render.engine.startswith("BLENDER_EEVEE"):
        sc.eevee.taa_render_samples = spec["samples"]
    elif sc.render.engine == "CYCLES":
        sc.cycles.samples = spec["samples"]
        sc.cycles.device = "CPU"
    sc.view_settings.view_transform = spec.get("view_transform", "AgX") if "AgX" in [
        i.identifier for i in sc.view_settings.bl_rna.properties["view_transform"].enum_items] else "Filmic"

    for look in (spec.get("look", "AgX - Medium High Contrast"), "Medium High Contrast"):
        try:
            sc.view_settings.look = look
            break
        except TypeError:
            pass
    if sc.render.engine.startswith("BLENDER_EEVEE"):
        for attr in ("use_raytracing", "use_gtao", "use_shadows"):
            if hasattr(sc.eevee, attr):
                setattr(sc.eevee, attr, True)

    kind = spec["kind"]
    if kind == "floorplan":
        center, span = build_floorplan(spec)
        lens = spec.get("lens", 30)
        orbit_camera(center, fit_distance(span, lens, spec.get("margin", 1.0)), spec.get("elevation", 62),
                     spec.get("start", -30), spec.get("sweep", 60), frames, lens)
    elif kind == "title":
        center, span = build_title(spec)
        cam = orbit_camera(center, fit_distance(span, spec.get("lens", 50), spec.get("margin", 1.05)),
                           spec.get("elevation", 10), spec.get("start", -28), spec.get("sweep", 22), frames,
                           spec.get("lens", 50))
        cam.data.lens = spec.get("lens", 50)
        cam.data.keyframe_insert("lens", frame=1)
        cam.data.lens = spec.get("lens", 50) * spec.get("push", 1.15)
        cam.data.keyframe_insert("lens", frame=frames)
    elif kind == "turntable":
        center, span = build_turntable(spec)
        orbit_camera(center, fit_distance(span, spec.get("lens", 50), spec.get("margin", 1.3)),
                     spec.get("elevation", 18), 0, spec.get("sweep", 360), frames, spec.get("lens", 50))
    else:
        raise SystemExit(f"unknown kind {kind}")
    world_and_lights(spec, center, span)

    os.makedirs(a.out, exist_ok=True)
    sc.render.image_settings.file_format = "PNG"
    if a.still:
        sc.frame_set(frames // 2 or 1)
        sc.render.filepath = os.path.join(os.path.abspath(a.out), "proof.png")
        bpy.ops.render.render(write_still=True)
    else:
        sc.render.filepath = os.path.join(os.path.abspath(a.out), "frame_")
        bpy.ops.render.render(animation=True)
    print("BLENDER_SCENE_DONE", sc.render.engine, a.out)


main()
