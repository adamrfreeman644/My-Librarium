'use strict';

function mergePlan(source,target,positions){
 const occupied=target.filter(x=>valid(Number(x.position))).map(x=>[
  Number(x.position),Math.max(Number(x.position),Number(x.position_end)||0)
 ]);
 const targetByID=new Map(target.map(x=>[x.book_id,x]));
 const changes=[];
 for(const book of source){
  if(!book.book_id)throw Error('A source link has no book ID.');
  if(book.arc_id)throw Error('A source book belongs to a story arc. Move or remove its arc assignment in Librarium before combining.');
  if(Number(book.position_end)>Number(book.position))throw Error('A source book spans multiple volumes. Its range must be handled in Librarium.');
  if(targetByID.has(book.book_id))continue;
  const position=positions.get(book.book_id);
  if(!valid(position))throw Error('Enter a valid volume number for '+book.title+'.');
  if(occupied.some(([start,end])=>position>=start&&position<=end))throw Error('Volume '+position+' is already occupied. Choose another position for '+book.title+'.');
  occupied.push([position,position]);
  changes.push({book_id:book.book_id,position});
 }
 return changes;
}

function fingerprint(rows){
 return JSON.stringify(rows.map(b=>[b.book_id,b.position,b.position_end,b.arc_id]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))));
}

(()=>{
 const section=$('combinePage'), lib=$('combineLibrary'), source=$('combineSource'), target=$('combineTarget');
 const preview=$('combinePreview'), previewButton=$('previewCombine');
 const say=text=>{$('combineStatus').textContent=text;};
 let running=false, loading=false, version=0;
 const selectors=[lib,source,target];
 function showPage(){
  const show=Boolean(token)&&location.hash==='#combine';
  section.hidden=!show;
  $('reviewPage').hidden=show;
 }
 addEventListener('hashchange',showPage);
 document.addEventListener('librarium-signed-in',()=>{
  $('pages').hidden=false;
  lib.replaceChildren(new Option('Choose a library',''),...libraries.map(l=>new Option(l.name,l.id)));
  source.replaceChildren(new Option('Choose a source series',''));
  target.replaceChildren(new Option('Choose a series to keep',''));
  showPage();
 });
 lib.onchange=async()=>{
  const rev=++version;
  preview.replaceChildren();say('');loading=true;previewButton.disabled=true;
  source.replaceChildren(new Option('Choose a source series',''));
  target.replaceChildren(new Option('Choose a series to keep',''));
  try{
   if(!lib.value)return;
   const rows=await api(root(lib.value)+'/series');
   if(rev!==version)return;
   rows.sort((a,b)=>String(a.name).localeCompare(String(b.name)));
   for(const s of rows){
    const name=s.name+(s.book_count==null?'':' · '+s.book_count+' books');
    source.add(new Option(name,s.id));target.add(new Option(name,s.id));
   }
   if(rows.length<2)say('This library needs at least two series to combine.');
  }catch(e){if(rev===version)say(e.message);}
  finally{if(rev===version){loading=false;previewButton.disabled=false;}}
 };
 for(const s of [source,target])s.onchange=()=>{version++;preview.replaceChildren();say('');};
 previewButton.onclick=async()=>{
  if(running||loading||saving)return;
  const library=lib.value, from=source.value,to=target.value;
  if(!library||!from||!to||from===to)return say('Choose two different series in the same library.');
  const rev=++version;
  const sourcePath=root(library)+'/series/'+encodeURIComponent(from)+'/books';
  const targetPath=root(library)+'/series/'+encodeURIComponent(to)+'/books';
  const sourceName=source.selectedOptions[0].textContent,targetName=target.selectedOptions[0].textContent;
  preview.replaceChildren();say('Loading both series…');
  try{
   const [a,b]=await Promise.all([api(sourcePath),api(targetPath)]);
   if(rev!==version)return;
   if(!a.length)return say('The source series has no book links to move.');
   const positions=new Map();
   const keep=element('p','Keeping: '+targetName+'. Existing volume positions in this series stay as they are.');
   const list=element('ul','');
   for(const book of a){
    const li=element('li',''), current=b.find(x=>x.book_id===book.book_id);
    if(current)li.append(element('p',book.title+' · already in the destination at volume '+current.position));
    else{
     const label=element('label',book.title+' · destination volume ');
     const input=document.createElement('input');
     input.type='number';input.min='0.01';input.max='1000';input.step='any';
     input.value=valid(Number(book.position))?book.position:'';
     positions.set(book.book_id,Number(input.value));
     input.oninput=()=>{positions.set(book.book_id,Number(input.value));update();};
     label.append(input);li.append(label);
    }
    list.append(li);
   }
   const warning=element('p','');warning.setAttribute('role','status');
   const confirm=element('label','');
   const checkbox=document.createElement('input');checkbox.type='checkbox';
   confirm.append(checkbox,document.createTextNode(' Remove the verified book links from '+sourceName+'.'));
   const apply=element('button','Combine book links');
   const update=()=>{
    try{
     const adds=mergePlan(a,b,positions);
     warning.textContent=adds.length+' links to add; '+a.length+' source links to remove after verification. No books or series records will be deleted.';
     apply.disabled=!checkbox.checked||running;
    }catch(e){warning.textContent=e.message;apply.disabled=true;}
   };
   checkbox.onchange=update;
   preview.append(keep,list,warning,confirm,apply);update();say('Review the volume numbers before combining.');
   apply.onclick=async()=>{
    if(running||saving||rev!==version||!checkbox.checked)return;
    let adds;
    try{adds=mergePlan(a,b,positions);}catch(e){return say(e.message);}
    running=saving=true;
    selectors.forEach(el=>{el.disabled=true;});previewButton.disabled=true;apply.disabled=true;
    preview.querySelectorAll('input').forEach(el=>{el.disabled=true;});
    let removed=0, ready=false;
    try{
     const [freshA,freshB]=await Promise.all([api(sourcePath),api(targetPath)]);
     if(fingerprint(a)!==fingerprint(freshA)||fingerprint(b)!==fingerprint(freshB))
      throw Error('One of the series changed. Preview the combination again.');
     say('Adding and verifying destination links…');
     for(const book of adds)await api(targetPath,'POST',book);
     const [currentA,verified]=await Promise.all([api(sourcePath),api(targetPath)]);
     if(fingerprint(a)!==fingerprint(currentA)||!a.every(book=>verified.some(x=>x.book_id===book.book_id&&
       Number(x.position)===Number(b.find(y=>y.book_id===book.book_id)?.position??positions.get(book.book_id)))))
      throw Error('Destination links could not be verified or the source changed.');
     ready=true;
     say('Removing verified source links…');
     for(const book of a){await api(sourcePath+'/'+encodeURIComponent(book.book_id),'DELETE');removed++;}
     say('Combined '+removed+' book links. The source series record is still in Librarium.');
     preview.replaceChildren();
    }catch(e){
     say(e.message+' '+(ready?'Removal confirmed for '+removed+' source links.':'No source links were removed.')+' Preview again to check both series.');
    }finally{
     running=saving=false;selectors.forEach(el=>{el.disabled=false;});previewButton.disabled=false;
    }
   };
  }catch(e){if(rev===version)say(e.message);}
 };
 showPage();
})();
