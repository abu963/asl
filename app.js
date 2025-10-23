// app.js
// هدف: عند الضغط على أي style (من JSON) نطبق تأثير glossy/bevel عالي الجودة تقريبي على النص أو داخل صورة شفافة.
// يعتمد التطبيق على avg_color في JSON (أو أول candidate).

const DEFAULT_JSON = 'droos-style-parsed-colors.json'; // ضع هذا الملف بجانب html إن أردت استخدامه مباشرة

// DOM
const jsonFile = document.getElementById('jsonFile');
const loadSample = document.getElementById('loadSample');
const jsonInfo = document.getElementById('jsonInfo');
const stylesGrid = document.getElementById('stylesGrid');

const textInput = document.getElementById('textInput');
const fontSelect = document.getElementById('fontSelect');
const fontSize = document.getElementById('fontSize');
const applyText = document.getElementById('applyText');

const imageFile = document.getElementById('imageFile');
const clearImage = document.getElementById('clearImage');

const previewCanvas = document.getElementById('previewCanvas');
const ctx = previewCanvas.getContext('2d');

const downloadBtn = document.getElementById('downloadBtn');
const logEl = document.getElementById('log');

let appState = {
  stylesData: null,
  currentStyle: null,
  mode: 'text',
  sampleText: textInput.value || 'النص التجريبي',
  font: fontSelect.value,
  fontPx: Number(fontSize.value) || 140,
  image: null
};

// helpers
function log(msg){ logEl.textContent = msg || ''; }
function rgbFromHex(h){
  const hx = (h||'#ffffff').replace('#','');
  return [parseInt(hx.slice(0,2),16), parseInt(hx.slice(2,4),16), parseInt(hx.slice(4,6),16)];
}
function lerp(a,b,t){ return a + (b-a)*t; }
function brighten(hex, amount){ // amount -0.5..1
  const [r,g,b] = rgbFromHex(hex);
  return '#' + [r,g,b].map(c => Math.max(0, Math.min(255, Math.round(c + 255*amount)))).map(x=>x.toString(16).padStart(2,'0')).join('');
}
function darken(hex, amount){
  const [r,g,b] = rgbFromHex(hex);
  return '#' + [r,g,b].map(c => Math.max(0, Math.min(255, Math.round(c * (1-amount))))).map(x=>x.toString(16).padStart(2,'0')).join('');
}

// render a thumbnail representing a glossy beveled tile for given hex color
function renderThumbToCanvas(hex, canvas){
  const w = canvas.width = canvas.clientWidth * devicePixelRatio;
  const h = canvas.height = canvas.clientHeight * devicePixelRatio;
  const c = canvas.getContext('2d');
  c.clearRect(0,0,w,h);

  // base gradient
  const g = c.createLinearGradient(0,0,0,h);
  g.addColorStop(0, brighten(hex, 0.12));
  g.addColorStop(0.5, hex);
  g.addColorStop(1, darken(hex, 0.18));
  c.fillStyle = g;
  c.fillRect(0,0,w,h);

  // inner bevel: draw highlight at top-left and shadow at bottom-right
  // highlight
  c.save();
  c.globalCompositeOperation = 'overlay';
  const hg = c.createLinearGradient(0,0,w,0);
  hg.addColorStop(0,'rgba(255,255,255,0.35)');
  hg.addColorStop(0.5,'rgba(255,255,255,0.02)');
  c.fillStyle = hg;
  c.fillRect(0,0,w,h*0.45);
  c.restore();

  // specular small shine
  c.beginPath();
  c.fillStyle = 'rgba(255,255,255,0.45)';
  const sx = w*0.25, sy = h*0.2, sr = Math.min(w,h)*0.14;
  c.ellipse(sx, sy, sr, sr*0.6, 0, 0, Math.PI*2);
  c.fill();

  // soft inner shadow (to simulate emboss)
  c.save();
  c.globalCompositeOperation = 'multiply';
  const sh = c.createLinearGradient(0,0,0,h);
  sh.addColorStop(0,'rgba(0,0,0,0.12)');
  sh.addColorStop(1,'rgba(0,0,0,0.35)');
  c.fillStyle = sh;
  c.fillRect(0,0,w,h);
  c.restore();

  // subtle border
  c.strokeStyle = 'rgba(0,0,0,0.25)';
  c.lineWidth = Math.max(1 * devicePixelRatio,1);
  c.strokeRect(0.5,0.5,w-1,h-1);
}

