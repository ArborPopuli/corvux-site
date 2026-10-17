# Corvux — corvux.dpdns.org

Personal site. **English + Latin only** (no Chinese in rendered content).

## Design lineage

| Layer | Source | What was taken |
|---|---|---|
| Layout skeleton | GitHub Universe '26 | Giant wordmark spanning full width, hairline grid, tabular info blocks, single accent colour, Mona Sans typeface |
| Atmosphere | Rhine Lab (`rhine-lab-art` / `RhineLabUI`) | Crystal spine, magenta point-cloud, dark lab field, wide-tracked mono captions |
| Section form | Rhine Lab `archive` | Card-array presentation → reused as **ARXIVS** (A/R/X/I/V/S), content swapped to research entries |

## What is 1:1 from the original

Everything below is carried over verbatim from the reverse-engineered source
(see `_research/SPINE-SPEC.md` for the byte-offset evidence trail):

- **Spine**: 40 nodes, `y = -0.65·i + 4`, `rotation.y = 0.4·i`, `scale = 3.5`,
  `position = [0, 3.446, 0]`. Nodes overlap ~45% (scale applies before offset).
- **Spine geometry**: `public/assets/geometry/spine/spine.json` — the original
  `spine.bin` decompressed (4244 triangles / 12732 vertices).
- **Spine material**: original `SpineShader` GLSL (FBR + matcap + MRO + normal map).
  Uniforms: `uColor #d1fff4`, `uNormalStrength 0.19`, `uLight [1,1,1,0.4]`,
  `uReflection [2.7, 0.85]`.
- **Particles**: 65536 points — the original `flower_spine-256.bin` decoded with
  DracoPy. **Must stay on the 256 tier**: the 512/1024 files are a *different,
  flattened* shape, not a denser version of the same point cloud.
  Per-point colour comes from the point cloud itself (magenta-violet, mean
  `0.290 / 0.139 / 0.243`).
- **Particle shader**: `gl_PointSize = 0.0275 · DPR · 2.0 · vScale · (1000/dist) · uSizeBias`,
  `uSizeBias = 1.0`, `rgb2hsv → hue jitter → saturation → hsv2rgb → sparkle →
  distance dim → pow(1.4)`, flower `rotation.y = 100°` fixed.
- **Bloom**: `UnrealBloomPass(0.5, 0.5, 0)` + a `pow(bloom, 1.8)` composite pass.
- **Camera**: fov 35, distance ≈ 9.6 from the axis.

## Deliberate deviations

| Deviation | Why |
|---|---|
| 3D is a full-bleed background, not the whole scene | The wordmark and text sit on top of it |
| `camera.lookAt` follows scroll | Drives the corridor; original has a fixed 7-target camera rig |
| Pointer parallax added | Original `moveXY = [0, 0]` (no parallax) — this is an enhancement |
| `900/dist` + `clamp(15)` on point size | Original uses `1000/dist` with no cap; at our camera distance a few points sit nearly on the lens and blow up into giant blobs |
| Matte canvas panels for 3D boards | Original uses WebGL text; canvas keeps text crisp and controllable |
| `coreLine` (central energy line) | Not in the original — our addition |

## Run

```sh
node serve.mjs          # http://127.0.0.1:4177/
```

No build step. Plain ES modules + vendored Three.js (`vendor/`).

## Structure

```
index.html
src/main.js          content data, injection, clock, reveal, mail obfuscation
src/scene.js         Three.js: spine, particles, panels, bloom, scroll corridor
src/spine-shader.js  1:1 SpineShader GLSL (FBR chain)
src/style.css        design tokens + layout
serve.mjs            static server (maps /fonts /assets /images → public/)
public/
  assets/geometry/spine/spine.json
  assets/geometry/particles/flower_spine.bin
  assets/images/pbr/*.png, assets/images/room/matcap-test.jpg
  fonts/MonaSans*.woff2
vendor/three/        Three.js r183 + loaders + postprocessing
_research/           reverse-engineering specs + verification reports
```

## Research notes

- `_research/SPINE-SPEC.md` — full parameter spec (10 chapters, byte-offset index)
- `_research/VERIFY-SPINE.md` — independent QA, round-by-round fidelity scoring
- `_research/ARXIVS-SPEC.md` — archive-array geometry and the ARXIVS adaptation

## Licence

Site code: ours. Third-party assets retain their own terms — the spine geometry
and point cloud come from `reverieach/rhine-lab-art`, whose `THIRD_PARTY_NOTICES.md`
states the Active Theory runtime is publicly downloadable but **not** released
under a unified open licence. This site is non-commercial and personal; it is not
a redistribution of that project.
