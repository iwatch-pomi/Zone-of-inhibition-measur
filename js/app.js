'use strict';

// ── Palette for up to 8 disks ─────────────────────────────────────────────
const DISK_COLORS = [
  '#e53935', '#1e88e5', '#43a047', '#fb8c00',
  '#8e24aa', '#00acc1', '#6d4c41', '#f06292',
];

// ── DOM refs ──────────────────────────────────────────────────────────────
const screens   = {
  capture:    document.getElementById('screen-capture'),
  preview:    document.getElementById('screen-preview'),
  processing: document.getElementById('screen-processing'),
  results:    document.getElementById('screen-results'),
  records:    document.getElementById('screen-records'),
};
const fileInput         = document.getElementById('fileInput');
const previewImg        = document.getElementById('previewImg');
const dishSizeInput     = document.getElementById('dishSize');
const resultCanvas      = document.getElementById('resultCanvas');
const canvasWrap        = document.getElementById('resultCanvasWrap');
const measurementsTbody = document.getElementById('measurementsTbody');
const summaryDisks      = document.getElementById('summaryDisks');
const summaryAvg        = document.getElementById('summaryAvg');
const summaryMin        = document.getElementById('summaryMin');
const summaryMax        = document.getElementById('summaryMax');
const adjustToolbar     = document.getElementById('adjustToolbar');
const adjustHint        = document.getElementById('adjustHint');
const btnAdjust         = document.getElementById('btnAdjust');
const resultsScreen     = document.getElementById('screen-results');
const btnCollapseTop    = document.getElementById('btnCollapseTop');
const btnCollapseBottom = document.getElementById('btnCollapseBottom');
const zoneSlider        = document.getElementById('zoneSlider');
const zoneSliderVal     = document.getElementById('zoneSliderVal');
const zoneSliderWrap    = document.getElementById('zoneSliderWrap');
const zoomLevelEl       = document.getElementById('zoomLevel');
const panControls       = document.getElementById('panControls');

const processor  = new ZoneProcessor();
let lastResult   = null;
let imageCanvas  = null;  // offscreen canvas holding the original image

// ── View state (zoom / pan) ───────────────────────────────────────────────
const viewState = { scale: 1, panX: 0, panY: 0 };

function resetView() {
  viewState.scale = 1; viewState.panX = 0; viewState.panY = 0;
  if (zoomLevelEl) zoomLevelEl.textContent = '1×';
  panControls.style.display = 'none';
}

// Shift the viewport by (dx, dy) in logical canvas pixels.
// Positive dx → image moves right (shows left side); negative → shows right side.
function panBy(dx, dy) {
  if (viewState.scale <= 1) return;
  viewState.panX += dx;
  viewState.panY += dy;
  clampPan();
  drawCanvas();
}

// Zoom around an image-space pivot point (defaults to current view centre).
function applyZoom(factor, pivotX, pivotY) {
  const dpr = window.devicePixelRatio || 1;
  const W = resultCanvas.width / dpr, H = resultCanvas.height / dpr;
  if (pivotX === undefined) {
    pivotX = (W / 2 - viewState.panX) / viewState.scale;
    pivotY = (H / 2 - viewState.panY) / viewState.scale;
  }
  const newScale = Math.max(1, Math.min(8, viewState.scale * factor));
  viewState.panX += pivotX * (viewState.scale - newScale);
  viewState.panY += pivotY * (viewState.scale - newScale);
  viewState.scale = newScale;
  clampPan();
  zoomLevelEl.textContent = viewState.scale <= 1 ? '1×' : viewState.scale.toFixed(1) + '×';
  panControls.style.display = viewState.scale > 1 ? 'grid' : 'none';
  canvasWrap.style.touchAction = viewState.scale > 1 || adjustState.active ? 'none' : '';
  drawCanvas();
}

function clampPan() {
  const dpr = window.devicePixelRatio || 1;
  const s = viewState.scale;
  const W = resultCanvas.width / dpr, H = resultCanvas.height / dpr;
  if (s <= 1) { viewState.panX = 0; viewState.panY = 0; return; }
  viewState.panX = Math.max(W * (1 - s), Math.min(0, viewState.panX));
  viewState.panY = Math.max(H * (1 - s), Math.min(0, viewState.panY));
}

// ── Adjust mode state ─────────────────────────────────────────────────────
const adjustState = {
  active:         false,
  selectedIdx:    null,
  addMode:        false,
  dishAdjustMode: false,
  dishDragMode:   null,   // 'move' | 'resize' | null
  isDragging:     false,
  panMode:        false,
  lastX: 0, lastY: 0,
  lastRawX: 0, lastRawY: 0,
  downX: 0, downY: 0,
  downRawX: 0, downRawY: 0,
};

const btnAddZone    = document.getElementById('btnAddZone');
const btnDeleteZone = document.getElementById('btnDeleteZone');
const btnAdjustDish   = document.getElementById('btnAdjustDish');
const dishSlider      = document.getElementById('dishSlider');
const dishSliderVal   = document.getElementById('dishSliderVal');
const dishSliderWrap  = document.getElementById('dishSliderWrap');
const boundaryNote    = document.getElementById('boundaryNote');
const dishBoundaryNote= document.getElementById('dishBoundaryNote');

// ── Screen transitions ────────────────────────────────────────────────────
function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name].classList.add('active');
  if (name !== 'results') {
    resultsScreen.classList.remove('hide-top', 'hide-bottom');
    btnCollapseTop.textContent    = '▲ 収納';
    btnCollapseBottom.textContent = '▼ 収納';
    exitAdjustMode();
    resetView();
  }
}

// ── Collapse tabs ─────────────────────────────────────────────────────────
btnCollapseTop.addEventListener('click', () => {
  const hidden = resultsScreen.classList.toggle('hide-top');
  btnCollapseTop.textContent = hidden ? '▼ 展開' : '▲ 収納';
});
btnCollapseBottom.addEventListener('click', () => {
  const hidden = resultsScreen.classList.toggle('hide-bottom');
  btnCollapseBottom.textContent = hidden ? '▲ 展開' : '▼ 収納';
});

// ── Zoom buttons ──────────────────────────────────────────────────────────
document.getElementById('btnZoomIn').addEventListener('click',  () => applyZoom(1.6));
document.getElementById('btnZoomOut').addEventListener('click', () => applyZoom(1 / 1.6));
zoomLevelEl.addEventListener('click', () => { resetView(); drawCanvas(); });

