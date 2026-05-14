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
  active:      false,
  selectedIdx: null,
  isDragging:  false,
  panMode:     false,
  lastX: 0, lastY: 0,
  lastRawX: 0, lastRawY: 0,
  downX: 0, downY: 0,
  downRawX: 0, downRawY: 0,
};

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
  ctx.beginPath();
  ctx.arc(dish.cx, dish.cy, dish.r, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.stroke();
  ctx.setLineDash([]);

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

    // Zone fill
    ctx.beginPath();
    ctx.arc(cx, cy, zoneR, 0, Math.PI * 2);
    ctx.fillStyle   = color;
    ctx.globalAlpha = dimmed ? 0.03 : 0.08;
    ctx.fill();

    // Zone border
    ctx.globalAlpha = baseAlpha;
    ctx.beginPath();
    ctx.arc(cx, cy, zoneR, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth   = isSel ? 3.5 : 2.5;
    ctx.stroke();

    // Boundary tick marks (selected zone only) — outward-pointing at N/S/E/W
    // These clarify: the circle line itself marks the boundary; bacteria grow outside
    if (isSel) {
      ctx.globalAlpha = 0.9;
      const TICK = 10;
      [[1,0],[-1,0],[0,1],[0,-1]].forEach(([dx, dy]) => {
        ctx.beginPath();
        ctx.moveTo(cx + dx * zoneR,        cy + dy * zoneR);
        ctx.lineTo(cx + dx * (zoneR+TICK), cy + dy * (zoneR+TICK));
        ctx.strokeStyle = '#fff';
        ctx.lineWidth   = 2;
        ctx.stroke();
      });
    }

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
      <td><strong>${m.zoneDiamMm}</strong></td>
      <td>${m.diskDiamMm}</td>`;
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
    zoneSliderWrap.style.display = 'none';
    return;
  }
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

// ── Adjust mode ───────────────────────────────────────────────────────────
function enterAdjustMode() {
  adjustState.active      = true;
  adjustState.selectedIdx = null;
  adjustState.isDragging  = false;
  adjustState.panMode     = false;
  adjustToolbar.classList.add('visible');
  canvasWrap.classList.add('adjusting');
  canvasWrap.style.touchAction = 'none';
  btnAdjust.textContent = '✏ 調整中…';
  btnAdjust.classList.add('btn-warning-active');
  setHint('ディスクをタップして選択してください');
  zoneSliderWrap.style.display = 'none';
  drawCanvas();
  updateResultsUI();
}

function exitAdjustMode() {
  adjustState.active      = false;
  adjustState.selectedIdx = null;
  adjustState.isDragging  = false;
  adjustState.panMode     = false;
  adjustToolbar.classList.remove('visible');
  canvasWrap.classList.remove('adjusting');
  canvasWrap.style.touchAction = viewState.scale > 1 ? 'none' : '';
  zoneSliderWrap.style.display = 'none';
  if (btnAdjust) {
    btnAdjust.textContent = '✏ 手動調整';
    btnAdjust.classList.remove('btn-warning-active');
  }
  if (lastResult) { drawCanvas(); updateResultsUI(); }
}

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
  e.preventDefault();
  resultCanvas.setPointerCapture(e.pointerId);
  const c = getCanvasCoords(e);
  Object.assign(adjustState, {
    downX: c.x, downY: c.y, downRawX: c.rawX, downRawY: c.rawY,
    lastX: c.x, lastY: c.y, lastRawX: c.rawX, lastRawY: c.rawY,
    isDragging: false, panMode: false,
  });
});

resultCanvas.addEventListener('pointermove', (e) => {
  if (!adjustState.active && viewState.scale <= 1) return;
  e.preventDefault();
  const c       = getCanvasCoords(e);
  const rawMoved = Math.hypot(c.rawX - adjustState.downRawX, c.rawY - adjustState.downRawY);

  if (!adjustState.isDragging) {
    if (rawMoved < 8) return;
    adjustState.isDragging = true;
    // If a zone is selected in adjust mode → move disk; otherwise → pan
    adjustState.panMode = !(adjustState.active && adjustState.selectedIdx !== null);
    if (!adjustState.panMode) setHint('ドラッグして位置を変更中…');
  }

  if (adjustState.panMode) {
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

  if (!adjustState.isDragging && adjustState.active) {
    const hit = hitTestForSelection(c.x, c.y);
    adjustState.selectedIdx = hit;
    setHint(hit !== null
      ? 'ドラッグ→位置移動 ／ スライダー→直径変更'
      : 'ディスクをタップして選択してください');
    syncSlider();
    drawCanvas();
    updateResultsUI();
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
  const lines = ['ディスク番号,阻止円直径(mm),ディスク直径(mm)'];
  lastResult.measurements.forEach(m => lines.push(`${m.id},${m.zoneDiamMm},${m.diskDiamMm}`));
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.download = `zone_measurement_${Date.now()}.csv`;
  link.href = URL.createObjectURL(blob);
  link.click();
  URL.revokeObjectURL(link.href);
});
