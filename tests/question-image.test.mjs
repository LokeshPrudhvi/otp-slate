import assert from 'node:assert/strict';
import { test, after, afterEach } from 'node:test';
import { fileURLToPath } from 'node:url';
import { rm } from 'node:fs/promises';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<div id="root"></div>', {url:'https://student.example.test'});
for (const key of ['window','document','navigator','HTMLElement','Element','Event','MouseEvent']) Object.defineProperty(globalThis,key,{configurable:true,value:key==='window'?dom.window:dom.window[key]});
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
dom.window.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
dom.window.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
const bundle = new URL(`.question-image-tests-${process.pid}.mjs`, import.meta.url);
await build({entryPoints:['packages/ui/src/question-image.tsx'],outfile:fileURLToPath(bundle),bundle:true,format:'esm',platform:'node',jsx:'automatic',loader:{'.css':'empty'},external:['react','react/*','react-dom','react-dom/*','@tanstack/react-query'],plugins:[{name:'isolated-transport',setup(b){
 b.onResolve({filter:/^\.\/kit$/},()=>({path:'transport',namespace:'test'}));
 b.onResolve({filter:/^\.\/lesson-upload$/},()=>({path:'uploads',namespace:'test'}));
 b.onLoad({filter:/.*/,namespace:'test'},a=>({contents:a.path==='transport'?'export const usePortal=()=>"student"; export const api=(...args)=>globalThis.imageApi(...args);':'export const uploadLessonFile=(...args)=>globalThis.imageUpload(...args);',loader:'js'}));
}}]});
const {QuestionImageEditor,QuestionImageView}=await import(bundle.href);
const {createElement:h,act}=await import('react');
const {createRoot}=await import('react-dom/client');
const {QueryClient,QueryClientProvider}=await import('@tanstack/react-query');
let root,client;
const fixture={uploadId:'image-1',alt:'Triangle with sides labelled 3, 4 and 5.'};
const source='student/exam-attempts/own-attempt/images/image-1';
async function mount(component,props){
 client=new QueryClient({defaultOptions:{queries:{retry:false}}});
 root=createRoot(document.getElementById('root'));
 await act(async()=>root.render(h(QueryClientProvider,{client},h(component,props))));
 await settle();
}
async function settle(){await act(async()=>{await new Promise(r=>setTimeout(r,20));});}
async function click(element){assert.ok(element);await act(async()=>element.dispatchEvent(new MouseEvent('click',{bubbles:true})));await settle();}
async function choose(file){const input=document.querySelector('input[type=file]');Object.defineProperty(input,'files',{configurable:true,value:[file]});await act(async()=>input.dispatchEvent(new Event('change',{bubbles:true})));await settle();}
afterEach(async()=>{if(root)await act(async()=>root.unmount());root=null;client?.clear();document.getElementById('root').replaceChildren();});
after(async()=>{await rm(bundle,{force:true});dom.window.close();});

test('private image uses scoped endpoint, readable alt and an in-page enlargement',async()=>{
 const calls=[];globalThis.imageApi=async path=>{calls.push(path);return{url:'https://private.example.test/asset?signed=sample',expiresIn:3600};};
 await mount(QuestionImageView,{image:fixture,source});
 assert.deepEqual(calls,[source]);assert.equal(document.querySelector('img').alt,fixture.alt);
 assert.equal(document.querySelector('a'),null);
 await click(document.querySelector('.question-image-open'));
 assert.ok(document.querySelector('dialog[open]'));assert.equal(document.querySelector('dialog img').alt,fixture.alt);
 await click(document.querySelector('[aria-label="Close enlarged image"]'));
 assert.equal(document.querySelector('dialog'),null);
 assert.equal(document.activeElement,document.querySelector('.question-image-open'));
});