// build grid UI
function buildGridFromData(data){
  stylesGrid.innerHTML = '';
  const arr = data.styles || [];
  if(arr.length === 0){
    stylesGrid.innerHTML = '<div class="muted">لا توجد أنماط في JSON</div>';
    return;
  }
  arr.forEach(s => {
    const tile = document.createElement('div');
    tile.className = 'style-tile';
    const canvas = document.createElement('canvas');
    canvas.className = 'thumb-canvas';
    // small physical size; will be drawn by renderThumbToCanvas
    const name = document.createElement('div');
    name.className = 'style-name';
    name.textContent = s.name || s.id || (s.file || 'style');
    tile.appendChild(canvas);
    tile.appendChild(name);

    // choose color source: avg_color.hex or first candidate
    const hex = (s.avg_color && s.avg_color.hex) || (s.candidates && s.candidates.length && s.candidates[0].hex) || '#7ab7ff';
    // render thumbnail
    // ensure canvas sizes reflect CSS
    setTimeout(()=>renderThumbToCanvas(hex, canvas), 20);

    tile.addEventListener('click', ()=> {
      appState.currentStyle = s;
      log(`طبقت الستايل: ${s.name || s.id} — ${hex}`);
      applyStyleToPreview(s);
    });
    stylesGrid.appendChild(tile);
  });
}

// apply style: generate a glossy/bevel rendering on the main preview canvas
function applyStyleToPreview(style){
  // choose hex color
  const hex = (style.avg_color && style.avg_color.hex) || (style.candidates && style.candidates.length && style.candidates[0].hex) || '#4fb3ff';
  // clear
  ctx.clearRect(0,0,previewCanvas.width, previewCanvas.height);
  // transparent background (keep canvas transparent if image mode and image absent)
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0)';
  ctx.fillRect(0,0,previewCanvas.width, previewCanvas.height);
  ctx.restore();

  // if image mode and image exists: draw recolored image preserving alpha
  if(appState.mode === 'image' && appState.image){
    // fit image
    const img = appState.image;
    const [dw, dh] = fitToCanvas(img.width, img.height, previewCanvas.width*0.9, previewCanvas.height*0.9);
    const dx = (previewCanvas.width - dw)/2;
    const dy = (previewCanvas.height - dh)/2;
    // draw original to tmp
    const tmp = document.createElement('canvas'); tmp.width = dw; tmp.height = dh;
    const tctx = tmp.getContext('2d'); tctx.drawImage(img, 0,0,dw,dh);
    // create colored layer
    const tmp2 = document.createElement('canvas'); tmp2.width = dw; tmp2.height = dh;
    const t2 = tmp2.getContext('2d');
    // fill with gradient derived from hex
    const g = t2.createLinearGradient(0,0,0,dh);
    g.addColorStop(0, brighten(hex, 0.18));
    g.addColorStop(0.5, hex);
    g.addColorStop(1, darken(hex, 0.22));
    t2.fillStyle = g; t2.fillRect(0,0,dw,dh);
    // keep alpha of original image
    t2.globalCompositeOperation = 'destination-in';
    t2.drawImage(tmp, 0,0);
    // draw result
    ctx.drawImage(tmp2, dx, dy);
    // add highlights for bevel
    drawSpecularOnRect(ctx, dx, dy, dw, dh, hex);
  } else {
    // text mode: draw text with glossy bevel effect centered
    const text = appState.sampleText || textInput.value || 'النص التجريبي';
    const font = `${appState.fontPx}px ${appState.font}`;
    ctx.save();
    // clear and set layout
    ctx.fillStyle = '#0000'; ctx.fillRect(0,0,previewCanvas.width, previewCanvas.height);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = font;
    // measure
    const metrics = ctx.measureText(text);
    const textW = metrics.width;
    const textH = appState.fontPx * 1.05;
    const x = previewCanvas.width/2;
    const y = previewCanvas.height/2;

    // create text mask on temp canvas
    const tmp = document.createElement('canvas'); tmp.width = previewCanvas.width; tmp.height = previewCanvas.height;
    const tctx = tmp.getContext('2d');
    tctx.clearRect(0,0,tmp.width,tmp.height);
    tctx.font = font; tctx.textAlign = 'center'; tctx.textBaseline = 'middle';
    // draw filled white text as mask
    tctx.fillStyle = '#fff';
    tctx.fillText(text, x, y);

    // base colored layer
    const layer = document.createElement('canvas'); layer.width = tmp.width; layer.height = tmp.height;
    const lctx = layer.getContext('2d');
    const g = lctx.createLinearGradient(0,y-textH,0,y+textH);
    g.addColorStop(0, brighten(hex, 0.18));
    g.addColorStop(0.45, hex);
    g.addColorStop(1, darken(hex, 0.24));
    lctx.fillStyle = g;
    lctx.fillRect(0,0,layer.width, layer.height);

    // apply mask: keep text alpha
    lctx.globalCompositeOperation = 'destination-in';
    lctx.drawImage(tmp, 0,0);

    // draw base to main
    ctx.drawImage(layer, 0,0);

    // inner bevel / emboss simulation: draw highlight & shadow by offsetting masked text
    const bevelSize = Math.max(4, Math.round(appState.fontPx * 0.04));
    // highlight (top-left)
    const hight = document.createElement('canvas'); hight.width = tmp.width; hight.height = tmp.height;
    const hctx = hight.getContext('2d');
    hctx.fillStyle = 'rgba(255,255,255,0.55)';
    hctx.shadowColor = 'rgba(255,255,255,0.6)';
    hctx.shadowBlur = bevelSize*1.8;
    hctx.shadowOffsetX = -bevelSize*0.4; hctx.shadowOffsetY = -bevelSize*0.8;
    hctx.globalCompositeOperation = 'source-over';
    hctx.drawImage(tmp, 0,0);
    // convert to mask
    hctx.globalCompositeOperation = 'destination-in';
    hctx.drawImage(tmp, 0,0);

    ctx.drawImage(hight, 0,0);

    // shadow (bottom-right)
    const sh = document.createElement('canvas'); sh.width = tmp.width; sh.height = tmp.height;
    const shctx = sh.getContext('2d');
    shctx.fillStyle = 'rgba(0,0,0,0.6)';
    shctx.shadowColor = 'rgba(0,0,0,0.6)';
    shctx.shadowBlur = bevelSize*1.8;
    shctx.shadowOffsetX = bevelSize*0.6; shctx.shadowOffsetY = bevelSize*0.9;
    shctx.drawImage(tmp, 0,0);
    shctx.globalCompositeOperation = 'destination-in';
    shctx.drawImage(tmp, 0,0);
    ctx.drawImage(sh, 0,0);

    // specular highlight: mirrored shiny stroke
    drawSpecularOnText(ctx, tmp, x, y, appState.fontPx, hex);

    // small outer stroke for separation
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.lineWidth = Math.max(2, appState.fontPx * 0.03);
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.strokeText(text, x, y);
    ctx.restore();

    ctx.restore();
  }
}

