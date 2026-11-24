import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, collection, doc, onSnapshot, setDoc, updateDoc, addDoc, deleteDoc, writeBatch, getDocs, enableIndexedDbPersistence } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
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
  $('userbar').replaceChildren(h('span',{},user.email), h('button',{type:'button',class:'btn ghost',onclick:importSeed},'Importar'), h('button',{type:'button',class:'btn ghost',onclick:()=>signOut(auth)},'Salir'));
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
      h('button',{type:'button',class:'btn',style:'margin-top:10px',onclick:importSeed},'Importar causas desde un archivo'))); return; }
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
    for (let i=0;i<rows.length;i+=400){ const b=writeBatch(db); rows.slice(i,i+400).forEach(r=>b.set(doc(db,r.path),r.data,{merge:true})); await b.commit(); }
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
    estadoBox(c),
    c.proximoPaso?h('div',{class:'next'},h('span',{class:'lbl'},'Próximo paso'),h('div',{class:'txt'},c.proximoPaso),d?h('div',{},h('span',{class:'due '+d.cls},d.txt)):null):null,
    c.resumen?h('p',{class:'resumen'},c.resumen):null)); }
function estadoBox(c){
  const box=h('div',{class:'estado'});
  const show=()=>{ box.textContent='';
    box.append(h('div',{class:'estado-top'},h('span',{class:'lbl'},'En qué quedamos'),
        c.estadoFecha?h('span',{class:'date'},'al '+fmt(c.estadoFecha)):null,
        h('button',{type:'button',class:'btn ghost',style:'margin-left:auto',onclick:edit},c.estadoActual?'Actualizar':'Escribir')),
      c.estadoActual?h('p',{class:'estado-txt'},c.estadoActual):h('p',{class:'hint'},'Todavía no hay un resumen del estado. Escribí en qué quedó la causa.')); };
  const edit=()=>{ box.textContent=''; const ta=h('textarea',{id:'estado-ta',rows:'6'}); ta.value=c.estadoActual||'';
    box.append(h('span',{class:'lbl'},'En qué quedamos'),ta,h('div',{class:'row',style:'margin-top:8px'},
      h('button',{type:'button',class:'btn primary',onclick:async()=>{ try{ await updateDoc(doc(db,'causas',c.id),{estadoActual:ta.value.trim(),estadoFecha:todayStr(),actualizado:now()}); toast('Estado actualizado.'); }catch(e){ toast('No se pudo guardar ('+(e.code||'error')+').'); } }},'Guardar'),
      h('button',{type:'button',class:'btn',onclick:show},'Cancelar'))); ta.focus(); };
  show(); return box; }

/* ---------- archivos guardados en Firestore, partidos en trozos ---------- */
const PARTE=700000, MAX_MB=8;
function toB64(file){ return new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(String(r.result).split(',')[1]||''); r.onerror=rej; r.readAsDataURL(file); }); }
async function guardarArchivo(causaId,file,fecha,eventoId){
  if(file.size>MAX_MB*1024*1024) throw {code:'el archivo supera '+MAX_MB+' MB'};
  const tipo=file.type||(/\.pdf$/i.test(file.name)?'application/pdf':'application/octet-stream');
  if(!/^(application\/pdf|image\/)/.test(tipo)) throw {code:'subí un PDF o una imagen'};
  const b64=await toB64(file); const ref=doc(collection(db,'causas',causaId,'archivos')); const n=Math.ceil(b64.length/PARTE)||1;
  for(let i=0;i<n;i+=5){ const b=writeBatch(db);
    for(let k=i;k<Math.min(n,i+5);k++) b.set(doc(db,'causas',causaId,'archivos',ref.id,'partes',String(k).padStart(4,'0')),{d:b64.slice(k*PARTE,(k+1)*PARTE)});
    await b.commit(); }
  await setDoc(ref,{nombre:file.name,tipo,size:file.size,partes:n,creado:now()});
  await addDoc(collection(db,'causas',causaId,'docs'),{nombre:file.name,archivoId:ref.id,tipo,fecha:fecha||todayStr(),eventoId:eventoId||''}); }
