# Ricostruisce la campana "da souk" usata come pin 3D in Bal'harm come
# low-poly (~3.3k tri) con il dettaglio dell'originale ad alta risoluzione
# (assets-src/bell-hires.glb, 424k tri) trasferito via bake Cycles
# (normal map tangent-space + base color con AO) su due texture WebP 512².
#
# Uscita: glTF 2.0 binario, Y-up, bbox centrato sull'origine: Y -1..+1
# (bocca in basso, pivot = cima a Y=+1), X/Z ±0.555; un solo mesh/materiale,
# nessuna animazione, nessuna compressione. Il profilo low-poly è ricavato
# dalla silhouette dell'originale (rimappato in Z: corpo x1.15, collo x1.5,
# pomello x1.0), quindi sorgente e destinazione combaciano per il bake.
#
# Lancio (da WSL, Blender per Windows; senza argomenti usa i default del repo):
#   B="/mnt/c/Program Files/Blender Foundation/Blender 5.2/blender.exe"
#   "$B" --background --factory-startup --python "$(wslpath -w scripts/build-bell.py)"
# Argomenti opzionali (percorsi da convertire con wslpath -w):
#   -- [sorgente hi-poly] [GLB di uscita] [knob|ring] [lato texture]
# Default: assets-src/bell-hires.glb (deve restare nel repo, fuori da
# uploads/ che viene servito), uploads/elements/bell.glb, "knob" (pomello +
# collo tornito + guglia a perline come l'originale; "ring" = anello), 512.
# Le texture intermedie (PNG) vengono scritte in una cartella temporanea,
# il cui percorso è stampato in console.
import bpy, bmesh, sys, math, os
import numpy as np
from mathutils import Vector, Matrix

import tempfile
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_GLB = argv[0] if len(argv) > 0 else os.path.join(REPO, "assets-src", "bell-hires.glb")
OUT_GLB = argv[1] if len(argv) > 1 else os.path.join(REPO, "uploads", "elements", "bell.glb")
HANDLE = argv[2] if len(argv) > 2 else "knob"
TEX = int(argv[3]) if len(argv) > 3 else 512
assert HANDLE in ("knob", "ring"), HANDLE
assert os.path.isfile(SRC_GLB), f"sorgente hi-poly non trovata: {SRC_GLB}"
TMP_DIR = tempfile.mkdtemp(prefix="bell-bake-")
print(f"ARGS src={SRC_GLB} out={OUT_GLB} handle={HANDLE} tex={TEX} tmp={TMP_DIR}")

# ----------------------------------------------------------------------------
# Parametri
# ----------------------------------------------------------------------------
RADIAL = 28            # segmenti radiali
MAX_PROFILE_PTS = 46   # punti del profilo esterno dopo la semplificazione
SXY = 0.988            # scala radiale: r max dell'originale 0.562 -> 0.555
WALL = 0.04            # spessore della parete (superficie interna)

def srgb_to_linear(hexstr):
    out = []
    for i in (0, 2, 4):
        c = int(hexstr[i:i + 2], 16) / 255.0
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return np.array(out)

BRASS = srgb_to_linear("d9b268")   # media target del base color (ottone caldo)
METALLIC = 0.35
ROUGHNESS = 0.40
EMISSIVE_STRENGTH = 0.28           # emissive = baseColorTexture * 0.28 (riempie le ombre)
INSIDE_DARK = 0.45                 # base color dell'interno = BRASS * 0.45
SHADOW_LIFT = 0.85                 # gamma < 1 sul base color: alza le patine scure

# Isole UV (v in coordinate Blender, 0 = basso): esterno bakeato, interno e
# parti procedurali (batacchio, anello) riempite a tinta piatta.
UV_OUTER = (0.30, 1.00)
UV_INNER = (0.14, 0.28)
UV_MISC = (0.02, 0.12)

# ----------------------------------------------------------------------------
# 1. Sorgente: importa l'originale, togli il batacchio, trasformalo in modo
#    che labbro = -1 e cima = +1 (stiramento verticale ~10%, radiale x1.06).
# ----------------------------------------------------------------------------
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
bpy.ops.import_scene.gltf(filepath=SRC_GLB)
src = [o for o in scene.objects if o.type == "MESH"][0]
src.name = "Source"

bm = bmesh.new(); bm.from_mesh(src.data)
lip_z = min(v.co.z for v in bm.verts if math.hypot(v.co.x, v.co.y) > 0.4)
top_z = max(v.co.z for v in bm.verts)
clapper = [v for v in bm.verts if math.hypot(v.co.x, v.co.y) < 0.12 and v.co.z < 0.17]
bmesh.ops.delete(bm, geom=clapper, context="VERTS")
bm.to_mesh(src.data); bm.free()

