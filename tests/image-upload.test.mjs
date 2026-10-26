import assert from 'node:assert/strict';
import {test,after} from 'node:test';
import {build} from 'esbuild';
import {rm} from 'node:fs/promises';
const bundle=new URL(`../.image-upload-${process.pid}.mjs`,import.meta.url);
await build({entryPoints:['packages/ui/src/image-upload.ts'],outfile:bundle.pathname,bundle:true,format:'esm',platform:'node'});
const {compressUploadImage}=await import(bundle.href);
after(()=>rm(bundle,{force:true}));
const file=(size,type='image/png')=>new File([new Uint8Array(size)],'diagram.png',{type});
function mockCanvas(encode){
 let closed=false,canvas;
 globalThis.createImageBitmap=async()=>({width:5000,height:3000,close(){closed=true;}});
 globalThis.document={createElement(){canvas={width:0,height:0,getContext:()=>({clearRect(){},drawImage(){}}),toBlob(callback,type,quality){callback(encode({type,quality,width:canvas.width,height:canvas.height}));}};return canvas;}};
 return ()=>{assert.equal(closed,true);assert.equal(canvas.width,0);};
}
test('already small images retain original bytes and identity for deduplication',async()=>{
 const original=file(8000);assert.equal(await compressUploadImage(original),original);
});
test('large images are resized before encoding, with accurate extension and type',async()=>{
 const cleanup=mockCanvas(({type,width,height})=>{assert.ok(width<=2400);assert.equal(width/height,5/3);return new Blob([new Uint8Array(500000)],{type});});
 const optimized=await compressUploadImage(file(6*1024*1024));
 assert.equal(optimized.size,500000);assert.equal(optimized.type,'image/webp');assert.equal(optimized.name,'diagram.webp');cleanup();
});
test('assignment images can preserve accepted PNG/JPEG formats',async()=>{
 const cleanup=mockCanvas(({type})=>new Blob([new Uint8Array(1000)],{type}));
 const optimized=await compressUploadImage(file(2*1024*1024),{preserveFormat:true});
 assert.equal(optimized.type,'image/png');cleanup();
});
test('does not replace a valid original with a larger encoded file',async()=>{
 const cleanup=mockCanvas(({type})=>new Blob([new Uint8Array(3*1024*1024)],{type}));
 const original=file(2*1024*1024);assert.equal(await compressUploadImage(original),original);cleanup();
});
test('logos respect their lower storage limit; failed compression stops the upload',async()=>{
 const cleanup=mockCanvas(({type})=>new Blob([new Uint8Array(600000)],{type}));
 await assert.rejects(compressUploadImage(file(2*1024*1024),{maxBytes:524288,targetBytes:160000,maxDimension:800}),/still too large/);cleanup();
});
test('empty files, unsupported formats and oversized originals are rejected before decoding',async()=>{
 await assert.rejects(compressUploadImage(file(0)),/non-empty/);
 await assert.rejects(compressUploadImage(file(100,'image/svg+xml')),/PNG/);
 await assert.rejects(compressUploadImage(file(31*1024*1024)),/30 MB/);
});
