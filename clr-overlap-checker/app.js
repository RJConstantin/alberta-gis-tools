import shp from 'https://cdn.jsdelivr.net/npm/shpjs@6.2.0/+esm';
import * as turf from 'https://cdn.jsdelivr.net/npm/@turf/turf@7.2.0/+esm';

const URLS = {
  clr: 'https://geospatial.alberta.ca/titan/rest/services/cadastre/crownland_reservation/MapServer',
  ats: 'https://geospatial.alberta.ca/titan/rest/services/base/alberta_township_system/MapServer/20',
  hrv: 'https://geospatial.alberta.ca/titan/rest/services/society/ct_listing_of_historic_resources_public/MapServer',
  parks: 'https://geospatial.alberta.ca/titan/rest/services/boundary/parks_protected_areas_alberta/FeatureServer/0',
  pluz: 'https://geospatial.alberta.ca/titan/rest/services/base/land_use_management_10tm_nad83_aep/MapServer/1',
  caribouRange: 'https://geospatial.alberta.ca/titan/rest/services/biota/wildlife_sensitivity_mammals_10tm_nad83_aep/MapServer/180',
  caribouZoneA: 'https://geospatial.alberta.ca/titan/rest/services/biota/wildlife_sensitivity_mammals_10tm_nad83_aep/MapServer/7',
  caribouZoneB: 'https://geospatial.alberta.ca/titan/rest/services/biota/wildlife_sensitivity_mammals_10tm_nad83_aep/MapServer/9',
  specialStreams: 'https://geospatial.alberta.ca/titan/rest/services/boundary/fish_and_wildlife_administrative_area_10tm_nad83_aep_v2/MapServer/9',
  specialLakes: 'https://geospatial.alberta.ca/titan/rest/services/boundary/fish_and_wildlife_administrative_area_10tm_nad83_aep_v2/MapServer/13',
  wetlands: 'https://geospatial.alberta.ca/titan/rest/services/environment/alberta_merged_wetland_inventory/MapServer/3',
  firstNations: 'https://geospatial.alberta.ca/titan/rest/services/boundaries/federal_indian_reserve/FeatureServer/0',
  metis: 'https://geospatial.alberta.ca/titan/rest/services/boundaries/municipal_metis_settlement_public/FeatureServer/0',
  greenWhite: 'https://geospatial.alberta.ca/titan/rest/services/boundary/asrd_administrative_area/MapServer/1'
};

const CLR_FIELDS = [
  'OBJECTID','ReservationNumber','CategoryDescription','PurposeTypeDescription','Intent','Company','StatusCode','RemarkText',
  'ActionCode1','ActionDescription1','SectorCode1','SectorName1',
  'ActionCode2','ActionDescription2','SectorCode2','SectorName2',
  'ActionCode3','ActionDescription3','SectorCode3','SectorName3',
  'ActionCode4','ActionDescription4','SectorCode4','SectorName4',
  'AddContactName1','AddContactPhone1','AddContactEmail1',
  'AddContactName2','AddContactPhone2','AddContactEmail2',
  'AddContactName3','AddContactPhone3','AddContactEmail3'
].join(',');
const ATS_FIELDS = 'OBJECTID,M,RGE,TWP,SEC,QS,LS,RA,DESCRIPTOR';
const HRV_LAYERS = [1,2,3,4,5].map((hrv, index) => ({ hrv, url: `${URLS.hrv}/${4 + index * 4}` }));
const CLR_LAYERS = [
  {id:0,label:'Application',checkbox:'applicationLayer'},
  {id:1,label:'Active',checkbox:'activeLayer'},
  {id:2,label:'Cancelled',checkbox:'cancelledLayer'}
];
const SCREEN_CHECKS = [
  'screenClr','screenHistoric','screenParks','screenPluz','screenCaribou','screenSpecialWaters','screenWetlands','screenIndigenous','screenGreenWhite'
];
const HRV_CATEGORY = {
  a:'Archaeological', c:'Cultural', gl:'Geological', h:'Historical Period', n:'Natural', p:'Palaeontological'
};
const PARK_TYPES = {
  NP:'National Park', WA:'Wilderness Area', ER:'Ecological Reserve', WP:'Willmore Wilderness Park',
  WPP:'Wildland Park', PP:'Provincial Park', HR:'Heritage Rangeland', NA:'Natural Area', PRA:'Provincial Recreation Area'
};

