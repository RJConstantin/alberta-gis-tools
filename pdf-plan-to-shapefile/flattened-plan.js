import * as pdfjsLib from 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.2.108/build/pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.2.108/build/pdf.worker.min.mjs';

const $ = (id) => document.getElementById(id);
let running = false;
let flattenedMode = false;
let currentFile = null;
let currentLegal = null;

function injectStyles() {
  if ($('flattenedPlanStyles')) return;
  const style = document.createElement('style');
  style.id = 'flattenedPlanStyles';
  style.textContent = `
    .flattened-only{display:none}
    body.flattened-plan-mode .flattened-only{display:block}
    body.flattened-plan-mode .flattened-coordinate-row{display:none!important}
    body.flattened-plan-mode .flattened-manual-details{display:none}
    body.flattened-plan-mode.show-plan-details .flattened-manual-details{display:grid}
    .flattened-banner{display:none;margin:0 0 18px;padding:14px 16px;border:1px solid #c8dbea;border-radius:9px;background:#eef5fb;color:#405d73;font-size:12px;line-height:1.5}
    body.flattened-plan-mode .flattened-banner{display:block}
    .flattened-banner strong{color:#172229}
    .position-panel{margin:18px 0 20px;border:1px solid #c9dceb;background:#f5f9fc;border-radius:11px;padding:18px}
    .position-panel h3{margin:5px 0 6px;font:700 18px/1.25 Arial,Helvetica,sans-serif;color:#172229}
    .position-panel p{margin:0 0 14px;color:#61717d;font-size:11px;line-height:1.55}
    .move-layout{display:grid;grid-template-columns:auto 1fr;gap:20px;align-items:center}
    .move-pad{display:grid;grid-template-columns:44px 44px 44px;grid-template-rows:40px 40px 40px;gap:5px;justify-content:start}
    .move-pad button,.rotate-controls button,.details-toggle{border:1px solid #b9ccdd;background:#fff;color:#2463a0;border-radius:6px;font-weight:700;cursor:pointer}
    .move-pad button{font-size:16px}.move-pad button:hover,.rotate-controls button:hover,.details-toggle:hover{background:#eaf2f9}
    .move-pad .north{grid-column:2;grid-row:1}.move-pad .west{grid-column:1;grid-row:2}.move-pad .centre{grid-column:2;grid-row:2;color:#6c7d89;font-size:10px;cursor:default}.move-pad .east{grid-column:3;grid-row:2}.move-pad .south{grid-column:2;grid-row:3}
    .move-options{display:grid;gap:11px}.move-options label{display:grid;gap:5px;color:#536675;font-size:11px;font-weight:700}.move-options select{height:35px;border:1px solid #c8d6e1;border-radius:6px;background:#fff;padding:0 8px;color:#172229}
    .rotate-controls{display:flex;gap:6px;flex-wrap:wrap}.rotate-controls button,.details-toggle{padding:8px 10px;font-size:11px}
    .flattened-note{margin-top:13px;padding-top:12px;border-top:1px solid #d9e5ef;color:#677784;font-size:10px;line-height:1.5}
    .meridian-row{margin:10px 0 0;padding:10px 12px;border:1px solid #d7e2ec;border-radius:7px;background:#f7fafc;font:12px Arial,Helvetica,sans-serif;color:#536776}
    .meridian-row select{margin-left:8px;padding:5px 7px;border:1px solid #c8d5df;border-radius:5px}
    @media(max-width:700px){.move-layout{grid-template-columns:1fr}}
  `;
  document.head.appendChild(style);
}

