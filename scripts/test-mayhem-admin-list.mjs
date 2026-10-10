// Actual admin list JSX/handlers and page routing, isolated from real actions.
// Run: node scripts/test-mayhem-admin-list.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
const nativeRequire=createRequire(import.meta.url);
let showArchived=false, creating=false, pending=false, confirmed=false, hook=0, transition;
let error=null; const calls=[], redirects=[], prompts=[]; let refreshes=0;
const actions={
  archiveMayhemEvent: async pin => {calls.push(['archive',pin]); return {ok:true};},
  deleteMayhemEvent: async pin => {calls.push(['delete',pin]); return error ? {ok:false,reason:error} : {ok:true};},
  setMayhemPublished: async (pin,published) => {calls.push(['publish',pin,published]);return {ok:true};},
  createMayhemEvent: async name => {calls.push(['create',name]);return {ok:true,eventId:'new-event'};},
};
let shownError;
const deps={
  react:{useState:()=>[[creating,'Named event',showArchived,null][hook],value=>{if(hook===4) shownError=value;}], useTransition:()=>[pending,fn=>{transition=fn();}]},
  'next/link':{default:'a'},
  'next/navigation':{useRouter:()=>({refresh:()=>refreshes++,push:path=>redirects.push(path)}),notFound:()=>{throw Error('notFound');},redirect:path=>{throw Error(path);}},
  '@/components/ui/button':{Button:'button'},
  '@/app/tools/mayhem/actions':actions,
};
// Hook setters need their index captured, as React does.
deps.react.useState=()=>{const i=hook++;return [[creating,'Named event',showArchived,null][i],value=>{if(i===3) shownError=value;}];};
function load(path,extra={}) {
  const exports={};
  const source=readFileSync(path,'utf8');
  runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,
    {exports,require:name=>extra[name]??deps[name]??nativeRequire(name),confirm:message=>{prompts.push(message);return confirmed;},console});
  return exports;
}
const {MayhemAdminList}=load('src/components/mayhem/mayhem-admin-list.tsx');
const event=(id,archived=false)=>({id,title:id,stage:'completed',archived_at:archived?'2026-10-10':null,published:true,registration_generation:archived?3:2});
function nodes(root) {if(!root||typeof root!=='object')return []; if(Array.isArray(root))return root.flatMap(nodes);return [root,...nodes(root.props?.children)];}
function render(){hook=0;return nodes(MayhemAdminList({tournaments:[event('active'),event('archived',true)]}));}
function buttons(elements,label){return elements.filter(node=>node.type==='button'&&[].concat(node.props.children).includes(label));}
let elements=render();
assert.equal(buttons(elements,'Delete').length,1);
assert.equal(buttons(elements,'Archive').length,1);
assert.ok(elements.some(node=>node.type==='input'&&node.props.type==='checkbox'));
buttons(elements,'Delete')[0].props.onClick();assert.equal(calls.length,0);
confirmed=true;buttons(elements,'Delete')[0].props.onClick();await transition;
assert.equal(JSON.stringify(calls[0]),JSON.stringify(['delete',{eventId:'active',generation:2}]));
assert.match(prompts.at(-1),/permanently/);assert.match(prompts.at(-1),/cannot be undone/);
buttons(elements,'Archive')[0].props.onClick();await transition;
assert.equal(JSON.stringify(calls[1]),JSON.stringify(['archive',{eventId:'active',generation:2}]));
assert.equal(refreshes,2);
console.log('PASS: confirmed Delete/Archive pin their row and generation; Cancel makes no server call.');
showArchived=true;elements=render();
assert.equal(buttons(elements,'Delete').length,2);assert.equal(buttons(elements,'Archive').length,1);
buttons(elements,'Delete')[1].props.onClick();await transition;
assert.equal(JSON.stringify(calls[2]),JSON.stringify(['delete',{eventId:'archived',generation:3}]));
assert.ok(elements.some(node=>node.type==='a'&&node.props.href==='/tools/mayhem?t=archived'));
console.log('PASS: Show archived exposes read-only history navigation and permanent deletion.');
error='This tournament changed. Refresh.';buttons(elements,'Delete')[0].props.onClick();await transition;
assert.equal(shownError,error);assert.equal(refreshes,3);error=null;
pending=true;elements=render();assert.ok(buttons(elements,'Delete').every(node=>node.props.disabled));pending=false;
creating=true;elements=render();const form=elements.find(node=>node.type==='form');form.props.onSubmit({preventDefault(){}});await transition;
assert.equal(calls.at(-1)[0],'create');assert.equal(calls.at(-1)[1],'Named event');assert.equal(redirects.at(-1),'/tools/mayhem?t=new-event');
console.log('PASS: typed errors remain readable, pending disables lifecycle controls, named Create opens selected desk.');
const reads=[];
const {default:Page}=load('src/app/tools/mayhem/page.tsx',{
  '@/lib/tools-auth':{isToolsSession:async()=>true},
  '@/lib/mayhem-db':{listMayhemEvents:async()=>[event('active')],getMayhemFull:async id=>{reads.push(id);return {event:{id,title:id},players:[],teams:[],groups:[],matches:[]};},listMayhemAudit:async()=>[]},
  '@/components/mayhem/mayhem-admin-list':{MayhemAdminList:'list'},
  '@/components/mayhem/mayhem-desk':{MayhemDesk:'desk'},
});
assert.equal((await Page({searchParams:Promise.resolve({})})).type,'list');assert.equal(reads.length,0);
const desk=await Page({searchParams:Promise.resolve({t:'chosen'})});assert.equal(desk.type,'desk');assert.equal(desk.props.initial.event.id,'chosen');
assert.equal(JSON.stringify(reads),JSON.stringify(['chosen']));
console.log('PASS: authenticated /tools/mayhem defaults to list; only ?t opens that exact desk.');