const $ = id => document.getElementById(id);
const fileInput=$('fileInput'), dropzone=$('dropzone'), fileName=$('fileName');
const checkButton=$('checkButton'), clearButton=$('clearButton'), statusBox=$('statusBox');
const resultCard=$('resultCard'), resultTitle=$('resultTitle'), resultCopy=$('resultCopy');
const layersChecked=$('layersChecked'), layersFlagged=$('layersFlagged'), findingsCount=$('findingsCount');
const overview=$('screenOverview'), resultSections=$('resultSections'), resultActions=$('resultActions'), csvButton=$('csvButton');
let selectedFile=null;
let lastExportRows=[];

function showStatus(message,kind='normal'){
  statusBox.hidden=false;
  statusBox.className='status'+(kind==='warn'?' warn':kind==='error'?' error':'');
  statusBox.textContent=message;
}
function hideStatus(){statusBox.hidden=true;statusBox.textContent='';statusBox.className='status'}
function resetResults(){resultCard.hidden=true;overview.innerHTML='';resultSections.innerHTML='';resultActions.hidden=true;lastExportRows=[]}
function clearAll(){selectedFile=null;fileInput.value='';fileName.textContent='';checkButton.disabled=true;clearButton.disabled=true;hideStatus();resetResults()}
function setFile(file){
  resetResults();hideStatus();
  if(!file)return clearAll();
  if(!file.name.toLowerCase().endsWith('.zip')){
    selectedFile=null;fileName.textContent='';checkButton.disabled=true;clearButton.disabled=true;
    showStatus('Please upload a ZIP containing the shapefile.','error');return;
  }
  selectedFile=file;fileName.textContent=file.name;checkButton.disabled=false;clearButton.disabled=false;
}
fileInput.addEventListener('change',()=>setFile(fileInput.files[0]));
clearButton.addEventListener('click',clearAll);
['dragenter','dragover'].forEach(type=>dropzone.addEventListener(type,e=>{e.preventDefault();dropzone.classList.add('dragging')}));
['dragleave','drop'].forEach(type=>dropzone.addEventListener(type,e=>{e.preventDefault();dropzone.classList.remove('dragging')}));
dropzone.addEventListener('drop',e=>{const file=e.dataTransfer.files[0];if(file)setFile(file)});
$('selectAll').addEventListener('click',()=>SCREEN_CHECKS.forEach(id=>$(id).checked=true));
$('clearLayers').addEventListener('click',()=>SCREEN_CHECKS.forEach(id=>$(id).checked=false));

function normalizeGeoJson(parsed){
  const collections=Array.isArray(parsed)?parsed:[parsed],features=[];
  for(const collection of collections){
    if(!collection)continue;
    if(collection.type==='FeatureCollection') for(const f of collection.features||[]) if(f&&f.geometry)features.push(f);
    else if(collection.type==='Feature'&&collection.geometry)features.push(collection);
  }
  return turf.featureCollection(features);
}
function coordinatesLookGeographic(fc){
  try{const b=turf.bbox(fc);return b.every(Number.isFinite)&&b[0]>=-180&&b[2]<=180&&b[1]>=-90&&b[3]<=90}catch{return false}
}
function safeIntersects(a,b){try{return turf.booleanIntersects(a,b)}catch{return false}}
function isPolygon(f){return f&&f.geometry&&(f.geometry.type==='Polygon'||f.geometry.type==='MultiPolygon')}
function exactPolygonOverlap(a,b){
  if(!isPolygon(a)||!isPolygon(b))return null;
  try{return turf.intersect(turf.featureCollection([a,b]))}catch{return null}
}
function hitsProject(projectFeatures, serviceFeature){return projectFeatures.some(project=>safeIntersects(project,serviceFeature))}
function filterHits(projectFeatures, serviceFeatures){return serviceFeatures.filter(feature=>hitsProject(projectFeatures,feature))}
function esc(value){return String(value??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function clean(value){return String(value??'').trim()}
function uniqueBy(items,keyFn){const map=new Map();for(const item of items){const key=keyFn(item);if(!map.has(key))map.set(key,item)}return [...map.values()]}
function firstProp(p,names){for(const name of names){const value=clean(p?.[name]);if(value)return value}return ''}

async function queryGeoJson(url,bbox,{outFields='*',maxFeatures=5000,pageSize=1000}={}){
  const all=[];let offset=0,truncated=false;
  while(offset<maxFeatures){
    const count=Math.min(pageSize,maxFeatures-offset);
    const params=new URLSearchParams({
      where:'1=1',geometry:bbox.join(','),geometryType:'esriGeometryEnvelope',inSR:'4326',spatialRel:'esriSpatialRelIntersects',
      outFields,returnGeometry:'true',outSR:'4326',resultOffset:String(offset),resultRecordCount:String(count),f:'geojson'
    });
    const response=await fetch(`${url}/query`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},body:params.toString()});
    if(!response.ok)throw new Error(`A Government of Alberta service returned HTTP ${response.status}.`);
    const data=await response.json();
    if(data.error)throw new Error(data.error.message||'A Government of Alberta service returned an error.');
    const batch=data.features||[];all.push(...batch);
    if(batch.length<count)break;
    offset+=batch.length;
    if(offset>=maxFeatures){truncated=true;break}
  }
  return {features:all,truncated};
}