function prepareDom() {
  const lat = $('latInput');
  const coordRow = lat?.closest('.two-fields');
  if (coordRow) coordRow.classList.add('flattened-coordinate-row');

  const width = $('widthInput');
  const widthRow = width?.closest('.two-fields');
  if (widthRow) widthRow.classList.add('flattened-manual-details');
  const rotation = $('rotationInput');
  const rotationLabel = rotation?.closest('label');
  if (rotationLabel) rotationLabel.classList.add('flattened-manual-details');

  if (!$('flattenedBanner')) {
    const banner = document.createElement('div');
    banner.id = 'flattenedBanner';
    banner.className = 'flattened-banner';
    banner.innerHTML = '<strong>Image-based plan mode.</strong> The legal location is used only to open the correct LSD. The proposed pad is then positioned on the map before confirmation.';
    $('detectedBox')?.insertAdjacentElement('beforebegin', banner);
  }

  if (!$('flattenedPositionPanel')) {
    const panel = document.createElement('section');
    panel.id = 'flattenedPositionPanel';
    panel.className = 'position-panel flattened-only';
    panel.innerHTML = `
      <div class="step-label">Position pad</div>
      <h3>Move the proposed pad to the correct location.</h3>
      <p>The pad starts near the middle of the detected LSD only as a temporary starting point. Compare it with the PDF, satellite imagery and ATS grid.</p>
      <div class="move-layout">
        <div class="move-pad" aria-label="Move whole pad">
          <button type="button" class="north" data-move="north" title="Move north">↑</button>
          <button type="button" class="west" data-move="west" title="Move west">←</button>
          <button type="button" class="centre" tabindex="-1" aria-hidden="true">PAD</button>
          <button type="button" class="east" data-move="east" title="Move east">→</button>
          <button type="button" class="south" data-move="south" title="Move south">↓</button>
        </div>
        <div class="move-options">
          <label>Move each click
            <select id="moveStep">
              <option value="10">10 m</option>
              <option value="25" selected>25 m</option>
              <option value="50">50 m</option>
              <option value="100">100 m</option>
            </select>
          </label>
          <div>
            <div style="color:#536675;font-size:11px;font-weight:700;margin-bottom:5px">Rotate whole pad</div>
            <div class="rotate-controls">
              <button type="button" data-rotate="-1">−1°</button>
              <button type="button" data-rotate="-0.1">−0.1°</button>
              <button type="button" data-rotate="0.1">+0.1°</button>
              <button type="button" data-rotate="1">+1°</button>
            </div>
          </div>
          <button type="button" class="details-toggle" id="togglePlanDetails">Show / correct dimensions & bearing</button>
        </div>
      </div>
      <div class="flattened-note">The LSD centre is never treated as the final site location. Download remains locked until the map boundary is confirmed.</div>
    `;
    document.querySelector('.map-card')?.insertAdjacentElement('beforebegin', panel);
    panel.querySelectorAll('[data-move]').forEach((button) => button.addEventListener('click', () => movePad(button.dataset.move)));
    panel.querySelectorAll('[data-rotate]').forEach((button) => button.addEventListener('click', () => rotatePad(Number(button.dataset.rotate))));
    $('togglePlanDetails')?.addEventListener('click', () => document.body.classList.toggle('show-plan-details'));
  }
}

function enterFlattenedMode() {
  flattenedMode = true;
  document.body.classList.add('flattened-plan-mode');
  document.body.classList.remove('show-plan-details');
  if ($('locatePlan')) $('locatePlan').textContent = 'Locate LSD';
  if ($('applyRectangle')) $('applyRectangle').textContent = 'Create starting pad';
  $('ocrMeridianRow')?.remove();
}

function exitFlattenedMode() {
  flattenedMode = false;
  currentLegal = null;
  document.body.classList.remove('flattened-plan-mode', 'show-plan-details');
  $('ocrMeridianRow')?.remove();
  if ($('locatePlan')) $('locatePlan').textContent = 'Locate on map';
  if ($('applyRectangle')) $('applyRectangle').textContent = 'Build / reset rectangle';
}

