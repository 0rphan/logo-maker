# NVP Logo Maker

A static web app for making 3D-printable logo stands in the style of the **מסד הארץ** stand.
You type the text, pick a font and colors, and choose which letters print separately with pegs. Then you download a 3MF for Bambu Studio.

Everything runs in the browser, so there is no server to set up. It's ready to host on GitHub Pages.

## What stays fixed

- **Base and arm.** These are the exact meshes from `Massad_Logo_Stroke_PRINT_pegged.3mf`, including the 14 mm arm.
- **Connector block and slot.** These sit under the logo, in the same position relative to the stand.
- **Layer heights.** The connector block is 0–8 mm, the background plate is 8–14 mm and the letters are 14–18 mm.

## What you can change

| Setting | Notes |
|---|---|
| Text | Hebrew is laid out right-to-left. Latin letters and digits inside the text are kept left-to-right. |
| Font | *Original logo letters* uses the exact glyphs from the original model (מ ס ד ה א ר ץ). Other letters fall back to Rubik. You can also pick one of 10 Hebrew Google Fonts or upload a .ttf, .otf or .woff file. |
| Letter height, spacing, word spacing | The site opens in Rubik with 6 mm word spacing. To reproduce the original exactly, type מסד הארץ, choose *Original logo letters*, and set word spacing to 0. Height 25.6 mm and spacing 2.5 mm are already the defaults. |
| Background border | The background is the letters offset outward by this amount (default 4.5 mm), with the gaps filled in. |
| Shift text | Moves the text relative to the stand connector. |
| Colors | Stand, background, the default letter color, and a color per letter. |
| Pegs (per letter) | The letter prints separately, face-up, with the holes on the bed. The holes are short bridges, so no supports are needed. It gets blind holes 2.8 mm wide and 3 mm deep, and the background gets pegs 2.5 mm wide and 2.6 mm tall. Each separate piece of a letter gets 2 pegs, placed automatically where there is enough wall. Thin pieces fall back to 2.0 mm pegs or a single peg, and the app warns you. |

The pegs always use the Letters color. They sit in the same layers as the letters, so they don't add filament swaps.

## Output

- **3MF**: a "Logo" object made of parts (letters, background, pegs), plus the arm, the base and every pegged letter. Each part is assigned a named color.
- **STL zip**: one STL per part, for other slicers.
- **Copy link**: the whole design is stored in the URL, so a link reopens it exactly.

## Publish on GitHub Pages

1. Create a GitHub repository, for example `logo-maker`, and push the contents of this folder to it. `index.html` must be at the repository root.
2. In the repository, open **Settings → Pages → Build and deployment**, choose **Deploy from a branch**, select `main` and `/ (root)`, then click **Save**.
3. After about a minute the site is live at `https://<your-user>.github.io/logo-maker/`.

```bash
cd logo-maker
git init && git add . && git commit -m "Logo maker"
git branch -M main
git remote add origin https://github.com/<your-user>/logo-maker.git
git push -u origin main
```

## Run locally

Browsers block `fetch` for `file://` pages, so serve the folder:

```bash
python -m http.server 8765
```

Then open http://localhost:8765.

## Files

- `index.html`, `css/style.css`: the page.
- `js/main.js`: the UI, the three.js preview, and the export buttons.
- `js/geometry.js`: text outlines, background offset, connector, peg placement and closed-mesh generation.
- `js/export.js`: the 3MF and STL writers.
- `data/stand.json`: the base and arm meshes, connector geometry, and the assembled-pose transforms taken from `3DLOGO_portable.blend`.
- `data/original-glyphs.json`: the original logo's letter outlines, extracted from the print 3MF.

Libraries load from CDNs: three.js 0.160, opentype.js 1.3.4, clipper-lib 6.4.2, JSZip 3.10.1, and fonts from @fontsource.
