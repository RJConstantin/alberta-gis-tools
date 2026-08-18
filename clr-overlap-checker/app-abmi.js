import { fromUrl } from 'https://cdn.jsdelivr.net/npm/geotiff@3.0.5/+esm';
import proj4 from 'https://cdn.jsdelivr.net/npm/proj4@2.21.0/+esm';
import * as turf from 'https://cdn.jsdelivr.net/npm/@turf/turf@7.2.0/+esm';

const ABMI_TIFF = 'https://ftp-public.abmi.ca//GISData/ABMIWetlandInventory/ABMIwetlandInventory.tif';
const ABMI_SOURCE = 'https://abmi.ca/data-portal/40.html';
const ABMI_CLASS = new Map([
  [0, 'Open water'],
  [1, 'Fen'],
  [2, 'Bog'],
  [3, 'Marsh'],
  [4, 'Swamp']
]);

const WGS84 = '+proj=longlat +datum=WGS84 +no_defs +type=crs';
const AB10TM = '+proj=tmerc +lat_0=0 +lon_0=-115 +k=0.9992 +x_0=500000 +y_0=0 +datum=NAD83 +units=m +no_defs +type=crs';
const nativeFetch = window.fetch.bind(window);
let imagePromise = null;

function resetCheckboxDefaults() {
  document.querySelectorAll('input[type="checkbox"]').forEach(input => {
    input.checked = false;
  });
}

resetCheckboxDefaults();
window.addEventListener('pageshow', resetCheckboxDefaults);