// ── Pan buttons (D-pad) ───────────────────────────────────────────────────
// Step = 20% of logical canvas width/height per press.
function panStep() {
  const dpr = window.devicePixelRatio || 1;
  return Math.round(resultCanvas.width / dpr * 0.10);
}
document.getElementById('btnPanUp').addEventListener('click',    () => panBy(0,  panStep()));
document.getElementById('btnPanDown').addEventListener('click',  () => panBy(0, -panStep()));
document.getElementById('btnPanLeft').addEventListener('click',  () => panBy( panStep(), 0));
document.getElementById('btnPanRight').addEventListener('click', () => panBy(-panStep(), 0));

// ── Image capture / upload ────────────────────────────────────────────────
document.getElementById('btnCamera').addEventListener('click', () => {
  fileInput.setAttribute('capture', 'environment');
  fileInput.click();
});
document.getElementById('btnUpload').addEventListener('click', () => {
  fileInput.removeAttribute('capture');
  fileInput.click();
});

fileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file || !file.type.startsWith('image/')) return;
  const url = URL.createObjectURL(file);
  previewImg.onload = () => { URL.revokeObjectURL(url); showScreen('preview'); };
  previewImg.src = url;
  fileInput.value = '';
});

// ── Preview screen ────────────────────────────────────────────────────────
document.getElementById('btnBack').addEventListener('click', () => showScreen('capture'));

document.getElementById('btnAnalyze').addEventListener('click', async () => {
  const dishMm = parseFloat(dishSizeInput.value);
  if (isNaN(dishMm) || dishMm < 20 || dishMm > 300) {
    alert('シャーレの直径を正しく入力してください（20〜300 mm）。');
    return;
  }
  runAnalysis(dishMm);
});

// ── Processing step indicator ─────────────────────────────────────────────
const STEPS = {
  gray:  document.getElementById('step-gray'),
  blur:  document.getElementById('step-blur'),
  dish:  document.getElementById('step-dish'),
  disks: document.getElementById('step-disks'),
  zones: document.getElementById('step-zones'),
};

document.addEventListener('processorStep', (e) => {
  const stepName = e.detail;
  let found = false;
  for (const [key, el] of Object.entries(STEPS)) {
    if (found) break;
    if (key === stepName) { el.classList.add('active'); found = true; }
    else { el.classList.remove('active'); el.classList.add('done'); }
  }
});
function resetSteps() { Object.values(STEPS).forEach(el => el.classList.remove('active', 'done')); }

// ── Main analysis ─────────────────────────────────────────────────────────
async function runAnalysis(dishMm) {
  resetSteps(); exitAdjustMode(); resetView();
  showScreen('processing');
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  try {
    const result = await processor.analyze(previewImg, dishMm);
    result.dishDiamMm = dishMm;   // preserve user-entered dish size for recalculation
    result.measurements.forEach(m => { m.name = `ディスク ${m.id}`; });
    lastResult = result;
    Object.values(STEPS).forEach(el => el.classList.add('done'));
    await new Promise(r => setTimeout(r, 300));
    initResultCanvas(result);
    drawCanvas();
    updateResultsUI();
    showScreen('results');
  } catch (err) {
    console.error(err);
    showScreen('preview');
    const alertBox = document.getElementById('previewAlert');
    alertBox.textContent = `⚠ ${err.message}`;
    alertBox.style.display = 'block';
  }
}

// ── Canvas init ───────────────────────────────────────────────────────────
function initResultCanvas(result) {
  const dpr = window.devicePixelRatio || 1;
  // Scale the drawing buffer by DPR so each logical pixel maps to dpr physical pixels.
  // This eliminates blurriness on Retina/high-DPI displays (e.g. iPad, iPhone).
  resultCanvas.width  = Math.round(result.canvasWidth  * dpr);
  resultCanvas.height = Math.round(result.canvasHeight * dpr);
  // Draw the original image (not the downsampled analysis copy) for maximum sharpness.
  imageCanvas = document.createElement('canvas');
  imageCanvas.width  = resultCanvas.width;
  imageCanvas.height = resultCanvas.height;
  imageCanvas.getContext('2d').drawImage(previewImg, 0, 0, imageCanvas.width, imageCanvas.height);
  resetView();
  // Defer fitCanvas so CSS layout has settled (grid/flex dimensions are final)
  requestAnimationFrame(fitCanvas);
}

// Set canvas CSS dimensions to maintain exact aspect ratio within available space.
// Both X and Y must use the same scale factor so getCanvasCoords() works correctly.
function fitCanvas() {
  if (!lastResult) return;
  const dpr = window.devicePixelRatio || 1;
  const cW = resultCanvas.width  / dpr;  // logical width
  const cH = resultCanvas.height / dpr;  // logical height
  const ratio = cW / cH;
  const isLandscape = window.innerWidth > window.innerHeight;

  let cssW, cssH;
  if (isLandscape) {
    // In landscape grid layout the canvas-wrap cell has defined clientWidth/Height
    const wrapW = canvasWrap.clientWidth  || Math.floor(window.innerWidth  * 0.6);
    const wrapH = canvasWrap.clientHeight || Math.floor(window.innerHeight * 0.88);
    if (wrapW / wrapH > ratio) {
      cssH = wrapH;
      cssW = Math.round(cssH * ratio);
    } else {
      cssW = wrapW;
      cssH = Math.round(cssW / ratio);
    }
  } else {
    // Portrait: full container width, height capped at 55% of viewport
    const maxW = canvasWrap.clientWidth || window.innerWidth;
    const maxH = Math.floor(window.innerHeight * 0.55);
    cssW = maxW;
    cssH = Math.round(cssW / ratio);
    if (cssH > maxH) {
      cssH = maxH;
      cssW = Math.round(cssH * ratio);
    }
  }

  resultCanvas.style.width  = cssW + 'px';
  resultCanvas.style.height = cssH + 'px';
}