function setValue(id, value) {
  const el = $(id);
  if (!el || value == null || value === '') return;
  el.value = String(value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

function clearFlattenedFields() {
  ['legalInput','latInput','lonInput','widthInput','heightInput'].forEach((id) => {
    const el = $(id);
    if (el) el.value = '';
  });
  if ($('rotationInput')) $('rotationInput').value = '0';
}

function cleanText(text) {
  return String(text || '').replace(/[–—]/g, '-').replace(/[|]/g, 'I').replace(/\s+/g, ' ').trim();
}

function detectMeridian(text) {
  const patterns = [
    /\bW\s*([456])\s*M\b/i,
    /\bWEST\s+OF\s+(?:THE\s+)?([456])(?:ST|ND|RD|TH)?\s+MERIDIAN\b/i,
    /\b([456])(?:ST|ND|RD|TH)\s+MERIDIAN\b/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return Number(m[1]);
  }
  return null;
}

function detectLegal(text) {
  const focused = text.match(/(?:PAD\s*SITE|WELL\s*SITE|SITE|PAD)[^0-9]{0,50}(\d{1,2})\s*-\s*(\d{1,2})\s*-\s*(\d{2,3})\s*-\s*(\d{1,2})/i);
  const general = text.match(/\b(\d{1,2})\s*-\s*(\d{1,2})\s*-\s*(\d{2,3})\s*-\s*(\d{1,2})\b/);
  const m = focused || general;
  if (!m) return null;
  const legal = { lsd:+m[1], sec:+m[2], twp:+m[3], rge:+m[4], mer:detectMeridian(text) };
  if (legal.lsd < 1 || legal.lsd > 16 || legal.sec < 1 || legal.sec > 36 || legal.twp < 1 || legal.twp > 126 || legal.rge < 1 || legal.rge > 34) return null;
  return legal;
}

function detectDimensions(text) {
  const nums = [...text.matchAll(/\b(\d{2,3}(?:[.,]\d{1,2})?)\s*(?:M|METRES?)?\b/gi)]
    .map((m) => Number(m[1].replace(',', '.')))
    .filter((v) => Number.isFinite(v) && v >= 20 && v <= 500);
  const counts = new Map();
  nums.forEach((v) => { const k = Math.round(v * 10) / 10; counts.set(k, (counts.get(k) || 0) + 1); });
  const ranked = [...counts.entries()].sort((a,b) => b[1]-a[1] || a[0]-b[0]);
  const repeated = ranked.find(([,count]) => count >= 2);
  if (!repeated) return null;
  return { width: repeated[0], height: repeated[0], count: repeated[1] };
}

function detectRotation(text) {
  const matches = [...text.matchAll(/\b(\d{1,3})\s*[°º]\s*(\d{1,2})\s*['’′]\s*(\d{1,2}(?:\.\d+)?)\s*[\"”″]?/g)];
  const options = matches.map((m) => {
    const bearing = +m[1] + (+m[2] / 60) + (+m[3] / 3600);
    const candidates = [bearing - 90, bearing - 270].sort((a,b) => Math.abs(a)-Math.abs(b));
    return { bearing, rotation:candidates[0] };
  }).filter((x) => x.bearing >= 0 && x.bearing < 360 && Math.abs(x.rotation) <= 45)
    .sort((a,b) => Math.abs(a.rotation)-Math.abs(b.rotation));
  return options[0] || null;
}

function formatBearing(value) {
  let d = Math.floor(value);
  const mf = (value - d) * 60;
  let m = Math.floor(mf);
  let s = Math.round((mf - m) * 60);
  if (s === 60) { s = 0; m += 1; }
  if (m === 60) { m = 0; d += 1; }
  return `${d}°${String(m).padStart(2,'0')}'${String(s).padStart(2,'0')}\"`;
}

async function inspectPdf(file) {
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjsLib.getDocument({ data }).promise;
  const page = await doc.getPage(1);
  const tc = await page.getTextContent();
  const nativeText = tc.items.map((item) => item.str).join(' ').replace(/\s+/g,' ').trim();
  if (nativeText.length > 80) return { flattened:false, nativeText, canvas:null };

  const base = page.getViewport({ scale:1 });
  const scale = Math.min(4.5, 3200 / base.width);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  await page.render({ canvasContext:canvas.getContext('2d',{willReadFrequently:true}), viewport }).promise;
  return { flattened:true, nativeText, canvas };
}

async function runOcr(canvas) {
  const mod = await import('https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.esm.min.js');
  const worker = await mod.createWorker('eng', 1, {
    logger:(m) => {
      if (m.status === 'recognizing text' && Number.isFinite(m.progress)) {
        $('pdfStatus').textContent = `Reading image-based plan… ${Math.round(m.progress * 100)}%`;
      }
    }
  });
  await worker.setParameters({ tessedit_pageseg_mode:'11', preserve_interword_spaces:'1' });
  const result = await worker.recognize(canvas);
  await worker.terminate();
  return cleanText(result?.data?.text || '');
}

function renderFindings(legal, dims, rotation) {
  const lines = ['<strong>Image-based plan detected.</strong>'];
  if (legal) lines.push(`Legal location: ${legal.lsd}-${legal.sec}-${legal.twp}-${legal.rge}${legal.mer ? `-W${legal.mer}M` : ''}`);
  if (dims) lines.push(`Likely pad size: ${dims.width} m × ${dims.height} m`);
  if (rotation) lines.push(`Likely top-edge bearing: ${formatBearing(rotation.bearing)}`);
  if (!legal && !dims) lines.push('The plan image was recognized, but the location or dimensions need a quick manual check.');
  lines.push('<span class="detected-note">The map confirmation is the final check.</span>');
  $('detectedBox').innerHTML = lines.join('<br>');
}

function showMeridianSelector(legal) {
  $('ocrMeridianRow')?.remove();
  const row = document.createElement('div');
  row.id = 'ocrMeridianRow';
  row.className = 'meridian-row';
  row.innerHTML = '<strong>Meridian was not readable.</strong> Choose it: <select id="ocrMeridian"><option value="">Select</option><option value="4">W4M</option><option value="5">W5M</option><option value="6">W6M</option></select>';
  $('detectedBox')?.insertAdjacentElement('afterend', row);
  $('ocrMeridian')?.addEventListener('change', (e) => {
    const mer = Number(e.target.value);
    if (!mer) return;
    legal.mer = mer;
    currentLegal = legal;
    setValue('legalInput', `${legal.lsd}-${legal.sec}-${legal.twp}-${legal.rge}-W${mer}M`);
    locateAndBuild();
  });
}

async function locateAndBuild() {
  if (!flattenedMode) return;
  $('locatePlan')?.click();
  const start = Date.now();
  const timer = setInterval(() => {
    const lat = Number($('latInput')?.value);
    const lon = Number($('lonInput')?.value);
    if (Number.isFinite(lat) && Number.isFinite(lon) && lat >= 48 && lat <= 61 && lon >= -121 && lon <= -109) {
      clearInterval(timer);
      if ($('widthInput')?.value && $('heightInput')?.value) {
        $('applyRectangle')?.click();
        setTimeout(zoomOut, 450);
        $('pdfStatus').textContent = 'Starting pad created inside the correct LSD. Move it to the actual site location, then confirm it on the map.';
      } else {
        document.body.classList.add('show-plan-details');
        $('pdfStatus').textContent = 'LSD located. Enter the pad dimensions shown on the plan, then click Create starting pad.';
      }
    } else if (Date.now() - start > 10000) clearInterval(timer);
  }, 200);
}

function offsetCoordinate(lat, lon, eastM, northM) {
  const r = 6378137;
  return [
    lat + (northM / r) * 180 / Math.PI,
    lon + (eastM / (r * Math.cos(lat * Math.PI / 180))) * 180 / Math.PI
  ];
}

function movePad(direction) {
  const lat = Number($('latInput')?.value);
  const lon = Number($('lonInput')?.value);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    $('pdfStatus').textContent = 'Locate the LSD first.';
    return;
  }
  const step = Number($('moveStep')?.value) || 25;
  let east = 0, north = 0;
  if (direction === 'north') north = step;
  if (direction === 'south') north = -step;
  if (direction === 'east') east = step;
  if (direction === 'west') east = -step;
  const [newLat,newLon] = offsetCoordinate(lat, lon, east, north);
  setValue('latInput', newLat.toFixed(7));
  setValue('lonInput', newLon.toFixed(7));
  $('applyRectangle')?.click();
  setTimeout(zoomOut, 300);
  $('pdfStatus').textContent = `Moved pad ${step} m ${direction}.`;
}

function rotatePad(delta) {
  const current = Number($('rotationInput')?.value) || 0;
  const next = current + delta;
  setValue('rotationInput', next.toFixed(2));
  if ($('widthInput')?.value && $('heightInput')?.value && $('latInput')?.value && $('lonInput')?.value) $('applyRectangle')?.click();
  setTimeout(zoomOut, 300);
  $('pdfStatus').textContent = `Pad rotation: ${next.toFixed(2)}°.`;
}

function zoomOut() {
  const button = document.querySelector('.leaflet-control-zoom-out');
  if (!button) return;
  button.click();
  setTimeout(() => button.click(), 75);
}

async function analyzeFile(file) {
  if (!file || running) return;
  running = true;
  currentFile = file;
  try {
    const inspected = await inspectPdf(file);
    if (!inspected.flattened) {
      exitFlattenedMode();
      return;
    }

    enterFlattenedMode();
    clearFlattenedFields();
    $('pdfConfidence').textContent = 'Image-based plan';
    $('pdfStatus').textContent = 'Image-based plan detected. Reading the plan for location, size and bearing…';

    let text = '';
    try {
      text = await runOcr(inspected.canvas);
    } catch (ocrError) {
      console.error('OCR unavailable', ocrError);
      $('detectedBox').innerHTML = '<strong>Image-based plan mode is active.</strong><br>Automatic reading did not start, so enter the legal location from the plan and use Locate LSD. The simplified positioning controls are still available.';
      $('pdfConfidence').textContent = 'Quick positioning mode';
      $('pdfStatus').textContent = 'Enter the legal location shown on the plan, then click Locate LSD.';
      document.body.classList.add('show-plan-details');
      return;
    }

    const legal = detectLegal(text);
    const dims = detectDimensions(text);
    const rotation = detectRotation(text);
    currentLegal = legal;

    if (legal) {
      if (legal.mer) setValue('legalInput', `${legal.lsd}-${legal.sec}-${legal.twp}-${legal.rge}-W${legal.mer}M`);
      else {
        setValue('legalInput', `${legal.lsd}-${legal.sec}-${legal.twp}-${legal.rge}`);
        showMeridianSelector(legal);
      }
    }
    if (dims) {
      setValue('widthInput', dims.width);
      setValue('heightInput', dims.height);
    }
    if (rotation) setValue('rotationInput', rotation.rotation.toFixed(2));

    renderFindings(legal, dims, rotation);
    $('pdfConfidence').textContent = legal || dims ? 'Plan details found' : 'Quick positioning mode';

    if (legal?.mer) await locateAndBuild();
    else if (legal) $('pdfStatus').textContent = 'Choose the meridian, then the tool will open the correct LSD and create the starting pad.';
    else {
      document.body.classList.add('show-plan-details');
      $('pdfStatus').textContent = 'Enter the legal location from the plan, then click Locate LSD. The pad can then be positioned with the arrow controls.';
    }
  } catch (err) {
    console.error(err);
    enterFlattenedMode();
    $('pdfConfidence').textContent = 'Quick positioning mode';
    $('pdfStatus').textContent = 'This plan could not be read automatically. Enter the legal location, click Locate LSD, then position the pad with the simplified controls.';
    document.body.classList.add('show-plan-details');
  } finally {
    running = false;
  }
}

function scheduleAnalyze(file) {
  currentFile = file;
  setTimeout(() => analyzeFile(file), 500);
}

injectStyles();
prepareDom();

$('planPdfInput')?.addEventListener('change', (e) => scheduleAnalyze(e.target.files?.[0]));
$('planPdfDrop')?.addEventListener('drop', (e) => scheduleAnalyze(e.dataTransfer?.files?.[0]));
