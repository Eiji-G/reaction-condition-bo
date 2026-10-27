import test from 'node:test';
import assert from 'node:assert/strict';
import {makeCandidates, conditionKey, suggest} from './optimizer.js';

const config={catalysts:'Cat A\nCat B',bases:'Base A\nBase B',solvents:'Solvent A',wavelengthList:'365\n370\n375',target:80};

test('builds the requested mixed search space',()=>{
  const space=makeCandidates(config);
  assert.equal(space.length,12);
  assert.deepEqual([...new Set(space.map(x=>x.wavelength))],[365,370,375]);
});

test('accepts wavelength candidates entered like base candidates',()=>{
  const space=makeCandidates({...config,wavelengthList:'365\n405\n450'});
  assert.equal(space.length,12);
  assert.deepEqual([...new Set(space.map(x=>x.wavelength))],[365,405,450]);
});

test('requires wavelength candidates as a fourth parameter',()=>{
  assert.throws(()=>makeCandidates({...config,wavelengthList:''}),/wavelength candidate/);
});

test('never recommends a measured condition and switches to GP after three results',()=>{
  const history=[];
  for(let i=0;i<4;i++){
    const result=suggest(config,history);
    assert.equal(result.phase,i<3?'Initial exploration':'Bayesian optimization');
    assert.ok(!history.some(row=>conditionKey(row)===conditionKey(result.condition)));
    history.push({...result.condition,yield:20+i*15});
  }
  const next=suggest(config,history);
  assert.ok(next.prediction);
  assert.ok(next.prediction.probabilityAtTarget>=0&&next.prediction.probabilityAtTarget<=1);
});

test('excludes history outside the current search space',()=>{
  const result=suggest(config,[{catalyst:'Old',base:'Base A',solvent:'Solvent A',wavelength:365,yield:99}]);
  assert.equal(result.observedCount,0);
  assert.equal(result.excludedCount,1);
});

test('excludes observations at wavelengths not in the selected candidates',()=>{
  const history=[{catalyst:'Cat A',base:'Base A',solvent:'Solvent A',wavelength:367.5,yield:55}];
  const result=suggest(config,history);
  assert.equal(result.observedCount,0);
  assert.equal(result.excludedCount,1);
  assert.ok([365,370,375].includes(result.condition.wavelength));
});

test('reports exhaustion',()=>{
  const one={...config,catalysts:'Cat A',bases:'Base A',wavelengthList:'365'};
  assert.throws(()=>suggest(one,[{...makeCandidates(one)[0],yield:90}]),/already been measured/);
});