async function queryClrLayer(layer,bbox){
  const result=await queryGeoJson(`${URLS.clr}/${layer.id}`,bbox,{outFields:CLR_FIELDS,maxFeatures:5000,pageSize:1000});
  return result.features.map(f=>({...f,_layerLabel:layer.label,_layerId:layer.id}));
}
async function queryAts(bbox){return (await queryGeoJson(URLS.ats,bbox,{outFields:ATS_FIELDS,maxFeatures:5000,pageSize:1000})).features}

function extractActions(p){
  const out=[];
  for(let i=1;i<=4;i++){
    const action=clean(p[`ActionDescription${i}`]||p[`ActionCode${i}`]);
    const sector=clean(p[`SectorName${i}`]||p[`SectorCode${i}`]);
    if(action)out.push({action,sector});
  }
  return uniqueBy(out,x=>`${x.action}|${x.sector}`);
}
function extractClrContacts(p){
  const out=[];
  for(let i=1;i<=3;i++){
    const name=clean(p[`AddContactName${i}`]),phone=clean(p[`AddContactPhone${i}`]),email=clean(p[`AddContactEmail${i}`]);
    if(name||phone||email)out.push({name,phone,email});
  }
  return uniqueBy(out,x=>`${x.name}|${x.phone}|${x.email}`);
}
function extractWaterContacts(p){
  const out=[];
  for(let i=1;i<=4;i++){
    const name=clean(p[`CONT${i}`]),position=clean(p[`POS${i}`]),phone=clean(p[`PHONE${i}`]),email=clean(p[`EMAIL${i}`]);
    if(name||position||phone||email)out.push({name,position,phone,email});
  }
  return uniqueBy(out,x=>`${x.name}|${x.position}|${x.phone}|${x.email}`);
}
function rawAts(feature){
  const p=feature.properties||{},m=Number(p.M),r=Number(p.RGE),t=Number(p.TWP),s=Number(p.SEC),ls=Number(p.LS),qs=clean(p.QS);
  if(Number.isFinite(ls)&&ls>=1&&ls<=16&&Number.isFinite(s)&&Number.isFinite(t)&&Number.isFinite(r)&&Number.isFinite(m))return {ls,s,t,r,m,label:`${ls}-${s}-${t}-${r}-W${m}M`};
  if(qs&&Number.isFinite(s)&&Number.isFinite(t)&&Number.isFinite(r)&&Number.isFinite(m))return {qs,s,t,r,m,label:`${qs}-${s}-${t}-${r}-W${m}M`};
  const label=clean(p.DESCRIPTOR);return label?{label}:null;
}
function compactAtsLocations(rawLocations){
  const groups=new Map(),fallback=[];
  for(const loc of rawLocations){
    if(loc&&Number.isFinite(loc.s)&&Number.isFinite(loc.t)&&Number.isFinite(loc.r)&&Number.isFinite(loc.m)&&Number.isFinite(loc.ls)){
      const key=`${loc.s}|${loc.t}|${loc.r}|${loc.m}`;
      if(!groups.has(key))groups.set(key,{s:loc.s,t:loc.t,r:loc.r,m:loc.m,ls:new Set()});
      groups.get(key).ls.add(loc.ls);
    }else if(loc?.label)fallback.push(loc.label);
  }
  const output=[];
  const sorted=[...groups.values()].sort((a,b)=>a.m-b.m||a.t-b.t||a.r-b.r||a.s-b.s);
  for(const g of sorted){
    const lsd=[...g.ls].sort((a,b)=>a-b);
    if(lsd.length===16&&lsd.every((v,i)=>v===i+1))output.push(`Sec. ${g.s}-${g.t}-${g.r}-W${g.m}M`);
    else output.push(`LSD ${lsd.join(', ')}, Sec. ${g.s}-${g.t}-${g.r}-W${g.m}M`);
  }
  return [...new Set([...output,...fallback])];
}
function atsForFeature(target,projectFeatures,atsFeatures){
  const exact=[],fallback=[];
  for(const project of projectFeatures){
    if(!safeIntersects(project,target))continue;
    const overlap=exactPolygonOverlap(project,target);
    if(overlap)exact.push(overlap);else fallback.push(project);
  }
  const raw=[];
  for(const ats of atsFeatures){
    let hit=false;
    if(exact.length)hit=exact.some(overlap=>safeIntersects(overlap,ats));
    if(!hit&&fallback.length)hit=fallback.some(project=>safeIntersects(project,ats)&&safeIntersects(target,ats));
    if(hit){const parsed=rawAts(ats);if(parsed)raw.push(parsed)}
  }
  return compactAtsLocations(raw);
}
function buildClrRow(clr,ats){
  const p=clr.properties||{};
  return {
    status:clr._layerLabel||p.StatusCode||'',reservation:p.ReservationNumber||'',category:p.CategoryDescription||'',
    purpose:p.PurposeTypeDescription||'',intent:p.Intent||'',holder:p.Company||'',actions:extractActions(p),contacts:extractClrContacts(p),
    remarks:p.RemarkText||'',ats
  };
}
function mergeClrRows(rows){
  const map=new Map();
  rows.forEach((row,index)=>{
    const key=`${row.status}|${row.reservation||index}`;
    if(!map.has(key)){map.set(key,{...row,ats:[...row.ats],actions:[...row.actions],contacts:[...row.contacts]});return}
    const x=map.get(key);
    x.ats=[...new Set([...x.ats,...row.ats])];
    x.actions=uniqueBy([...x.actions,...row.actions],a=>`${a.action}|${a.sector}`);
    x.contacts=uniqueBy([...x.contacts,...row.contacts],c=>`${c.name}|${c.phone}|${c.email}`);
    if(!x.holder&&row.holder)x.holder=row.holder;if(!x.category&&row.category)x.category=row.category;if(!x.purpose&&row.purpose)x.purpose=row.purpose;if(!x.intent&&row.intent)x.intent=row.intent;if(!x.remarks&&row.remarks)x.remarks=row.remarks;
  });
  return [...map.values()].sort((a,b)=>(a.reservation||'').localeCompare(b.reservation||'',undefined,{numeric:true}));
}