// ── Main draw function ────────────────────────────────────────────────────
function drawCanvas(forExport = false) {
  if (!lastResult) return;
  const { dish, measurements, canvasWidth } = lastResult;
  const ctx = resultCanvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  // All annotation coordinates are in logical (analysis) pixel space.
  // Multiply transforms by DPR so they map correctly to the physical buffer.
  const W = resultCanvas.width  / dpr;
  const H = resultCanvas.height / dpr;

  const s  = forExport ? 1 : viewState.scale;
  const px = forExport ? 0 : viewState.panX;
  const py = forExport ? 0 : viewState.panY;

  // Clear physical buffer with identity transform
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, resultCanvas.width, resultCanvas.height);

  // Apply zoom/pan — DPR scaling maps logical coords to sharp physical pixels
  ctx.setTransform(s * dpr, 0, 0, s * dpr, px * dpr, py * dpr);
  if (imageCanvas) ctx.drawImage(imageCanvas, 0, 0, W, H);

  // Petri dish outline
  const inDishMode = adjustState.dishAdjustMode && !forExport;
  ctx.beginPath();
  ctx.arc(dish.cx, dish.cy, dish.r, 0, Math.PI * 2);
  if (inDishMode) {
    ctx.strokeStyle = '#4caf50';
    ctx.lineWidth   = 3;
    ctx.setLineDash([]);
  } else {
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth   = 2;
    ctx.setLineDash([6, 4]);
  }
  ctx.stroke();
  ctx.setLineDash([]);

  // Dish adjust handles (center = move, cardinal edge points = resize)
  if (inDishMode) {
    _drawHandle(ctx, dish.cx, dish.cy, '#4caf50', 'move');
    for (const [hx, hy] of [
      [dish.cx + dish.r, dish.cy],
      [dish.cx - dish.r, dish.cy],
      [dish.cx,          dish.cy - dish.r],
      [dish.cx,          dish.cy + dish.r],
    ]) {
      _drawDishResizeHandle(ctx, hx, hy);
    }
  }

  const inAdjust  = adjustState.active && !forExport;
  const selIdx    = adjustState.selectedIdx;
  const hasSelect = selIdx !== null;

  measurements.forEach((m, i) => {
    const color  = DISK_COLORS[i % DISK_COLORS.length];
    const { cx, cy, r: diskR } = m.disk;
    const zoneR  = m.zoneRadius;
    const isSel  = inAdjust && i === selIdx;
    const dimmed = inAdjust && hasSelect && !isSel;
    const baseAlpha = dimmed ? 0.30 : 0.85;

    // Zone inner fill — very subtle tint so the zone area is identifiable
    ctx.beginPath();
    ctx.arc(cx, cy, zoneR, 0, Math.PI * 2);
    ctx.fillStyle   = color;
    ctx.globalAlpha = dimmed ? 0.02 : 0.06;
    ctx.fill();
    ctx.globalAlpha = 1;

    // Zone border — single stroke at the zone boundary.
    ctx.globalAlpha = baseAlpha;
    ctx.beginPath();
    ctx.arc(cx, cy, zoneR, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth   = isSel ? 2.5 : 2;
    ctx.stroke();

    // Diameter line
    ctx.globalAlpha = dimmed ? 0.2 : 0.65;
    ctx.beginPath();
    ctx.moveTo(cx - zoneR, cy);
    ctx.lineTo(cx + zoneR, cy);
    ctx.strokeStyle = color;
    ctx.lineWidth   = 1;
    ctx.stroke();

    ctx.globalAlpha = 1;

    // Label — two lines: zone name above, diameter below
    const nameLine = m.name || String(i + 1);
    const mmLine   = `${m.zoneDiamMm} mm`;
    const fontSize = Math.max(11, Math.round(canvasWidth / 55));
    ctx.font        = `bold ${fontSize}px sans-serif`;
    ctx.globalAlpha = dimmed ? 0.30 : 1;
    const lx = cx - zoneR + 3;
    const ly2 = cy - 4;
    const ly1 = ly2 - fontSize - 1;
    for (const [line, ly] of [[nameLine, ly1], [mmLine, ly2]]) {
      ctx.lineWidth   = 3;
      ctx.strokeStyle = '#000';
      ctx.strokeText(line, lx, ly);
      ctx.fillStyle   = color;
      ctx.fillText(line, lx, ly);
    }
    ctx.globalAlpha = 1;

    // Center drag handle (selected zone only)
    if (isSel) _drawHandle(ctx, cx, cy, color, 'move');
  });

  // Reset transform
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

function _drawHandle(ctx, x, y, color, type) {
  const R = type === 'move' ? 9 : 16;
  ctx.globalAlpha = 0.95;
  ctx.beginPath();
  ctx.arc(x, y, R, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth   = 2;
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = color;
  ctx.lineWidth   = 1.5;
  ctx.beginPath();
  if (type === 'move') {
    ctx.moveTo(x - 4, y); ctx.lineTo(x + 4, y);
    ctx.moveTo(x, y - 4); ctx.lineTo(x, y + 4);
  } else {
    ctx.moveTo(x - 6, y); ctx.lineTo(x + 6, y);
    ctx.moveTo(x + 3, y - 4); ctx.lineTo(x + 6, y); ctx.lineTo(x + 3, y + 4);
    ctx.moveTo(x - 3, y - 4); ctx.lineTo(x - 6, y); ctx.lineTo(x - 3, y + 4);
  }
  ctx.stroke();
}

function _drawDishResizeHandle(ctx, x, y) {
  const R = 7;
  ctx.globalAlpha = 0.92;
  ctx.beginPath();
  ctx.arc(x, y, R, 0, Math.PI * 2);
  ctx.fillStyle = '#4caf50';
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.globalAlpha = 1;
}

// ── Zone name editing ─────────────────────────────────────────────────────
function escapeHtmlForTable(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function startNameEdit(idx, tr) {
  const m       = lastResult.measurements[idx];
  const nameSpan = tr.querySelector('.zone-name-text');
  const editBtn  = tr.querySelector('.btn-edit-name');

  const input = document.createElement('input');
  input.type      = 'text';
  input.value     = m.name || String(m.id);
  input.className = 'zone-name-input';
  input.maxLength = 30;

  nameSpan.replaceWith(input);
  editBtn.style.display = 'none';
  input.focus();
  input.select();

  let committed = false;
  function commit() {
    if (committed) return;
    committed = true;
    const newName = input.value.trim() || `ディスク ${m.id}`;
    m.name = newName;
    drawCanvas();
    updateResultsUI();
  }
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter')  { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { input.value = m.name || String(m.id); input.blur(); }
  });
}

// ── Results UI (table + summary) ──────────────────────────────────────────
function updateResultsUI() {
  if (!lastResult) return;
  const { measurements, dish, canvasWidth, canvasHeight } = lastResult;

  const zones = measurements.map(m => m.zoneDiamMm);
  summaryDisks.textContent = zones.length;
  summaryAvg.textContent   = zones.length ? (zones.reduce((a, b) => a + b, 0) / zones.length).toFixed(1) : '-';
  summaryMin.textContent   = zones.length ? Math.min(...zones).toFixed(1) : '-';
  summaryMax.textContent   = zones.length ? Math.max(...zones).toFixed(1) : '-';

  measurementsTbody.innerHTML = '';
  measurements.forEach((m, i) => {
    const color = DISK_COLORS[i % DISK_COLORS.length];
    const isSel = adjustState.active && adjustState.selectedIdx === i;
    const tr    = document.createElement('tr');
    if (isSel) tr.style.background = '#fff9e6';
    tr.innerHTML = `
      <td>
        <div class="name-cell">
          <span class="disk-color-dot" style="background:${color}"></span>
          <span class="zone-name-text">${escapeHtmlForTable(m.name || String(m.id))}</span>
          <button class="btn-edit-name" title="名前を変更">✎</button>
        </div>
      </td>
      <td><strong>${m.zoneDiamMm}</strong> mm</td>`;
    tr.querySelector('.btn-edit-name').addEventListener('click', () => startNameEdit(i, tr));
    measurementsTbody.appendChild(tr);
  });

  const dishCoverage = (dish.r * 2) / Math.max(canvasWidth, canvasHeight);
  const warningEl = document.getElementById('resultsWarning');
  if (dishCoverage < 0.4) {
    warningEl.textContent = '⚠ シャーレが画像の40%未満を占めています。精度向上のため、シャーレを画面いっぱいに撮影してください。';
    warningEl.style.display = 'block';
  } else {
    warningEl.style.display = 'none';
  }
}

// ── Zone slider ───────────────────────────────────────────────────────────
function syncSlider() {
  if (adjustState.selectedIdx === null || !lastResult) {
    zoneSliderWrap.style.display  = 'none';
    btnDeleteZone.style.display   = 'none';
    return;
  }
  btnDeleteZone.style.display = 'inline-flex';
  const m = lastResult.measurements[adjustState.selectedIdx];
  const { dish, measurements, mmPerPx } = lastResult;
  // Use average disk radius across all zones so every slider shares the same minimum.
  // Individual disk detections vary by a few pixels even though all disks are the same physical size.
  const avgDiskR = measurements.reduce((s, d) => s + d.disk.r, 0) / measurements.length;
  const minDiam = +(avgDiskR * mmPerPx).toFixed(1); // half of avg disk diameter
  const maxDiam = +(dish.r   * 2 * 0.92 * mmPerPx).toFixed(1);
  zoneSlider.min   = minDiam;
  zoneSlider.max   = maxDiam;
  zoneSlider.step  = '0.5';
  zoneSlider.value = m.zoneDiamMm;
  zoneSliderVal.textContent = `${m.zoneDiamMm} mm`;
  zoneSliderWrap.style.display = 'flex';
}

zoneSlider.addEventListener('input', () => {
  if (adjustState.selectedIdx === null || !lastResult) return;
  const m = lastResult.measurements[adjustState.selectedIdx];
  m.zoneDiamMm = +parseFloat(zoneSlider.value).toFixed(1);
  m.zoneRadius = m.zoneDiamMm / 2 / lastResult.mmPerPx;
  m.zoneDiamPx = m.zoneRadius * 2;
  zoneSliderVal.textContent = `${m.zoneDiamMm} mm`;
  drawCanvas();
  updateResultsUI();
});

// ── Dish adjust mode ──────────────────────────────────────────────────────
function enterDishAdjustMode() {
  adjustState.dishAdjustMode  = true;
  adjustState.dishDragMode    = null;
  adjustState.selectedIdx     = null;
  adjustState.addMode         = false;
  adjustToolbar.classList.add('dish-mode');
  canvasWrap.classList.remove('add-mode');
  btnAdjustDish.classList.add('btn-active');
  btnAddZone.classList.remove('btn-warning-active');
  // hide zone-only controls, show dish slider
  zoneSliderWrap.style.display  = 'none';
  btnDeleteZone.style.display   = 'none';
  boundaryNote.style.display    = 'none';
  dishBoundaryNote.style.display = '';
  syncDishSlider();
  setHint('中心ドラッグ→移動　外縁ドラッグ→サイズ変更');
  drawCanvas();
}

function exitDishAdjustMode() {
  adjustState.dishAdjustMode = false;
  adjustState.dishDragMode   = null;
  adjustToolbar.classList.remove('dish-mode');
  btnAdjustDish.classList.remove('btn-active');
  dishSliderWrap.style.display   = 'none';
  dishBoundaryNote.style.display = 'none';
  boundaryNote.style.display     = '';
  setHint('ディスクをタップして選択してください');
  if (lastResult) { drawCanvas(); updateResultsUI(); }
}

function syncDishSlider() {
  if (!lastResult || !adjustState.dishAdjustMode) {
    dishSliderWrap.style.display = 'none';
    return;
  }
  const { dish, canvasWidth, canvasHeight } = lastResult;
  const maxR = Math.round(Math.min(canvasWidth, canvasHeight) * 0.49);
  dishSlider.min   = Math.max(20, Math.round(dish.r * 0.3));
  dishSlider.max   = maxR;
  dishSlider.step  = '1';
  dishSlider.value = Math.round(dish.r);
  dishSliderVal.textContent = Math.round(dish.r) + 'px';
  dishSliderWrap.style.display = 'flex';
}

// Recalculate mm values for all zones after the dish circle changes.
function recalcMeasurementsFromDish() {
  if (!lastResult) return;
  const { dish, measurements, dishDiamMm } = lastResult;
  lastResult.mmPerPx = dishDiamMm / (dish.r * 2);
  measurements.forEach(m => {
    m.diskDiamMm = +(m.disk.r       * 2 * lastResult.mmPerPx).toFixed(1);
    m.zoneDiamMm = +(m.zoneRadius   * 2 * lastResult.mmPerPx).toFixed(1);
    m.diskDiamPx = m.disk.r     * 2;
    m.zoneDiamPx = m.zoneRadius * 2;
  });
  syncDishSlider();
  updateResultsUI();
}

dishSlider.addEventListener('input', () => {
  if (!adjustState.dishAdjustMode || !lastResult) return;
  lastResult.dish.r = parseFloat(dishSlider.value);
  dishSliderVal.textContent = Math.round(lastResult.dish.r) + 'px';
  recalcMeasurementsFromDish();
  drawCanvas();
});

btnAdjustDish.addEventListener('click', () => {
  if (adjustState.dishAdjustMode) exitDishAdjustMode(); else enterDishAdjustMode();
});

// ── Adjust mode ───────────────────────────────────────────────────────────
function enterAdjustMode() {
  adjustState.active      = true;
  adjustState.selectedIdx = null;
  adjustState.addMode     = false;
  adjustState.isDragging  = false;
  adjustState.panMode     = false;
  adjustToolbar.classList.add('visible');
  canvasWrap.classList.add('adjusting');
  canvasWrap.style.touchAction = 'none';
  btnAdjust.textContent = '✏ 調整中…';
  btnAdjust.classList.add('btn-warning-active');
  setHint('ディスクをタップして選択してください');
  zoneSliderWrap.style.display  = 'none';
  btnDeleteZone.style.display   = 'none';
  drawCanvas();
  updateResultsUI();
}

function exitAdjustMode() {
  exitDishAdjustMode();                // clean up dish mode first
  adjustState.active      = false;
  adjustState.selectedIdx = null;
  adjustState.addMode     = false;
  adjustState.isDragging  = false;
  adjustState.panMode     = false;
  adjustToolbar.classList.remove('visible', 'dish-mode');
  canvasWrap.classList.remove('adjusting', 'add-mode');
  canvasWrap.style.touchAction = viewState.scale > 1 ? 'none' : '';
  zoneSliderWrap.style.display   = 'none';
  dishSliderWrap.style.display   = 'none';
  dishBoundaryNote.style.display = 'none';
  btnDeleteZone.style.display    = 'none';
  btnAddZone.classList.remove('btn-warning-active');
  boundaryNote.style.display = '';
  if (btnAdjust) {
    btnAdjust.textContent = '✏ 手動調整';
    btnAdjust.classList.remove('btn-warning-active');
  }
  if (lastResult) { drawCanvas(); updateResultsUI(); }
}

// ── Add / delete zone ─────────────────────────────────────────────────────
function enterAddMode() {
  if (adjustState.dishAdjustMode) exitDishAdjustMode();
  adjustState.addMode     = true;
  adjustState.selectedIdx = null;
  canvasWrap.classList.add('add-mode');
  btnAddZone.classList.add('btn-warning-active');
  zoneSliderWrap.style.display = 'none';
  btnDeleteZone.style.display  = 'none';
  setHint('追加したい位置をタップしてください');
  drawCanvas();
  updateResultsUI();
}

function exitAddMode() {
  adjustState.addMode = false;
  canvasWrap.classList.remove('add-mode');
  btnAddZone.classList.remove('btn-warning-active');
  setHint(adjustState.selectedIdx !== null
    ? 'ドラッグ→位置移動 ／ スライダー→直径変更'
    : 'ディスクをタップして選択してください');
}

function addZoneAt(imgX, imgY) {
  if (!lastResult) return;
  const { measurements, dish, mmPerPx } = lastResult;
  const avgDiskR = measurements.length > 0
    ? measurements.reduce((s, m) => s + m.disk.r, 0) / measurements.length
    : dish.r * 0.067;                      // ~6 mm disk in 90 mm dish
  const zoneR = avgDiskR * 3.5;
  const newId = measurements.length + 1;
  const newM = {
    id:         newId,
    name:       `ディスク ${newId}`,
    disk:       { cx: imgX, cy: imgY, r: avgDiskR },
    zoneRadius: zoneR,
    diskDiamMm: +(avgDiskR * 2 * mmPerPx).toFixed(1),
    zoneDiamMm: +(zoneR    * 2 * mmPerPx).toFixed(1),
    diskDiamPx: avgDiskR * 2,
    zoneDiamPx: zoneR * 2,
  };
  measurements.push(newM);
  adjustState.selectedIdx = measurements.length - 1;
  exitAddMode();
  syncSlider();
  drawCanvas();
  updateResultsUI();
}

function deleteSelectedZone() {
  if (adjustState.selectedIdx === null || !lastResult) return;
  lastResult.measurements.splice(adjustState.selectedIdx, 1);
  lastResult.measurements.forEach((m, i) => { m.id = i + 1; });
  adjustState.selectedIdx = null;
  btnDeleteZone.style.display = 'none';
  syncSlider();
  setHint('ディスクをタップして選択してください');
  drawCanvas();
  updateResultsUI();
}

btnAddZone.addEventListener('click', () => {
  if (adjustState.addMode) exitAddMode(); else enterAddMode();
});
btnDeleteZone.addEventListener('click', deleteSelectedZone);

function setHint(text) { adjustHint.textContent = text; }

btnAdjust.addEventListener('click', () => {
  if (adjustState.active) exitAdjustMode(); else enterAdjustMode();
});
document.getElementById('btnAdjustDone').addEventListener('click', exitAdjustMode);

// ── Coordinate helpers ────────────────────────────────────────────────────
// Returns image-space (x, y) and raw logical-canvas (rawX, rawY) coords.
// All coordinates are in logical (analysis) pixels, independent of DPR.
function getCanvasCoords(e) {
  const dpr  = window.devicePixelRatio || 1;
  const rect = resultCanvas.getBoundingClientRect();
  const src  = e.touches ? e.touches[0] : e;
  // Map CSS position → logical canvas pixels (physical buffer / DPR = logical)
  const W    = resultCanvas.width  / dpr;
  const H    = resultCanvas.height / dpr;
  const rawX = (src.clientX - rect.left) * (W / rect.width);
  const rawY = (src.clientY - rect.top)  * (H / rect.height);
  return {
    x: (rawX - viewState.panX) / viewState.scale,
    y: (rawY - viewState.panY) / viewState.scale,
    rawX, rawY,
  };
}

function hitTestForSelection(imgX, imgY) {
  if (!lastResult) return null;
  const HIT = 50;
  let best = null, bestDist = Infinity;
  lastResult.measurements.forEach((m, i) => {
    const { cx, cy } = m.disk;
    const dist = Math.hypot(imgX - cx, imgY - cy);
    if (dist < m.zoneRadius + HIT) {
      const d = Math.abs(dist - m.zoneRadius);
      if (d < bestDist) { bestDist = d; best = i; }
    }
  });
  return best;
}

// ── Pointer events (adjust + pan) ────────────────────────────────────────
resultCanvas.addEventListener('pointerdown', (e) => {
  if (!adjustState.active && viewState.scale <= 1) return;
  if (e.button !== 0) return;   // ignore right-click / middle-click on desktop
  e.preventDefault();
  resultCanvas.setPointerCapture(e.pointerId);
  const c = getCanvasCoords(e);
  Object.assign(adjustState, {
    downX: c.x, downY: c.y, downRawX: c.rawX, downRawY: c.rawY,
    lastX: c.x, lastY: c.y, lastRawX: c.rawX, lastRawY: c.rawY,
    isDragging: false, panMode: false,
  });
  // Determine dish drag mode at touch-start so the whole gesture is consistent
  if (adjustState.dishAdjustMode && lastResult) {
    const { dish } = lastResult;
    const d = Math.hypot(c.x - dish.cx, c.y - dish.cy);
    adjustState.dishDragMode = d < dish.r * 0.3 ? 'move' : 'resize';
  }
});

resultCanvas.addEventListener('pointermove', (e) => {
  if (!adjustState.active && viewState.scale <= 1) return;
  if (e.buttons === 0) return;  // mouse hover without button press — ignore
  e.preventDefault();
  const c       = getCanvasCoords(e);
  const rawMoved = Math.hypot(c.rawX - adjustState.downRawX, c.rawY - adjustState.downRawY);

  if (!adjustState.isDragging) {
    if (rawMoved < 8) return;
    adjustState.isDragging = true;
    if (adjustState.dishAdjustMode) {
      adjustState.panMode = false;
      setHint(adjustState.dishDragMode === 'move'
        ? '中心を移動中…'
        : 'シャーレのサイズを変更中…');
    } else {
      // zone mode: selected zone → move; nothing selected → pan
      adjustState.panMode = !(adjustState.active && adjustState.selectedIdx !== null);
      if (!adjustState.panMode) setHint('ドラッグして位置を変更中…');
    }
  }

  if (adjustState.dishAdjustMode && lastResult) {
    const dish = lastResult.dish;
    if (adjustState.dishDragMode === 'move') {
      dish.cx += c.x - adjustState.lastX;
      dish.cy += c.y - adjustState.lastY;
    } else {
      const newR = Math.hypot(c.x - dish.cx, c.y - dish.cy);
      if (newR > 20) dish.r = newR;
    }
    recalcMeasurementsFromDish();
  } else if (adjustState.panMode) {
    viewState.panX += c.rawX - adjustState.lastRawX;
    viewState.panY += c.rawY - adjustState.lastRawY;
    clampPan();
  } else if (adjustState.active && adjustState.selectedIdx !== null) {
    const m = lastResult.measurements[adjustState.selectedIdx];
    m.disk.cx += c.x - adjustState.lastX;
    m.disk.cy += c.y - adjustState.lastY;
    syncSlider();
    updateResultsUI();
  }

  adjustState.lastX = c.x; adjustState.lastY = c.y;
  adjustState.lastRawX = c.rawX; adjustState.lastRawY = c.rawY;
  drawCanvas();
});

resultCanvas.addEventListener('pointerup', (e) => {
  const c = getCanvasCoords(e);

  if (adjustState.dishAdjustMode) {
    // In dish mode: finish drag, restore hint
    setHint('中心ドラッグ→移動　外縁ドラッグ→サイズ変更');
    drawCanvas();
  } else if (!adjustState.isDragging && adjustState.active) {
    if (adjustState.addMode) {
      addZoneAt(c.x, c.y);         // place new zone; exits addMode internally
    } else {
      const hit = hitTestForSelection(c.x, c.y);
      adjustState.selectedIdx = hit;
      setHint(hit !== null
        ? 'ドラッグ→位置移動 ／ スライダー→直径変更'
        : 'ディスクをタップして選択してください');
      syncSlider();
      drawCanvas();
      updateResultsUI();
    }
  } else if (adjustState.isDragging && adjustState.active) {
    setHint(adjustState.selectedIdx !== null
      ? 'ドラッグ→位置移動 ／ スライダー→直径変更'
      : 'ディスクをタップして選択してください');
  }

  adjustState.isDragging = false;
  adjustState.panMode    = false;
  if (adjustState.isDragging) drawCanvas(); // already drawn in move
});

// ── Pinch-to-zoom (touch) ────────────────────────────────────────────────
let pinchLastDist = 0;

resultCanvas.addEventListener('touchstart', (e) => {
  if (e.touches.length === 2) {
    e.preventDefault();
    pinchLastDist = Math.hypot(
      e.touches[0].clientX - e.touches[1].clientX,
      e.touches[0].clientY - e.touches[1].clientY
    );
  }
}, { passive: false });

resultCanvas.addEventListener('touchmove', (e) => {
  if (e.touches.length !== 2) return;
  e.preventDefault();
  const t1 = e.touches[0], t2 = e.touches[1];
  const dist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
  if (pinchLastDist > 0 && dist > 0) {
    const dpr  = window.devicePixelRatio || 1;
    const rect = resultCanvas.getBoundingClientRect();
    const W    = resultCanvas.width  / dpr;
    const H    = resultCanvas.height / dpr;
    const midRawX = ((t1.clientX + t2.clientX) / 2 - rect.left) * (W / rect.width);
    const midRawY = ((t1.clientY + t2.clientY) / 2 - rect.top)  * (H / rect.height);
    const pivotX  = (midRawX - viewState.panX) / viewState.scale;
    const pivotY  = (midRawY - viewState.panY) / viewState.scale;
    applyZoom(dist / pinchLastDist, pivotX, pivotY);
  }
  pinchLastDist = dist;
}, { passive: false });

resultCanvas.addEventListener('touchend', () => { pinchLastDist = 0; });

// ── Results footer buttons ────────────────────────────────────────────────
document.getElementById('btnRetake').addEventListener('click', () => {
  document.getElementById('previewAlert').style.display = 'none';
  showScreen('capture');
});

document.getElementById('btnReanalyze').addEventListener('click', () => {
  document.getElementById('previewAlert').style.display = 'none';
  showScreen('preview');
});

// ── Image save with name overlay ──────────────────────────────────────────
const imgNameModal   = document.getElementById('imgNameModal');
const imgNameInput   = document.getElementById('imgNameInput');

function openImgNameModal() {
  imgNameInput.value = '';
  imgNameModal.style.display = 'flex';
  setTimeout(() => imgNameInput.focus(), 80);
}

function closeImgNameModal() {
  imgNameModal.style.display = 'none';
}

function doSaveImage(name) {
  const wasActive = adjustState.active, wasSel = adjustState.selectedIdx;
  adjustState.active = false; adjustState.selectedIdx = null;
  drawCanvas(true);

  if (name) {
    const dpr  = window.devicePixelRatio || 1;
    const ctx  = resultCanvas.getContext('2d');
    // Work in physical pixel space (transform was reset to identity by drawCanvas)
    const pad  = Math.round(14 * dpr);
    const fSz  = Math.round(20 * dpr);
    ctx.font   = `bold ${fSz}px sans-serif`;
    const tw   = ctx.measureText(name).width;
    const boxW = tw + pad * 2;
    const boxH = fSz + pad * 1.4;
    const r    = Math.round(7 * dpr);
    const x    = pad, y = pad;

    // Rounded-rect background
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + boxW - r, y);
    ctx.arcTo(x + boxW, y, x + boxW, y + r, r);
    ctx.lineTo(x + boxW, y + boxH - r);
    ctx.arcTo(x + boxW, y + boxH, x + boxW - r, y + boxH, r);
    ctx.lineTo(x + r, y + boxH);
    ctx.arcTo(x, y + boxH, x, y + boxH - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
    ctx.fillStyle = 'rgba(0,0,0,0.58)';
    ctx.fill();

    // Name text
    ctx.fillStyle = '#ffffff';
    ctx.fillText(name, x + pad, y + pad + fSz * 0.82);
  }

  const link = document.createElement('a');
  link.download = `zone_measurement_${Date.now()}.png`;
  link.href = resultCanvas.toDataURL('image/png');
  link.click();

  adjustState.active = wasActive; adjustState.selectedIdx = wasSel;
  if (wasActive) drawCanvas();
}

document.getElementById('btnSaveImage').addEventListener('click', () => {
  if (!lastResult) return;
  openImgNameModal();
});

document.getElementById('btnImgNameCancel').addEventListener('click', closeImgNameModal);

imgNameModal.addEventListener('click', (e) => {
  if (e.target === imgNameModal) closeImgNameModal();
});

document.getElementById('btnImgNameConfirm').addEventListener('click', () => {
  const name = imgNameInput.value.trim();
  closeImgNameModal();
  doSaveImage(name);
});

imgNameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter')  { e.preventDefault(); document.getElementById('btnImgNameConfirm').click(); }
  if (e.key === 'Escape') closeImgNameModal();
});

