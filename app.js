import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, collection, doc, onSnapshot, setDoc, updateDoc, addDoc, deleteDoc, writeBatch, enableIndexedDbPersistence } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig, OWNER_EMAIL } from "./firebase-config.js?v=3";

const fbApp = initializeApp(firebaseConfig);
const auth = getAuth(fbApp);
const db = getFirestore(fbApp);
try { enableIndexedDbPersistence(db); } catch (e) {}

const TIPOS = ['Escrito presentado','Proveído / Resolución','Audiencia','Notificación','Reclamo / Carta documento','Trabajo con Claude','Nota'];
const FUEROS = ['Penal','Penal federal','Federal','Laboral','Familia','Civil','Extrajudicial','Asesoramiento'];
const ESTADOS = ['Activa','En espera','Cerrada'];
const S = { causas:[], loaded:false, sel:null, eventos:[], docs:[], estado:'Activa', fuero:'', q:'', editing:false, unsubEv:null, unsubDocs:null, unsubCausas:null };

/* ---------- helpers ---------- */
function h(tag, props, ...kids){ const el=document.createElement(tag);
  for (const [k,v] of Object.entries(props||{})){ if(v==null||v===false) continue;
    if(k==='class') el.className=v; else if(k==='text') el.textContent=v;
    else if(k.startsWith('on')) el.addEventListener(k.slice(2),v); else el.setAttribute(k, v===true?'':v); }
  for (const c of kids.flat()){ if(c==null||c===false) continue; el.append(c instanceof Node?c:document.createTextNode(String(c))); }
  return el; }
const $ = id => document.getElementById(id);
function toast(msg){ const t=$('toast'); t.textContent=msg; t.hidden=false; clearTimeout(toast._t); toast._t=setTimeout(()=>t.hidden=true,3200); }
function todayStr(){ const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
const MES=['ene.','feb.','mar.','abr.','may.','jun.','jul.','ago.','sep.','oct.','nov.','dic.'];
function fmt(d){ if(!d) return ''; const p=String(d).split('-'); if(p.length===3) return p[2]+'/'+p[1]+'/'+p[0]; if(p.length===2) return MES[+p[1]-1]+' '+p[0]; return d; }
function dueInfo(d){ if(!d||String(d).length!==10) return null; const t0=new Date(todayStr()+'T00:00:00'); const n=Math.round((new Date(d+'T00:00:00')-t0)/864e5);
  if(n<0) return {cls:'over',txt:'Vencido '+fmt(d)}; if(n===0) return {cls:'over',txt:'Hoy'}; if(n<=7) return {cls:'soon',txt:(n===1?'Mañana':'En '+n+' días')}; return {cls:'later',txt:fmt(d)}; }
function fueroCls(f){ return 'f-'+({'Penal':'penal','Penal federal':'penal','Federal':'fed','Laboral':'lab','Familia':'fam','Civil':'civ'}[f]||'ext'); }
function estadoCls(e){ return e==='En espera'?'espera':e==='Cerrada'?'cerrada':'activa'; }
function safeUrl(u){ return typeof u==='string' && /^https:\/\//i.test(u) ? u : null; }
function slug(s){ return (String(s||'causa').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,40)||'causa')+'-'+Math.random().toString(36).slice(2,6); }
const now = () => new Date().toISOString();

/* ---------- auth ---------- */
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });
const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
const POPUP_FAIL = ['auth/popup-blocked','auth/popup-closed-by-user','auth/cancelled-popup-request','auth/operation-not-supported-in-this-environment'];
getRedirectResult(auth).catch(e => { $('login-msg').textContent = 'No se pudo ingresar ('+(e.code||'error')+'). Probá abrir el link directo en Chrome.'; });
$('btn-login').addEventListener('click', async () => {
  $('login-msg').textContent = '';
  if (isMobile) { $('login-msg').textContent = 'Te llevamos a Google…'; return signInWithRedirect(auth, provider); }
  try { await signInWithPopup(auth, provider); }
  catch (e) {
    if (POPUP_FAIL.includes(e.code)) { $('login-msg').textContent = 'Te llevamos a Google…'; return signInWithRedirect(auth, provider); }
    $('login-msg').textContent = 'No se pudo ingresar ('+(e.code||'error')+').'; }
});
onAuthStateChanged(auth, user => {
  if (!user) { $('app').hidden=true; $('login').hidden=false; S.unsubCausas&&S.unsubCausas(); return; }
  if (OWNER_EMAIL && user.email !== OWNER_EMAIL) {
    $('login-msg').textContent = 'Esta cuenta ('+user.email+') no tiene acceso. Ingresá con '+OWNER_EMAIL+'.';
    signOut(auth); return; }
  $('login').hidden=true; $('app').hidden=false;
  $('userbar').replaceChildren(h('span',{},user.email), h('button',{type:'button',class:'btn ghost',onclick:()=>signOut(auth)},'Salir'));
  start();
});