function expandHrvCategories(value){
  const text=clean(value).toLowerCase();if(!text)return '';
  const codes=text.split(/[\s,;/|]+/).filter(Boolean);
  const labels=codes.map(code=>HRV_CATEGORY[code]||code.toUpperCase());
  return [...new Set(labels)].join(', ');
}
function simpleEntry(name,details=[],contact=''){return {name,details:details.filter(Boolean),contact}}
function dedupeEntries(entries){return uniqueBy(entries,e=>`${e.name}|${e.details.join('|')}|${e.contact}`)}

async function screenClr(project,bbox){
  const layers=CLR_LAYERS.filter(l=>$(l.checkbox).checked);
  if(!layers.length)return {key:'clr',title:'Crown Land Reservations',hits:[],clrRows:[],note:'No CLR status was selected.'};
  const queried=(await Promise.all(layers.map(l=>queryClrLayer(l,bbox)))).flat();
  const overlapping=filterHits(project.features,queried);
  let clrRows=[];
  if(overlapping.length){
    showStatus('CLR overlap found. Resolving ATS legal locations...');
    const atsFeatures=await queryAts(bbox);
    clrRows=mergeClrRows(overlapping.map(clr=>buildClrRow(clr,atsForFeature(clr,project.features,atsFeatures))));
  }
  return {key:'clr',title:'Crown Land Reservations',hits:clrRows.map(row=>({name:row.reservation||'Reservation number unavailable'})),clrRows,note:'Live Crown Land Reservation service.'};
}