document.getElementById('btnExportCsv').addEventListener('click', () => {
  if (!lastResult) return;
  const lines = ['ディスク番号,阻止円直径(mm)'];
  lastResult.measurements.forEach(m => lines.push(`${m.id},${m.zoneDiamMm}`));
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.download = `zone_measurement_${Date.now()}.csv`;
  link.href = URL.createObjectURL(blob);
  link.click();
  URL.revokeObjectURL(link.href);
});

// ── Resize / orientation handling ────────────────────────────────────────
window.addEventListener('resize', () => {
  // Defer to let CSS layout settle (especially after orientation change)
  requestAnimationFrame(() => { fitCanvas(); if (lastResult) drawCanvas(); });
});

// ── Records (localStorage) ────────────────────────────────────────────────
const STORAGE_KEY = 'zoi_records_v1';

function loadRecords() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
  catch { return []; }
}

function persistRecords(records) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

function captureAnnotatedThumbnail() {
  if (!lastResult) return null;
  const dpr = window.devicePixelRatio || 1;
  const fullW = resultCanvas.width  / dpr;
  const fullH = resultCanvas.height / dpr;

  // Temporarily render the full un-zoomed annotated image
  const wasActive = adjustState.active;
  const wasSel    = adjustState.selectedIdx;
  adjustState.active = false;
  adjustState.selectedIdx = null;
  drawCanvas(true);

  // Downscale to thumbnail
  const thumbW = 960;
  const thumbH = Math.round(fullH * thumbW / fullW);
  const tc  = document.createElement('canvas');
  tc.width  = thumbW;
  tc.height = thumbH;
  const tCtx = tc.getContext('2d');
  tCtx.imageSmoothingEnabled = true;
  tCtx.imageSmoothingQuality = 'high';
  tCtx.drawImage(
    resultCanvas,
    0, 0, resultCanvas.width, resultCanvas.height,
    0, 0, thumbW, thumbH
  );
  const dataUrl = tc.toDataURL('image/jpeg', 0.88);

  // Restore previous view
  adjustState.active = wasActive;
  adjustState.selectedIdx = wasSel;
  drawCanvas();

  return dataUrl;
}