async function getAbmiImage() {
  if (!imagePromise) {
    imagePromise = fromUrl(ABMI_TIFF).then(tiff => tiff.getImage()).catch(error => {
      imagePromise = null;
      throw error;
    });
  }
  return imagePromise;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function projectedBoundsForWgs84Bbox(bbox) {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const corners = [
    [minLon, minLat], [minLon, maxLat], [maxLon, minLat], [maxLon, maxLat]
  ].map(coord => proj4(WGS84, AB10TM, coord));
  return [
    Math.min(...corners.map(c => c[0])),
    Math.min(...corners.map(c => c[1])),
    Math.max(...corners.map(c => c[0])),
    Math.max(...corners.map(c => c[1]))
  ];
}

function rasterWindow(image, bbox3400) {
  const [imgMinX, imgMinY, imgMaxX, imgMaxY] = image.getBoundingBox();
  const width = image.getWidth();
  const height = image.getHeight();
  const xRes = (imgMaxX - imgMinX) / width;
  const yRes = (imgMaxY - imgMinY) / height;
  const [minX, minY, maxX, maxY] = bbox3400;

  if (maxX < imgMinX || minX > imgMaxX || maxY < imgMinY || minY > imgMaxY) return null;

  const x0 = clamp(Math.floor((minX - imgMinX) / xRes), 0, width);
  const x1 = clamp(Math.ceil((maxX - imgMinX) / xRes), 0, width);
  const y0 = clamp(Math.floor((imgMaxY - maxY) / yRes), 0, height);
  const y1 = clamp(Math.ceil((imgMaxY - minY) / yRes), 0, height);

  if (x1 <= x0 || y1 <= y0) return null;
  return { x0, y0, x1, y1, xRes, yRes, imgMinX, imgMaxY };
}

function bufferedProjectPolygons(project) {
  const polygons = [];
  for (const feature of project.features || []) {
    if (!feature?.geometry) continue;
    try {
      const buffered = turf.buffer(feature, 0.0075, { units: 'kilometers' });
      if (buffered?.geometry && (buffered.geometry.type === 'Polygon' || buffered.geometry.type === 'MultiPolygon')) {
        polygons.push(buffered);
      }
    } catch {
      // Ignore an individual invalid feature and continue screening the rest.
    }
  }
  return polygons;
}

async function classesForBufferedFeature(image, feature, found) {
  const featureBbox = turf.bbox(feature);
  const windowInfo = rasterWindow(image, projectedBoundsForWgs84Bbox(featureBbox));
  if (!windowInfo) return;

  const { x0, y0, x1, y1, xRes, yRes, imgMinX, imgMaxY } = windowInfo;
  const rowWidth = x1 - x0;
  if (rowWidth <= 0) return;

  const maxCellsPerChunk = 350000;
  const rowsPerChunk = Math.max(1, Math.floor(maxCellsPerChunk / rowWidth));

  for (let startY = y0; startY < y1 && found.size < ABMI_CLASS.size; startY += rowsPerChunk) {
    const endY = Math.min(y1, startY + rowsPerChunk);
    const raster = await image.readRasters({
      window: [x0, startY, x1, endY],
      samples: [0],
      interleave: true
    });
    const chunkRows = endY - startY;

    for (let row = 0; row < chunkRows && found.size < ABMI_CLASS.size; row++) {
      for (let col = 0; col < rowWidth && found.size < ABMI_CLASS.size; col++) {
        const value = Number(raster[row * rowWidth + col]);
        const className = ABMI_CLASS.get(value);
        if (!className || found.has(className)) continue;

        const px = x0 + col;
        const py = startY + row;
        const x = imgMinX + (px + 0.5) * xRes;
        const y = imgMaxY - (py + 0.5) * yRes;
        const [lon, lat] = proj4(AB10TM, WGS84, [x, y]);

        if (turf.booleanPointInPolygon(turf.point([lon, lat]), feature)) {
          found.add(className);
        }
      }
    }
  }
}

window.__screenAbmiWetlands = async function screenAbmiWetlands(project) {
  const image = await getAbmiImage();
  const projectPolygons = bufferedProjectPolygons(project);
  if (!projectPolygons.length) {
    throw new Error('The uploaded geometry could not be prepared for ABMI wetland screening.');
  }

  const found = new Set();
  for (const polygon of projectPolygons) {
    await classesForBufferedFeature(image, polygon, found);
    if (found.size === ABMI_CLASS.size) break;
  }

  const order = ['Open water', 'Fen', 'Bog', 'Marsh', 'Swamp'];
  const hits = order.filter(name => found.has(name)).map(name => ({
    name,
    details: ['Mapped ABMI wetland class intersects the project'],
    contact: ''
  }));

  return {
    key: 'wetlands',
    title: 'ABMI Wetland Inventory',
    hits,
    note: 'ABMI province-wide Wetland Inventory (2021), 10 m raster. Screening only; mapped classes do not replace site-specific wetland delineation.'
  };
};

async function loadScreeningApp() {
  const response = await nativeFetch('./app.js', { cache: 'no-store' });
  if (!response.ok) throw new Error(`Could not load the screening application (HTTP ${response.status}).`);
  let source = await response.text();

  source = source.replace(
    /async function screenWetlands\(project,bbox\)\{[\s\S]*?\n\}\nasync function screenIndigenous/,
    "async function screenWetlands(project,bbox){\n  return window.__screenAbmiWetlands(project,bbox);\n}\nasync function screenIndigenous"
  );
  source = source.replaceAll('Alberta Merged Wetland Inventory', 'ABMI Wetland Inventory');
  source = source.replace(
    "wetlands: 'https://geospatial.alberta.ca/titan/rest/services/environment/alberta_merged_wetland_inventory/MapServer/3',",
    `wetlands: '${ABMI_SOURCE}',`
  );
  source = source.replace("{id:'screenWetlands',label:'Wetlands',run:screenWetlands}", "{id:'screenWetlands',label:'ABMI Wetland Inventory',run:screenWetlands}");
  source = source.replace('Select at least one Government of Alberta layer to screen.', 'Select at least one screening layer.');

  const moduleUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  try {
    await import(moduleUrl);
  } finally {
    URL.revokeObjectURL(moduleUrl);
  }
}

loadScreeningApp().catch(error => {
  console.error(error);
  const box = document.getElementById('statusBox');
  if (box) {
    box.hidden = false;
    box.className = 'status error';
    box.textContent = error?.message || 'The spatial screening application could not be loaded.';
  }
});
