#!/usr/bin/env python3
"""Müller-Brockmann editorial grid scaffold generator."""
import argparse
import sys


def build(cfg):
    c = cfg
    lh = c.baseline * 3
    css = f""":root{{
  --cols:{c.cols};
  --bl:{c.baseline}px;
  --lh:{lh}px;
  --gutter:{c.gutter}px;
  --margin:{c.margin}px;
  --pad:{c.baseline*12}px;
  --maxw:{c.maxw}px;
  --paper:#ffffff;
  --ink:#111315;
  --ink-soft:#5b6066;
  --accent:{c.accent};
  --g-col:rgba(228,0,43,.075);
  --g-edge:rgba(228,0,43,.40);
  --g-base:rgba(0,150,140,.34);
  --g-base-min:rgba(0,150,140,.12);
}}
*{{box-sizing:border-box;}}
body{{margin:0;background:var(--paper);color:var(--ink);
  font-family:"Archivo",system-ui,sans-serif;font-size:16px;line-height:var(--lh);
  -webkit-font-smoothing:antialiased;}}
img{{display:block;width:100%;height:100%;object-fit:cover;}}
.spread{{position:relative;width:100%;}}
.wrap{{position:relative;max-width:var(--maxw);margin:0 auto;padding:var(--pad) var(--margin);}}
.grid{{display:grid;grid-template-columns:repeat(var(--cols),1fr);
  column-gap:var(--gutter);row-gap:var(--lh);}}
.band{{grid-column:1 / -1;display:grid;grid-template-columns:subgrid;
  column-gap:var(--gutter);row-gap:var(--lh);align-items:start;}}
@supports not (grid-template-columns:subgrid){{
  .band{{grid-template-columns:repeat(var(--cols),1fr);}}
}}
.guides{{position:absolute;inset:0;pointer-events:none;z-index:60;opacity:0;
  transition:opacity .26s ease;}}
body.grid-on .guides{{opacity:1;}}
.guides .cols{{position:absolute;top:0;bottom:0;left:var(--margin);right:var(--margin);
  display:grid;grid-template-columns:repeat(var(--cols),1fr);column-gap:var(--gutter);}}
.guides .col{{background:var(--g-col);
  box-shadow:inset 1px 0 0 var(--g-edge),inset -1px 0 0 var(--g-edge);position:relative;}}
.guides .col span{{position:absolute;top:{c.baseline*4}px;left:0;right:0;text-align:center;
  font-family:"Space Mono",monospace;font-size:10px;line-height:1;color:var(--accent);}}
.guides .rows{{position:absolute;left:var(--margin);right:var(--margin);top:var(--pad);bottom:0;
  background-image:
    repeating-linear-gradient(to bottom,var(--g-base) 0 1px,transparent 1px var(--lh)),
    repeating-linear-gradient(to bottom,var(--g-base-min) 0 1px,transparent 1px var(--bl));}}
.guides .mline{{position:absolute;top:0;bottom:0;width:1px;background:var(--g-edge);}}
.guides .mline.l{{left:var(--margin);}} .guides .mline.r{{right:var(--margin);}}
.toggle{{position:fixed;top:18px;right:18px;z-index:200;display:flex;align-items:center;gap:10px;
  background:var(--ink);color:#fff;border:none;cursor:pointer;font-family:"Space Mono",monospace;
  font-size:12px;letter-spacing:.14em;text-transform:uppercase;padding:11px 14px;}}
.toggle .dot{{width:9px;height:9px;border-radius:50%;background:#555;}}
body.grid-on .toggle{{background:var(--accent);}} body.grid-on .toggle .dot{{background:#fff;}}"""

    js = """var btn=document.getElementById('gridToggle');
function setGrid(on){document.body.classList.toggle('grid-on',on);
  if(btn){btn.setAttribute('aria-pressed',on?'true':'false');
    var l=btn.querySelector('.lbl'); if(l) l.textContent=on?'Hide grid':'Show grid';}}
if(btn) btn.addEventListener('click',function(){setGrid(!document.body.classList.contains('grid-on'));});
document.addEventListener('keydown',function(e){
  if((e.key==='g'||e.key==='G')&&!e.metaKey&&!e.ctrlKey&&!e.altKey){
    setGrid(!document.body.classList.contains('grid-on'));}});
document.querySelectorAll('.guides .cols').forEach(function(h){
  var n=getComputedStyle(document.documentElement).getPropertyValue('--cols').trim()||'12';
  for(var i=1;i<=parseInt(n,10);i++){var c=document.createElement('div');c.className='col';
    var s=document.createElement('span');s.textContent=i;c.appendChild(s);h.appendChild(c);}});
(function(){
  var cvs=document.createElement('canvas'),ctx=cvs.getContext('2d');
  var sel='.masthead, .numeral, .shead h2, .h2b';
  function align(){
    document.querySelectorAll(sel).forEach(function(el){
      el.style.marginLeft='0px';
      var cs=getComputedStyle(el),ch=(el.textContent||'').trim().charAt(0); if(!ch) return;
      if(cs.textTransform==='uppercase') ch=ch.toUpperCase();
      ctx.font=cs.fontStyle+' '+cs.fontWeight+' '+cs.fontSize+' '+cs.fontFamily;
      ctx.textAlign='left';
      var abl=ctx.measureText(ch).actualBoundingBoxLeft;
      if(isFinite(abl)) el.style.marginLeft=abl.toFixed(2)+'px';
    });
  }
  if(document.fonts&&document.fonts.ready){document.fonts.ready.then(align);}
  align();
  var t;window.addEventListener('resize',function(){clearTimeout(t);t=setTimeout(align,120);});
})();"""

    band = """      <div class="band">
        <div style="grid-column:1 / 6;"></div>
        <figure style="grid-column:6 / 13;"></figure>
      </div>"""

    overlay = """    <div class="guides" aria-hidden="true">
      <div class="cols"></div><div class="rows"></div>
      <div class="mline l"></div><div class="mline r"></div>
    </div>"""

    if cfg.scaffold:
        return f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Editorial — modular grid</title>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@300;400;500;600;700;800;900&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet">
<style>
{css}
</style></head>
<body>
<button class="toggle" id="gridToggle" aria-pressed="false"><span class="dot"></span><span class="lbl">Show grid</span></button>
<section class="spread">
  <div class="wrap">
    <div class="grid">
{band}
    </div>
{overlay}
  </div>
</section>
<script>
{js}
</script>
</body></html>"""
    return (
        "/* ===== CSS ===== */\n" + css
        + "\n\n/* ===== JS ===== */\n" + js
        + "\n\n/* ===== band ===== */\n" + band
        + "\n\n/* ===== overlay ===== */\n" + overlay + "\n"
    )


def main():
    ap = argparse.ArgumentParser(description="Müller-Brockmann editorial grid scaffold")
    ap.add_argument("--cols", type=int, default=12)
    ap.add_argument("--baseline", type=int, default=8)
    ap.add_argument("--gutter", type=int, default=24)
    ap.add_argument("--margin", type=int, default=72)
    ap.add_argument("--maxw", type=int, default=1296)
    ap.add_argument("--accent", default="#e4002b")
    ap.add_argument("--scaffold", action="store_true")
    cfg = ap.parse_args()
    for name, v in (("gutter", cfg.gutter), ("margin", cfg.margin)):
        if v % cfg.baseline != 0:
            print(
                f"# WARNING: --{name} ({v}) is not a multiple of --baseline ({cfg.baseline})",
                file=sys.stderr,
            )
    sys.stdout.write(build(cfg) + "\n")


if __name__ == "__main__":
    main()