/* ---------- list ---------- */
function buildFilters(){
  const seg=$('seg-estado'); seg.textContent='';
  for (const [lbl,val] of [['Activas','Activa'],['En espera','En espera'],['Cerradas','Cerrada'],['Todas','']])
    seg.append(h('button',{type:'button','aria-pressed':String(S.estado===val),onclick:()=>{S.estado=val;buildFilters();renderList();}},lbl));
  const sel=$('sel-fuero'); if(!sel.options.length){ sel.append(h('option',{value:''},'Todos los fueros'),...FUEROS.map(f=>h('option',{value:f},f)));
    sel.addEventListener('change',()=>{S.fuero=sel.value;renderList();}); }
}
function filtered(){ const q=S.q.trim().toLowerCase();
  return S.causas.filter(c=>(!S.estado||(c.estado||'Activa')===S.estado)&&(!S.fuero||c.fuero===S.fuero)&&
    (!q||[c.nombre,c.caratula,c.cliente,c.expediente,c.tribunal,c.fuero].join(' ').toLowerCase().includes(q)))
   .sort((a,b)=>{const da=a.proximaFecha||'9999',db_=b.proximaFecha||'9999';return da<db_?-1:da>db_?1:String(a.nombre).localeCompare(String(b.nombre),'es');}); }
function renderAgenda(){ const box=$('agenda'); box.textContent='';
  const items=S.causas.filter(c=>c.estado!=='Cerrada'&&c.proximaFecha&&String(c.proximaFecha).length===10).sort((a,b)=>a.proximaFecha<b.proximaFecha?-1:1).slice(0,5);
  if(!items.length) return;
  box.append(h('div',{class:'agenda'},h('h2',{},'Próximos pasos con fecha'),
    h('ol',{},items.map(c=>{const d=dueInfo(c.proximaFecha);return h('li',{tabindex:'0',onclick:()=>select(c.id),onkeydown:e=>{if(e.key==='Enter')select(c.id);}},
      h('span',{class:'due '+d.cls},d.txt),h('span',{style:'min-width:0'},h('span',{class:'ag-name'},c.nombre),h('span',{class:'ag-step'},c.proximoPaso||'')));})))); }