function saveRecord(name) {
  if (!lastResult) return;
  const records = loadRecords();
  const measurements = lastResult.measurements.map(m => ({
    id: m.id, name: m.name || `ディスク ${m.id}`, zoneDiamMm: m.zoneDiamMm,
  }));
  const avg = measurements.length
    ? (measurements.reduce((s, m) => s + m.zoneDiamMm, 0) / measurements.length).toFixed(1)
    : '—';
  const minV = measurements.length ? Math.min(...measurements.map(m => m.zoneDiamMm)) : null;
  const maxV = measurements.length ? Math.max(...measurements.map(m => m.zoneDiamMm)) : null;
  const thumbnail = captureAnnotatedThumbnail();
  records.unshift({
    id:        Date.now(),
    name:      name.trim() || '無題',
    date:      new Date().toLocaleString('ja-JP'),
    dishMm:    lastResult.dishDiamMm,
    diskCount: measurements.length,
    avgMm:     avg,
    minMm:     minV,
    maxMm:     maxV,
    measurements,
    thumbnail,
  });
  try {
    persistRecords(records);
  } catch (e) {
    // Storage quota exceeded — save without thumbnail
    records[0].thumbnail = null;
    try {
      persistRecords(records);
    } catch {
      alert('ストレージの空き容量が不足しているため保存できませんでした。古い記録を削除してください。');
    }
  }
}

