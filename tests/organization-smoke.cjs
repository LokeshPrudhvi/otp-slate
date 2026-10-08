const fs=require('node:fs'),assert=require('node:assert/strict'),{webcrypto}=require('node:crypto');
const {JSDOM,VirtualConsole}=require('jsdom');
const platform=fs.readFileSync('otp-slate-platform-admin.html','utf8'),organization=fs.readFileSync('otp-slate-organization-admin.html','utf8');
const errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));
const active=[];
function make(html,path,data,signed=false){const dom=new JSDOM(html,{url:'https://slate.test/'+path,runScripts:'dangerously',virtualConsole:vc,beforeParse(w){Object.defineProperty(w,'crypto',{value:webcrypto});w.TextEncoder=TextEncoder;w.scrollTo=()=>{};w.URL.createObjectURL=()=> 'blob:test';w.URL.revokeObjectURL=()=>{};if(data)w.localStorage.setItem('otp-slate-admin-v1',JSON.stringify(data));if(signed)w.sessionStorage.setItem('otp-slate-admin-session','active');}});active.push(dom);return dom;}
const tick=()=>new Promise(r=>setTimeout(r,15));
async function until(predicate){for(let i=0;i<120;i++){if(predicate())return;await tick();}throw new Error('Timed out waiting for UI');}
const p=make(platform,'otp-slate-platform-admin.html',null,true),w=p.window,d=w.document;
const q=s=>{const e=d.querySelector(s);assert.ok(e,s);return e;},click=s=>q(s).click(),fill=(k,v)=>q(`[name="${k}"]`).value=v;
const nav=view=>click(`[data-action="nav"][data-view="${view}"]`);
const change=(s,v)=>{q(s).value=v;q(s).dispatchEvent(new w.Event('change',{bubbles:true}));};
const stored=()=>JSON.parse(w.localStorage.getItem('otp-slate-admin-v1'));
async function submit(){q('#modalForm').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await until(()=>!d.querySelector('#modalForm')||q('#formError').textContent);}
async function addMember(email,name,password='AssignedPass2026!'){click('[data-action="new-staff"]');fill('name',name);fill('email',email);fill('password',password);fill('confirm',password);await submit();}
async function login(dom,email,password){const ow=dom.window,od=ow.document;od.querySelector('[name="email"]').value=email;od.querySelector('[name="password"]').value=password;od.querySelector('#memberLogin').dispatchEvent(new ow.Event('submit',{bubbles:true,cancelable:true}));await until(()=>od.querySelector('#main')||od.querySelector('#loginError')?.textContent);}
function update(dom,data){dom.window.localStorage.setItem('otp-slate-admin-v1',JSON.stringify(data));dom.window.dispatchEvent(new dom.window.StorageEvent('storage',{key:'otp-slate-admin-v1'}));}
(async()=>{
 assert.equal(d.querySelector('#roleSelect'),null);assert.equal(d.querySelector('#loginRole'),null);
 change('#orgSelect','northstar');nav('team');assert.match(q('h1').textContent,/Organization members/);
 await addMember('viewer.one@northstar.example','Viewer One');assert.equal(d.querySelector('#modalForm'),null);
 await addMember('viewer.two@northstar.example','Viewer Two');let db=stored();assert.equal(db.members.filter(m=>m.org==='northstar').length,4);
 assert.ok(!JSON.stringify(db).includes('AssignedPass2026!'),'Password must not be stored in plaintext');
 await addMember('viewer.one@northstar.example','Duplicate');assert.match(q('#formError').textContent,/already/);click('[data-action="modal-close"]');
 click('[data-action="new-staff"]');fill('name','Mismatch');fill('email','mismatch@northstar.example');fill('password','LongPassword2026!');fill('confirm','DifferentPassword!');await submit();assert.match(q('#formError').textContent,/match/);click('[data-action="modal-close"]');
 const viewer=make(organization,'otp-slate-organization-admin.html?org=vertex',stored()),ow=viewer.window,od=ow.document;
 const original=ow.localStorage.getItem('otp-slate-admin-v1');
 await login(viewer,'viewer.one@northstar.example','WrongPassword');assert.match(od.querySelector('#loginError').textContent,/incorrect/);
 await login(viewer,'viewer.one@northstar.example','AssignedPass2026!');assert.match(od.querySelector('.org-card').textContent,/Northstar/);assert.equal(od.querySelector('#orgSelect'),null);assert.equal(od.querySelector('#roleSelect'),null);
 assert.equal(od.querySelectorAll('.chart').length,3);assert.equal(od.querySelectorAll('.skill-row').length,4);assert.equal(ow.eval('students()').length,8);assert.equal(ow.eval('events().length')>0,true);
 const activity28=ow.eval('events().length');od.querySelector('#periodFilter').value='7';od.querySelector('#periodFilter').dispatchEvent(new ow.Event('change',{bubbles:true}));assert.ok(ow.eval('events().length')<activity28);assert.equal(ow.eval('daily().length'),7);
 for(const view of ['students','courses','practice','exams','overview']){od.querySelector(`[data-action="nav"][data-view="${view}"]`).click();assert.ok(od.querySelector('h1'));assert.ok(!od.querySelector('#main').textContent.includes('Arjun Das'));assert.equal(od.querySelectorAll('[data-action^="new-"],[data-action^="edit-"],[data-action*="import"],#modalForm').length,0);}
 assert.equal(ow.localStorage.getItem('otp-slate-admin-v1'),original,'Analytics navigation must not change workspace data');
 od.querySelector('[data-action="nav"][data-view="students"]').click();od.querySelector('#studentSearch').value='Diya';od.querySelector('#studentSearch').dispatchEvent(new ow.Event('input',{bubbles:true}));assert.equal(od.querySelectorAll('#studentTable tbody tr').length,1);od.querySelector('#studentTable [data-action="student"]').click();assert.match(od.querySelector('.student-hero').textContent,/Diya Patel/);
 const forged=od.createElement('button');forged.dataset.action='student';forged.dataset.id='student-8';od.querySelector('#main').append(forged);forged.click();assert.match(od.querySelector('.student-hero').textContent,/Diya Patel/);
 // A second member gets the same organization, and a different organization gets its own roster.
 const other=make(organization,'otp-slate-organization-admin.html',stored());await login(other,'viewer.two@northstar.example','AssignedPass2026!');assert.equal(other.window.eval('students()').length,8);
 const vertex=make(organization,'otp-slate-organization-admin.html',stored());await login(vertex,'priya@vertex.example','SlateDemo2026!');assert.match(vertex.window.document.querySelector('.org-card').textContent,/Vertex/);assert.equal(vertex.window.eval('students()').length,4);assert.ok(!vertex.window.document.querySelector('#main').textContent.includes('Aarav Sharma'));
 // Account disable immediately invalidates an existing viewer session on refresh.
 let member=stored().members.find(m=>m.email==='viewer.two@northstar.example');click(`[data-action="member-status"][data-id="${member.id}"]`);await submit();update(other,stored());assert.ok(other.window.document.querySelector('#memberLogin'));assert.equal(other.window.sessionStorage.getItem('otp-slate-organization-session'),null);
 // A platform password reset revokes the earlier session and requires the new password.
 member=stored().members.find(m=>m.email==='viewer.one@northstar.example');click(`[data-action="edit-staff"][data-id="${member.id}"]`);fill('password','ResetPassword2026!');fill('confirm','ResetPassword2026!');await submit();update(viewer,stored());assert.ok(od.querySelector('#memberLogin'));await login(viewer,member.email,'AssignedPass2026!');assert.match(od.querySelector('#loginError').textContent,/incorrect/);await login(viewer,member.email,'ResetPassword2026!');assert.ok(od.querySelector('#main'));
 od.querySelector('[data-action="logout"]').click();assert.ok(od.querySelector('#memberLogin'));assert.equal(ow.sessionStorage.getItem('otp-slate-organization-session'),null);
 // Fresh organization with a newly provisioned viewer has honest empty analytics.
 nav('organizations');click('[data-action="new-org"]');fill('name','Empty Academy');fill('code','EMPTY');fill('contact','admin@empty.example');await submit();nav('team');await addMember('viewer@empty.example','Empty Viewer');const empty=make(organization,'otp-slate-organization-admin.html',stored());await login(empty,'viewer@empty.example','AssignedPass2026!');assert.equal(empty.window.eval('students().length'),0);assert.equal(empty.window.eval('events().length'),0);empty.window.document.querySelector('[data-action="nav"][data-view="courses"]').click();assert.match(empty.window.document.querySelector('#main').textContent,/No courses assigned yet/);
 // Large rosters stay paginated and do not acquire invented scores.
 db=stored();const emptyOrg=db.orgs.find(o=>o.code==='EMPTY');db.students.push(...Array.from({length:2000},(_,i)=>({id:'analytics-load-'+i,org:emptyOrg.id,name:'New Learner '+i,student_id:'AN'+i,cohort:'New intake',status:'Active',profile:'',custom:null})));update(empty,db);assert.equal(empty.window.eval('students().length'),2000);assert.equal(empty.window.eval('metrics().score'),null);empty.window.document.querySelector('[data-action="nav"][data-view="students"]').click();assert.equal(empty.window.document.querySelectorAll('#studentTable tbody tr').length,20);empty.window.document.querySelector('[data-action="page"][data-dir="1"]').click();assert.match(empty.window.document.querySelector('.panel-foot').textContent,/Page 2 of 100/);
 // Suspending an organization also removes its member access.
 db=stored();db.orgs.find(o=>o.id==='vertex').status='Archived';update(vertex,db);assert.ok(vertex.window.document.querySelector('#memberLogin'));
 assert.deepEqual(errors,[]);
 console.log('PASS: separate portals, multiple organization logins, hashed passwords, organization scoping, read-only analytics, chart filters, student drill-down, password reset, account disable, archive revocation and empty analytics.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>active.forEach(dom=>dom.window.close()));