function renderList(){ renderAgenda(); const ul=$('lista'); ul.textContent='';
  if(!S.loaded){ ul.append(h('li',{class:'empty'},'Cargando tus causas…')); return; }
  if(!S.causas.length){ ul.append(h('li',{class:'empty'},'Todavía no hay causas.',h('br'),
      h('button',{type:'button',class:'btn',style:'margin-top:10px',onclick:importSeed},'Importar mis causas (archivo causas-inicial.json)'))); return; }
  const list=filtered();
  if(!list.length){ ul.append(h('li',{class:'empty'},'Ninguna causa coincide con el filtro.')); return; }
  for (const c of list){ const d=dueInfo(c.proximaFecha);
    ul.append(h('li',{},h('button',{type:'button',class:'causa','aria-current':String(S.sel===c.id),onclick:()=>select(c.id)},
      h('div',{class:'t'},h('span',{class:'n'},c.nombre||'(sin nombre)'),d?h('span',{class:'due '+d.cls},d.txt):null),
      h('div',{class:'row'},h('span',{class:'fuero '+fueroCls(c.fuero)},c.fuero||'Sin fuero'),c.expediente?h('span',{class:'x'},c.expediente):null),
      c.proximoPaso?h('div',{class:'s'},c.proximoPaso):null))); }
}
function importSeed(){
  const inp=h('input',{type:'file',accept:'application/json,.json',hidden:true});
  inp.addEventListener('change',async()=>{ const f=inp.files[0]; if(!f) return;
    try{ const rows=JSON.parse(await f.text()); await importRows(rows); }catch(e){ toast('El archivo no es válido.'); } });
  document.body.append(inp); inp.click(); }
async function importRows(rows){
  try{
    for (let i=0;i<rows.length;i+=400){ const b=writeBatch(db); rows.slice(i,i+400).forEach(r=>b.set(doc(db,r.path),r.data)); await b.commit(); }
    toast('Se importaron '+rows.length+' registros.'); }
  catch(e){ toast('No se pudo importar ('+(e.code||'error')+').'); } }

/* ---------- detail ---------- */
const current = () => S.causas.find(c=>c.id===S.sel)||null;
function select(id){
  if(S.sel!==id){ S.editing=false; S.unsubEv&&S.unsubEv(); S.unsubDocs&&S.unsubDocs(); S.eventos=[]; S.docs=[]; S.sel=id;
    S.unsubEv=onSnapshot(collection(db,'causas',id,'eventos'),s=>{S.eventos=s.docs.map(d=>({id:d.id,...d.data()}));renderTimeline();},e=>toast('No se pudieron leer los movimientos.'));
    S.unsubDocs=onSnapshot(collection(db,'causas',id,'docs'),s=>{S.docs=s.docs.map(d=>({id:d.id,...d.data()}));renderTimeline();renderDocs();},()=>{});
    try{ history.replaceState(null,'','#c-'+id); }catch(e){} }
  document.body.classList.add('show-detail'); renderList(); renderDetail(); window.scrollTo({top:0});
}
function renderDetail(){ const box=$('detalle'); box.textContent=''; const c=current();
  if(!c){ box.append(h('div',{class:'empty'},'Elegí una causa de la lista para ver su estado, movimientos y documentos.')); return; }
  box.append(h('article',{class:'detail'},h('div',{id:'cabecera'}),h('section',{},h('h3',{},'Movimientos'),h('div',{id:'nuevo-mov'}),h('ol',{class:'timeline',id:'timeline'})),h('section',{id:'sec-docs'})));
  renderHeader(); renderNewEvent(); renderTimeline(); renderDocs(); }