# Rimappatura Z lineare a tratti: il labbro va a -1 e la cima resta a +1, ma
# l'allungamento (+0.31) è distribuito su corpo e collo tornito, lasciando
# il pomello sferico non deformato. Le quote sono quelle dell'originale
# (spalla ~0.21, inizio pomello ~0.49, fine calotta ~0.80).
Z_ORIG = [lip_z, 0.21, 0.49, 0.80, top_z]
FACT = [1.15, 1.5, 1.0]                      # corpo, collo, pomello
Z_NEW = [-1.0]
for z0, z1, f in zip(Z_ORIG, Z_ORIG[1:], FACT):
    Z_NEW.append(Z_NEW[-1] + (z1 - z0) * f)
Z_NEW.append(1.0)                            # guglia: assorbe il resto
spire_f = (1.0 - Z_NEW[-2]) / (top_z - 0.80)
assert spire_f > 0.9, f"guglia compressa ({spire_f:.2f}): riduci FACT"
n = len(src.data.vertices)
co = np.empty(n * 3, dtype=np.float32); src.data.vertices.foreach_get("co", co); co = co.reshape(n, 3)
co[:, 2] = np.interp(co[:, 2], Z_ORIG, Z_NEW)
src.data.vertices.foreach_set("co", co.ravel()); src.data.update()
# Le normali custom importate dal glTF non seguirebbero la deformazione:
# via, e shading smooth sulla sorgente.
bpy.context.view_layer.objects.active = src; src.select_set(True)
bpy.ops.mesh.customdata_custom_splitnormals_clear()
src.data.polygons.foreach_set("use_smooth", [True] * len(src.data.polygons))
src.matrix_world = Matrix.Diagonal((SXY, SXY, 1.0, 1.0))
print(f"SOURCE lip_z={lip_z:.3f} top_z={top_z:.3f} z-map {[round(z,3) for z in Z_NEW]} "
      f"factors {FACT + [round(spire_f, 3)]} xy={SXY} clapper verts removed={len(clapper)}")
# Materiale sorgente: niente metallic/emissive, così il pass Diffuse Color
# restituisce il base color puro.
for m in src.data.materials:
    for n in m.node_tree.nodes:
        if n.type == "BSDF_PRINCIPLED":
            n.inputs["Metallic"].default_value = 0.0
            n.inputs["Emission Strength"].default_value = 0.0

# ----------------------------------------------------------------------------
# 2. Profilo esterno (r, z) dell'originale trasformato: raggio massimo per
#    fascia di z, poi semplificazione Ramer-Douglas-Peucker.
# ----------------------------------------------------------------------------
mw = src.matrix_world
NB = 400
rmax = np.zeros(NB)
for v in src.data.vertices:
    p = mw @ v.co
    i = min(NB - 1, max(0, int((p.z + 1.0) / 2.0 * NB)))
    rmax[i] = max(rmax[i], math.hypot(p.x, p.y))
pts = [(rmax[i], -1.0 + (i + 0.5) * 2.0 / NB) for i in range(NB) if rmax[i] > 0]
pts[0] = (pts[0][0], -1.0)            # bordo del labbro esattamente a -1
pts.append((0.0, 1.0))                # chiusura sull'asse in cima

def rdp(points, eps):
    if len(points) < 3:
        return points
    (x0, y0), (x1, y1) = points[0], points[-1]
    dx, dy = x1 - x0, y1 - y0
    L = math.hypot(dx, dy) or 1e-9
    dmax, idx = 0.0, 0
    for i in range(1, len(points) - 1):
        d = abs(dy * points[i][0] - dx * points[i][1] + x1 * y0 - y1 * x0) / L
        if d > dmax:
            dmax, idx = d, i
    if dmax > eps:
        return rdp(points[:idx + 1], eps)[:-1] + rdp(points[idx:], eps)
    return [points[0], points[-1]]

if HANDLE == "ring":
    # Taglia il profilo sotto il pomello: collo dello stelo (r minimo tra z 0.1 e 0.6)
    neck = min((p for p in pts if 0.1 < p[1] < 0.6), key=lambda p: p[0])
    pts = [p for p in pts if p[1] <= neck[1]] + [(0.0, neck[1])]
    NECK_Z = neck[1]