async function abrirArchivo(causaId,x){
  const w=window.open('','_blank'); if(w){ try{ w.document.title='Abriendo…'; w.document.body.textContent='Abriendo '+(x.nombre||'archivo')+'…'; }catch(e){} }
  try{ const snap=await getDocs(collection(db,'causas',causaId,'archivos',x.archivoId,'partes'));
    const b64=snap.docs.sort((a,b)=>a.id.localeCompare(b.id)).map(d=>d.data().d).join('');
    const bin=atob(b64); const u8=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) u8[i]=bin.charCodeAt(i);
    const url=URL.createObjectURL(new Blob([u8],{type:x.tipo||'application/pdf'}));
    if(w) w.location.href=url; else { const a=h('a',{href:url,target:'_blank',download:x.nombre||'archivo'}); document.body.append(a); a.click(); a.remove(); } }
  catch(e){ if(w) w.close(); toast('No se pudo abrir el archivo.'); } }
async function borrarArchivo(causaId,x){
  if(x.archivoId){ const snap=await getDocs(collection(db,'causas',causaId,'archivos',x.archivoId,'partes')); const b=writeBatch(db); snap.forEach(d=>b.delete(d.ref)); b.delete(doc(db,'causas',causaId,'archivos',x.archivoId)); await b.commit(); }
  await deleteDoc(doc(db,'causas',causaId,'docs',x.id)); }
function docLink(causaId,x,label){
  if(x.archivoId) return h('a',{href:'#',onclick:e=>{e.preventDefault();abrirArchivo(causaId,x);}},label||x.nombre||'Archivo');
  const u=safeUrl(x.url); return u?h('a',{href:u,target:'_blank',rel:'noopener'},label||x.nombre||'Documento'):h('span',{},label||x.nombre||'Documento'); }

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
      h('button',{type:'button',class:'btn',onclick:()=>{ if(isNew){ S.sel=null; renderDetail(); } else { S.editing=false; renderHeader(); } }},'Cancelar'),
      isNew?null:h('span',{style:'margin-left:auto',id:'del-zone'},h('button',{type:'button',class:'btn danger',onclick:()=>askDelete(c)},'Eliminar causa'))));
  return f; }
function askDelete(c){ const z=$('del-zone'); if(!z) return; z.textContent='';
  z.append(h('span',{class:'row'},h('span',{class:'hint'},'¿Eliminar "'+(c.nombre||'')+'" con todos sus movimientos? No se puede deshacer.'),
    h('button',{type:'button',class:'btn danger',onclick:()=>deleteCausa(c)},'Sí, eliminar'),
    h('button',{type:'button',class:'btn',onclick:()=>{ z.textContent=''; z.append(h('button',{type:'button',class:'btn danger',onclick:()=>askDelete(c)},'Eliminar causa')); }},'No'))); }
async function deleteCausa(c){
  try{ S.unsubEv&&S.unsubEv(); S.unsubDocs&&S.unsubDocs();
    const b=writeBatch(db);
    for (const sub of ['eventos','docs']){ const snap=await getDocs(collection(db,'causas',c.id,sub)); snap.forEach(d=>b.delete(d.ref)); }
    const arch=await getDocs(collection(db,'causas',c.id,'archivos'));
    for (const a of arch.docs){ const ps=await getDocs(collection(db,'causas',c.id,'archivos',a.id,'partes')); ps.forEach(d=>b.delete(d.ref)); b.delete(a.ref); }
    b.delete(doc(db,'causas',c.id)); await b.commit();
    S.sel=null; S.editing=false; try{ history.replaceState(null,'',location.pathname); }catch(e){}
    document.body.classList.remove('show-detail'); renderDetail(); renderList(); toast('Causa eliminada.'); }
  catch(e){ toast('No se pudo eliminar ('+(e.code||'error')+').'); } }