function renderHeader(){ const box=$('cabecera'); if(!box) return; box.textContent=''; const c=current(); if(!c) return;
  if(S.editing){ box.append(causaForm(c)); return; }
  const d=dueInfo(c.proximaFecha);
  const meta=[['Tribunal / dependencia',c.tribunal],['Cliente',c.cliente],['Junto a',c.conQuien],['Honorarios',c.honorarios],['Etapa',c.etapa]].filter(x=>x[1]);
  box.append(h('div',{style:'display:grid;gap:16px'},
    h('div',{},h('button',{type:'button',class:'btn ghost back',onclick:()=>document.body.classList.remove('show-detail')},'← Causas'),
      h('div',{class:'eyebrow'},h('span',{class:'fuero '+fueroCls(c.fuero)},c.fuero||'Sin fuero'),h('span',{class:'pill '+estadoCls(c.estado)},c.estado||'Activa'),
        c.actualizado?h('span',{},'Actualizada '+fmt(String(c.actualizado).slice(0,10))):null,
        h('span',{style:'margin-left:auto'},h('button',{type:'button',class:'btn',onclick:()=>{S.editing=true;renderHeader();}},'Editar datos'))),
      h('h2',{},c.nombre||'(sin nombre)')),
    (c.caratula||c.expediente)?h('div',{class:'caratula'},h('span',{class:'lbl'},'Carátula'),c.caratula?h('div',{class:'c'},c.caratula):null,c.expediente?h('div',{class:'e'},'Expte. '+c.expediente):null):null,
    meta.length?h('dl',{class:'meta'},meta.map(([k,v])=>h('div',{},h('dt',{},k),h('dd',{},v)))):null,
    c.proximoPaso?h('div',{class:'next'},h('span',{class:'lbl'},'Próximo paso'),h('div',{class:'txt'},c.proximoPaso),d?h('div',{},h('span',{class:'due '+d.cls},d.txt)):null):null,
    c.resumen?h('p',{class:'resumen'},c.resumen):null)); }
function field(lbl,input,full){ return h('label',{class:'f'+(full?' full':'')},lbl,input); }
function causaForm(c){ const isNew=!c; c=c||{estado:'Activa'};
  const inp=(id,val,type)=>h('input',{id:'cf-'+id,type:type||'text',value:val||''});
  const fueroSel=h('select',{id:'cf-fuero'},h('option',{value:''},'Elegir…'),FUEROS.map(f=>h('option',{value:f,selected:c.fuero===f},f)));
  const estSel=h('select',{id:'cf-estado'},ESTADOS.map(e=>h('option',{value:e,selected:(c.estado||'Activa')===e},e)));
  const res=h('textarea',{id:'cf-resumen'}); res.value=c.resumen||'';
  const f=h('form',{class:'grid formbox',onsubmit:async e=>{ e.preventDefault();
      const g=id=>$('cf-'+id).value.trim();
      const data={nombre:g('nombre'),caratula:g('caratula'),cliente:g('cliente'),fuero:g('fuero'),expediente:g('expediente'),tribunal:g('tribunal'),estado:g('estado'),etapa:g('etapa'),proximoPaso:g('proximoPaso'),proximaFecha:g('proximaFecha'),conQuien:g('conQuien'),honorarios:g('honorarios'),resumen:g('resumen'),actualizado:now()};
      if(!data.nombre){ toast('Poné al menos un nombre para la causa.'); return; }
      const btn=f.querySelector('button[type=submit]'); btn.disabled=true;
      try{ if(isNew){ const id=slug(data.nombre); await setDoc(doc(db,'causas',id),data); S.editing=false; select(id); toast('Causa creada.'); }
           else { await updateDoc(doc(db,'causas',c.id),data); S.editing=false; renderHeader(); toast('Datos guardados.'); } }
      catch(err){ btn.disabled=false; toast('No se pudo guardar ('+(err.code||'error')+').'); } }},
    h('div',{class:'full',style:'font-weight:600'},isNew?'Nueva causa':'Editar datos de la causa'),
    field('Nombre corto (como la llamás vos)',inp('nombre',c.nombre),true),
    field('Carátula',inp('caratula',c.caratula),true),
    field('Cliente',inp('cliente',c.cliente)),field('Fuero',fueroSel),field('Expediente',inp('expediente',c.expediente)),
    field('Tribunal / dependencia',inp('tribunal',c.tribunal)),field('Estado',estSel),field('Etapa actual',inp('etapa',c.etapa)),
    field('Próximo paso',inp('proximoPaso',c.proximoPaso),true),field('Fecha del próximo paso',inp('proximaFecha',c.proximaFecha,'date')),
    field('Junto a (colegas)',inp('conQuien',c.conQuien)),field('Honorarios',inp('honorarios',c.honorarios)),
    field('Resumen del caso',res,true),
    h('div',{class:'full row'},h('button',{type:'submit',class:'btn primary'},isNew?'Crear causa':'Guardar'),
      h('button',{type:'button',class:'btn',onclick:()=>{ if(isNew){ S.sel=null; renderDetail(); } else { S.editing=false; renderHeader(); } }},'Cancelar')));
  return f; }
