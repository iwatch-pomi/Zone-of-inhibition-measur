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

const processor = new ZoneProcessor();
let lastResult  = null;

// ── Adjust mode state ────────────────────────────────────────────────────
const adjustState = {
  active:      false,
  selectedIdx: null,
  dragMode:    null,   // 'center' | 'edge'
  isDragging:  false,
  lastX:       0,
  lastY:       0,
  downX:       0,
  downY:       0,
};

// ── Screen transitions ────────────────────────────────────────────────────
function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name].classList.add('active');
  if (name !== 'results') exitAdjustMode();
}

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
  if (!file) return;
  if (!file.type.startsWith('image/')) return;
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

function resetSteps() {
  Object.values(STEPS).forEach(el => el.classList.remove('active', 'done'));
}

// ── Main analysis ─────────────────────────────────────────────────────────
async function runAnalysis(dishMm) {
  resetSteps();
  exitAdjustMode();
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

// ── Canvas init (only sets dimensions, called once per analysis) ──────────
function initResultCanvas(result) {
  resultCanvas.width  = result.canvasWidth;
  resultCanvas.height = result.canvasHeight;
}

// ── Main draw function ────────────────────────────────────────────────────
function drawCanvas(forExport = false) {
  if (!lastResult) return;
  const { dish, measurements, imageData, canvasWidth } = lastResult;
  const ctx = resultCanvas.getContext('2d');

  // Restore original image pixels
  ctx.putImageData(imageData, 0, 0);

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
    const color   = DISK_COLORS[i % DISK_COLORS.length];
    const { cx, cy, r: diskR } = m.disk;
    const zoneR   = m.zoneRadius;
    const isSel   = inAdjust && i === selIdx;
    const dimmed  = inAdjust && hasSelect && !isSel;
    const baseAlpha = dimmed ? 0.30 : 0.85;

    // Zone fill
    ctx.beginPath();
    ctx.arc(cx, cy, zoneR, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.globalAlpha = dimmed ? 0.03 : 0.08;
    ctx.fill();

    // Zone border
    ctx.globalAlpha = baseAlpha;
    ctx.beginPath();
    ctx.arc(cx, cy, zoneR, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth   = isSel ? 3.5 : 2.5;
    ctx.stroke();

    // Disk circle
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

    // Adjustment handles — drawn only for the selected zone in adjust mode
    if (isSel) {
      _drawHandle(ctx, cx, cy, color, 'move');
      _drawHandle(ctx, cx + zoneR, cy, color, 'resize');
      // Dashed radial guide line
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + zoneR, cy);
      ctx.strokeStyle = color;
      ctx.lineWidth   = 1;
      ctx.globalAlpha = 0.45;
      ctx.setLineDash([4, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
  });
}

function _drawHandle(ctx, x, y, color, type) {
  const R = 16;
  ctx.globalAlpha = 0.95;
  ctx.beginPath();
  ctx.arc(x, y, R, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth   = 3;
  ctx.stroke();
  ctx.globalAlpha = 1;

  ctx.strokeStyle = color;
  ctx.lineWidth   = 2.5;
  ctx.beginPath();
  if (type === 'move') {
    ctx.moveTo(x - 7, y); ctx.lineTo(x + 7, y);
    ctx.moveTo(x, y - 7); ctx.lineTo(x, y + 7);
  } else {
    ctx.moveTo(x - 6, y); ctx.lineTo(x + 6, y);
    ctx.moveTo(x + 3, y - 4); ctx.lineTo(x + 6, y); ctx.lineTo(x + 3, y + 4);
    ctx.moveTo(x - 3, y - 4); ctx.lineTo(x - 6, y); ctx.lineTo(x - 3, y + 4);
  }
  ctx.stroke();
}

// ── Results UI update (table + summary, no canvas redraw) ─────────────────
function updateResultsUI() {
  if (!lastResult) return;
  const { measurements, dish, canvasWidth, canvasHeight } = lastResult;

  // Summary cards
  const zones = measurements.map(m => m.zoneDiamMm);
  summaryDisks.textContent = zones.length;
  summaryAvg.textContent   = zones.length ? (zones.reduce((a, b) => a + b, 0) / zones.length).toFixed(1) : '-';
  summaryMin.textContent   = zones.length ? Math.min(...zones).toFixed(1) : '-';
  summaryMax.textContent   = zones.length ? Math.max(...zones).toFixed(1) : '-';

  // Table rows — rebuild to reflect updated values
  measurementsTbody.innerHTML = '';
  measurements.forEach((m, i) => {
    const color = DISK_COLORS[i % DISK_COLORS.length];
    const isSel = adjustState.active && adjustState.selectedIdx === i;
    const tr    = document.createElement('tr');
    if (isSel) tr.style.background = '#fff9e6';
    tr.dataset.idx = i;
    tr.innerHTML = `
      <td><span class="disk-color-dot" style="background:${color}"></span>${m.id}${isSel ? ' ✏' : ''}</td>
      <td><strong>${m.zoneDiamMm}</strong></td>
      <td>${m.diskDiamMm}</td>
    `;
    measurementsTbody.appendChild(tr);
  });

  // Coverage warning
  const dishCoverage = (dish.r * 2) / Math.max(canvasWidth, canvasHeight);
  const warningEl = document.getElementById('resultsWarning');
  if (dishCoverage < 0.4) {
    warningEl.textContent = '⚠ シャーレが画像の40%未満を占めています。精度向上のため、シャーレを画面いっぱいに撮影してください。';
    warningEl.style.display = 'block';
  } else {
    warningEl.style.display = 'none';
  }
}

// ── Adjust mode ───────────────────────────────────────────────────────────
function enterAdjustMode() {
  adjustState.active      = true;
  adjustState.selectedIdx = null;
  adjustState.dragMode    = null;
  adjustState.isDragging  = false;
  adjustToolbar.classList.add('visible');
  canvasWrap.classList.add('adjusting');
  btnAdjust.textContent = '✏ 調整中…';
  btnAdjust.classList.add('btn-warning-active');
  setHint('ディスクをタップして選択してください');
  drawCanvas();
  updateResultsUI();
}

function exitAdjustMode() {
  adjustState.active      = false;
  adjustState.selectedIdx = null;
  adjustState.dragMode    = null;
  adjustState.isDragging  = false;
  adjustToolbar.classList.remove('visible');
  canvasWrap.classList.remove('adjusting');
  if (btnAdjust) {
    btnAdjust.textContent = '✏ 手動調整';
    btnAdjust.classList.remove('btn-warning-active');
  }
  if (lastResult) { drawCanvas(); updateResultsUI(); }
}

function setHint(text) { adjustHint.textContent = text; }

btnAdjust.addEventListener('click', () => {
  if (adjustState.active) exitAdjustMode();
  else enterAdjustMode();
});

document.getElementById('btnAdjustDone').addEventListener('click', exitAdjustMode);

// ── Canvas pointer events (adjust mode) ──────────────────────────────────

function getCanvasCoords(e) {
  const rect  = resultCanvas.getBoundingClientRect();
  const scaleX = resultCanvas.width  / rect.width;
  const scaleY = resultCanvas.height / rect.height;
  const src    = e.touches ? e.touches[0] : e;
  return {
    x: (src.clientX - rect.left) * scaleX,
    y: (src.clientY - rect.top)  * scaleY,
  };
}

// Returns index of closest zone within tap range, or null
function hitTestForSelection(x, y) {
  if (!lastResult) return null;
  const HIT = 50; // canvas-px tap margin
  let best = null, bestDist = Infinity;
  lastResult.measurements.forEach((m, i) => {
    const { cx, cy } = m.disk;
    const zoneR = m.zoneRadius;
    const dist  = Math.hypot(x - cx, y - cy);
    if (dist < zoneR + HIT) {
      const d = Math.abs(dist - zoneR); // distance to zone perimeter
      if (d < bestDist) { bestDist = d; best = i; }
    }
  });
  return best;
}

resultCanvas.addEventListener('pointerdown', (e) => {
  if (!adjustState.active) return;
  e.preventDefault();
  resultCanvas.setPointerCapture(e.pointerId);
  const { x, y } = getCanvasCoords(e);
  adjustState.downX      = x;
  adjustState.downY      = y;
  adjustState.lastX      = x;
  adjustState.lastY      = y;
  adjustState.isDragging = false;
  adjustState.dragMode   = null;
});

resultCanvas.addEventListener('pointermove', (e) => {
  if (!adjustState.active) return;
  e.preventDefault();
  const { x, y } = getCanvasCoords(e);
  const moved = Math.hypot(x - adjustState.downX, y - adjustState.downY);

  // Start drag only after moving > 8px and if a zone is selected
  if (!adjustState.isDragging) {
    if (moved < 8 || adjustState.selectedIdx === null) return;
    // Determine drag mode from where the drag started
    const m      = lastResult.measurements[adjustState.selectedIdx];
    const { cx, cy, r: diskR } = m.disk;
    const distFromCenter = Math.hypot(adjustState.downX - cx, adjustState.downY - cy);
    adjustState.dragMode   = (distFromCenter < diskR * 2 + 20) ? 'center' : 'edge';
    adjustState.isDragging = true;
    setHint(adjustState.dragMode === 'center' ? '中心をドラッグして位置を変更中…' : '外縁をドラッグして半径を変更中…');
  }

  if (!adjustState.isDragging || adjustState.selectedIdx === null) return;

  const m = lastResult.measurements[adjustState.selectedIdx];

  if (adjustState.dragMode === 'center') {
    m.disk.cx += x - adjustState.lastX;
    m.disk.cy += y - adjustState.lastY;
  } else {
    const newR = Math.hypot(x - m.disk.cx, y - m.disk.cy);
    m.zoneRadius  = Math.max(m.disk.r * 1.2, newR);
    m.zoneDiamMm  = +(m.zoneRadius * 2 * lastResult.mmPerPx).toFixed(1);
    m.zoneDiamPx  = m.zoneRadius * 2;
  }

  adjustState.lastX = x;
  adjustState.lastY = y;
  drawCanvas();
  updateResultsUI();
});

resultCanvas.addEventListener('pointerup', (e) => {
  if (!adjustState.active) return;
  const { x, y } = getCanvasCoords(e);

  if (!adjustState.isDragging) {
    // Treat as tap — update selection
    const hit = hitTestForSelection(x, y);
    if (hit === null) {
      adjustState.selectedIdx = null;
      setHint('ディスクをタップして選択してください');
    } else {
      adjustState.selectedIdx = hit;
      setHint('中心付近をドラッグ→移動 ／ 外側をドラッグ→リサイズ');
    }
  } else {
    setHint(adjustState.selectedIdx !== null
      ? '中心付近をドラッグ→移動 ／ 外側をドラッグ→リサイズ'
      : 'ディスクをタップして選択してください');
  }

  adjustState.isDragging = false;
  adjustState.dragMode   = null;
  drawCanvas();
  updateResultsUI();
});

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
  // Draw without handles for the exported image
  const wasActive = adjustState.active;
  const wasSel    = adjustState.selectedIdx;
  adjustState.active      = false;
  adjustState.selectedIdx = null;
  drawCanvas(true);
  const link = document.createElement('a');
  link.download = `zone_measurement_${Date.now()}.png`;
  link.href     = resultCanvas.toDataURL('image/png');
  link.click();
  // Restore state
  adjustState.active      = wasActive;
  adjustState.selectedIdx = wasSel;
  if (wasActive) drawCanvas();
});

document.getElementById('btnExportCsv').addEventListener('click', () => {
  if (!lastResult) return;
  const lines = ['ディスク番号,阻止円直径(mm),ディスク直径(mm)'];
  lastResult.measurements.forEach(m => lines.push(`${m.id},${m.zoneDiamMm},${m.diskDiamMm}`));
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.download = `zone_measurement_${Date.now()}.csv`;
  link.href     = URL.createObjectURL(blob);
  link.click();
  URL.revokeObjectURL(link.href);
});