function renderNewEvent(){ const box=$('nuevo-mov'); if(!box) return; box.textContent='';
  let open=false; const toggle=h('button',{type:'button',class:'btn',onclick:()=>{open=!open;form.hidden=!open;toggle.textContent=open?'Cerrar':'+ Cargar movimiento';}},'+ Cargar movimiento');
  const tipo=h('select',{id:'ev-tipo'},TIPOS.map(t=>h('option',{value:t},t)));
  const det=h('textarea',{id:'ev-det'});
  const form=h('form',{class:'grid formbox',hidden:true,style:'margin-top:10px',onsubmit:async e=>{ e.preventDefault();
      const c=current(); if(!c) return; const titulo=$('ev-tit').value.trim(); if(!titulo){ toast('Escribí un título para el movimiento.'); return; }
      const btn=form.querySelector('button[type=submit]'); btn.disabled=true;
      const ev={fecha:$('ev-fecha').value||todayStr(),tipo:tipo.value,titulo,detalle:det.value.trim(),link:$('ev-link').value.trim(),creado:now()};
      try{ const ref=await addDoc(collection(db,'causas',c.id,'eventos'),ev);
        const f=$('ev-file').files[0]; if(f){ $('ev-tit').disabled=true; toast('Subiendo archivo…'); await guardarArchivo(c.id,f,ev.fecha,ref.id); }
        const upd={actualizado:now()}; if($('ev-estado').checked){ upd.estadoActual=ev.titulo+(ev.detalle?'. '+ev.detalle:''); upd.estadoFecha=ev.fecha; }
        await updateDoc(doc(db,'causas',c.id),upd); $('ev-tit').disabled=false;
        form.reset(); $('ev-fecha').value=todayStr(); toast('Movimiento cargado.'); }
      catch(err){ toast('No se pudo cargar ('+(err.code||'error')+').'); }
      btn.disabled=false; }},
    field('Fecha (la del cargo, si es un escrito)',h('input',{id:'ev-fecha',type:'date',value:todayStr()})),field('Tipo',tipo),
    field('Título',h('input',{id:'ev-tit',type:'text',placeholder:'Ej.: Presenté hábeas data por mail al Juzgado Federal'}),true),
    field('Detalle',det,true),
    field('Escrito con cargo u otro archivo (PDF o foto, hasta 8 MB)',h('input',{id:'ev-file',type:'file',accept:'application/pdf,image/*'})),
    field('Enlace (opcional)',h('input',{id:'ev-link',type:'url',placeholder:'https://…'})),
    h('label',{class:'full row',style:'font-size:.88rem;gap:6px'},h('input',{id:'ev-estado',type:'checkbox',checked:true}),'Usar este movimiento como nuevo "En qué quedamos"'),
    h('div',{class:'full'},h('button',{type:'submit',class:'btn primary'},'Guardar movimiento')));
  box.append(toggle,form); }
function renderTimeline(){ const ol=$('timeline'); if(!ol) return; ol.textContent='';
  const evs=[...S.eventos].sort((a,b)=>String(b.fecha).localeCompare(String(a.fecha))||String(b.creado||'').localeCompare(String(a.creado||'')));
  if(!evs.length){ ol.append(h('li',{class:'empty'},'Sin movimientos cargados.')); return; }
  for (const ev of evs){ const link=safeUrl(ev.link); let confirmBox=null;
    const adj=S.docs.filter(x=>x.eventoId===ev.id);
    const acts=h('div',{class:'acts'},link?h('a',{href:link,target:'_blank',rel:'noopener'},ev.tipo==='Trabajo con Claude'?'Abrir el chat':'Abrir enlace'):null,
      adj.map(x=>docLink(S.sel,x,'Ver '+(x.nombre||'archivo'))));
    acts.append(h('button',{type:'button',class:'btn ghost',onclick:()=>{ if(confirmBox){confirmBox.remove();confirmBox=null;return;}
      confirmBox=h('span',{class:'row'},h('span',{class:'hint'},'¿Borrar este movimiento?'),
        h('button',{type:'button',class:'btn danger',onclick:async()=>{ try{ await deleteDoc(doc(db,'causas',S.sel,'eventos',ev.id)); toast('Movimiento borrado.'); }catch(e){ toast('No se pudo borrar.'); } }},'Borrar'),
        h('button',{type:'button',class:'btn',onclick:()=>{confirmBox.remove();confirmBox=null;}},'No')); acts.append(confirmBox); }},'Borrar'));
    ol.append(h('li',{class:'ev'},h('div',{class:'when'},h('div',{class:'date'},fmt(ev.fecha))),
      h('div',{style:'min-width:0'},h('div',{class:'tipo'+(ev.tipo==='Trabajo con Claude'?' claude':'')},ev.tipo||'Nota'),h('div',{class:'tt'},ev.titulo||''),ev.detalle?h('p',{class:'dd'},ev.detalle):null,acts))); } }