function renderNewEvent(){ const box=$('nuevo-mov'); if(!box) return; box.textContent='';
  let open=false; const toggle=h('button',{type:'button',class:'btn',onclick:()=>{open=!open;form.hidden=!open;toggle.textContent=open?'Cerrar':'+ Cargar movimiento';}},'+ Cargar movimiento');
  const tipo=h('select',{id:'ev-tipo'},TIPOS.map(t=>h('option',{value:t},t)));
  const det=h('textarea',{id:'ev-det'});
  const form=h('form',{class:'grid formbox',hidden:true,style:'margin-top:10px',onsubmit:async e=>{ e.preventDefault();
      const c=current(); if(!c) return; const titulo=$('ev-tit').value.trim(); if(!titulo){ toast('Escribí un título para el movimiento.'); return; }
      const btn=form.querySelector('button[type=submit]'); btn.disabled=true;
      const ev={fecha:$('ev-fecha').value||todayStr(),tipo:tipo.value,titulo,detalle:det.value.trim(),link:$('ev-link').value.trim(),creado:now()};
      try{ await addDoc(collection(db,'causas',c.id,'eventos'),ev); await updateDoc(doc(db,'causas',c.id),{actualizado:now()});
        form.reset(); $('ev-fecha').value=todayStr(); toast('Movimiento cargado.'); }
      catch(err){ toast('No se pudo cargar ('+(err.code||'error')+').'); }
      btn.disabled=false; }},
    field('Fecha',h('input',{id:'ev-fecha',type:'date',value:todayStr()})),field('Tipo',tipo),
    field('Título',h('input',{id:'ev-tit',type:'text',placeholder:'Ej.: Presenté hábeas data por mail al Juzgado Federal'}),true),
    field('Detalle',det,true),
    field('Enlace (Drive, chat, expediente web)',h('input',{id:'ev-link',type:'url',placeholder:'https://…'}),true),
    h('div',{class:'full'},h('button',{type:'submit',class:'btn primary'},'Guardar movimiento')));
  box.append(toggle,form); }
function renderTimeline(){ const ol=$('timeline'); if(!ol) return; ol.textContent='';
  const evs=[...S.eventos].sort((a,b)=>String(b.fecha).localeCompare(String(a.fecha))||String(b.creado||'').localeCompare(String(a.creado||'')));
  if(!evs.length){ ol.append(h('li',{class:'empty'},'Sin movimientos cargados.')); return; }
  for (const ev of evs){ const link=safeUrl(ev.link); let confirmBox=null;
    const acts=h('div',{class:'acts'},link?h('a',{href:link,target:'_blank',rel:'noopener'},ev.tipo==='Trabajo con Claude'?'Abrir el chat':'Abrir enlace'):null);
    acts.append(h('button',{type:'button',class:'btn ghost',onclick:()=>{ if(confirmBox){confirmBox.remove();confirmBox=null;return;}
      confirmBox=h('span',{class:'row'},h('span',{class:'hint'},'¿Borrar este movimiento?'),
        h('button',{type:'button',class:'btn danger',onclick:async()=>{ try{ await deleteDoc(doc(db,'causas',S.sel,'eventos',ev.id)); toast('Movimiento borrado.'); }catch(e){ toast('No se pudo borrar.'); } }},'Borrar'),
        h('button',{type:'button',class:'btn',onclick:()=>{confirmBox.remove();confirmBox=null;}},'No')); acts.append(confirmBox); }},'Borrar'));
    ol.append(h('li',{class:'ev'},h('div',{class:'when'},h('div',{class:'date'},fmt(ev.fecha))),
      h('div',{style:'min-width:0'},h('div',{class:'tipo'+(ev.tipo==='Trabajo con Claude'?' claude':'')},ev.tipo||'Nota'),h('div',{class:'tt'},ev.titulo||''),ev.detalle?h('p',{class:'dd'},ev.detalle):null,acts))); } }
