/**
 * ZoneProcessor — canvas-based image analysis for zone-of-inhibition measurement.
 *
 * Pipeline:
 *  1. Downsample image to ≤800px for speed
 *  2. Grayscale + Gaussian blur
 *  3. Detect petri dish (largest bright circle)
 *  4. Detect antibiotic disks (small dark blobs)
 *  5. Measure each zone via radial intensity profiling
 *  6. Scale pixel measurements to mm using dish diameter
 */
class ZoneProcessor {
  constructor() {
    this._offscreen = document.createElement('canvas');
    this._MAX_DIM = 800;
  }

  async analyze(imageElement, dishDiameterMm = 90) {
    const { canvas, scale } = this._prepareCanvas(imageElement);
    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;
    const imgData = ctx.getImageData(0, 0, width, height);

    this._emitStep('gray');
    const gray = this._toGrayscale(imgData);

    this._emitStep('blur');
    const blurred = this._gaussianBlur(gray, width, height, 2.5);

    this._emitStep('dish');
    const dish = this._detectPetriDish(blurred, gray, width, height);
    if (!dish) throw new Error('シャーレを検出できませんでした。明るい場所で撮り直してください。');

    this._emitStep('disks');
    const disks = this._detectDisks(blurred, width, height, dish, dishDiameterMm);
    // No throw on empty disks — show results screen so user can add zones manually.

    this._emitStep('zones');
    const mmPerPx = dishDiameterMm / (dish.r * 2);

    const measurements = disks.map((disk, i) => {
      const zoneR = this._measureZoneRadius(gray, disk, dish, width, height);
      const diskDiamPx  = disk.r * 2;
      const zoneDiamPx  = zoneR * 2;
      const diskDiamMm  = diskDiamPx  * mmPerPx;
      const zoneDiamMm  = zoneDiamPx  * mmPerPx;
      return {
        id: i + 1,
        disk: { ...disk },
        zoneRadius: zoneR,
        diskDiamMm:  +diskDiamMm.toFixed(1),
        zoneDiamMm:  +zoneDiamMm.toFixed(1),
        diskDiamPx,
        zoneDiamPx,
      };
    });

    return {
      dish,
      measurements,
      mmPerPx,
      canvasWidth: width,
      canvasHeight: height,
      imageScale: scale,
      imageData: imgData,
    };
  }

  // ── private: canvas prep ──────────────────────────────────────────────────

  _prepareCanvas(img) {
    const ow = img.naturalWidth  || img.width;
    const oh = img.naturalHeight || img.height;
    const scale = Math.min(1, this._MAX_DIM / Math.max(ow, oh));
    const w = Math.round(ow * scale);
    const h = Math.round(oh * scale);
    const canvas = this._offscreen;
    canvas.width  = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    return { canvas, scale };
  }

  // ── grayscale ─────────────────────────────────────────────────────────────

  _toGrayscale(imgData) {
    const { data, width, height } = imgData;
    const gray = new Float32Array(width * height);
    for (let i = 0; i < width * height; i++) {
      gray[i] = 0.299 * data[i*4] + 0.587 * data[i*4+1] + 0.114 * data[i*4+2];
    }
    return gray;
  }

  // ── Gaussian blur (separable) ─────────────────────────────────────────────

