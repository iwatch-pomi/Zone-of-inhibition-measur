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

const processor  = new ZoneProcessor();
let lastResult   = null;
let imageCanvas  = null;  // offscreen canvas holding the original image

// ── View state (zoom / pan) ───────────────────────────────────────────────
const viewState = { scale: 1, panX: 0, panY: 0 };

function resetView() {
  viewState.scale = 1; viewState.panX = 0; viewState.panY = 0;
  if (zoomLevelEl) zoomLevelEl.textContent = '1×';
}

// Zoom around an image-space pivot point (defaults to current view centre).
function applyZoom(factor, pivotX, pivotY) {
  const W = resultCanvas.width, H = resultCanvas.height;
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
  canvasWrap.style.touchAction = viewState.scale > 1 || adjustState.active ? 'none' : '';
  drawCanvas();
}

function clampPan() {
  const s = viewState.scale, W = resultCanvas.width, H = resultCanvas.height;
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
  resultCanvas.width  = result.canvasWidth;
  resultCanvas.height = result.canvasHeight;
  // Create offscreen canvas for the image (drawImage respects transforms; putImageData does not)
  imageCanvas = document.createElement('canvas');
  imageCanvas.width  = result.canvasWidth;
  imageCanvas.height = result.canvasHeight;
  imageCanvas.getContext('2d').putImageData(result.imageData, 0, 0);
  resetView();
  // Defer fitCanvas so CSS layout has settled (grid/flex dimensions are final)
  requestAnimationFrame(fitCanvas);
}

// Set canvas CSS dimensions to maintain exact aspect ratio within available space.
// Both X and Y must use the same scale factor so getCanvasCoords() works correctly.
function fitCanvas() {
  if (!lastResult) return;
  const cW = resultCanvas.width;
  const cH = resultCanvas.height;
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

  const s  = forExport ? 1 : viewState.scale;
  const px = forExport ? 0 : viewState.panX;
  const py = forExport ? 0 : viewState.panY;

  // Clear with identity transform
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, resultCanvas.width, resultCanvas.height);

  // Apply zoom/pan
  ctx.setTransform(s, 0, 0, s, px, py);
  if (imageCanvas) ctx.drawImage(imageCanvas, 0, 0);

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

    // Zone border — white outer stroke + colored inner stroke.
    // Align the inner edge of this line to the zone boundary (where bacteria begin).
    ctx.globalAlpha = baseAlpha;
    ctx.beginPath();
    ctx.arc(cx, cy, zoneR, 0, Math.PI * 2);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth   = isSel ? 2.5 : 1.5;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, zoneR, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth   = isSel ? 1.5 : 1;
    ctx.stroke();

    // Disk circle
    ctx.globalAlpha = baseAlpha;
    ctx.beginPath();
    ctx.arc(cx, cy, diskR, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth   = 1.5;
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

    // Label
    const label    = `${i + 1}: ${m.zoneDiamMm} mm`;
    const fontSize = Math.max(11, Math.round(canvasWidth / 55));
    ctx.font        = `bold ${fontSize}px sans-serif`;
    ctx.globalAlpha = dimmed ? 0.30 : 1;
    ctx.lineWidth   = 3;
    ctx.strokeStyle = '#000';
    ctx.strokeText(label, cx - zoneR + 3, cy - 5);
    ctx.fillStyle   = color;
    ctx.fillText(label, cx - zoneR + 3, cy - 5);
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
      <td><span class="disk-color-dot" style="background:${color}"></span>${m.id}${isSel ? ' ✏' : ''}</td>
      <td><strong>${m.zoneDiamMm}</strong></td>`;
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
  const { dish, mmPerPx } = lastResult;
  const minDiam = +(m.disk.r * 2 * 1.15 * mmPerPx).toFixed(1);
  const maxDiam = +(dish.r  * 2 * 0.92 * mmPerPx).toFixed(1);
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
  const newM = {
    id:         measurements.length + 1,
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
// Returns both image-space (x, y) and raw screen-canvas (rawX, rawY) coords.
function getCanvasCoords(e) {
  const rect   = resultCanvas.getBoundingClientRect();
  const src    = e.touches ? e.touches[0] : e;
  const rawX   = (src.clientX - rect.left) * (resultCanvas.width  / rect.width);
  const rawY   = (src.clientY - rect.top)  * (resultCanvas.height / rect.height);
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
    const rect  = resultCanvas.getBoundingClientRect();
    const midRawX = ((t1.clientX + t2.clientX) / 2 - rect.left) * (resultCanvas.width  / rect.width);
    const midRawY = ((t1.clientY + t2.clientY) / 2 - rect.top)  * (resultCanvas.height / rect.height);
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

document.getElementById('btnSaveImage').addEventListener('click', () => {
  if (!lastResult) return;
  const wasActive = adjustState.active, wasSel = adjustState.selectedIdx;
  adjustState.active = false; adjustState.selectedIdx = null;
  drawCanvas(true);
  const link = document.createElement('a');
  link.download = `zone_measurement_${Date.now()}.png`;
  link.href = resultCanvas.toDataURL('image/png');
  link.click();
  adjustState.active = wasActive; adjustState.selectedIdx = wasSel;
  if (wasActive) drawCanvas();
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