async function screenHistoric(project,bbox){
  const queried=await Promise.all(HRV_LAYERS.map(async layer=>({layer,features:(await queryGeoJson(layer.url,bbox,{outFields:'*',maxFeatures:5000})).features})));
  const entries=[];
  for(const {layer,features} of queried){
    for(const feature of filterHits(project.features,features)){
      const p=feature.properties||{},hrv=p.HRV||layer.hrv,category=expandHrvCategories(p.CATEGORY),ats=clean(p.ATS);
      entries.push(simpleEntry(`HRV ${hrv}${category?` · ${category}`:''}`,[ats?`GOA listed ATS: ${ats}`:'']));
    }
  }
  return {key:'historic',title:'Historic Resources',hits:dedupeEntries(entries),note:'HRV 1 is the highest protection value and HRV 5 the lowest.'};
}
async function screenParks(project,bbox){
  const features=(await queryGeoJson(URLS.parks,bbox,{outFields:'NAME,TYPE,SUBTYPE,STATUS,OC_NO,NOTES',maxFeatures:5000})).features;
  const entries=filterHits(project.features,features).map(feature=>{
    const p=feature.properties||{},type=PARK_TYPES[p.TYPE]||clean(p.TYPE);
    return simpleEntry(clean(p.NAME)||'Protected area',[type,clean(p.SUBTYPE),p.STATUS?`Status: ${p.STATUS}`:'',p.OC_NO?`Order-in-Council: ${p.OC_NO}`:'']);
  });
  return {key:'parks',title:'Parks & Protected Areas',hits:dedupeEntries(entries),note:'Includes provincial protected-area designations and national parks in the GOA dataset.'};
}
async function screenPluz(project,bbox){
  const features=(await queryGeoJson(URLS.pluz,bbox,{outFields:'PLUZ_NAME,PLUZ_CODE,TYPE',maxFeatures:5000})).features;
  const entries=filterHits(project.features,features).map(feature=>{const p=feature.properties||{};return simpleEntry(clean(p.PLUZ_NAME)||'Public Land Use Zone',[clean(p.TYPE),p.PLUZ_CODE?`Code: ${p.PLUZ_CODE}`:''])});
  return {key:'pluz',title:'Public Land Use Zones',hits:dedupeEntries(entries),note:'PLUZ areas have land-use controls under the Public Lands Administration Regulation.'};
}
async function screenCaribou(project,bbox){
  const [rangeData,zoneAData,zoneBData]=await Promise.all([
    queryGeoJson(URLS.caribouRange,bbox,{outFields:'*',maxFeatures:5000}),queryGeoJson(URLS.caribouZoneA,bbox,{outFields:'*',maxFeatures:5000}),queryGeoJson(URLS.caribouZoneB,bbox,{outFields:'*',maxFeatures:5000})
  ]);
  const entries=[];
  for(const feature of filterHits(project.features,rangeData.features)){
    const p=feature.properties||{},range=firstProp(p,['LOCALRANGE','RANGE','LOCAL_RANGE']),sub=firstProp(p,['SUBUNIT','SUB_UNIT']),status=firstProp(p,['STATUS']);
    entries.push(simpleEntry(range||sub||'Caribou Range',[sub&&sub!==range?`Sub-unit: ${sub}`:'',status?`Status: ${status}`:'']));
  }
  const zoneEntries=(features,zoneLabel)=>filterHits(project.features,features).map(feature=>{
    const p=feature.properties||{},name=firstProp(p,['LOCALNAME','LOCALRANGE','RANGE','SUBUNIT','NAME']);
    return simpleEntry(`${zoneLabel}${name?` · ${name}`:''}`,[]);
  });
  entries.push(...zoneEntries(zoneAData.features,'Caribou Zone A'),...zoneEntries(zoneBData.features,'Caribou Zone B'));
  return {key:'caribou',title:'Caribou Range & Zones',hits:dedupeEntries(entries),note:'Government of Alberta states that specific operating conditions apply to caribou ranges.'};
}
async function screenSpecialWaters(project,bbox){
  const [streamData,lakeData]=await Promise.all([
    queryGeoJson(URLS.specialStreams,bbox,{outFields:'*',maxFeatures:5000}),queryGeoJson(URLS.specialLakes,bbox,{outFields:'*',maxFeatures:5000})
  ]);
  const entries=[];
  const add=(feature,kind)=>{
    const p=feature.properties||{},name=clean(p.NAME)||'Unnamed waterbody',contacts=extractWaterContacts(p);
    const details=[p.WB_ID?`FWMIS Waterbody ID: ${p.WB_ID}`:'',kind==='Stream'&&p.STR_ORDER?`Strahler order: ${p.STR_ORDER}`:'',clean(p.SPECIES_PR)?`Species: ${clean(p.SPECIES_PR)}`:'',clean(p.District)?`District: ${clean(p.District)}`:'',clean(p.Region)?`Region: ${clean(p.Region)}`:''];
    const contact=contacts.map(c=>[c.name,c.position,c.phone,c.email].filter(Boolean).join(' · ')).join('; ');
    entries.push(simpleEntry(`${kind}: ${name}`,details,contact));
  };
  filterHits(project.features,streamData.features).forEach(f=>add(f,'Stream'));
  filterHits(project.features,lakeData.features).forEach(f=>add(f,'Lake / Reservoir'));
  return {key:'specialWaters',title:'Special Waters (RL-PAAS)',hits:dedupeEntries(entries),note:'Special Waters are used for RL-PAAS screening and may require approval from the responsible fisheries biologist before work proceeds under that licence.'};
}
async function screenWetlands(project,bbox){
  const data=await queryGeoJson(URLS.wetlands,bbox,{outFields:'CWCS_Class,Extent',maxFeatures:5000});
  const hits=filterHits(project.features,data.features),counts=new Map();
  for(const feature of hits){const cls=clean(feature.properties?.CWCS_Class)||'Unclassified';counts.set(cls,(counts.get(cls)||0)+1)}
  const entries=[...counts.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([cls,count])=>simpleEntry(cls,[`${count} intersecting mapped polygon${count===1?'':'s'}`]));
  const note='Regional screening inventory. GOA states this dataset is not a replacement for site-specific wetland information and source inventories span 1998–2015.'+(data.truncated?' The query reached the 5,000-feature safety limit.':'');
  return {key:'wetlands',title:'Alberta Merged Wetland Inventory',hits:entries,note};
}
async function screenIndigenous(project,bbox){
  const [fnData,metisData]=await Promise.all([
    queryGeoJson(URLS.firstNations,bbox,{outFields:'IRES_NAME,IRES_CODE',maxFeatures:5000}),queryGeoJson(URLS.metis,bbox,{outFields:'METIS_NAME,METIS_CODE',maxFeatures:5000})
  ]);
  const entries=[];
  for(const feature of filterHits(project.features,fnData.features)){const p=feature.properties||{};entries.push(simpleEntry(`First Nations Reserve: ${clean(p.IRES_NAME)||'Unnamed reserve'}`,[p.IRES_CODE?`Code: ${p.IRES_CODE}`:'']))}
  for(const feature of filterHits(project.features,metisData.features)){const p=feature.properties||{};entries.push(simpleEntry(`Métis Settlement: ${clean(p.METIS_NAME)||'Unnamed settlement'}`,[p.METIS_CODE?`Code: ${p.METIS_CODE}`:'']))}
  return {key:'indigenous',title:'First Nations Reserves & Métis Settlements',hits:dedupeEntries(entries),note:'Boundary screening only. This does not determine consultation requirements.'};
}
async function screenGreenWhite(project,bbox){
  const features=(await queryGeoJson(URLS.greenWhite,bbox,{outFields:'GWA_NAME,GWA_CODE',maxFeatures:5000})).features;
  const entries=filterHits(project.features,features).map(feature=>{const p=feature.properties||{};return simpleEntry(clean(p.GWA_NAME)||'Green / White Area',[p.GWA_CODE?`Code: ${p.GWA_CODE}`:''])});
  return {key:'greenWhite',title:'Green / White Area',hits:dedupeEntries(entries),note:'GOA administrative Green/White Area boundary.'};
}

