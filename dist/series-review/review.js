'use strict';
const $=id=>document.getElementById(id), status=t=>{$('status').textContent=t;};
let token='', libraries=[], saving=false, generation=0, reviewKey='', savedReview=null;
const root=id=>'/api/v1/libraries/'+encodeURIComponent(id);
const key=s=>String(s??'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/^the\s+/,'').replace(/[^a-z0-9]/g,'');
const valid=n=>Number.isFinite(n)&&n>0&&n<=1000;
async function api(url,method='GET',data){
 const endpoint=url.startsWith('/api/')?url:'/series-assistant'+url;
 const r=await fetch(endpoint,{method,headers:{...(data?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{})},...(data?{body:JSON.stringify(data)}:{})});
 if(r.status===204)return null;
 const j=await r.json();if(!r.ok)throw Object.assign(Error(j.error||'Request failed.'),{status:r.status,retryAfter:j.retry_after,daily:j.daily});return j.data??j;
}
async function startSeriesReview(){
 try{
  token=sessionStorage.getItem('librarium-access')||'';
  if(!token)return status('Sign in to My Librarium first, then reopen Series Review from Settings.');
  const [account,available]=await Promise.all([api('/api/v1/auth/me'),api('/api/v1/libraries')]);
  const accountID=account?.id||account?.user?.id;
  if(!accountID)throw Error('Could not identify the signed-in account.');
  if(account.is_instance_admin!==true)throw Error('Series Assistant is available to the Librarium administrator.');
  libraries=available;
  $('library').replaceChildren(new Option('All libraries',''),...libraries.map(x=>new Option(x.name,x.id)));
  $('work').hidden=false;$('provider').hidden=false;
  reviewKey='librarium-series-review-v2:'+accountID;
  try{savedReview=JSON.parse(localStorage.getItem(reviewKey)||'null');}catch{}
  if(savedReview?.items&&savedReview?.unresolved){renderSavedReview(++generation);status('Restored review from '+new Date(savedReview.at).toLocaleString()+'.');}
  else status('Choose a library or scan all libraries.');
  document.dispatchEvent(new Event('librarium-signed-in'));
 }catch(e){status(e.message);}
}
$('logout').onclick=()=>{sessionStorage.removeItem('librarium-access');location.assign('/');};
window.addEventListener('DOMContentLoaded',startSeriesReview,{once:true});
async function catalogue(base){
 const all=[];
 for(let page=1;page<=200;page++){
  const j=await api(base+'/books?page='+page+'&per_page=100');
  const items=Array.isArray(j)?j:j.items;
  if(!Array.isArray(items))throw Error('Unexpected catalogue response.');
  all.push(...items);
  if(Array.isArray(j)||!items.length||(Number.isFinite(j.total)?all.length>=j.total:items.length<100))return all;
 }
 throw Error('The catalogue scan exceeded its page limit.');
}
const element=(tag,text)=>Object.assign(document.createElement(tag),{textContent:text});
function renderGroup(lib,runs,group,rev,shared){
 const approvalKey=b=>JSON.stringify([lib.id,key(group.name),b.id,b.position]);
 const persistedGroup=group.books.some(b=>savedReview?.items.some(item=>item.lib.id===lib.id&&item.group.books.includes(b)));
 const isApproved=b=>persistedGroup&&savedReview.approved.includes(approvalKey(b));
 const completed=group.books.every(isApproved);
 const row=element('article',''), heading=element('h3',group.name+' · '+lib.name);
 const mode=document.createElement('select');mode.setAttribute('aria-label','Series to link or create');
 const normalized=key(group.name), exact=runs.filter(s=>key(s.name)===normalized||(group.slug&&s.external_source==='hardcover'&&s.external_id===group.slug));
 const similar=runs.filter(s=>{const n=key(s.name);return n.length>=5&&normalized.length>=5&&(n.includes(normalized)||normalized.includes(n));});
 mode.replaceChildren(new Option('Choose an existing series or create one',''),
  ...runs.map(x=>new Option('Link to: '+x.name,x.id)),
  ...(exact.length?[]:[new Option('Create: '+group.name,'new')]));
 if(exact.length===1)mode.value=exact[0].id;
 else if(!exact.length&&!similar.length)mode.value='new';
 const list=element('ul',''), selected=[];
 for(const b of group.books){
  const li=element('li',''), label=element('label',''), box=document.createElement('input');
  box.type='checkbox';box.checked=!isApproved(b);box.disabled=isApproved(b);
  label.append(box,document.createTextNode('Vol. '+b.position+' · '+b.title+(isApproved(b)?' · Approved':'')));li.append(label);list.append(li);selected.push({b,box});
 }
 const approve=element('button','Approve selected books');
 const message=element('p','');message.setAttribute('role','status');
 row.append(heading,element('p',group.reason||'Check the suggested membership and order.'),mode,list);
 if(!shared)row.append(approve);
 if(group.note)row.append(element('p','Ollama review note (unverified): '+group.note));
 row.append(message);
 if(completed){approve.disabled=mode.disabled=true;message.textContent='Already approved in this review.';}
 (shared?.container||$('results')).append(row);
 const prepare=()=>{
  if(completed)return null;
  const choice=mode.value, chosen=selected.filter(x=>x.box.checked).map(x=>x.b);
  const books=chosen.map(b=>({book_id:b.id,position:b.position}));
  if(!choice||!books.length)throw Error('Choose a series and at least one book for '+lib.name+'.');
  for(const b of chosen){
   const clash=chosen.some(x=>x.id!==b.id&&x.position===b.position&&(!b.work||b.work!==x.work));
   if(clash)throw Error('Different books have the same volume position in '+lib.name+'. Deselect one.');
  }
  return {choice,books,chosen};
 };
 const apply=async ({choice,books,chosen})=>{

  approve.disabled=true;mode.disabled=true;
  try{
   const base=root(lib.id)+'/series', fresh=await api(base);
   if(choice==='new'){
    const matches=fresh.filter(s=>key(s.name)===normalized||(group.slug&&s.external_source==='hardcover'&&s.external_id===group.slug));
    if(matches.length>1)throw Error('Multiple matching series now exist. Scan again and choose one.');
    if(matches.length===1)choice=matches[0].id;
   }
   if(choice==='new'){
    const result=await api(base+'/bulk-create','POST',{series:[{name:group.name,books}]});
    if(result?.created!==1)throw Error('Librarium did not confirm creation. Scan again before retrying.');
    message.textContent='Series created in Librarium.';
   }else{
    if(!fresh.some(s=>s.id===choice))throw Error('That series is no longer available. Scan again.');
    const url=base+'/'+encodeURIComponent(choice)+'/books', linked=await api(url);
    const todo=books.filter(b=>!linked.some(x=>x.book_id===b.book_id));
    if(todo.some(b=>linked.some(x=>!books.some(y=>y.book_id===x.book_id&&y.position===b.position)&&x.position>0&&b.position>=x.position&&b.position<=Math.max(x.position,x.position_end||0))))throw Error('A proposed position is already occupied. Deselect that book.');
    let done=0;
    try{for(const b of todo){await api(url,'POST',b);done++;}}
    catch{throw Error('Saved '+done+' of '+todo.length+' new links. Check the series before retrying.');}
    message.textContent=done?done+' books linked.':'Those books were already linked.';
   }
   selected.forEach(x=>{x.box.disabled=true;});
   if(persistedGroup){savedReview.approved.push(...chosen.map(approvalKey));persistReview();}
  }catch(e){message.textContent=e.message;approve.disabled=false;mode.disabled=false;throw e;}
 };
 if(shared){shared.entries.push({prepare,apply});return;}
 approve.onclick=async()=>{
  if(rev!==generation||saving)return;
  saving=true;
  try{await apply(prepare());}catch(e){message.textContent=e.message;}finally{saving=false;}
 };

}
function providerMatch(volumes, books){
 const byTitle=new Map();
 for(const b of books){
  const k=key(b.title); if(!k)continue;
  if(!byTitle.has(k))byTitle.set(k,[]);
  byTitle.get(k).push(b);
 }
 return volumes.map(v=>{
  const names=(v.book?.contributions||[]).map(c=>key(c.author?.name)).filter(Boolean);
  const sameTitle=byTitle.get(key(v.book?.title))||[];
  const matches=sameTitle.filter(b=>(b.contributors||[]).some(c=>names.includes(key(c.name))));
  return {...v,matches};
 });
}
$('hardcover').onsubmit=async event=>{
 event.preventDefault();
 if(saving||$('generate').disabled)return;
 if(event.submitter?.id==='generate')return scanHardcover(event.currentTarget);
 const form=event.currentTarget, button=$('checkRun');
 const fields=new FormData(form),url=new URL(fields.get('series'));
 const slug=url.pathname.match(/^\/series\/([a-z0-9-]+)\/?$/i)?.[1];
 if(url.protocol!=='https:'||url.hostname!=='hardcover.app'||!slug)return status('Use a Hardcover series URL.');
 if(!fields.get('key')?.trim())return status('Enter your Hardcover API key.');
 form.elements.key.value='';
 button.disabled=true;$('generate').disabled=true;$('library').disabled=true;
 const rev=++generation;$('review').hidden=false;$('results').replaceChildren();
 status('Getting the volume list from Hardcover…');
 try{
  const run=await hardcoverRead('/hardcover',{slug,key:fields.get('key')});
  const volumes=(Array.isArray(run.book_series)?run.book_series:[]).filter(v=>valid(Number(v.position))&&v.book?.title);
  if(!volumes.length)throw Error('Hardcover did not return any numbered volumes.');
  const chosen=libraries.filter(lib=>!$('library').value||lib.id===$('library').value);
  const matchedTitles=new Set();let errors=0;
  for(const lib of chosen){
   status('Matching '+run.name+' against '+lib.name+'…');
   try{
    const [runs,books]=await Promise.all([api(root(lib.id)+'/series'),catalogue(root(lib.id))]);
    const matches=providerMatch(volumes,books), candidates=[];
    for(const v of matches){
     if(v.matches.length!==1)continue;
     const b=v.matches[0];
     matchedTitles.add(key(v.book.title));
     if(hasAffiliatedSeries(b))continue;
     if(!candidates.some(c=>c.id===b.id))candidates.push({id:b.id,title:b.title,position:Number(v.position)});
    }
    if(candidates.length)renderGroup(lib,runs,{name:run.name,reason:'Hardcover · matched by title and author',books:candidates},rev);
   }catch{errors++;}
  }
  const list=element('ul','');
  for(const v of volumes.filter(v=>!matchedTitles.has(key(v.book.title))))list.append(element('li','Vol. '+v.position+' · '+v.book.title));
  if(list.children.length){
   const section=element('article','');
   section.append(element('h3','No unique title-and-author match'),element('p','These volumes may be missing, catalogued under another title, or listed more than once.'),list);
   $('results').append(section);
  }
  status(run.name+' · '+volumes.length+' numbered entries from Hardcover.'+(errors?' '+errors+' libraries could not be checked.':'')+' Nothing has been saved.');
 }catch(e){status(e.message);}finally{button.disabled=false;$('generate').disabled=false;$('library').disabled=false;}
};


const isbn=v=>String(v??'').toUpperCase().replace(/[^0-9X]/g,'');
function bookISBNs(b){
 const records=[b,...(Array.isArray(b.editions)?b.editions:[]),b.primary_edition].filter(Boolean);
 return [...new Set(records.flatMap(r=>[r.isbn_10,r.isbn_13,r.isbn].map(isbn)).filter(x=>/^(?:[0-9]{9}[0-9X]|[0-9]{13})$/.test(x)))].slice(0,4);
}
function hardcoverMatch(book,records){
 const codes=bookISBNs(book);
 const exact=records.filter(r=>(r.editions||[]).some(e=>[isbn(e.isbn_10),isbn(e.isbn_13)].some(x=>codes.includes(x))));
 const authors=(book.contributors||[]).map(c=>key(c.name)).filter(Boolean);
 const fallback=records.filter(r=>key(r.title)===key(book.title)&&(r.contributions||[]).some(c=>authors.includes(key(c.author?.name))));
 const matches=exact.length?exact:fallback;
 const canonical=new Map(matches.map(r=>[r.canonical_id||r.id,r]));
 if(canonical.size!==1)return {state:canonical.size?'Ambiguous match':'No verified match',candidates:matches.slice(0,6).map(r=>String(r.title??'').slice(0,180))};
 const id=canonical.keys().next().value;
 return {record:records.find(r=>r.id===id)||canonical.get(id),method:exact.length?'ISBN':'title and author'};
}
async function hardcoverRead(url, data){
 for(let attempt=0; ;attempt++){
  try{return await api(url,'POST',data);}
  catch(e){
   if(e.status!==429||e.daily||attempt>=2||!Number.isFinite(e.retryAfter)||e.retryAfter>90)throw e;
   status('Hardcover asked us to pause for '+e.retryAfter+' seconds. The scan will resume automatically.');
   await new Promise(resolve=>setTimeout(resolve,(e.retryAfter+1)*1000));
  }
 }
}
const lookupKey=b=>JSON.stringify([String(b.title??''), (b.contributors||[]).map(c=>key(c.name)).sort(),bookISBNs(b).sort()]);
async function lookupBatch(batch,secret,cache){
 const unique=new Map(batch.map(b=>[lookupKey(b),b]));
 const pending=[...unique].filter(([id])=>!cache.has(id));
 if(!pending.length)return;
 try{
  const records=await hardcoverRead('/hardcover/books',{key:secret,
   titles:[...new Set(pending.map(([,b])=>String(b.title??'').slice(0,250)).filter(Boolean))],
   isbns:[...new Set(pending.flatMap(([,b])=>bookISBNs(b)))]});
  if(!Array.isArray(records))throw Error('Unexpected Hardcover response.');
  for(const [id,book] of pending)cache.set(id,hardcoverMatch(book,records));
 }catch(e){
  if(e.status===422&&pending.length>1){
   const mid=Math.ceil(pending.length/2);
   await lookupBatch(pending.slice(0,mid).map(([,b])=>b),secret,cache);
   await lookupBatch(pending.slice(mid).map(([,b])=>b),secret,cache);
   return;
  }
  throw e;
 }
}
function renderDuplicateGroups(items,rev){
 const pending=new Map();
 for(const item of items){
  for(const b of item.group.books){
   const id=JSON.stringify([b.work,item.group.slug||key(item.group.name),b.position]);
   if(!pending.has(id))pending.set(id,[]);
   pending.get(id).push({item,b});
  }
 }
 const grouped=new Set();
 for(const records of pending.values()){
  if(records.length<2||!records[0].b.work)continue;
  const shared={container:element('section',''),entries:[]}, first=records[0];
  const note=element('p','');note.setAttribute('role','status');
  const approve=element('button','Apply to selected records ('+records.length+' shown)');
  shared.container.append(element('h2',first.b.title.split(' · ')[0]+' · '+first.item.group.name+' · Vol. '+first.b.position),
   element('p','Hardcover identifies these catalogue entries as the same work. Approving links them without merging or deleting them.'));
  const targets=new Map();
  for(const {item,b} of records){
   grouped.add(b);
   if(!targets.has(item))targets.set(item,[]);
   targets.get(item).push(b);
  }
  for(const [item,books] of targets)
   renderGroup(item.lib,item.runs,{...item.group,books},rev,shared);
  shared.container.append(approve,note);$('results').append(shared.container);
  approve.onclick=async()=>{
   if(rev!==generation||saving)return;
   let plan;
   try{plan=shared.entries.map(entry=>[entry,entry.prepare()]).filter(([,choice])=>choice);if(!plan.length){approve.disabled=true;note.textContent='Already approved in this review.';return;}}
   catch(e){note.textContent=e.message;return;}
   approve.disabled=true;saving=true;
   let done=0;
   try{
    for(const [entry,choice] of plan){await entry.apply(choice);done++;}
    note.textContent='Approved links saved to Librarium.';
   }catch(e){
    note.textContent='Completed '+done+' of '+plan.length+' libraries. '+e.message+' Scan again before retrying.';
   }finally{saving=false;}
  };
 }
 for(const {lib,runs,group} of items){
  const books=group.books.filter(b=>!grouped.has(b));
  if(books.length)renderGroup(lib,runs,{...group,books},rev);
 }
}
function persistReview(){
 try{localStorage.setItem(reviewKey,JSON.stringify(savedReview));return true;}catch{return false;}
}
function renderSavedReview(rev){
 $('clearReview').hidden=false;
 const allowed=new Set(libraries.map(l=>l.id));
 $('review').hidden=false;$('exportReview').hidden=false;$('results').replaceChildren();
 renderDuplicateGroups(savedReview.items.filter(item=>allowed.has(item.lib.id)),rev);
 if(savedReview.unresolved.length){
  const details=element('details',''), list=element('ul','');
  details.append(element('summary','Books that need checking ('+savedReview.unresolved.length+')'),list);
  for(const x of savedReview.unresolved)list.append(element('li',x.title+' · '+x.library+' · '+x.reason+(x.note?' · Ollama, unverified: '+x.note:'')));
  $('results').append(details);
 }
}
$('clearReview').onclick=()=>{
 if(!savedReview)return;
 if(saving||$('generate').disabled)return status('Wait for the current action to finish.');
 if(!confirm('Clear the saved review from this browser? Approved changes in Librarium will stay.'))return;
 try{localStorage.removeItem(reviewKey);}
 catch{return status('The browser did not let us clear the saved review.');}
 generation++;
 savedReview=null;
 $('results').replaceChildren();
 $('review').hidden=true;
 $('exportReview').hidden=true;
 $('clearReview').hidden=true;
 status('Saved review cleared. Your Librarium catalogue was not changed.');
};
$('exportReview').onclick=()=>{
 if(!savedReview)return;
 const url=URL.createObjectURL(new Blob([JSON.stringify(savedReview,null,2)],{type:'application/json'}));
 const a=document.createElement('a');a.href=url;a.download='librarium-series-review.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
async function addExceptionNotes(items,unresolved){
 const cases=[];
 for(const item of items){
  const name=key(item.group.name);
  if(item.runs.some(s=>key(s.name)===name))continue;
  const ranked=item.runs.map(s=>({name:s.name,score:String(s.name).toLowerCase().split(/[^a-z0-9]+/).filter(w=>w.length>3&&item.group.name.toLowerCase().includes(w)).length})).filter(x=>x.score).sort((a,b)=>b.score-a.score).slice(0,5);
  if(ranked.length)cases.push({target:item.group, data:{type:'possible series alias',name:item.group.name,existing:ranked.map(x=>x.name)}});
 }
 for(const x of unresolved.filter(x=>x.reason!=='Lookup failed')){
  cases.push({target:x,data:{type:x.reason,title:x.title,author:x.author,candidates:x.candidates}});
 }
 let failures=0;
 for(let start=0;start<cases.length;start+=12){
  const batch=cases.slice(start,start+12);
  status('Asking local Ollama about exceptions · '+Math.min(start+12,cases.length)+' of '+cases.length+'…');
  try{
   const result=await api('/review-exceptions','POST',{cases:batch.map((x,id)=>({id,...x.data}))});
   for(const note of Array.isArray(result?.notes)?result.notes:[])
    if(Number.isInteger(note?.id)&&batch[note.id]&&typeof note.note==='string'&&note.note.trim())batch[note.id].target.note=note.note.slice(0,400);
   persistReview();
  }catch{failures++;if(failures>=2)break;}
 }
 return failures;
}
function hasAffiliatedSeries(book){
 return Array.isArray(book.series)&&book.series.length>0;
}
async function scanHardcover(form){
 const secret=form.elements.key.value.trim();
 if(!secret)return status('Enter your Hardcover API key.');
 form.elements.key.value='';
 const rev=++generation, button=$('generate'), single=$('checkRun'), picker=$('library');
 $('exportReview').hidden=true;
 button.disabled=single.disabled=picker.disabled=true;$('review').hidden=false;$('results').replaceChildren();
 let checked=0, skipped=0, noSeries=0, proposals=0, failures=0;
 const unresolved=[], cache=new Map(), reviewItems=[];
 try{
  for(const lib of libraries.filter(x=>!picker.value||x.id===picker.value)){
   try{
    status('Reading '+lib.name+'…');
    const [runs,allBooks]=await Promise.all([api(root(lib.id)+'/series'),catalogue(root(lib.id))]);
    const books=allBooks.filter(b=>!hasAffiliatedSeries(b));
    skipped+=allBooks.length-books.length;
    const groups=new Map();
    for(let i=0;i<books.length;i+=16){
     const batch=books.slice(i,i+16);
     status('Checking '+lib.name+' with Hardcover · '+Math.min(i+16,books.length)+' of '+books.length+'…');
     try{
      await lookupBatch(batch,secret,cache);
     }catch(e){
      if(e.status===429||e.status===401||e.status===403||!checked)throw e;
      failures+=batch.length;for(const b of batch)unresolved.push({library:lib.name,title:b.title,reason:'Lookup failed'});
      continue;
     }
     checked+=batch.length;
     for(const book of batch){
      const {record,state,method,candidates}=cache.get(lookupKey(book));
      if(!record){unresolved.push({library:lib.name,title:book.title,author:(book.contributors||[]).map(c=>c.name).join(', ').slice(0,240),reason:state,candidates});continue;}
      const memberships=(record.book_series||[]).filter(x=>x.series?.name&&valid(Number(x.position)));
      if(!memberships.length){noSeries++;continue;}
      for(const entry of memberships){
       const src=entry.series,id=String(src.id??key(src.name));
       const group=groups.get(id)||{name:src.name,slug:src.slug,reason:'Hardcover series membership and volume order',books:[]};
       if(!group.books.some(b=>b.id===book.id))group.books.push({id:book.id,title:book.title+' · '+method,position:Number(entry.position),work:String(record.canonical_id||record.id||'')});
       groups.set(id,group);
      }
     }
    }
    for(const group of groups.values()){group.books.sort((a,b)=>a.position-b.position);reviewItems.push({lib,runs,group});proposals++;}
   }catch(e){
    if(e.status===429||e.status===401||e.status===403||checked===0)throw e;
    $('results').append(element('p',lib.name+': '+e.message));
   }
  }
  savedReview={at:new Date().toISOString(),items:reviewItems,unresolved,approved:[]};
  const stored=persistReview();
  // Save the Hardcover results before any optional AI calls.
  const aiFailures=await addExceptionNotes(reviewItems,unresolved);
  const persisted=persistReview();
  renderSavedReview(rev);
  status(checked+' books checked · '+proposals+' series proposals · '+skipped+' books already in a series skipped · '+noSeries+' matched books without numbered series data'+(failures?' · '+failures+' lookup failures':'')+'. '+(stored&&persisted?'Review saved on this Mac.':'Download the review to keep a copy.')+(aiFailures?' Some Ollama notes could not be generated.':'')+' No library changes have been made automatically.');

 }catch(e){status(e.message+' Nothing has been saved.');}
 finally{button.disabled=single.disabled=picker.disabled=false;}
}
