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
const measurementsTbody = document.getElementById('measurementsTbody');
const summaryDisks      = document.getElementById('summaryDisks');
const summaryAvg        = document.getElementById('summaryAvg');
const summaryMin        = document.getElementById('summaryMin');
const summaryMax        = document.getElementById('summaryMax');

const processor = new ZoneProcessor();
let lastResult  = null;

// ── Screen transitions ────────────────────────────────────────────────────
function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name].classList.add('active');
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
  if (!file.type.startsWith('image/')) {
    showError('preview', '画像ファイルを選択してください。');
    return;
  }
  const url = URL.createObjectURL(file);
  previewImg.onload = () => {
    URL.revokeObjectURL(url);
    showScreen('preview');
  };
  previewImg.src = url;
  fileInput.value = '';
});

// ── Preview screen buttons ────────────────────────────────────────────────
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
  // Mark all previous as done, current as active
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
  showScreen('processing');

  // Let the screen render before heavy computation
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

  try {
    const result = await processor.analyze(previewImg, dishMm);
    lastResult = result;

    // Mark last step done
    Object.values(STEPS).forEach(el => el.classList.add('done'));
    await new Promise(r => setTimeout(r, 300));

    renderResults(result);
    showScreen('results');
  } catch (err) {
    console.error(err);
    showScreen('preview');
    const alertBox = document.getElementById('previewAlert');
    alertBox.textContent = `⚠ ${err.message}`;
    alertBox.style.display = 'block';
  }
}

// ── Render results ────────────────────────────────────────────────────────
function renderResults(result) {
  const { dish, measurements, mmPerPx, canvasWidth, canvasHeight, imageData } = result;

  // --- Canvas ---
  resultCanvas.width  = canvasWidth;
  resultCanvas.height = canvasHeight;
  const ctx = resultCanvas.getContext('2d');

  // Draw original image
  ctx.putImageData(imageData, 0, 0);

  // Draw petri dish outline
  ctx.beginPath();
  ctx.arc(dish.cx, dish.cy, dish.r, 0, Math.PI*2);
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.stroke();
  ctx.setLineDash([]);

  // Draw each disk and zone
  measurements.forEach((m, i) => {
    const color = DISK_COLORS[i % DISK_COLORS.length];
    const { cx, cy, r: diskR } = m.disk;
    const zoneR = m.zoneRadius;

    // Zone circle
    ctx.beginPath();
    ctx.arc(cx, cy, zoneR, 0, Math.PI*2);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.globalAlpha = 0.85;
    ctx.stroke();

    // Zone fill (faint)
    ctx.beginPath();
    ctx.arc(cx, cy, zoneR, 0, Math.PI*2);
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.08;
    ctx.fill();
    ctx.globalAlpha = 1;

    // Disk circle
    ctx.beginPath();
    ctx.arc(cx, cy, diskR, 0, Math.PI*2);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Diameter line
    ctx.beginPath();
    ctx.moveTo(cx - zoneR, cy);
    ctx.lineTo(cx + zoneR, cy);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.7;
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Label
    const label = `${i+1}: ${m.zoneDiamMm} mm`;
    ctx.font = `bold ${Math.max(11, Math.round(canvasWidth/55))}px sans-serif`;
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 3;
    ctx.strokeText(label, cx - zoneR + 3, cy - 5);
    ctx.fillStyle = color;
    ctx.fillText(label, cx - zoneR + 3, cy - 5);
  });

  // --- Summary cards ---
  const zones = measurements.map(m => m.zoneDiamMm);
  summaryDisks.textContent = zones.length;
  summaryAvg.textContent   = zones.length ? (zones.reduce((a,b)=>a+b,0)/zones.length).toFixed(1) : '-';
  summaryMin.textContent   = zones.length ? Math.min(...zones).toFixed(1) : '-';
  summaryMax.textContent   = zones.length ? Math.max(...zones).toFixed(1) : '-';

  // --- Table ---
  measurementsTbody.innerHTML = '';
  measurements.forEach((m, i) => {
    const color = DISK_COLORS[i % DISK_COLORS.length];
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><span class="disk-color-dot" style="background:${color}"></span>${m.id}</td>
      <td><strong>${m.zoneDiamMm}</strong></td>
      <td>${m.diskDiamMm}</td>
    `;
    measurementsTbody.appendChild(tr);
  });

  // Show warning if dish was very small in image
  const dishCoverage = (dish.r * 2) / Math.max(canvasWidth, canvasHeight);
  const warningEl = document.getElementById('resultsWarning');
  if (dishCoverage < 0.4) {
    warningEl.textContent = '⚠ シャーレが画像の40%未満を占めています。精度向上のため、シャーレを画面いっぱいに撮影してください。';
    warningEl.style.display = 'block';
  } else {
    warningEl.style.display = 'none';
  }
}

// ── Results buttons ───────────────────────────────────────────────────────
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
  const link = document.createElement('a');
  link.download = `zone_measurement_${Date.now()}.png`;
  link.href = resultCanvas.toDataURL('image/png');
  link.click();
});

document.getElementById('btnExportCsv').addEventListener('click', () => {
  if (!lastResult) return;
  const { measurements } = lastResult;
  const lines = ['ディスク番号,阻止円直径(mm),ディスク直径(mm)'];
  measurements.forEach(m => lines.push(`${m.id},${m.zoneDiamMm},${m.diskDiamMm}`));
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.download = `zone_measurement_${Date.now()}.csv`;
  link.href = URL.createObjectURL(blob);
  link.click();
  URL.revokeObjectURL(link.href);
});

// ── Utility ───────────────────────────────────────────────────────────────
function showError(screen, msg) {
  console.error(msg);
}