eps = 0.003
outer = rdp(pts, eps)
while len(outer) > MAX_PROFILE_PTS:
    eps *= 1.25
    outer = rdp(pts, eps)
print(f"PROFILE {len(outer)} pts (eps {eps:.4f}), lip r={outer[0][0]:.3f}")

# Profilo interno: offset verso l'interno dei punti del corpo, chiuso sull'asse
body = [p for p in outer if p[1] < 0.05 and p[0] > 0.2]
step = max(1, len(body) // 7)
inner = [(max(p[0] - WALL, 0.05), p[1] + 0.012) for p in body[::step]]
inner.append((0.0, inner[-1][1] + 0.08))

# ----------------------------------------------------------------------------
# 3. Low-poly: griglia profilo x angolo con UV procedurali.
# ----------------------------------------------------------------------------
mesh = bpy.data.meshes.new("Bell")
obj = bpy.data.objects.new("Bell", mesh)
scene.collection.objects.link(obj)
bm = bmesh.new()
uv_layer = bm.loops.layers.uv.new("UVMap")

def spin_strip(profile, vrange):
    """Spinna un profilo (r,z) attorno a Z con cucitura duplicata (u 0..1);
    v = ascissa curvilinea normalizzata mappata su vrange."""
    arc = [0.0]
    for a, b in zip(profile, profile[1:]):
        arc.append(arc[-1] + math.hypot(b[0] - a[0], b[1] - a[1]))
    vs = [vrange[0] + (vrange[1] - vrange[0]) * t / arc[-1] for t in arc]
    rows = []
    for (r, z) in profile:
        if r < 1e-6:
            v = bm.verts.new((0.0, 0.0, z)); rows.append([v] * (RADIAL + 1))
        else:
            rows.append([bm.verts.new((r * math.cos(math.tau * j / RADIAL), r * math.sin(math.tau * j / RADIAL), z))
                         for j in range(RADIAL + 1)])
    for i in range(len(profile) - 1):
        for j in range(RADIAL):
            quad = [rows[i][j], rows[i][j + 1], rows[i + 1][j + 1], rows[i + 1][j]]
            uvs = [(j / RADIAL, vs[i]), ((j + 1) / RADIAL, vs[i]), ((j + 1) / RADIAL, vs[i + 1]), (j / RADIAL, vs[i + 1])]
            verts, uvq = [], []
            for v, uv in zip(quad, uvs):
                if v not in verts:
                    verts.append(v); uvq.append(uv)
            if len(verts) < 3:
                continue
            f = bm.faces.new(verts)
            for loop, uv in zip(f.loops, uvq):
                loop[uv_layer].uv = uv
    return rows

# esterno: dall'alto (asse) al labbro, così la normale guarda fuori
spin_strip(list(reversed(outer)), (UV_OUTER[1], UV_OUTER[0]))
# interno: dal labbro verso l'asse
spin_strip(inner, UV_INNER)
# bordo del labbro: salda esterno e interno in un'unica shell chiusa
spin_strip([outer[0], inner[0]], (UV_OUTER[0], UV_INNER[1]))

def uv_misc(u, v):
    return (u, UV_MISC[0] + (UV_MISC[1] - UV_MISC[0]) * v)

def add_torus(major, minor, seg_major, seg_minor, matrix):
    rows = []
    for i in range(seg_major + 1):
        a = math.tau * (i % seg_major) / seg_major
        ring = []
        for j in range(seg_minor + 1):
            b = math.tau * (j % seg_minor) / seg_minor
            r = major + minor * math.cos(b)
            ring.append(bm.verts.new(matrix @ Vector((r * math.cos(a), r * math.sin(a), minor * math.sin(b)))))
        rows.append(ring)
    for i in range(seg_major):
        for j in range(seg_minor):
            f = bm.faces.new((rows[i][j], rows[i][j + 1], rows[i + 1][j + 1], rows[i + 1][j]))
            for loop, (ii, jj) in zip(f.loops, ((i, j), (i, j + 1), (i + 1, j + 1), (i + 1, j))):
                loop[uv_layer].uv = uv_misc(ii / seg_major, jj / seg_minor)

def add_sphere(radius, seg, rings, center):
    prof = [(radius * math.sin(math.pi * k / rings), center + radius * math.cos(math.pi * k / rings)) for k in range(rings + 1)]
    spin_strip(prof, (UV_MISC[1], UV_MISC[0]))

def add_cylinder(radius, z0, z1, seg):
    prof = [(0.0, z1), (radius, z1), (radius, z0), (0.0, z0)]
    spin_strip(prof, (UV_MISC[1], UV_MISC[0]))

if HANDLE == "ring":
    RING_MAJOR, RING_MINOR = 0.20, 0.08
    m = Matrix.Translation((0, 0, 1.0 - RING_MAJOR - RING_MINOR)) @ Matrix.Rotation(math.radians(90), 4, "X")
    add_torus(RING_MAJOR, RING_MINOR, 24, 8, m)  # 24: un vertice esattamente in cima (z=+1)
    add_cylinder(0.06, NECK_Z - 0.02, 1.0 - 2 * RING_MAJOR - RING_MINOR + 0.04, 12)

# batacchio, dentro la bocca
add_cylinder(0.024, -0.80, inner[-1][1] - 0.02, 8)
add_sphere(0.10, 12, 8, -0.82)

bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-6)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
bm.normal_update()
# Controllo: shell chiusa e facce dell'interno rivolte verso l'asse
# (con doubleSided=false una faccia girata viene scartata dal rendering).
def _rc(f):
    c = f.calc_center_median(); return c, math.hypot(c.x, c.y)