function deleteRecord(id) {
  persistRecords(loadRecords().filter(r => r.id !== id));
}

function deleteAllRecords() {
  persistRecords([]);
}

// ── Records list rendering ────────────────────────────────────────────────
function renderRecordsList() {
  const records = loadRecords();
  const listEl  = document.getElementById('recordsList');
  const emptyEl = document.getElementById('recordsEmpty');
  const countEl = document.getElementById('recordsCount');
  const delAllBtn = document.getElementById('btnDeleteAllRecords');

  listEl.innerHTML = '';

  if (records.length === 0) {
    emptyEl.style.display = 'flex';
    countEl.textContent   = '';
    delAllBtn.style.display = 'none';
    return;
  }

  emptyEl.style.display   = 'none';
  countEl.textContent     = `${records.length} 件`;
  delAllBtn.style.display = '';

  records.forEach(r => {
    const item = document.createElement('div');
    item.className = 'record-item';

    const fmtMm = v => (v !== null && v !== undefined) ? `${v} mm` : '—';

    // Thumbnail section
    const thumbWrap = document.createElement('div');
    thumbWrap.className = 'record-thumb-wrap';
    if (r.thumbnail) {
      thumbWrap.innerHTML = `
        <img class="record-thumb" src="${r.thumbnail}" alt="測定画像" loading="lazy">
        <span class="record-thumb-hint">タップで拡大</span>`;
      thumbWrap.addEventListener('click', () => openLightbox(r.thumbnail));
    } else {
      thumbWrap.innerHTML = `<div class="record-thumb-placeholder">画像なし</div>`;
    }

    // Info + actions body
    const body = document.createElement('div');
    body.className = 'record-item-body';
    body.innerHTML = `
      <div class="record-item-info">
        <div class="record-item-name">${escapeHtml(r.name)}</div>
        <div class="record-item-date">${r.date}</div>
        <div class="record-item-stats">
          <span class="record-stat-badge">ディスク <strong>${r.diskCount}</strong></span>
          <span class="record-stat-badge">平均 <strong>${fmtMm(r.avgMm)}</strong></span>
          <span class="record-stat-badge">最小 <strong>${fmtMm(r.minMm)}</strong></span>
          <span class="record-stat-badge">最大 <strong>${fmtMm(r.maxMm)}</strong></span>
          <span class="record-stat-badge">シャーレ <strong>${r.dishMm} mm</strong></span>
        </div>
        <details class="record-detail" style="margin-top:8px">
          <summary style="font-size:12px;color:var(--text-secondary);cursor:pointer">詳細を表示</summary>
          <table style="margin-top:6px;width:100%;border-collapse:collapse;font-size:12px">
            <thead><tr>
              <th style="text-align:left;padding:3px 6px;border-bottom:1px solid var(--border)">ディスク</th>
              <th style="text-align:right;padding:3px 6px;border-bottom:1px solid var(--border)">阻止円直径 (mm)</th>
            </tr></thead>
            <tbody>
              ${r.measurements.map(m =>
                `<tr>
                  <td style="padding:3px 6px;border-bottom:1px solid var(--border)">${escapeHtml(m.name || String(m.id))}</td>
                  <td style="text-align:right;padding:3px 6px;border-bottom:1px solid var(--border)">${m.zoneDiamMm}</td>
                </tr>`
              ).join('')}
            </tbody>
          </table>
        </details>
      </div>
      <div class="record-item-actions">
        <button class="btn btn-sm btn-record-delete">🗑 削除</button>
      </div>`;

    body.querySelector('.btn-record-delete').addEventListener('click', () => {
      if (!confirm(`「${r.name}」を削除しますか？`)) return;
      deleteRecord(r.id);
      renderRecordsList();
    });

    item.appendChild(thumbWrap);
    item.appendChild(body);
    listEl.appendChild(item);
  });
}

