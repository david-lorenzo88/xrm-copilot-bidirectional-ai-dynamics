# Session deck

`Building-the-Bridge.pptx` is generated from the event template
(`../AIERP_Summit_2026_Template.pptx`) by `build_deck.py`. Do not hand-edit the .pptx if you
want to keep regenerating it: change the content in `build_deck.py` and rebuild.

```bash
pip install python-pptx pillow
python deck/build_deck.py
```

- `build_deck.py`: one function per slide (text, speaker notes, code snippets, diagram).
- `pptx_kit.py`: helpers to duplicate template slides, replace text while keeping the
  template's formatting, and draw native shapes (code panels, arrows, boxes).
- `assets/speaker-frame.png`: speaker photo in the template's rounded glow frame (background
  replaced; `assets/speaker.jpg` is the plain crop). `assets/qr-repo.png`: QR code to this repo.
- `assets/screenshots/<name>.png`: demo screenshots. When a file exists it replaces the
  placeholder on the matching recap slide: `beat1-grounded`, `beat2-operate`, `beat3-dashboard`.

Template fonts are Segoe UI and Roboto. Check the final layout in PowerPoint, since renders
on machines without those fonts are approximate.