// draw specular highlight on rectangle-like image (used for thumbnails / images)
function drawSpecularOnRect(cctx, dx, dy, dw, dh, hex){
  cctx.save();
  cctx.globalCompositeOperation = 'lighter';
  const glare = cctx.createLinearGradient(dx, dy, dx, dy + dh*0.6);
  glare.addColorStop(0, 'rgba(255,255,255,0.65)');
  glare.addColorStop(0.15, 'rgba(255,255,255,0.18)');
  glare.addColorStop(0.6, 'rgba(255,255,255,0.02)');
  cctx.fillStyle = glare;
  cctx.fillRect(dx, dy, dw, dh*0.45);

  // small specular circle
  cctx.beginPath();
  cctx.fillStyle = 'rgba(255,255,255,0.45)';
  cctx.ellipse(dx + dw*0.22, dy + dh*0.20, dw*0.09, dh*0.05, 0, 0, Math.PI*2);
  cctx.fill();
  cctx.restore();
}

// draw specular based on masked text to add glossy streaks
function drawSpecularOnText(mainCtx, maskCanvas, cx, cy, fontPx, hex){
  // draw a thin white stroke with gradient and blur
  mainCtx.save();
  // create an offscreen to draw streaks
  const w = maskCanvas.width, h = maskCanvas.height;
  const off = document.createElement('canvas'); off.width = w; off.height = h;
  const oc = off.getContext('2d');
  oc.clearRect(0,0,w,h);
  // draw thin white horizontal band across top third of mask
  oc.globalCompositeOperation = 'source-over';
  oc.fillStyle = 'rgba(255,255,255,0.9)';
  const bandH = Math.max(8, Math.round(fontPx * 0.12));
  const bandY = Math.round(cy - fontPx*0.38);
  oc.fillRect(0, bandY, w, bandH);

  // mask band to text shape
  oc.globalCompositeOperation = 'destination-in';
  oc.drawImage(maskCanvas, 0,0);

  // blur the offscreen by repeatedly drawing with globalAlpha (simple blur)
  for(let i=0;i<6;i++){
    mainCtx.globalAlpha = 0.12;
    mainCtx.drawImage(off, 0,0);
  }
  mainCtx.globalAlpha = 1;
  mainCtx.drawImage(off, 0,0);
  mainCtx.restore();
}

// utilities
function fitToCanvas(w, h, maxW, maxH){
  const r = Math.min(maxW / w, maxH / h, 1);
  return [Math.round(w * r), Math.round(h * r)];
}