// ── Lightbox ──────────────────────────────────────────────────────────────
const thumbLightbox    = document.getElementById('thumbLightbox');
const thumbLightboxImg = document.getElementById('thumbLightboxImg');

function openLightbox(src) {
  thumbLightboxImg.src = src;
  thumbLightbox.style.display = 'flex';
}

function closeLightbox() {
  thumbLightbox.style.display = 'none';
  thumbLightboxImg.src = '';
}

document.getElementById('btnCloseLightbox').addEventListener('click', closeLightbox);
thumbLightbox.addEventListener('click', (e) => {
  if (e.target === thumbLightbox) closeLightbox();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && thumbLightbox.style.display !== 'none') closeLightbox();
});

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Save modal ────────────────────────────────────────────────────────────
const saveModal        = document.getElementById('saveModal');
const recordNameInput  = document.getElementById('recordNameInput');

function openSaveModal() {
  recordNameInput.value = '';
  saveModal.style.display = 'flex';
  setTimeout(() => recordNameInput.focus(), 80);
}

function closeSaveModal() {
  saveModal.style.display = 'none';
}

document.getElementById('btnSaveRecord').addEventListener('click', openSaveModal);

document.getElementById('btnSaveModalCancel').addEventListener('click', closeSaveModal);

saveModal.addEventListener('click', (e) => {
  if (e.target === saveModal) closeSaveModal();
});

document.getElementById('btnSaveModalConfirm').addEventListener('click', () => {
  const name = recordNameInput.value.trim();
  if (!name) { recordNameInput.focus(); return; }
  saveRecord(name);
  closeSaveModal();
  // Brief confirmation
  const btn = document.getElementById('btnSaveRecord');
  const orig = btn.textContent;
  btn.textContent = '✓ 保存しました';
  btn.disabled = true;
  setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 1800);
});

recordNameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('btnSaveModalConfirm').click();
  if (e.key === 'Escape') closeSaveModal();
});

// ── Records screen navigation ─────────────────────────────────────────────
document.getElementById('btnViewRecords').addEventListener('click', () => {
  renderRecordsList();
  showScreen('records');
});

document.getElementById('btnBackFromRecords').addEventListener('click', () => {
  showScreen('capture');
});

document.getElementById('btnDeleteAllRecords').addEventListener('click', () => {
  const records = loadRecords();
  if (records.length === 0) return;
  if (!confirm(`保存された ${records.length} 件の記録をすべて削除しますか？`)) return;
  deleteAllRecords();
  renderRecordsList();
});
