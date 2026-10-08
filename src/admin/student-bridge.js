// Local preview bridge. The production API must enforce these rules itself.
let studentAdminData;try{studentAdminData=SlateAdminModel.load();SlateAdminModel.save(studentAdminData);}catch(_){studentAdminData=SlateAdminModel.seed();}
let studentIdentity=new URLSearchParams(location.search).get('student')||sessionStorage.getItem('otp-slate-student-id')||'aarav';
const assignedStudent=()=>studentAdminData.students.find(s=>s.id===studentIdentity);
const studentGrants=()=>SlateAdminModel.effective(studentAdminData,assignedStudent());
const studentHasCourse=id=>Object.hasOwn(studentGrants().courses,id);
const studentHasModule=(id,mi)=>SlateAdminModel.canModule(studentGrants(),id,mi);
const studentHasPractice=id=>studentGrants().practices.includes(id);
function studentCourseList(){return COURSES.filter(c=>studentHasCourse(c.id)).map(c=>c.id);}
function studentCanView(view){
 const s=assignedStudent();if(!s||s.status!=='Active'||studentAdminData.orgs.find(o=>o.id===s.org)?.status!=='Active')return false;
 if(['course','lesson'].includes(view))return studentHasCourse(S.course)&&(view!=='lesson'||studentHasModule(S.course,S.mod));
 if(['jobs','resume'].includes(view))return studentGrants().features.includes(view);
 if(['hiring','crt','dsa','fullstack','cc'].includes(view))return COURSES.some(c=>c.cat===view&&studentHasCourse(c.id));
 return true;
}
function assignedHubEntries(){return Object.entries(HUBS).filter(([id])=>COURSES.some(c=>c.cat===id&&studentHasCourse(c.id)));}
function accessEmpty(){return `<div class="a-page"><div class="a-head"><h1 class="a-h1">Access not assigned</h1></div><section class="exam-empty"><h2>Your admin manages your learning access.</h2><p>This resource is not assigned to your account. Contact Platform Admin to request learning access.</p><button class="a-btn" data-act="go" data-go="dashboard">Back to dashboard</button></section></div>`;}
function studentPublishedExams(){const s=assignedStudent();if(!s||s.status!=='Active'||studentAdminData.orgs.find(o=>o.id===s.org)?.status!=='Active')return [];return studentAdminData.exams.filter(e=>e.org===s.org&&e.status==='Published'&&(!e.cohort||e.cohort===s.cohort)&&(!e.deadline||new Date(e.deadline)>new Date()));}
function assignedExamsHTML(){const exams=studentPublishedExams();if(!exams.length)return null;return `<div class="a-page"><div class="a-head"><h1 class="a-h1">Live Exams</h1><span class="sp"></span><span class="a-tag">${exams.length} available</span></div><p class="hub-note">Released by Platform Admin.</p><div class="hub-grid">${exams.map(e=>`<article class="hub-card"><div class="hub-card-top"><span class="live-status">Available</span><span class="a-tag">${e.kind==='coding'?'Coding':'Aptitude'}</span></div><h2>${esc(e.title)}</h2><p>${e.duration} minutes · ${e.kind==='coding'?'1 sample problem':'5 sample questions'}</p><small>${e.deadline?'Closes '+new Date(e.deadline).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})+' IST':'No closing time'}</small><div class="hub-actions"><button class="a-btn pri" data-act="admin-exam" data-id="${e.id}">Start exam →</button></div></article>`).join('')}</div></div>`;}
function startAssignedExam(id){const e=studentPublishedExams().find(e=>e.id===id);if(!e){toast('This exam is no longer available.');render();return;}if(e.kind==='coding')openExam({title:e.title,course:null,mode:'exam',langs:['py','cpp','java','c'],timer:e.duration*60,proctor:false,q:'two'});else openLab('mcq',{title:e.title,timed:true,duration:e.duration*60});}
function studentPublishedJobs(){const s=assignedStudent();return studentAdminData.jobs.filter(j=>j.org===s?.org&&j.status==='Published');}
APP.addEventListener('click',e=>{const b=e.target.closest('[data-act="admin-exam"]');if(b&&signedIn)startAssignedExam(b.dataset.id);});
window.addEventListener('storage',e=>{if(e.key===SlateAdminModel.KEY){try{studentAdminData=SlateAdminModel.load();MODAL.close();render();}catch(_){toast('Could not refresh assigned access.');}}});
