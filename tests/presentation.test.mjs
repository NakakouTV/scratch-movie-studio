import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeCut} from '../server/cuts.mjs';
import {OPERATIONS} from '../server/api.mjs';
import {Presentation} from '../server/presentation.mjs';
test('speech markers bind to semantic phases and survive persisted retakes',()=>{
 const raw={narration:{markers:[{id:'four',atMs:2400,text:'4にします'}]},beats:[{id:'number',text:'値を4にします',beforeMs:150,afterMs:400,actions:[{type:'block.input',block:'move',input:'STEPS',value:'4',cues:{'value.before':{at:'four'},'value.entered':{holdMs:300,mode:'freeze'}}}]}]};
 const first=normalizeCut(raw,OPERATIONS),again=normalizeCut(JSON.parse(JSON.stringify(first)),OPERATIONS);assert.deepEqual(again,first);assert.equal(first.beats[0].actions[0].cues['value.before'].atMs,2400);
});
test('legacy cuts still normalize and retake without beats or narration',()=>{
 const raw={actions:[{type:'wait',ms:100}]},a=normalizeCut(raw,OPERATIONS);assert.deepEqual(normalizeCut(a,OPERATIONS),a);
});
test('unknown markers, phases, mixed recipes and invalid timing reject before rendering',()=>{
 for(const raw of [{actions:[{type:'wait',cues:{before:{at:'missing'}}}]},{actions:[{type:'wait',cues:{wrong:{}}}]},{beats:[{actions:[]}],actions:[{type:'wait'}]},{timing:{move:-1}},{narration:{markers:[{id:'a',atMs:2},{id:'a',atMs:4}]}},{framing:{kind:'input'}},{beats:[{id:'a'},{id:'a'}]}])assert.throws(()=>normalizeCut(raw,OPERATIONS));
});
test('completed phases cannot pretend to synchronize actions already performed',()=>{
 assert.throws(()=>normalizeCut({actions:[{type:'variable.create',name:'x',cues:{created:{atMs:2000}}}]},OPERATIONS),/直前/);
 assert.throws(()=>normalizeCut({setup:[{type:'wait',cues:{before:{holdMs:100}}}]},OPERATIONS),/録画する/);
 assert.throws(()=>normalizeCut({beats:[{before:[{type:'variables',names:['x','x']}]}]},OPERATIONS),/重複/);
});
test('beat confirmation precedes the marker and scoped timing is restored',async()=>{
 let clock=0;const seen=[],base={move:45,drag:75,type:7,pause:20};
 const c={options:{},timing:{...base},editorZoom:1,settleCursor:async()=>{},page:{evaluate:async fn=>String(fn).includes('scrollX')?{x:0,y:0}:false},execute:async function(a){await this.options.onPhase('before');seen.push({clock,timing:{...this.timing}});await this.options.onPhase('after');}};
 const recipe=normalizeCut({beats:[{atMs:500,beforeMs:200,afterMs:300,timing:{move:100},actions:[{type:'wait',timing:{move:10}}]}]},OPERATIONS),p=new Presentation(c,{origin:0},recipe,async ms=>{clock+=ms;});p.now=()=>clock;
 await p.run([],recipe.beats);assert.equal(seen[0].clock,500);assert.equal(seen[0].timing.move,10);assert.deepEqual(c.timing,base);assert.equal(clock,800);assert.equal(p.events.find(e=>e.type==='marker').lateMs,0);
});
