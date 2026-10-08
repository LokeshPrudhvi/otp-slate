const fs=require('node:fs'),assert=require('node:assert/strict');
const {JSDOM,VirtualConsole}=require('jsdom');
const html=fs.readFileSync('otp-slate-admin.html','utf8'),studentHTML=fs.readFileSync('otp-slate.html','utf8');
const errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));
const dom=new JSDOM(html,{url:'https://slate.test/otp-slate-admin.html',runScripts:'dangerously',virtualConsole:vc,beforeParse(w){w.URL.createObjectURL=()=> 'blob:test';w.URL.revokeObjectURL=()=>{};}});
const w=dom.window,d=w.document;
const q=s=>{const el=d.querySelector(s);assert.ok(el,s);return el;};
const click=s=>q(s).click();
const change=(selector,value)=>{q(selector).value=value;q(selector).dispatchEvent(new w.Event('change',{bubbles:true}));};
const fill=(key,value)=>q(`[name="${key}"]`).value=value;
const submit=async()=>{q('#modalForm').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await tick();};
const stored=()=>JSON.parse(w.localStorage.getItem('otp-slate-admin-v1'));
const nav=view=>click(`[data-action="nav"][data-view="${view}"]`);
const tick=()=>new Promise(resolve=>setTimeout(resolve,20));
function studentPreview(db,id){const result=new JSDOM(studentHTML,{url:'https://slate.test/otp-slate.html?student='+id,runScripts:'dangerously',virtualConsole:vc,beforeParse(sw){sw.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});sw.localStorage.setItem('otp-slate-admin-v1',JSON.stringify(db));sw.sessionStorage.setItem('otp-slate-demo-session','active');}});return result;}
(async()=>{
 assert.match(q('h2').textContent,/Welcome/);click('[data-action="login"]');
 assert.equal(q('h1').textContent,'Overview');
 for(const view of ['organizations','students','access','imports','exams','jobs','team','reports','activity','settings']){nav(view);assert.ok(q('h1').textContent);}
 nav('organizations');click('[data-action="new-org"]');
 fill('name','Test Organization');fill('code','TEST');fill('city','Pune');fill('contact','admin@test.example');await submit();
 let db=stored(),org=db.orgs.find(o=>o.code==='TEST');assert.ok(org);assert.equal(db.students.filter(s=>s.org===org.id).length,0);
 nav('students');click('[data-action="new-student"]');
 fill('student_id','TEST001');fill('full_name','Test Learner');fill('email','learner@test.example');fill('phone','9000900001');fill('cohort','2027');await submit();
 db=stored();let student=db.students.find(s=>s.email==='learner@test.example');assert.ok(student);assert.equal(student.profile,'');assert.equal(Object.keys(w.SlateAdminModel.effective(db,student).courses).length,0);
 // Profiles can assign only selected modules and separate practice access.
 nav('access');click('[data-action="new-profile"]');fill('name','Python starter');
 q('[data-module="py"][data-index="0"]').checked=true;
 q('[data-practice="typing"]').checked=true;await submit();
 db=stored();let profile=db.profiles.find(p=>p.name==='Python starter');assert.deepEqual(profile.grants.courses.py,[0]);assert.deepEqual(profile.grants.practices,['typing']);
 nav('students');q(`[data-select="${student.id}"]`).checked=true;q(`[data-select="${student.id}"]`).dispatchEvent(new w.Event('change',{bubbles:true}));click('[data-action="bulk-profile"]');fill('profile',profile.id);await submit();
 db=stored();student=db.students.find(s=>s.id===student.id);assert.equal(student.profile,profile.id);
 let preview=studentPreview(db,student.id),pd=preview.window.document;
 assert.equal(pd.querySelectorAll('.a-cards .a-card').length,1);
 pd.querySelector('[data-go="courses"]').click();assert.ok(pd.querySelector('#catalog').textContent.includes('Python'));assert.ok(!pd.querySelector('#catalog').textContent.includes('Java Programming'));
 pd.querySelector('[data-act="course"][data-id="py"]').click();assert.equal(pd.querySelectorAll('.learn-module').length,1);
 assert.equal(pd.querySelector('.learn-module [data-m="0"]').getAttribute('aria-expanded'),'true');
 // A forged direct module request is rejected by the interaction handler.
 const fake=pd.createElement('button');fake.dataset.act='item';fake.dataset.m='2';fake.dataset.k='0';pd.querySelector('#amain').append(fake);fake.click();assert.match(pd.querySelector('#toast').textContent,/not been assigned/);
 pd.querySelector('[data-go="practice"]').click();assert.equal(pd.querySelectorAll('#practiceCatalog .hub-card').length,1);assert.match(pd.querySelector('#practiceCatalog').textContent,/Typing/);
 preview.window.close();
 click(`[data-action="student-view"][data-id="${student.id}"]`);click(`[data-action="individual-access"][data-id="${student.id}"]`);
 q('[data-module="py"][data-index="0"]').checked=false;q('[data-module="java"][data-index="2"]').checked=true;await submit();
 db=stored();student=db.students.find(s=>s.id===student.id);assert.deepEqual(student.custom.courses,{java:[2]});
 click(`[data-action="student-view"][data-id="${student.id}"]`);click(`[data-action="restore-profile"][data-id="${student.id}"]`);assert.equal(stored().students.find(s=>s.id===student.id).custom,null);
 // Real XLSX file import: read file bytes through the same browser FileReader path.
 nav('imports');const buf=fs.readFileSync('outputs/admin-template/student-import-template.xlsx');
 const file=new w.File([new Uint8Array(buf)],'students.xlsx',{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
 Object.defineProperty(q('#importFile'),'files',{value:[file],configurable:true});q('#importFile').dispatchEvent(new w.Event('change',{bubbles:true}));await tick();
 assert.match(q('[data-action="commit-import"]').textContent,/Create 2/);assert.equal(q('[data-action="commit-import"]').disabled,false);click('[data-action="commit-import"]');assert.equal(stored().students.filter(s=>s.org===org.id).length,3);
 // Bad rows cannot create admin roles or silently overwrite existing students.
 const bad=w.SlateAdminModel.validateRows(stored(),org.id,[{student_id:'TEST001',full_name:'Bad',email:'learner@test.example',phone:'9000900001',role:'Platform admin',status:'Active'}]);
 assert.ok(bad[0].errors.some(e=>e.includes('admin')));assert.ok(bad[0].errors.some(e=>e.includes('Duplicate')));
 const noProfile=w.SlateAdminModel.validateRows(stored(),org.id,[{student_id:'T9',full_name:'Bad',email:'bad9@test.example',phone:'9000900009',role:'Student',access_profile:'Placement essentials',status:'Active'}]);assert.ok(noProfile[0].errors.some(e=>e.includes('does not exist')));
 nav('exams');click('[data-action="new-exam"]');fill('title','Placement assessment');await submit();
 let exam=stored().exams.find(e=>e.title==='Placement assessment');assert.equal(exam.status,'Draft');click(`[data-action="exam-publish"][data-id="${exam.id}"]`);await submit();assert.equal(stored().exams.find(e=>e.id===exam.id).status,'Published');
 preview=studentPreview(stored(),student.id);pd=preview.window.document;pd.querySelector('[data-go="live-exams"]').click();assert.match(pd.querySelector('#amain').textContent,/Placement assessment/);pd.querySelector('[data-act="admin-exam"]').click();assert.equal(pd.querySelector('#mT').textContent,'10:00');preview.window.close();
 click(`[data-action="exam-publish"][data-id="${exam.id}"]`);await submit();assert.equal(stored().exams.find(e=>e.id===exam.id).status,'Withdrawn');
 nav('jobs');click('[data-action="new-job"]');fill('title','Junior developer');fill('company','Example employer');fill('url','https://example.com/apply');fill('description','Example job description');await submit();
 let job=stored().jobs.find(j=>j.title==='Junior developer');assert.equal(job.status,'Draft');click(`[data-action="job-publish"][data-id="${job.id}"]`);assert.equal(stored().jobs.find(j=>j.id===job.id).status,'Published');
 // Organization archive revokes effective access without deleting the roster.
 nav('organizations');click(`[data-action="org-status"][data-id="${org.id}"]`);await submit();db=stored();assert.equal(db.orgs.find(o=>o.id===org.id).status,'Archived');assert.equal(Object.keys(w.SlateAdminModel.effective(db,db.students.find(s=>s.id===student.id)).courses).length,0);
 click(`[data-action="org-status"][data-id="${org.id}"]`);await submit();
 // Platform management has a fixed identity and no role preview selector.
 assert.equal(d.querySelector('#roleSelect'),null);assert.equal(d.querySelector('#loginRole'),null);
 change('#orgSelect',org.id);nav('imports');
 // Validate and create 2,000 learners in one review, then page through the roster.
 const rows=Array.from({length:2000},(_,i)=>({student_id:'LOAD'+i,full_name:'Load Student '+i,email:'load'+i+'@test.example',phone:String(9100000000+i),role:'Student',cohort:'Scale test',access_profile:'None',status:'Active'}));
 w.eval('loadImport')(rows,'2000-students.csv');assert.match(q('[data-action="commit-import"]').textContent,/Create 2000/);click('[data-action="commit-import"]');assert.equal(stored().students.filter(s=>s.org===org.id).length,2003);assert.equal(d.querySelectorAll('#studentTable tbody tr').length,20);click('[data-action="page"][data-dir="1"]');assert.match(q('.pagination').textContent,/Page 2/);
 nav('access');click('[data-action="assign-cohort"]');fill('cohort','Scale test');fill('profile',profile.id);await submit();assert.equal(stored().students.filter(s=>s.org===org.id&&s.cohort==='Scale test'&&s.profile===profile.id).length,2000);
 assert.ok(stored().audit.some(a=>a.action==='Students imported'));
 click('[data-action="logout"]');assert.equal(w.sessionStorage.getItem('otp-slate-admin-session'),null);assert.match(q('h2').textContent,/Welcome/);
 const save=stored();dom.window.close();
 const reloaded=new JSDOM(html,{url:'https://slate.test/otp-slate-admin.html',runScripts:'dangerously',virtualConsole:vc,beforeParse(rw){rw.localStorage.setItem('otp-slate-admin-v1',JSON.stringify(save));rw.sessionStorage.setItem('otp-slate-admin-session','active');}});assert.match(reloaded.window.document.querySelector('#main').textContent,/2020|2015|2014|2012/);reloaded.window.close();
 assert.deepEqual(errors,[]);
 console.log('PASS: organization CRUD, module-level grants, student preview restrictions, real XLSX import, validation, publishing, separate platform navigation, archival, persistence, and 2,000-student import.');
})().catch(e=>{console.error(e);dom.window.close();process.exitCode=1;});