inner_sorted = sorted(inner, key=lambda p: p[1])
def inner_r_at(z):
    return float(np.interp(z, [p[1] for p in inner_sorted], [p[0] for p in inner_sorted]))
inner_faces = [f for f in bm.faces if -0.95 < _rc(f)[0].z < inner_sorted[-1][1] - 0.02
               and 0.12 < _rc(f)[1] < inner_r_at(_rc(f)[0].z) + 0.01]
bad = sum(1 for f in inner_faces if f.normal.dot(Vector((_rc(f)[0].x, _rc(f)[0].y, 0))) > 0)
open_edges = sum(1 for e in bm.edges if not e.is_manifold)
assert bad == 0 and open_edges == 0, f"shell: inner outward={bad} non-manifold={open_edges}"
print(f"CHECK inner faces={len(inner_faces)} outward(bad)={bad} non-manifold edges={open_edges}")
for f in bm.faces:
    f.smooth = True
for e in bm.edges:
    if e.is_manifold and e.calc_face_angle(0.0) > math.radians(40):
        e.smooth = False
bm.to_mesh(mesh); bm.free(); mesh.update()
tris = sum(len(p.vertices) - 2 for p in mesh.polygons)
zs = [v.co.z for v in mesh.vertices]; rs = [math.hypot(v.co.x, v.co.y) for v in mesh.vertices]
print(f"BUILD {len(mesh.vertices)} verts, {len(mesh.polygons)} polys, {tris} tris; z[{min(zs):.3f},{max(zs):.3f}] rmax {max(rs):.3f}")

# ----------------------------------------------------------------------------
# 4. Bake (Cycles, CPU): normal (tangent), base color, AO dall'originale.
# ----------------------------------------------------------------------------
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.render.bake.margin = 4
scene.render.bake.use_selected_to_active = True
scene.render.bake.cage_extrusion = 0.015
scene.render.bake.max_ray_distance = 0.045

mat = bpy.data.materials.new("Brass"); mat.use_nodes = True
mat.use_backface_culling = True
nt = mat.node_tree
bsdf = nt.nodes["Principled BSDF"]
mesh.materials.append(mat)
bake_node = nt.nodes.new("ShaderNodeTexImage")
nt.nodes.active = bake_node

def bake(kind, name, samples, colorspace, **kw):
    img = bpy.data.images.new(name, TEX, TEX, float_buffer=True)
    img.colorspace_settings.name = colorspace
    bake_node.image = img
    scene.cycles.samples = samples
    bpy.ops.object.select_all(action="DESELECT")
    src.select_set(True); obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.bake(type=kind, use_selected_to_active=True, margin=4,
                        cage_extrusion=0.015, max_ray_distance=0.045, use_clear=True, **kw)
    print("BAKED", kind)
    return img

img_n = bake("NORMAL", "bake-normal", 4, "Non-Color", normal_space="TANGENT")
img_c = bake("DIFFUSE", "bake-color", 8, "Non-Color", pass_filter={"COLOR"})
if scene.world is None:
    scene.world = bpy.data.worlds.new("W")
scene.world.light_settings.distance = 0.06
img_ao = bake("AO", "bake-ao", 24, "Non-Color")

# ----------------------------------------------------------------------------
# 5. Post-processing (numpy): normalizza il base color sull'ottone target,
#    moltiplica l'AO, riempie a tinta piatta le isole non bakeate.
# ----------------------------------------------------------------------------
def to_np(img):
    a = np.array(img.pixels[:], dtype=np.float32).reshape(TEX, TEX, 4)
    return a  # riga 0 = v=0 (basso)

