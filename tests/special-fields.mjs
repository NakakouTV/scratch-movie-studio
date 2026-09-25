import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {EditorController} from '../server/controller.mjs';
import {blankProject,readSb3} from '../server/project.mjs';
const c=await new EditorController('http://127.0.0.1:8601',{timing:{move:50,drag:200,type:5,pause:50}}).open();
const expected=[];
async function add(id,opcode){await c.execute({type:'block.add',sourceId:id,opcode,place:{x:400,y:300}});}
async function check(a,value=a.value){
 await c.execute(a);
 const id=c.resolve(a.block),input=a.input?c.mappedInput(a.block,a.input):undefined;
 const field=await c.page.evaluate(({id,input,name})=>studio.fieldInfo(id,input,name),{id,input,name:a.field});
 assert.equal(String(field.value).toLowerCase(),String(value).toLowerCase(),JSON.stringify(a));
 expected.push({id,input,field:field.name,value:String(field.value)});
}
try{
 const buffer=await fs.readFile('PEN動作確認.sb3');await c.load(buffer);await c.load(await blankProject(buffer));await c.selectTarget('ペン');
 await add('pen','pen_setPenColorToColor');
 const colour=c.colour;let pickerCount=0;
 c.colour=async function(...args){
  assert.equal(await this.page.locator('.scratchColourSlider:visible').count(),3);
  pickerCount++;if(pickerCount===1)await this.page.screenshot({path:'test-results/special-colour-picker.png'});
  return colour.apply(this,args);
 };
 for(const value of ['#2bff00','#000000','#ffffff','#010203'])await check({type:'block.input',block:'pen',input:'COLOR',value});
 await check({type:'block.field',block:'pen',input:'COLOR',field:'COLOUR',value:'#Ab09EF'});
 assert.equal(pickerCount,5);
 await assert.rejects(c.execute({type:'block.input',block:'pen',input:'COLOR',value:'invalid'}),/#rrggbb/);
 assert.equal(await c.page.locator('.scratchColourSlider:visible').count(),0);
 await add('touch','sensing_touchingcolor');await check({type:'block.input',block:'touch',input:'COLOR',value:'#2bff00'});
 await add('compare','sensing_coloristouchingcolor');
 await check({type:'block.field',block:'compare',input:'COLOR',field:'COLOUR',value:'#123456'});
 await check({type:'block.input',block:'compare',input:'COLOR2',value:'#abcdef'});
 console.log('pen and sensing colours, both APIs, exact RGB and invalid colour recovery PASS');
 await add('angle','motion_pointindirection');await check({type:'block.input',block:'angle',input:'DIRECTION',value:'-135'});
 await check({type:'block.field',block:'angle',input:'DIRECTION',field:'NUM',value:'37.5'});
 await add('number','motion_movesteps');await check({type:'block.input',block:'number',input:'STEPS',value:'-0.125'});
 await add('text','looks_say');await check({type:'block.input',block:'text',input:'MESSAGE',value:'日本語 123'});
 console.log('angle picker, negative decimal and text PASS');
 await add('param','pen_setPenColorParamTo');await check({type:'block.input',block:'param',input:'COLOR_PARAM',value:'transparency'});
 await check({type:'block.input',block:'param',input:'VALUE',value:'75.5'});
 await add('math','operator_mathop');await check({type:'block.field',block:'math',field:'OPERATOR',value:'floor'});
 await add('key','event_whenkeypressed');await check({type:'block.field',block:'key',field:'KEY_OPTION',value:'left arrow'});
 await add('goto','motion_goto');await check({type:'block.input',block:'goto',input:'TO',value:'_random_'});
 await add('costume','looks_switchcostumeto');await check({type:'block.input',block:'costume',input:'COSTUME',value:'点'});
 await add('sound','sound_playuntildone');await check({type:'block.input',block:'sound',input:'SOUND_MENU',value:'確認音'});
 await add('stop','control_stop');await check({type:'block.field',block:'stop',field:'STOP_OPTION',value:'other scripts in sprite'});
 await c.execute({type:'block.add',sourceId:'tail',opcode:'motion_movesteps',place:{after:'stop'}});
 await c.verifyConnection(c.resolve('tail'),{after:'stop'});
 console.log('pen parameter, math/key/target/asset menus and shape-changing stop menu PASS');
 const snapshot=await c.save();await c.load(snapshot);await c.selectTarget('ペン');
 // Verify the last requested value for each field survives an sb3 roundtrip.
 const last=new Map(expected.map(e=>[`${e.id}/${e.input}/${e.field}`,e]));
 for(const e of last.values())assert.equal(String(await c.page.evaluate(e=>studio.field(e.id,e.input,e.field).getValue(),e)),e.value);
 assert.deepEqual(c.errors,[]);console.log('saved special settings roundtrip PASS');
}catch(e){await c.page.screenshot({path:'test-results/special-fields-failure.png'});throw e;}finally{await c.close();}
