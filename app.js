import {normalizeNames, wavelengthValues, configuredWavelengths, makeCandidates, conditionKey, suggest} from './optimizer.js';

const STORAGE_KEY = 'reaction-bo-v1';
const $ = id => document.getElementById(id);
const defaultConfig = {substrate:'', catalysts:'', bases:'', solvents:'', wavelengthList:'', target:80};
let state = load();
let currentRecommendation = null;

function migrateConfig(saved) {
  const config={...defaultConfig,...saved};
  if (!String(config.wavelengthList||'').trim() && saved.wavelengthMin!==undefined) {
    try { config.wavelengthList=wavelengthValues(saved.wavelengthMin,saved.wavelengthMax,saved.wavelengthStep).join('\n'); }
    catch (_) { /* keep the original data so the user can repair the setup */ }
  }
  delete config.wavelengthMin; delete config.wavelengthMax; delete config.wavelengthStep;
  return config;
}

function load() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (data && typeof data === 'object' && data.config && Array.isArray(data.history)) {
      return {config:migrateConfig(data.config), history:data.history};
    }
  } catch (_) { /* corrupted browser data: start with an empty campaign */ }
  return {config:{...defaultConfig}, history:[]};
}
function persist() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
function show(message, error=false) {
  const box = $('message'); box.textContent=message; box.className=error?'error':''; box.hidden=false;
  window.clearTimeout(show.timer); show.timer=window.setTimeout(()=>{box.hidden=true;},6000);
}
function configFromForm() {
  return {
    substrate:$('substrate').value.trim(), catalysts:$('catalysts').value, bases:$('bases').value, solvents:$('solvents').value,
    wavelengthList:$('wavelengthList').value, target:Number($('target').value)
  };
}
function fillForm() {
  for (const [key,value] of Object.entries(state.config)) if ($(key)) $(key).value=value;
}
function fillSelect(id, values) {
  const select=$(id), previous=select.value; select.replaceChildren();
  for (const value of values) {
    const option=document.createElement('option'); option.value=String(value); option.textContent=String(value); select.append(option);
  }
  if (values.map(String).includes(previous)) select.value=previous;
}
function refreshSelectors() {
  const c=state.config;
  fillSelect('record-catalyst', normalizeNames(c.catalysts));
  fillSelect('record-base', normalizeNames(c.bases));
  fillSelect('record-solvent', normalizeNames(c.solvents));
  try { fillSelect('record-wavelength', configuredWavelengths(c)); }
  catch (_) { fillSelect('record-wavelength',[]); }
}
function create(tag, text, className) {
  const element=document.createElement(tag); element.textContent=text; if(className) element.className=className; return element;
}
function renderHistory() {
  const body=$('history-body'); body.replaceChildren();
  $('history-count').textContent=`${state.history.length} ${state.history.length===1?'result':'results'}`;
  if (!state.history.length) {
    const tr=document.createElement('tr'),td=create('td','No results yet.','empty-row'); td.colSpan=8;tr.append(td);body.append(tr);return;
  }
  for (const row of [...state.history].reverse()) {
    const tr=document.createElement('tr');
    const items=[row.date||'',row.catalyst,row.base,row.solvent,`${row.wavelength} nm`,`${Number(row.yield).toFixed(1)}%`,row.note||''];
    for (let i=0;i<items.length;i++) tr.append(create('td',items[i],i===5?(Number(row.yield)>=Number(state.config.target)?'yield-good':'yield-other'):''));
    const cell=document.createElement('td'),button=create('button','Delete','delete-button');button.type='button';
    button.addEventListener('click',()=>{if(!window.confirm('Delete this experiment result?'))return;state.history=state.history.filter(x=>x.id!==row.id);persist();currentRecommendation=null;render();show('Experiment result deleted.');});
    cell.append(button);tr.append(cell);body.append(tr);
  }
}
function renderRecommendation() {
  const box=$('recommendation');box.replaceChildren();
  if (!currentRecommendation) {box.className='recommendation empty';box.textContent='Add your candidates to see a suggested experiment here.';$('phase').textContent='Ready';return;}
  box.className='recommendation';$('phase').textContent=currentRecommendation.phase;
  const head=create('div','','reco-head');head.append(create('strong','Suggested condition'),create('span',`Based on ${currentRecommendation.observedCount} ${currentRecommendation.observedCount===1?'result':'results'}`));box.append(head);
  const grid=create('div','','reco-grid');
  for (const [label,key,unit] of [['Catalyst','catalyst',''],['Base','base',''],['Solvent','solvent',''],['Wavelength','wavelength',' nm']]) {
    const item=create('div','','reco-item');item.append(create('small',label),create('b',`${currentRecommendation.condition[key]}${unit}`));grid.append(item);
  }
  box.append(grid);
  if (currentRecommendation.prediction) {
    const p=currentRecommendation.prediction;
    const prediction=create('div','','prediction');
    prediction.append(create('strong',`Predicted yield ${Math.max(0,Math.min(100,p.mean)).toFixed(1)}%`),
      document.createTextNode(` · Model uncertainty ±${p.sd.toFixed(1)} percentage points · Chance of reaching target ${(p.probabilityAtTarget*100).toFixed(0)}%`));
    box.append(prediction);
  } else box.append(create('div','With fewer than three results, the tool first explores diverse conditions.','prediction'));
  if (currentRecommendation.excludedCount) box.append(create('div',`${currentRecommendation.excludedCount} ${currentRecommendation.excludedCount===1?'result was':'results were'} outside the search space and excluded from the model.`,'prediction'));
  const use=create('button','Use this condition in the result form →','reco-use');use.type='button';use.addEventListener('click',()=>{
    const c=currentRecommendation.condition;
    $('record-catalyst').value=c.catalyst;$('record-base').value=c.base;$('record-solvent').value=c.solvent;$('record-wavelength').value=String(c.wavelength);
    $('record-yield').focus();
  });box.append(use);
}
function render() {
  try {const count=makeCandidates(state.config).length;$('space-count').textContent=`${count.toLocaleString('en-US')} ${count===1?'condition':'conditions'}`;} catch (_) {$('space-count').textContent='Not set';}
  refreshSelectors();renderHistory();renderRecommendation();
}
function download(name,content,type) {
  const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function csvCell(value) {return `"${String(value??'').replaceAll('"','""')}"`;}

$('save-config').addEventListener('click',()=>{
  try {const config=configFromForm();makeCandidates(config);if(!Number.isFinite(config.target)||config.target<0||config.target>100)throw new Error('Enter a target yield between 0% and 100%.');
    state.config=config;currentRecommendation=null;persist();render();show('Search space saved.');
  } catch (e) {show(e.message,true);}
});
$('suggest').addEventListener('click',()=>{
  try {currentRecommendation=suggest(state.config,state.history);renderRecommendation();show('Next condition suggested.');}
  catch(e){show(e.message,true);}
});
$('record').addEventListener('click',()=>{
  try {
    const choices=makeCandidates(state.config);
    const row={catalyst:$('record-catalyst').value,base:$('record-base').value,solvent:$('record-solvent').value,wavelength:Number($('record-wavelength').value),yield:Number($('record-yield').value),note:$('record-note').value.trim()};
    if($('record-yield').value.trim()===''||!Number.isFinite(row.yield)||row.yield<0||row.yield>100)throw new Error('Enter a yield between 0% and 100%.');
    if(!choices.some(x=>conditionKey(x)===conditionKey(row)))throw new Error('Select a condition within the search space.');
    row.id=globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random()}`;row.date=new Date().toLocaleDateString('en-CA');
    state.history.push(row);persist();currentRecommendation=null;$('record-yield').value='';$('record-note').value='';render();show(row.yield>=Number(state.config.target)?'Result saved. Target yield reached!':'Result saved.');
  } catch(e){show(e.message,true);}
});
$('export-json').addEventListener('click',()=>download('reaction-bo-backup.json',JSON.stringify({format:'reaction-bo-v1',...state},null,2),'application/json'));
$('export-csv').addEventListener('click',()=>{
  const keys=['date','catalyst','base','solvent','wavelength','yield','note'];
  const lines=[keys.map(csvCell).join(','),...state.history.map(row=>keys.map(k=>csvCell(row[k])).join(','))];
  download('reaction-bo-results.csv','\ufeff'+lines.join('\r\n'),'text/csv;charset=utf-8');
});
$('import-json').addEventListener('change',async event=>{
  try {
    const file=event.target.files?.[0];if(!file)return;const data=JSON.parse(await file.text());
    if(data.format!=='reaction-bo-v1'||!data.config||!Array.isArray(data.history))throw new Error('Select a backup file created by this tool.');
    const config=migrateConfig(data.config);makeCandidates(config);
    if(!Number.isFinite(Number(config.target))||Number(config.target)<0||Number(config.target)>100)throw new Error('The backup has an invalid target yield.');
    const history=data.history.map(row=>({id:String(row.id||`${Date.now()}-${Math.random()}`),date:String(row.date||''),catalyst:String(row.catalyst||''),base:String(row.base||''),solvent:String(row.solvent||''),wavelength:Number(row.wavelength),yield:Number(row.yield),note:String(row.note||'')}));
    if(history.some(x=>!Number.isFinite(x.wavelength)||!Number.isFinite(x.yield)||x.yield<0||x.yield>100))throw new Error('The backup contains invalid experiment results.');
    if(!window.confirm(`Replace your current data with ${history.length} ${history.length===1?'result':'results'} from this backup?`))return;
    state={config,history};persist();currentRecommendation=null;fillForm();render();show('Backup restored.');
  } catch(e){show(e.message,true);}finally{event.target.value='';}
});

fillForm();render();