function renderActions(actions){
  if(!actions.length)return '<span class="muted">No action published in the CLR attributes.</span>';
  return actions.map(a=>`<span class="action-row"><span class="action-name">${esc(a.action)}</span>${a.sector?` <span class="sector">· ${esc(a.sector)}</span>`:''}</span>`).join('');
}
function renderClrContacts(contacts,remarks){
  let html='';
  if(contacts.length){
    html=contacts.map(c=>{const bits=[];if(c.name)bits.push(`<strong>${esc(c.name)}</strong>`);if(c.phone)bits.push(esc(c.phone));if(c.email)bits.push(`<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>`);return `<span class="contact-row">${bits.join(' · ')}</span>`}).join('');
  }else html='<span class="muted">No structured contact information is published for this reservation.</span>';
  if(!contacts.length&&remarks)html+=`<div class="remarks"><strong>Reservation remarks:</strong> ${esc(remarks)}</div>`;
  return html;
}
function renderAts(ats){return ats.length?`<div class="ats-wrap">${ats.map(x=>`<span class="ats-chip">${esc(x)}</span>`).join('')}</div>`:'<span class="muted">ATS location could not be resolved.</span>'}
function renderClrRows(rows){
  if(!rows.length)return '';
  return `<div class="clr-list">${rows.map(row=>`<article class="clr-item">
    <div class="result-head"><h3>${esc(row.reservation||'Reservation number unavailable')}</h3><span class="status-pill hit">${esc(row.status)}</span></div>
    <div class="detail-grid">
      <div class="detail wide"><span class="detail-label">Required Action(s)</span><div class="detail-value">${renderActions(row.actions)}</div></div>
      <div class="detail wide"><span class="detail-label">ATS Location(s) of Intersection</span><div class="detail-value">${renderAts(row.ats)}</div></div>
      <div class="detail"><span class="detail-label">Reservation Holder</span><div class="detail-value">${esc(row.holder||'Not provided')}</div></div>
      <div class="detail"><span class="detail-label">Reservation Holder Contact</span><div class="detail-value">${renderClrContacts(row.contacts,row.remarks)}</div></div>
      <div class="detail"><span class="detail-label">Category</span><div class="detail-value">${esc(row.category||'Not provided')}</div></div>
      <div class="detail"><span class="detail-label">Purpose</span><div class="detail-value">${esc(row.purpose||'Not provided')}</div></div>
      <div class="detail wide"><span class="detail-label">Management Intent</span><div class="detail-value">${esc(row.intent||'Not provided')}</div></div>
    </div>
  </article>`).join('')}</div>`;
}
function renderSimpleEntries(hits){
  if(!hits.length)return '<div class="no-hit">No overlap found.</div>';
  return `<div class="finding-list">${hits.map(hit=>`<div class="finding-row"><div class="finding-main"><strong>${esc(hit.name)}</strong>${hit.details?.length?`<div class="finding-details">${hit.details.map(esc).join(' · ')}</div>`:''}${hit.contact?`<div class="finding-contact">${esc(hit.contact)}</div>`:''}</div></div>`).join('')}</div>`;
}
function renderResults(groups){
  const flagged=groups.filter(g=>!g.failed&&g.hits.length>0);
  overview.innerHTML=groups.map(group=>{
    const state=group.failed?'failed':group.hits.length?'flagged':'clear';
    const label=group.failed?'Check failed':group.hits.length?`${group.hits.length} found`:'No overlap';
    return `<div class="overview-item ${state}"><span>${esc(group.title)}</span><strong>${label}</strong></div>`;
  }).join('');
  resultSections.innerHTML=groups.map(group=>{
    const state=group.failed?'failed':group.hits.length?'hit':'clear';
    const label=group.failed?'Check failed':group.hits.length?`${group.hits.length} found`:'Clear';
    const body=group.failed?'<div class="no-hit failed-message">This Government of Alberta service could not be checked during this run.</div>':group.key==='clr'?renderClrRows(group.clrRows||[]):renderSimpleEntries(group.hits);
    return `<section class="screen-section">
      <div class="screen-section-head"><div><h3>${esc(group.title)}</h3>${group.note?`<p>${esc(group.note)}</p>`:''}</div><span class="status-pill ${state}">${label}</span></div>
      ${body}
    </section>`;
  }).join('');
  return flagged.length;
}
function buildExportRows(groups){
  const rows=[];
  for(const group of groups){
    if(group.key==='clr'){
      for(const r of group.clrRows||[]){
        const actions=r.actions.map(a=>a.sector?`${a.action} (${a.sector})`:a.action).join('; ');
        const contacts=r.contacts.map(c=>[c.name,c.phone,c.email].filter(Boolean).join(' | ')).join('; ');
        rows.push({layer:group.title,finding:r.reservation,details:[`Status: ${r.status}`,`Actions: ${actions}`,`Holder: ${r.holder}`,`Category: ${r.category}`,`Purpose: ${r.purpose}`,`Intent: ${r.intent}`].filter(x=>!x.endsWith(': ')).join(' | '),ats:r.ats.join('; '),contact:contacts||r.remarks});
      }
    }else{
      for(const hit of group.hits)rows.push({layer:group.title,finding:hit.name,details:(hit.details||[]).join(' | '),ats:'',contact:hit.contact||''});
    }
  }
  return rows;
}
function csvCell(value){const s=String(value??'');return /[",\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s}
function downloadCsv(){
  const headers=['Screening Layer','Finding','Details','ATS Intersections','Contact / Notes'];
  const lines=[headers.map(csvCell).join(',')];
  for(const row of lastExportRows)lines.push([row.layer,row.finding,row.details,row.ats,row.contact].map(csvCell).join(','));
  const blob=new Blob([lines.join('\n')],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download='GOA_Spatial_Screening_Results.csv';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),500);
}
csvButton.addEventListener('click',downloadCsv);

const SCREENERS = [
  {id:'screenClr',label:'Crown Land Reservations',run:screenClr},
  {id:'screenHistoric',label:'Historic Resources',run:screenHistoric},
  {id:'screenParks',label:'Parks & Protected Areas',run:screenParks},
  {id:'screenPluz',label:'Public Land Use Zones',run:screenPluz},
  {id:'screenCaribou',label:'Caribou Range & Zones',run:screenCaribou},
  {id:'screenSpecialWaters',label:'Special Waters',run:screenSpecialWaters},
  {id:'screenWetlands',label:'Wetlands',run:screenWetlands},
  {id:'screenIndigenous',label:'First Nations & Métis Lands',run:screenIndigenous},
  {id:'screenGreenWhite',label:'Green / White Area',run:screenGreenWhite}
];

checkButton.addEventListener('click',async()=>{
  if(!selectedFile)return;
  const selected=SCREENERS.filter(s=>$(s.id).checked);
  if(!selected.length){showStatus('Select at least one Government of Alberta layer to screen.','warn');return}
  if($('screenClr').checked&&!CLR_LAYERS.some(l=>$(l.checkbox).checked)){showStatus('Select at least one CLR status, or turn off Crown Land Reservations.','warn');return}
  checkButton.disabled=true;resetResults();showStatus('Reading the shapefile in your browser...');
  try{
    const parsed=await shp(await selectedFile.arrayBuffer());
    const project=normalizeGeoJson(parsed);
    if(!project.features.length)throw new Error('No spatial features were found in the ZIP.');
    if(!coordinatesLookGeographic(project))throw new Error('The shapefile could not be converted to latitude and longitude. Make sure the ZIP contains the correct .prj file.');
    const bbox=turf.bbox(project),groups=[];
    for(let i=0;i<selected.length;i++){
      const screener=selected[i];showStatus(`Checking ${screener.label} (${i+1} of ${selected.length})...`);
      try{groups.push(await screener.run(project,bbox))}
      catch(error){groups.push({key:screener.id,title:screener.label,hits:[],note:`Service check failed: ${error?.message||'Unknown error'}`,failed:true})}
    }
    const flagged=renderResults(groups),totalFindings=groups.reduce((sum,g)=>sum+(g.failed?0:g.hits.length),0),failed=groups.filter(g=>g.failed).length;
    layersChecked.textContent=String(groups.length);layersFlagged.textContent=String(flagged);findingsCount.textContent=String(totalFindings);
    resultTitle.textContent=flagged?'GOA screening results':'No selected constraints found';
    const baseCopy=flagged?`${flagged} of ${groups.length} selected screening categories returned one or more intersecting features.`:`None of the successfully checked screening categories returned an intersecting feature.`;
    resultCopy.textContent=failed?`${baseCopy} ${failed} service check${failed===1?' was':'s were'} not completed.`:baseCopy;
    lastExportRows=buildExportRows(groups);resultActions.hidden=!lastExportRows.length;resultCard.hidden=false;hideStatus();resultCard.scrollIntoView({behavior:'smooth',block:'start'});
  }catch(error){showStatus(error?.message||'The spatial screening could not be completed.','error')}
  finally{checkButton.disabled=false}
});