  _gaussianBlur(gray, width, height, sigma) {
    const { kernel, half } = this._makeGaussKernel(sigma);
    const tmp = new Float32Array(width * height);
    const out = new Float32Array(width * height);

    // horizontal pass
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let s = 0, w = 0;
        for (let k = -half; k <= half; k++) {
          const nx = x + k;
          if (nx >= 0 && nx < width) { s += gray[y*width+nx] * kernel[k+half]; w += kernel[k+half]; }
        }
        tmp[y*width+x] = s / w;
      }
    }
    // vertical pass
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let s = 0, w = 0;
        for (let k = -half; k <= half; k++) {
          const ny = y + k;
          if (ny >= 0 && ny < height) { s += tmp[ny*width+x] * kernel[k+half]; w += kernel[k+half]; }
        }
        out[y*width+x] = s / w;
      }
    }
    return out;
  }

  _makeGaussKernel(sigma) {
    const half = Math.ceil(sigma * 2.5);
    const kernel = [];
    for (let k = -half; k <= half; k++) {
      kernel.push(Math.exp(-(k*k) / (2*sigma*sigma)));
    }
    return { kernel, half };
  }

  // ── Petri dish detection ──────────────────────────────────────────────────
  // Strategy: threshold bright pixels → find centroid + radial extent.
  // Then refine radius by averaging distances of bright-edge pixels from centroid.

  _detectPetriDish(blurred, gray, width, height) {
    // Estimate a foreground threshold (dish agar vs. black background).
    // Use Otsu's binarisation on a histogram.
    const hist = new Int32Array(256);
    for (let i = 0; i < blurred.length; i++) hist[Math.round(blurred[i])]++;

    const total = width * height;
    let sum = 0;
    for (let i = 0; i < 256; i++) sum += i * hist[i];
    let sumB = 0, wB = 0, maxVar = 0, threshold = 40;
    for (let t = 0; t < 256; t++) {
      wB += hist[t];
      if (!wB) continue;
      const wF = total - wB;
      if (!wF) break;
      sumB += t * hist[t];
      const mB = sumB / wB;
      const mF = (sum - sumB) / wF;
      const var_ = wB * wF * (mB - mF) ** 2;
      if (var_ > maxVar) { maxVar = var_; threshold = t; }
    }
    threshold = Math.max(30, threshold - 10); // slightly below Otsu to include dim edges

    // Centroid of bright region
    let sx = 0, sy = 0, cnt = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (blurred[y*width+x] > threshold) { sx += x; sy += y; cnt++; }
      }
    }
    if (cnt < 100) return null;
    const cx = sx / cnt, cy = sy / cnt;

    // Radius: average of farthest bright pixels (sample at 72 angles)
    const radii = [];
    const NUM_ANGLES = 360;
    for (let a = 0; a < NUM_ANGLES; a++) {
      const theta = (a / NUM_ANGLES) * 2 * Math.PI;
      const cosT = Math.cos(theta), sinT = Math.sin(theta);
      // Scan outward from center; record last bright pixel
      let lastR = 0;
      const maxR = Math.min(cx, cy, width-cx, height-cy);
      for (let r = 10; r < maxR; r += 2) {
        const px = Math.round(cx + r * cosT);
        const py = Math.round(cy + r * sinT);
        if (px < 0 || px >= width || py < 0 || py >= height) break;
        if (blurred[py*width+px] > threshold) lastR = r;
      }
      if (lastR > 0) radii.push(lastR);
    }
    if (radii.length < 36) return null;

    // Use 80th percentile to be robust against notches / clip corners
    radii.sort((a, b) => a - b);
    const r = radii[Math.floor(radii.length * 0.80)];
    return { cx, cy, r };
  }

  // ── Disk detection ────────────────────────────────────────────────────────
  // Multi-pass: try progressively more sensitive thresholds until disks found.

  _detectDisks(blurred, width, height, dish, dishDiameterMm) {
    // Agar brightness: 65th percentile inside dish (above disk-pixel noise)
    const inside = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const dx = x - dish.cx, dy = y - dish.cy;
        if (dx*dx + dy*dy < (dish.r * 0.85)**2) inside.push(blurred[y*width+x]);
      }
    }
    inside.sort((a, b) => a - b);
    const agarMedian = inside[Math.floor(inside.length * 0.65)];

    // Use actual dish size for accurate area filter
    const mmPerPx   = dishDiameterMm / (dish.r * 2);
    const expectedR = 3 / mmPerPx;                        // 6mm disk → 3mm radius
    const minArea   = Math.PI * (expectedR * 0.20) ** 2;  // permissive lower bound
    const maxArea   = Math.PI * (expectedR * 3.50) ** 2;  // permissive upper bound
    const mergeDist = expectedR * 2.5;

    // Try thresholds from least to most sensitive; stop when candidates found
    for (const ratio of [0.68, 0.58, 0.48, 0.38]) {
      const thresh = agarMedian * ratio;
      const mask   = new Uint8Array(width * height);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const dx = x - dish.cx, dy = y - dish.cy;
          const inDish = dx*dx + dy*dy < (dish.r * 0.93)**2;
          mask[y*width+x] = (inDish && blurred[y*width+x] < thresh) ? 1 : 0;
        }
      }

      const components = this._connectedComponents(mask, width, height);
      const candidates = components
        .filter(c => c.pixels.length >= minArea && c.pixels.length <= maxArea)
        .map(c => {
          let sx = 0, sy = 0;
          for (const idx of c.pixels) { sx += idx % width; sy += Math.floor(idx / width); }
          const cx = sx / c.pixels.length;
          const cy = sy / c.pixels.length;
          const r  = Math.sqrt(c.pixels.length / Math.PI);
          return { cx, cy, r, area: c.pixels.length };
        });

      const merged = this._mergeDisks(candidates, mergeDist);
      if (merged.length > 0) return merged;
    }
    return [];
  }

  _connectedComponents(mask, width, height) {
    const labeled    = new Int32Array(width * height).fill(-1);
    const components = [];
    let label = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (!mask[y*width+x] || labeled[y*width+x] !== -1) continue;
        const pixels = [];
        const queue  = [y*width+x];
        labeled[y*width+x] = label;
        let qi = 0;
        while (qi < queue.length) {
          const idx = queue[qi++];
          pixels.push(idx);
          const px = idx % width, py = (idx - px) / width;
          for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
            const nx = px+dx, ny = py+dy;
            if (nx<0||nx>=width||ny<0||ny>=height) continue;
            const ni = ny*width+nx;
            if (mask[ni] && labeled[ni]===-1) { labeled[ni]=label; queue.push(ni); }
          }
        }
        components.push({ label, pixels });
        label++;
      }
    }
    return components;
  }

  _mergeDisks(disks, mergeDist) {
    const used   = new Array(disks.length).fill(false);
    const merged = [];
    for (let i = 0; i < disks.length; i++) {
      if (used[i]) continue;
      const group = [disks[i]];
      for (let j = i+1; j < disks.length; j++) {
        if (used[j]) continue;
        const dx = disks[i].cx - disks[j].cx, dy = disks[i].cy - disks[j].cy;
        if (Math.sqrt(dx*dx+dy*dy) < mergeDist) { group.push(disks[j]); used[j] = true; }
      }
      const cx = group.reduce((s,d)=>s+d.cx,0) / group.length;
      const cy = group.reduce((s,d)=>s+d.cy,0) / group.length;
      const r  = Math.sqrt(group.reduce((s,d)=>s+d.area,0) / Math.PI);
      merged.push({ cx, cy, r });
    }
    return merged;
  }

  // ── Zone measurement ──────────────────────────────────────────────────────
  // Radial intensity profiling: disk (dark) → clear zone (bright) → lawn (dim).

  _measureZoneRadius(gray, disk, dish, width, height) {
    const { cx, cy, r: diskR } = disk;
    const distToDishEdge = dish.r - Math.hypot(cx - dish.cx, cy - dish.cy);
    const maxSearchR     = Math.min(distToDishEdge * 0.97, dish.r * 0.88);

    const startR = Math.ceil(diskR * 1.1);
    if (maxSearchR <= startR) return diskR * 3;

    // 360-direction radial profile for finer angular resolution
    const NUM_ANGLES = 360;
    const angles  = Array.from({ length: NUM_ANGLES }, (_, a) => (a / NUM_ANGLES) * 2 * Math.PI);
    const profile = [];

    for (let r = startR; r < maxSearchR; r++) {
      let sum = 0, cnt = 0;
      for (const theta of angles) {
        const px = Math.round(cx + r * Math.cos(theta));
        const py = Math.round(cy + r * Math.sin(theta));
        if (px >= 0 && px < width && py >= 0 && py < height) { sum += gray[py*width+px]; cnt++; }
      }
      profile.push(cnt ? sum / cnt : 0);
    }

    const smoothed = this._smooth(profile, 11);

    // Peak brightness in profile (centre of clear zone)
    let maxVal = 0, maxIdx = 0;
    for (let i = 0; i < smoothed.length; i++) {
      if (smoothed[i] > maxVal) { maxVal = smoothed[i]; maxIdx = i; }
    }

    // 1) First drop below 75% of peak (zone→lawn intensity transition)
    const dropThresh = maxVal * 0.75;
    let boundaryIdx  = smoothed.length - 1;
    for (let i = maxIdx; i < smoothed.length; i++) {
      if (smoothed[i] < dropThresh) { boundaryIdx = i; break; }
    }

    // 2) Steepest descent point after peak
    let maxNegDeriv = 0, derivBoundary = boundaryIdx;
    for (let i = maxIdx + 1; i < smoothed.length - 1; i++) {
      const deriv = smoothed[i-1] - smoothed[i+1];
      if (deriv > maxNegDeriv) { maxNegDeriv = deriv; derivBoundary = i; }
    }

    // Take the earlier estimate (more conservative = inner edge of boundary)
    boundaryIdx = Math.min(boundaryIdx, derivBoundary);

    return startR + boundaryIdx;
  }

  _smooth(arr, w) {
    const half = Math.floor(w/2);
    return arr.map((_, i) => {
      let s = 0, cnt = 0;
      for (let j = -half; j <= half; j++) {
        if (i+j >= 0 && i+j < arr.length) { s += arr[i+j]; cnt++; }
      }
      return s/cnt;
    });
  }

  // ── Event helpers ─────────────────────────────────────────────────────────

  _emitStep(step) {
    document.dispatchEvent(new CustomEvent('processorStep', { detail: step }));
  }
}