// events

// load JSON file uploaded by user
jsonFile.addEventListener('change', async (e)=>{
  const f = e.target.files && e.target.files[0];
  if(!f) return;
  const txt = await f.text();
  try{
    const data = JSON.parse(txt);
    appState.stylesData = data;
    jsonInfo.textContent = `حملت JSON — ${ (data.styles && data.styles.length) || 0 } أنماط`;
    buildGridFromData(data);
    log('تم تحميل JSON');
  } catch(err){
    log('خطأ بقراءة JSON');
    console.error(err);
  }
});

// load sample json (if file placed)
loadSample.addEventListener('click', async ()=>{
  try{
    const res = await fetch(DEFAULT_JSON);
    if(!res.ok){ log('لا يوجد JSON افتراضي موجود'); return; }
    const data = await res.json();
    appState.stylesData = data;
    jsonInfo.textContent = `استخدم JSON المضمّن — ${ (data.styles && data.styles.length) || 0 } أنماط`;
    buildGridFromData(data);
    log('استخدمت JSON الافتراضي');
  } catch(err){
    log('فشل في تحميل JSON الافتراضي');
    console.error(err);
  }
});

applyText.addEventListener('click', ()=>{
  appState.sampleText = textInput.value || '';
  appState.font = fontSelect.value;
  appState.fontPx = Number(fontSize.value) || 140;
  if(appState.currentStyle){
    applyStyleToPreview(appState.currentStyle);
  } else {
    drawPlainPreview();
  }
});

// image upload
imageFile.addEventListener('change', (e)=>{
  const f = e.target.files && e.target.files[0];
  if(!f) return;
  const img = new Image();
  img.onload = ()=> {
    appState.image = img;
    if(appState.currentStyle) applyStyleToPreview(appState.currentStyle);
    else drawPlainPreview();
  };
  img.onerror = ()=> { log('فشل تحميل الصورة'); };
  img.src = URL.createObjectURL(f);
});

clearImage.addEventListener('click', ()=>{
  appState.image = null;
  imageFile.value = '';
  drawPlainPreview();
});

// mode radio change
document.querySelectorAll('input[name="mode"]').forEach(r=>{
  r.addEventListener('change', ()=> {
    appState.mode = r.value;
    if(appState.currentStyle) applyStyleToPreview(appState.currentStyle);
    else drawPlainPreview();
  });
});

// download
downloadBtn.addEventListener('click', ()=>{
  const link = document.createElement('a');
  link.href = previewCanvas.toDataURL('image/png');
  link.download = 'asl_applied.png';
  link.click();
});

// initial plain preview
function drawPlainPreview(){
  ctx.clearRect(0,0,previewCanvas.width, previewCanvas.height);
  ctx.fillStyle = '#071022';
  ctx.fillRect(0,0,previewCanvas.width, previewCanvas.height);
  // draw text sample
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `${appState.fontPx}px ${appState.font}`;
  ctx.fillText(appState.sampleText || 'النص التجريبي', previewCanvas.width/2, previewCanvas.height/2);
  ctx.restore();
}
drawPlainPreview();

// small helper to build grid if data exists (used when JSON loaded)
function buildGridFromData(data){ buildGridFromDataInner(data); }
function buildGridFromDataInner(data){
  stylesGrid.innerHTML = '';
  const arr = data.styles || [];
  if(arr.length === 0){
    stylesGrid.innerHTML = '<div class="muted">لا توجد أنماط في JSON</div>';
    return;
  }
  arr.forEach(s => {
    const tile = document.createElement('div'); tile.className = 'style-tile';
    const canvas = document.createElement('canvas'); canvas.className = 'thumb-canvas';
    // small size in CSS; set pixel ratio-aware size
    // append then render
    const name = document.createElement('div'); name.className = 'style-name'; name.textContent = s.name || s.id || 'unnamed';
    tile.appendChild(canvas); tile.appendChild(name);
    stylesGrid.appendChild(tile);
    // choose color
    const hex = (s.avg_color && s.avg_color.hex) || (s.candidates && s.candidates.length && s.candidates[0].hex) || '#3aa0ff';
    // ensure correct CSS -> physical size
    requestAnimationFrame(()=> {
      // set canvas CSS pixel size
      canvas.width = canvas.clientWidth * devicePixelRatio;
      canvas.height = canvas.clientHeight * devicePixelRatio;
      renderThumbToCanvas(hex, canvas);
    });

    tile.addEventListener('click', ()=> {
      appState.currentStyle = s;
      applyStyleToPreview(s);
      log(`طبق الستايل: ${s.name || s.id}`);
    });
  });
  }