def rows(vr):
    return slice(int(vr[0] * TEX), int(vr[1] * TEX))

col = to_np(img_c); ao = to_np(img_ao); nrm = to_np(img_n)
outer_rows = rows(UV_OUTER)
mean = col[outer_rows, :, :3].reshape(-1, 3).mean(axis=0)
print("BAKED base mean (linear):", mean)
gain = BRASS / np.maximum(mean, 1e-4)
col[..., :3] *= gain
col[outer_rows, :, :3] *= (0.55 + 0.45 * ao[outer_rows, :, :1])
col[outer_rows, :, :3] = np.clip(col[outer_rows, :, :3], 0, 1) ** SHADOW_LIFT
col[rows((UV_INNER[0] - 0.012, UV_INNER[1] + 0.012)), :, :3] = BRASS * INSIDE_DARK
col[rows((UV_MISC[0] - 0.012, UV_MISC[1] + 0.012)), :, :3] = BRASS * 1.1
col[..., :3] = np.clip(col[..., :3], 0, 1); col[..., 3] = 1
nrm[rows((0.0, UV_OUTER[0] - 0.008)), :, :3] = (0.5, 0.5, 1.0); nrm[..., 3] = 1

def save_png(name, arr, colorspace):
    """Scrive il PNG con i byte già nello spazio finale: Image.save() su un
    buffer float non applica la OETF sRGB, quindi per il base color la
    codifica lineare->sRGB la facciamo qui (la normal map resta grezza)."""
    if colorspace == "sRGB":
        arr = arr.copy()
        c = np.clip(arr[..., :3], 0, 1)
        arr[..., :3] = np.where(c <= 0.0031308, 12.92 * c, 1.055 * np.power(c, 1 / 2.4) - 0.055)
    img = bpy.data.images.new(name, TEX, TEX, float_buffer=True)
    img.colorspace_settings.name = "Non-Color"
    img.pixels = arr.ravel().tolist()
    path = os.path.join(TMP_DIR, name + ".png")
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    bpy.data.images.remove(img)
    img = bpy.data.images.load(path)
    img.colorspace_settings.name = colorspace
    return img

tex_c = save_png(f"bell-{HANDLE}-basecolor", col, "sRGB")
tex_n = save_png(f"bell-{HANDLE}-normal", nrm, "Non-Color")

# ----------------------------------------------------------------------------
# 6. Materiale finale ed export. Base color ed emissive usano la stessa
#    texture: emissiveFactor = EMISSIVE_STRENGTH (esportato come fattore).
# ----------------------------------------------------------------------------
nt.nodes.remove(bake_node)
n_c = nt.nodes.new("ShaderNodeTexImage"); n_c.image = tex_c
n_n = nt.nodes.new("ShaderNodeTexImage"); n_n.image = tex_n
nmap = nt.nodes.new("ShaderNodeNormalMap"); nmap.inputs["Strength"].default_value = 1.0
nt.links.new(n_c.outputs["Color"], bsdf.inputs["Base Color"])
nt.links.new(n_c.outputs["Color"], bsdf.inputs["Emission Color"])
nt.links.new(n_n.outputs["Color"], nmap.inputs["Color"])
nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
bsdf.inputs["Metallic"].default_value = METALLIC
bsdf.inputs["Roughness"].default_value = ROUGHNESS
bsdf.inputs["Emission Strength"].default_value = EMISSIVE_STRENGTH

wanted = dict(
    filepath=OUT_GLB, export_format="GLB", export_yup=True, export_apply=True,
    use_selection=True, export_animations=False, export_skins=False, export_morph=False,
    export_extras=False, export_cameras=False, export_lights=False,
    export_draco_mesh_compression_enable=False, export_texcoords=True, export_normals=True,
    export_tangents=False, export_materials="EXPORT", export_vertex_color="NONE",
    export_image_format="WEBP", export_image_quality=82, export_jpeg_quality=82,
    export_image_add_webp=False, export_image_webp_fallback=False,
)
props = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
kwargs = {k: v for k, v in wanted.items() if k in props}
skipped = sorted(set(wanted) - set(kwargs))
if skipped:
    print("EXPORT: parametri ignorati (assenti in questa versione):", skipped)
bpy.ops.object.select_all(action="DESELECT")
obj.select_set(True); bpy.context.view_layer.objects.active = obj
bpy.ops.export_scene.gltf(**kwargs)
print("EXPORTED", OUT_GLB)