function renderDocs(){ const sec=$('sec-docs'); if(!sec) return; sec.textContent='';
  let open=false; const toggle=h('button',{type:'button',class:'btn',onclick:()=>{open=!open;form.hidden=!open;}},'+ Agregar documento');
  const form=h('form',{class:'grid formbox',hidden:true,style:'margin-bottom:10px',onsubmit:async e=>{ e.preventDefault();
      const nombre=$('dc-nom').value.trim(), url=$('dc-url').value.trim(); if(!nombre||!safeUrl(url)){ toast('Poné el nombre y un enlace que empiece con https://'); return; }
      try{ await addDoc(collection(db,'causas',S.sel,'docs'),{nombre,url,fecha:$('dc-fecha').value||todayStr(),eventoId:''}); form.reset(); toast('Documento agregado.'); }
      catch(err){ toast('No se pudo guardar ('+(err.code||'error')+').'); } }},
    field('Nombre',h('input',{id:'dc-nom',type:'text',placeholder:'Ej.: Hábeas data firmado'}),true),
    field('Enlace (Google Drive u otro)',h('input',{id:'dc-url',type:'url',placeholder:'https://drive.google.com/…'})),
    field('Fecha',h('input',{id:'dc-fecha',type:'date',value:todayStr()})),
    h('div',{class:'full'},h('button',{type:'submit',class:'btn primary'},'Guardar documento')));
  sec.append(h('h3',{},h('span',{},'Documentos'),toggle),form);
  const docs=[...S.docs].sort((a,b)=>String(b.fecha).localeCompare(String(a.fecha)));
  if(!docs.length){ sec.append(h('div',{class:'empty'},'Sin documentos. Agregá el enlace de Drive de cada escrito o constancia.')); return; }
  sec.append(h('ul',{class:'docs'},docs.map(x=>{ const u=safeUrl(x.url);
    return h('li',{},u?h('a',{href:u,target:'_blank',rel:'noopener'},x.nombre||'Documento'):h('span',{},x.nombre||'Documento',h('span',{class:'hint'},' (sin enlace)')),h('span',{class:'date'},fmt(x.fecha))); }))); }

/* ---------- boot ---------- */
$('q').addEventListener('input',e=>{S.q=e.target.value;renderList();});
$('btn-nueva').addEventListener('click',()=>{ const box=$('detalle'); box.textContent=''; box.append(h('div',{class:'detail'},causaForm(null))); document.body.classList.add('show-detail'); });
function start(){
  if(S.unsubCausas) return;
  buildFilters(); renderList();
  S.unsubCausas=onSnapshot(collection(db,'causas'),snap=>{
      S.causas=snap.docs.map(d=>({id:d.id,...d.data()})); S.loaded=true; $('banner').textContent='';
      renderList();
      const m=/^#c-([A-Za-z0-9_-]+)$/.exec(location.hash||'');
      if(m&&!S.sel&&S.causas.some(c=>c.id===m[1])) select(m[1]);
      else if(S.sel&&!S.editing) renderHeader(); },
    e=>{ S.loaded=true; $('banner').replaceChildren(h('div',{class:'banner'},'No se pudo leer la base de causas ('+e.code+'). Revisá las reglas de Firestore.')); renderList(); });
}
window.addEventListener('hashchange',()=>{ const m=/^#c-([A-Za-z0-9_-]+)$/.exec(location.hash||''); if(m&&m[1]!==S.sel&&S.causas.some(c=>c.id===m[1])) select(m[1]); });
if('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(()=>{});