test('nested image dialog isolates Escape and Tab from its parent without blocking native behavior',async()=>{
 globalThis.imageApi=async()=>({url:'https://private.example.test/asset?signed=sample',expiresIn:3600});
 await mount(QuestionImageView,{image:fixture,source});
 const trigger=document.querySelector('.question-image-open');
 await click(trigger);
 const dialog=document.querySelector('dialog[open]');
 const close=document.querySelector('[aria-label="Close enlarged image"]');
 close.focus();
 const received=[];
 const parentListener=event=>received.push(event.key);
 document.addEventListener('keydown',parentListener);
 try {
  for(const [key,shiftKey] of [['Escape',false],['Tab',false],['Tab',true]]) {
   const event=new dom.window.KeyboardEvent('keydown',{key,shiftKey,bubbles:true,cancelable:true});
   await act(async()=>close.dispatchEvent(event));
   assert.equal(event.defaultPrevented,false,`${key} keeps native dialog handling`);
  }
  assert.deepEqual(received,[],'the parent Escape/Tab handler must not run');
  await act(async()=>close.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'a',bubbles:true,cancelable:true})));
  assert.deepEqual(received,['a'],'unrelated keys retain their existing event behavior');
  const cancel=new Event('cancel',{cancelable:true});
  await act(async()=>dialog.dispatchEvent(cancel));
  assert.equal(cancel.defaultPrevented,false);
  assert.equal(document.querySelector('dialog'),null);
  assert.equal(document.activeElement,trigger,'closing the image restores focus to its Enlarge control');
 } finally {document.removeEventListener('keydown',parentListener);}
});

test('denied image shows retry and alternative description without rendering a URL',async()=>{
 let count=0;globalThis.imageApi=async()=>{if(++count===1)throw Error('Not assigned');return{url:'https://private.example.test/restored',expiresIn:3600};};
 await mount(QuestionImageView,{image:fixture,source});
 assert.equal(document.querySelector('img'),null);assert.match(document.querySelector('[role=alert]').textContent,/Triangle/);
 await click(document.querySelector('[role=alert] button'));
 assert.equal(document.querySelector('img').src,'https://private.example.test/restored');
});

test('unsafe image response is never used as a browser source',async()=>{
 globalThis.imageApi=async()=>({url:'data:image/svg+xml,<svg onload=alert(1)>',expiresIn:3600});
 await mount(QuestionImageView,{image:fixture,source});
 assert.equal(document.querySelector('img'),null);assert.ok(document.querySelector('[role=alert]'));
});

test('failed replacement preserves existing question attachment and unlocks saving',async()=>{
 const changes=[],pending=[];globalThis.imageApi=async()=>({url:'https://private.example.test/original',expiresIn:3600});globalThis.imageUpload=async()=>{throw Error('Upload interrupted');};
 await mount(QuestionImageEditor,{image:fixture,onChange:v=>changes.push(v),onPending:v=>pending.push(v)});
 await choose(new dom.window.File(['image'],'diagram.png',{type:'image/png'}));
 assert.deepEqual(changes,[]);assert.deepEqual(pending,[true,false]);assert.match(document.querySelector('[role=alert]').textContent,/Upload interrupted/);assert.equal(document.querySelector('img').alt,fixture.alt);
});

test('successful upload saves only an immutable ID and description; remove detaches it',async()=>{
 const changes=[];globalThis.imageApi=async()=>({url:'https://private.example.test/original',expiresIn:3600});globalThis.imageUpload=async(file,scope)=>{assert.equal(scope.purpose,'question_image');return{id:'new-image-id',fileName:file.name};};
 await mount(QuestionImageEditor,{image:fixture,onChange:v=>changes.push(v)});
 await choose(new dom.window.File(['image'],'new.png',{type:'image/png'}));
 assert.deepEqual(changes[0],{uploadId:'new-image-id',alt:fixture.alt});
 const description=document.querySelector('.question-image-description input');assert.equal(description.required,true);assert.equal(description.maxLength,500);
 await click([...document.querySelectorAll('button')].find(b=>b.textContent==='Remove image'));
 assert.equal(changes.at(-1),undefined);
});

test('unmounting a pending upload cannot attach its result to another question',async()=>{
 let finish;const changes=[],pending=[];globalThis.imageUpload=()=>new Promise(resolve=>finish=resolve);
 await mount(QuestionImageEditor,{onChange:v=>changes.push(v),onPending:v=>pending.push(v)});
 await choose(new dom.window.File(['image'],'diagram.webp',{type:'image/webp'}));
 assert.deepEqual(pending,[true]);await act(async()=>root.unmount());root=null;
 await act(async()=>finish({id:'late-image'}));assert.deepEqual(changes,[]);assert.deepEqual(pending,[true,false]);
});