function renderDocs(){ const sec=$('sec-docs'); if(!sec) return; sec.textContent='';
  const up=h('label',{class:'btn'},'+ Subir archivo',h('input',{type:'file',accept:'application/pdf,image/*',hidden:true,onchange:async e=>{ const f=e.target.files[0]; if(!f) return;
      toast('Subiendo archivo…'); try{ await guardarArchivo(S.sel,f,todayStr(),''); toast('Archivo subido.'); }catch(err){ toast('No se pudo subir ('+(err.code||'error')+').'); } e.target.value=''; }}));
  let open=false; const toggle=h('button',{type:'button',class:'btn ghost',onclick:()=>{open=!open;form.hidden=!open;}},'+ Enlace');
  const form=h('form',{class:'grid formbox',hidden:true,style:'margin-bottom:10px',onsubmit:async e=>{ e.preventDefault();
      const nombre=$('dc-nom').value.trim(), url=$('dc-url').value.trim(); if(!nombre||!safeUrl(url)){ toast('Poné el nombre y un enlace que empiece con https://'); return; }
      try{ await addDoc(collection(db,'causas',S.sel,'docs'),{nombre,url,fecha:$('dc-fecha').value||todayStr(),eventoId:''}); form.reset(); toast('Enlace agregado.'); }
      catch(err){ toast('No se pudo guardar ('+(err.code||'error')+').'); } }},
    field('Nombre',h('input',{id:'dc-nom',type:'text'}),true),
    field('Enlace',h('input',{id:'dc-url',type:'url',placeholder:'https://…'})),
    field('Fecha',h('input',{id:'dc-fecha',type:'date',value:todayStr()})),
    h('div',{class:'full'},h('button',{type:'submit',class:'btn primary'},'Guardar enlace')));
  sec.append(h('h3',{},h('span',{},'Documentos'),h('span',{class:'row'},up,toggle)),form);
  const docs=[...S.docs].sort((a,b)=>String(b.fecha).localeCompare(String(a.fecha)));
  if(!docs.length){ sec.append(h('div',{class:'empty'},'Sin documentos. Subí escritos con cargo, cédulas o constancias en PDF o foto.')); return; }
  sec.append(h('ul',{class:'docs'},docs.map(x=>{ let conf=null; const li=h('li',{});
    const del=h('button',{type:'button',class:'btn ghost',onclick:()=>{ if(conf){conf.remove();conf=null;return;}
      conf=h('span',{class:'row'},h('button',{type:'button',class:'btn danger',onclick:async()=>{ try{ await borrarArchivo(S.sel,x); toast('Documento borrado.'); }catch(e){ toast('No se pudo borrar.'); } }},'Borrar'),
        h('button',{type:'button',class:'btn',onclick:()=>{conf.remove();conf=null;}},'No')); li.append(conf); }},'Borrar');
    li.append(docLink(S.sel,x),h('span',{class:'row'},h('span',{class:'date'},fmt(x.fecha)),del)); return li; }))); }

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
