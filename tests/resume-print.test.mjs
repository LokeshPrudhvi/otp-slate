import assert from 'node:assert/strict';
import {test,after} from 'node:test';
import {build} from 'esbuild';
import {rm} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
const bundle=new URL(`../.resume-print-${process.pid}.mjs`,import.meta.url);
await build({entryPoints:['apps/student/src/resume-print.ts'],outfile:bundle.pathname,bundle:true,format:'esm',platform:'node'});
const {printResume}=await import(bundle.href);
after(()=>rm(bundle,{force:true}));

test('export contains only the current resume, preserving template, bullets and dates',async()=>{
 const dom=new JSDOM('<!doctype html><title>Portal</title><nav>Jobs Free certification courses Resume builder</nav><form>Private editor controls</form><article class="resume-paper template-modern"><header><h1>Asha</h1></header><section><h2>Experience</h2><div class="resume-entry-heading"><h3>Intern</h3><span>Jun 2025 – Aug 2025</span></div><ul class="resume-bullets"><li>Built a project</li></ul></section></article>');
 globalThis.document=dom.window.document;
 const originalAppend=document.body.append.bind(document.body);
 let printed,frame;
 document.body.append=(node)=>{
  originalAppend(node);frame=node;
  node.contentWindow.focus=()=>{};
  node.contentWindow.print=()=>{printed=node.contentDocument;};
 };
 try{
  const paper=document.querySelector('article');
  await printResume(paper,'Asha');
  assert.equal(printed.title,'Asha - Resume');
  assert.equal(printed.body.children.length,1);
  assert.ok(printed.querySelector('.template-modern .resume-bullets li'));
  assert.equal(printed.querySelector('nav, form, input, button'),null);
  assert.ok(!printed.body.textContent.includes('Free certification'));
  assert.ok(printed.body.textContent.includes('Jun 2025 – Aug 2025'));
  assert.ok(document.body.contains(paper),'Live preview remains in place');
  assert.ok(printed.querySelector('style').textContent.includes('size: A4'));
  frame.contentWindow.dispatchEvent(new dom.window.Event('afterprint'));
  assert.equal(document.querySelector('iframe'),null);
 }finally{dom.window.close();}
});

test('failed print cleans up its frame without changing the resume',async()=>{
 const dom=new JSDOM('<article class="resume-paper template-serif"><h1>Student</h1></article>');
 globalThis.document=dom.window.document;
 const append=document.body.append.bind(document.body);
 document.body.append=node=>{append(node);node.contentWindow.focus=()=>{};node.contentWindow.print=()=>{throw new Error('Print unavailable');};};
 try{
  await assert.rejects(printResume(document.querySelector('article'),'Student'),/Print unavailable/);
  assert.equal(document.querySelector('iframe'),null);
  assert.equal(document.querySelector('h1').textContent,'Student');
 }finally{dom.window.close();}
});
