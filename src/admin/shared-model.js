(function(global){
 'use strict';
 const KEY='otp-slate-admin-v1';
 const catalog=global.SLATE_CATALOG;
 const uid=()=>global.crypto?.randomUUID?.() || 'id-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
 const emptyGrants=()=>({courses:{},practices:[],features:[]});
 const allGrants=()=>({courses:Object.fromEntries(catalog.map(c=>[c.id,'all'])),practices:['aptitude','typing','live','practice','livecode','webdev','quant','logic','cp','interview','sql-practice'],features:['jobs','resume','rankings']});
 function seed(){
  const orgs=[{id:'northstar',name:'Northstar Institute of Technology',code:'NIT',type:'College',city:'Hyderabad',contact:'placements@northstar.example',status:'Active'},{id:'vertex',name:'Vertex Skills Academy',code:'VSA',type:'Training organization',city:'Bengaluru',contact:'team@vertex.example',status:'Active'},{id:'brightpath',name:'Brightpath Learning',code:'BPL',type:'Organization',city:'Pune',contact:'hello@brightpath.example',status:'Active'}];
  const profiles=[{id:'full',org:'northstar',name:'Complete learning access',description:'All demo courses, practice and career tools.',grants:allGrants()},{id:'crt',org:'northstar',name:'Placement essentials',description:'Aptitude, reasoning and foundational programming.',grants:{courses:{py:'all',quant:'all',logic:'all',interview:'all'},practices:['aptitude','typing','quant','logic','interview'],features:['jobs','resume','rankings']}},{id:'mern',org:'vertex',name:'MERN cohort',description:'Web development and the MERN pathway.',grants:{courses:{html:'all',js:'all',mern:'all'},practices:['webdev','practice'],features:['jobs','resume']}}];
  const names=['Aarav Sharma','Diya Patel','Kabir Mehta','Ananya Reddy','Ishaan Gupta','Meera Nair','Rohan Kumar','Sneha Rao','Arjun Das','Priya Shah','Vikram Singh','Kavya Menon'];
  const students=names.map((name,i)=>({id:i===0?'aarav':'student-'+i,org:i<8?'northstar':'vertex',student_id:(i<8?'NIT':'VSA')+String(i+1).padStart(3,'0'),name,email:name.toLowerCase().replaceAll(' ','.')+'@student.example',phone:i===0?'9876540210':'900001'+String(i).padStart(4,'0'),role:'Student',cohort:i<8?'Batch 2027':'Web cohort 2027',profile:i===0?'full':i<8?'crt':'mern',status:i===7?'Suspended':'Active',custom:null,accessUntil:'',created:'2026-10-06'}));
  return {version:1,orgs,students,profiles,members:demoMembers(),analytics:demoAnalytics(students),exams:[],jobs:[],audit:[{id:'seed',org:null,actor:'System',action:'Demo workspace created',detail:'3 organizations and 12 sample students',time:'2026-10-06T04:30:00Z'}]};
 }
 // These fixtures are explicitly labeled sample data in the analytics portal.
 function demoMembers(){return [
  {id:'member-northstar',org:'northstar',name:'Meera Joshi',email:'meera@northstar.example'},
  {id:'member-northstar-2',org:'northstar',name:'Ananya Rao',email:'ananya@northstar.example'},
  {id:'member-vertex',org:'vertex',name:'Priya Sethi',email:'priya@vertex.example'}
 ].map(m=>({...m,status:'Active',credentialVersion:1,created:'2026-10-06',credential:{salt:'slate-organization-demo-v1',iterations:150000,hash:'0d071c420300e8e93812ff9fdf21248130b0e875fdd730fc6d867ccc988acec9'}}));}
 function demoAnalytics(students){
  const events=[],progress=[];
  const skills=['aptitude','reasoning','coding','web'];
  students.forEach((s,i)=>{
   if(!/^(aarav|student-\d+)$/.test(s.id))return;
   for(let day=0;day<28;day++){
    if((day+i)%(i===6?7:3)===0||i===7)continue;
    const date=new Date(Date.UTC(2026,8,9+day)).toISOString().slice(0,10),skill=skills[(day+i)%4];
    const score=Math.min(98,Math.max(28,88-i*4+(day%6)*2-((day+i)%5)*3));
    events.push({id:'fixture-'+i+'-'+day,student:s.id,date,kind:day%6===0?'exam':day%2===0?'lesson':'practice',skill,course:s.org==='vertex'?['html','js','mern'][day%3]:['py','quant','logic','interview'][day%4],score:day%2===0&&day%6!==0?null:score,minutes:15+(day%5)*8});
   }
   const ids=s.org==='vertex'?['html','js','mern']:['py','quant','logic','interview'];
   ids.forEach((course,j)=>{const total=catalog.find(c=>c.id===course)?.mods.length||1;progress.push({student:s.id,course,total,completed:Math.min(total,Math.max(0,Math.round(total*(.92-i*.065-j*.06))))});});
  });
  return {source:'Sample analytics',asOf:'2026-10-06',events,progress};
 }
 function load(){
  const raw=global.localStorage.getItem(KEY);if(!raw)return seed();const db=JSON.parse(raw);
  if(db.version!==1||!Array.isArray(db.orgs)||!Array.isArray(db.students)||!Array.isArray(db.profiles))throw new Error('Saved workspace is not compatible.');
  // Preserve saved rosters while adding the separate organization viewer accounts.
  if(!Array.isArray(db.members)){
   db.members=demoMembers().filter(m=>db.orgs.some(o=>o.id===m.org));
   for(const old of db.staff||[]){if(db.orgs.some(o=>o.id===old.org)&&!db.members.some(m=>m.email.toLowerCase()===old.email.toLowerCase()))db.members.push({id:old.id,org:old.org,name:old.name,email:old.email.toLowerCase(),status:'Disabled',credentialVersion:1,credential:null,created:'2026-10-06'});}
  }
  if(!db.analytics)db.analytics=demoAnalytics(db.students);
  return db;
 }
 const hex=bytes=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
 async function passwordHash(password,salt,iterations){
  if(!global.crypto?.subtle)throw new Error('Password preview requires a browser with Web Crypto support.');
  const encoder=new TextEncoder();
  const key=await global.crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveBits']);
  return hex(await global.crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:encoder.encode(salt),iterations},key,256));
 }
 async function createCredential(password){
  if(typeof password!=='string'||password.length<10||password.length>128)throw new Error('Use a password between 10 and 128 characters.');
  if(!global.crypto?.getRandomValues)throw new Error('Password preview requires Web Crypto support.');
  const salt=hex(global.crypto.getRandomValues(new Uint8Array(16))),iterations=150000;
  return {salt,iterations,hash:await passwordHash(password,salt,iterations)};
 }
 async function verifyCredential(password,credential){
  if(!credential?.hash||!credential?.salt)return false;
  const actual=await passwordHash(password,credential.salt,credential.iterations);
  if(actual.length!==credential.hash.length)return false;
  let difference=0;for(let i=0;i<actual.length;i++)difference|=actual.charCodeAt(i)^credential.hash.charCodeAt(i);
  return difference===0;
 }
 function save(db){global.localStorage.setItem(KEY,JSON.stringify(db));}
 function effective(db,student){
  const org=db.orgs.find(o=>o.id===student?.org);
  if(!student||student.status!=='Active'||org?.status!=='Active'||student.accessUntil && student.accessUntil<new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'}))return emptyGrants();
  if(student.custom)return student.custom;
  return db.profiles.find(p=>p.id===student.profile&&p.org===student.org)?.grants || emptyGrants();
 }
 const canModule=(grants,cid,mi)=>grants.courses[cid]==='all'||Array.isArray(grants.courses[cid])&&grants.courses[cid].includes(mi);
 function validateRows(db,org,rows){
  const seenIds=new Set(),seenEmails=new Set(),seenPhones=new Set();
  return rows.map((row,index)=>{
   const cell=k=>String(row[k]??'').trim();
   const data={id:uid(),org,student_id:cell('student_id'),name:cell('full_name'),email:cell('email').toLowerCase(),phone:cell('phone').replace(/\s/g,''),role:cell('role')||'Student',cohort:cell('cohort'),profile:'',status:cell('status')||'Active',custom:null,accessUntil:'',created:new Date().toISOString().slice(0,10)};
   const errors=[];
   if(!data.student_id||data.student_id.length>80)errors.push('Student ID is required (max 80 characters)');
   if(!data.name||data.name.length>120)errors.push('Full name is required (max 120 characters)');
   if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email))errors.push('Valid email is required');
   if(!/^[6-9]\d{9}$/.test(data.phone))errors.push('Phone must be a 10-digit Indian mobile number');
   if(data.role!=='Student')errors.push('Student imports cannot create staff or admin roles');
   if(!['Active','Suspended'].includes(data.status))errors.push('Status must be Active or Suspended');
   if(seenIds.has(data.student_id.toLowerCase())||db.students.some(s=>s.org===org&&s.student_id.toLowerCase()===data.student_id.toLowerCase()))errors.push('Duplicate student ID');
   if(seenEmails.has(data.email)||db.students.some(s=>s.email.toLowerCase()===data.email))errors.push('Duplicate email');
   if(seenPhones.has(data.phone)||db.students.some(s=>s.phone===data.phone))errors.push('Duplicate phone');
   const name=cell('access_profile');
   if(name&&name.toLowerCase()!=='none'){const profile=db.profiles.find(p=>p.org===org&&p.name.toLowerCase()===name.toLowerCase());if(!profile)errors.push('Access profile does not exist in this organization');else data.profile=profile.id;}
   seenIds.add(data.student_id.toLowerCase());seenEmails.add(data.email);seenPhones.add(data.phone);
   return {row:index+2,data,errors};
  });
 }
 function audit(db,actor,org,action,detail){db.audit.unshift({id:uid(),actor,org,action,detail,time:new Date().toISOString()});}
 global.SlateAdminModel={KEY,catalog,uid,seed,load,save,effective,canModule,emptyGrants,validateRows,audit,createCredential,verifyCredential};
})(window);
