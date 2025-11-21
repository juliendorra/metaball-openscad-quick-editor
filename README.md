# Metaball OpenSCAD Quick Editor

A browser-only metaball sketchpad that outputs BOSL2-friendly OpenSCAD code.

## How to
- Clone or download this repo.
- Serve the folder statically (for example: `python -m http.server 8000`) or open `index.html` directly in a modern browser.
- Add, duplicate or split metaballs.
- select a metaball and drag it in any orthographic view, 
- when selected, scroll change the metaball radius
- create negative metaballs or switch polarity to create a negative field
- Context menu (secondary click) gives you quick access to actions.
- Adjust threshold/resolution, then copy the generated code into OpenSCAD.

## OpenSCAD usage
- The output includes `BOSL2/std.scad` and `BOSL2/isosurface.scad`; ensure BOSL2 is installed or reachable via `OPENSCADPATH`.
- The `spec` list is expressed as `move(...)` transforms with `mb_sphere()` entries and polarity flags for negatives.
- `bounding_box`, `voxel_size`, and `isovalue` are emitted; tweak them directly in the copied snippet as needed.
- For example you can try a smaller `voxel_size`: it takes longer to render, but makes the rendered surface smoother
- You can paste prior output into the textarea or drop the `.scad` file in the window, and then click **Import from SCAD** to load the metaballs and resume editing.
