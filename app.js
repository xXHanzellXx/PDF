pdfjsLib.GlobalWorkerOptions.workerSrc = '';

let pdfDoc = null;
let originalPdfBytes = null;
let pageNum = 1;
let pageRendering = false;
let pageNumPending = null;
let scale = 1.0; 
let rotations = {}; 
let pageAnnotations = {}; 
let copiedObject = null;

let historyStack = {}; 
let redoStack = {};   
let isInternalChange = false;

const pdfCanvas = document.getElementById('pdf-canvas');
const pdfCtx = pdfCanvas.getContext('2d');
let fabricCanvas = null;
let currentTool = 'select';

window.addEventListener('DOMContentLoaded', () => {
  initFabricCanvas();
  setupEventListeners();
  setupKeyboardShortcuts();
});

function initFabricCanvas() {
  fabricCanvas = new fabric.Canvas('fabric-canvas', {
    freeDrawingBrush: new fabric.PencilBrush(),
  });

  const handleStateChange = () => {
    if (isInternalChange) return;
    saveHistoryState();
  };

  fabricCanvas.on('object:modified', handleStateChange);
  fabricCanvas.on('object:added', handleStateChange);
  fabricCanvas.on('object:removed', handleStateChange);

  fabricCanvas.on('selection:created', syncTextControls);
  fabricCanvas.on('selection:updated', syncTextControls);
}

function setupEventListeners() {
  document.getElementById('pdf-input').addEventListener('change', handleFileSelect);
  document.getElementById('pdf-input-welcome').addEventListener('change', handleFileSelect);
  document.getElementById('image-input').addEventListener('change', handleImageUpload);
  document.getElementById('font-upload').addEventListener('change', handleFontUpload);
  document.getElementById('font-manual-apply').addEventListener('click', applyManualFont);
  
  // Firma y sellos
  document.getElementById('btn-open-signature').addEventListener('click', openSignatureModal);
  document.getElementById('close-signature-modal').addEventListener('click', closeSignatureModal);
  document.getElementById('cancel-signature').addEventListener('click', closeSignatureModal);
  document.getElementById('clear-signature').addEventListener('click', clearSignaturePad);
  document.getElementById('insert-signature').addEventListener('click', insertSignatureToPDF);

  document.getElementById('stamp-approved').addEventListener('click', () => addStamp('APROBADO', '#16a34a', '#dcfce7'));
  document.getElementById('stamp-rejected').addEventListener('click', () => addStamp('RECHAZADO', '#e11d48', '#ffe4e6'));
  document.getElementById('stamp-confidential').addEventListener('click', () => addStamp('CONFIDENCIAL', '#d97706', '#fef3c7'));
  document.getElementById('stamp-signed').addEventListener('click', () => addStamp('FIRMADO', '#4f46e5', '#e0e7ff'));

  const exportMenuBtn = document.getElementById('btn-export-menu');
  const exportDropdown = document.getElementById('export-dropdown');
  
  exportMenuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    exportDropdown.classList.toggle('hidden');
  });

  window.addEventListener('click', () => exportDropdown.classList.add('hidden'));

  document.getElementById('export-pdf').addEventListener('click', () => exportFile('pdf'));
  document.getElementById('export-png').addEventListener('click', () => exportFile('png'));
  document.getElementById('export-txt').addEventListener('click', () => exportFile('txt'));

  document.getElementById('btn-prev').addEventListener('click', onPrevPage);
  document.getElementById('btn-next').addEventListener('click', onNextPage);
  document.getElementById('page-num').addEventListener('change', (e) => {
    let num = parseInt(e.target.value);
    if (pdfDoc && num >= 1 && num <= pdfDoc.numPages) {
      saveCurrentPageAnnotations();
      pageNum = num;
      queueRenderPage(pageNum);
    }
  });

  document.getElementById('btn-zoom-in').addEventListener('click', () => { 
    if (scale < 2.5) { scale += 0.25; renderPage(pageNum); } 
  });
  document.getElementById('btn-zoom-out').addEventListener('click', () => { 
    if (scale > 0.5) { scale -= 0.25; renderPage(pageNum); } 
  });

  document.getElementById('tool-select').addEventListener('click', () => setTool('select'));
  document.getElementById('tool-text').addEventListener('click', () => addText());
  document.getElementById('tool-sticky-note').addEventListener('click', () => addStickyNote());
  document.getElementById('tool-whiteout').addEventListener('click', () => addWhiteout());
  document.getElementById('tool-draw').addEventListener('click', () => setTool('draw'));
  document.getElementById('tool-highlight').addEventListener('click', () => setTool('highlight'));
  document.getElementById('tool-rect').addEventListener('click', () => addShape('rect'));
  document.getElementById('tool-circle').addEventListener('click', () => addShape('circle'));
  document.getElementById('tool-line').addEventListener('click', () => addShape('line'));
  document.getElementById('tool-arrow').addEventListener('click', () => addShape('arrow'));
  document.getElementById('tool-delete').addEventListener('click', deleteSelectedObject);

  document.getElementById('btn-undo').addEventListener('click', undoAction);
  document.getElementById('btn-redo').addEventListener('click', redoAction);

  document.getElementById('font-family').addEventListener('change', updateTextProperty);
  document.getElementById('font-size').addEventListener('change', updateTextProperty);
  document.getElementById('text-color').addEventListener('change', updateTextProperty);
  document.getElementById('btn-bold').addEventListener('click', toggleBold);
  document.getElementById('btn-italic').addEventListener('click', toggleItalic);
  document.getElementById('btn-underline').addEventListener('click', toggleUnderline);

  document.getElementById('draw-color').addEventListener('input', updateBrushProperties);
  document.getElementById('draw-width').addEventListener('input', updateBrushProperties);

  document.getElementById('btn-bring-forward').addEventListener('click', bringForward);
  document.getElementById('btn-send-backward').addEventListener('click', sendBackward);

  document.getElementById('btn-rotate-left').addEventListener('click', () => rotatePage(-90));
  document.getElementById('btn-rotate-right').addEventListener('click', () => rotatePage(90));
  document.getElementById('btn-delete-page').addEventListener('click', deleteCurrentPage);

  document.getElementById('btn-guide').addEventListener('click', () => document.getElementById('guide-modal').classList.remove('hidden'));
  document.getElementById('close-guide').addEventListener('click', () => document.getElementById('guide-modal').classList.add('hidden'));
  document.getElementById('btn-understood').addEventListener('click', () => document.getElementById('guide-modal').classList.add('hidden'));
}

function setupKeyboardShortcuts() {
  window.addEventListener('keydown', (e) => {
    const activeElem = document.activeElement;
    if (activeElem && (activeElem.tagName === 'INPUT' || activeElem.tagName === 'SELECT' || activeElem.tagName === 'TEXTAREA')) {
      return;
    }

    const activeObj = fabricCanvas ? fabricCanvas.getActiveObject() : null;
    if (activeObj && activeObj.isEditing) return;

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) redoAction();
      else undoAction();
    }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      redoAction();
    }
    else if (e.key === 'Delete' || e.key === 'Backspace') {
      deleteSelectedObject();
    } 
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
      if (activeObj) activeObj.clone((cloned) => { copiedObject = cloned; });
    } 
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
      if (copiedObject) {
        copiedObject.clone((clonedObj) => {
          fabricCanvas.discardActiveObject();
          clonedObj.set({ left: clonedObj.left + 20, top: clonedObj.top + 20, evented: true });
          if (clonedObj.type === 'activeSelection') {
            clonedObj.canvas = fabricCanvas;
            clonedObj.forEachObject((obj) => fabricCanvas.add(obj));
            clonedObj.setCoordinates();
          } else {
            fabricCanvas.add(clonedObj);
          }
          copiedObject.top += 20;
          copiedObject.left += 20;
          fabricCanvas.setActiveObject(clonedObj);
          fabricCanvas.requestRenderAll();
          saveHistoryState();
        });
      }
    }
  });
}

function saveHistoryState() {
  if (!fabricCanvas || isInternalChange) return;
  if (!historyStack[pageNum]) historyStack[pageNum] = [];
  
  const jsonState = JSON.stringify(fabricCanvas.toJSON());
  const currentStack = historyStack[pageNum];
  
  if (currentStack.length === 0 || currentStack[currentStack.length - 1] !== jsonState) {
    currentStack.push(jsonState);
    redoStack[pageNum] = [];
  }
  updateHistoryButtonsUI();
}

function undoAction() {
  if (!historyStack[pageNum] || historyStack[pageNum].length <= 1) return;
  
  if (!redoStack[pageNum]) redoStack[pageNum] = [];
  const currentState = historyStack[pageNum].pop();
  redoStack[pageNum].push(currentState);

  const previousState = historyStack[pageNum][historyStack[pageNum].length - 1];
  isInternalChange = true;
  fabricCanvas.loadFromJSON(previousState, () => {
    fabricCanvas.renderAll();
    isInternalChange = false;
    updateHistoryButtonsUI();
  });
}

function redoAction() {
  if (!redoStack[pageNum] || redoStack[pageNum].length === 0) return;

  const nextState = redoStack[pageNum].pop();
  if (!historyStack[pageNum]) historyStack[pageNum] = [];
  historyStack[pageNum].push(nextState);

  isInternalChange = true;
  fabricCanvas.loadFromJSON(nextState, () => {
    fabricCanvas.renderAll();
    isInternalChange = false;
    updateHistoryButtonsUI();
  });
}

function updateHistoryButtonsUI() {
  const undoBtn = document.getElementById('btn-undo');
  const redoBtn = document.getElementById('btn-redo');

  undoBtn.disabled = !historyStack[pageNum] || historyStack[pageNum].length <= 1;
  redoBtn.disabled = !redoStack[pageNum] || redoStack[pageNum].length === 0;
}

async function handleFileSelect(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  try {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    const bytes = await file.arrayBuffer();
    // PDF nativo: se mantiene el flujo existente sin rasterizar el documento.
    if (ext === 'pdf' || file.type === 'application/pdf') {
      await loadPdfBytes(new Uint8Array(bytes), file.name);
      return;
    }
    if (['png','jpg','jpeg','webp','gif','bmp','tif','tiff'].includes(ext) || file.type.startsWith('image/')) {
      const dataUrl = await fileToDataURL(file);
      const img = await loadImage(dataUrl);
      const pdf = await PDFLib.PDFDocument.create();
      const pageW = img.naturalWidth || img.width;
      const pageH = img.naturalHeight || img.height;
      const page = pdf.addPage([pageW, pageH]);
      let embedded;
      if (ext === 'jpg' || ext === 'jpeg') embedded = await pdf.embedJpg(bytes);
      else if (ext === 'png') embedded = await pdf.embedPng(bytes);
      else {
        const canvas = document.createElement('canvas'); canvas.width = pageW; canvas.height = pageH;
        canvas.getContext('2d').drawImage(img, 0, 0, pageW, pageH);
        embedded = await pdf.embedPng(await (await fetch(canvas.toDataURL('image/png'))).arrayBuffer());
      }
      page.drawImage(embedded, {x:0,y:0,width:pageW,height:pageH});
      await loadPdfBytes(await pdf.save(), file.name);
      return;
    }
    if (['pptx','odt','odp'].includes(ext)) {
      if (!window.JSZip) throw new Error('No se pudo cargar el lector de archivos Office. Revisa tu conexión a Internet.');
      const zip=await JSZip.loadAsync(bytes);
      let entries=[];
      if (ext==='pptx') entries=Object.values(zip.files).filter(f=>!f.dir && /^ppt\/slides\/slide\d+\.xml$/i.test(f.name)).sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true}));
      else { const content=zip.file('content.xml'); if (content) entries=[content]; }
      const blocks=[];
      for (let i=0;i<entries.length;i++) {
        const xml=await entries[i].async('string');
        const parsed=new DOMParser().parseFromString(xml,'application/xml');
        const nodes=[...parsed.getElementsByTagNameNS('*','t')].map(n=>n.textContent).filter(Boolean);
        if (ext==='pptx') blocks.push({text:`Diapositiva ${i+1}`,size:23,bold:true});
        if (nodes.length) blocks.push({text:nodes.join(ext==='pptx'?'   ':' '),size:15});
        blocks.push({text:' ',size:10});
      }
      if (!blocks.length) throw new Error('No se encontró texto legible dentro del archivo.');
      await openEditableTextDocument(blocks,file.name);
      setImportStatus(`${file.name}: se extrajo el texto de Office como objetos editables. El diseño, imágenes, animaciones, fórmulas y tablas complejas no se conservan completamente.`);
      return;
    }
    if (['docx','odt'].includes(ext)) {
      if (ext === 'docx' && window.mammoth) {
        const result = await mammoth.convertToHtml({arrayBuffer: bytes});
        const parser = new DOMParser(); const doc = parser.parseFromString(result.value, 'text/html');
        const blocks = [...doc.body.querySelectorAll('h1,h2,h3,h4,p,li,td,th')].map(n => ({text:n.innerText.trim(), size:/^H1$/i.test(n.tagName)?28:/^H2$/i.test(n.tagName)?23:16, bold:/^H[1-4]$/.test(n.tagName)||n.tagName==='TH'})).filter(x=>x.text);
        if (!blocks.length) blocks.push({text:doc.body.innerText || 'Documento sin texto extraíble',size:16});
        await openEditableTextDocument(blocks, file.name);
        return;
      }
      throw new Error('Este archivo requiere una conversión a DOCX o PDF para importar su contenido.');
    }
    if (['xlsx','xls','ods','csv','tsv'].includes(ext)) {
      if (!window.XLSX) throw new Error('No se pudo cargar el lector de hojas de cálculo. Revisa tu conexión a Internet.');
      let workbook;
      if (['csv','tsv'].includes(ext)) workbook = XLSX.read(new TextDecoder().decode(bytes), {type:'string', raw:false, FS: ext==='tsv'?'\t':','});
      else workbook = XLSX.read(bytes, {type:'array'});
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, {header:1, raw:false, defval:''}).slice(0,100);
      const maxCols = Math.min(12, Math.max(1, ...rows.map(r=>r.length)));
      const blocks=[];
      rows.forEach((row, ri)=>{
        const cells = row.slice(0,maxCols).map(v=>String(v ?? '').replace(/\s+/g,' ').trim());
        if (cells.some(Boolean)) blocks.push({text:cells.join('   │   '), size:ri===0?15:12, bold:ri===0, topLine:ri===0});
      });
      await openEditableTextDocument(blocks.length?blocks:[{text:'La hoja está vacía.',size:16}], `${file.name} — ${workbook.SheetNames[0]}`);
      setImportStatus(`Hoja importada como texto editable. Se cargaron hasta 100 filas y ${maxCols} columnas; fórmulas, estilos y varias hojas no se reconstruyen todavía.`);
      return;
    }
    if (['musicxml','xml','mxl'].includes(ext) && (ext !== 'xml' || /score-partwise|score-timewise/i.test(new TextDecoder().decode(bytes.slice(0,4000))))) {
      let xmlText;
      if (ext === 'mxl') {
        if (!window.JSZip) throw new Error('No se pudo cargar el lector de archivos MXL.');
        const zip = await JSZip.loadAsync(bytes);
        let entry = Object.values(zip.files).find(f => !f.dir && /\.musicxml$|\.xml$/i.test(f.name) && !/META-INF/i.test(f.name));
        if (!entry) throw new Error('No se encontró un archivo MusicXML dentro del MXL.');
        xmlText = await entry.async('string');
      } else xmlText = new TextDecoder().decode(bytes);
      await openMusicXml(xmlText, file.name);
      return;
    }
    if (['txt','md','json','rtf','html','htm','xml'].includes(ext) || file.type.startsWith('text/')) {
      let text = new TextDecoder('utf-8').decode(bytes);
      if (ext === 'rtf') text = text.replace(/\\'[0-9a-f]{2}/gi,' ').replace(/\\par[d]?/g,'\n').replace(/\\[a-z]+-?\d* ?/gi,'').replace(/[{}]/g,'');
      if (['html','htm'].includes(ext)) { const d = new DOMParser().parseFromString(text,'text/html'); text = d.body.innerText || d.body.textContent || ''; }
      if (ext === 'json') { try { text = JSON.stringify(JSON.parse(text), null, 2); } catch (_) {} }
      const lines = text.replace(/\r/g,'').split('\n');
      await openEditableTextDocument(lines.map(line=>({text:line || ' ',size:15})), file.name);
      return;
    }
    if (ext === 'svg') {
      const svgText = new TextDecoder().decode(bytes);
      const blob = new Blob([svgText], {type:'image/svg+xml'});
      const url = URL.createObjectURL(blob);
      try {
        const img = await loadImage(url);
        const c = document.createElement('canvas'); c.width=img.naturalWidth||1200; c.height=img.naturalHeight||1600;
        c.getContext('2d').drawImage(img,0,0,c.width,c.height);
        const pdf=await PDFLib.PDFDocument.create(); const page=pdf.addPage([c.width,c.height]);
        const png=await pdf.embedPng(await (await fetch(c.toDataURL('image/png'))).arrayBuffer()); page.drawImage(png,{x:0,y:0,width:c.width,height:c.height});
        await loadPdfBytes(await pdf.save(),file.name);
      } finally { URL.revokeObjectURL(url); }
      setImportStatus('SVG importado como imagen de fondo. Puedes añadir y mover objetos encima, pero los trazos vectoriales originales no se separan automáticamente.');
      return;
    }
    throw new Error(`El formato .${ext || '(desconocido)'} todavía no tiene un importador compatible. Convierte el archivo a PDF, DOCX, XLSX, CSV, TXT o MusicXML para abrirlo aquí.`);
  } catch (err) {
    console.error('Error al importar archivo:', err);
    alert(`No se pudo importar “${file.name}”.\n\n${err.message || 'Archivo no compatible o dañado.'}`);
  } finally { e.target.value = ''; }
}

async function loadPdfBytes(bytes, filename='documento.pdf') {
  originalPdfBytes = bytes;
  const loadingTask = pdfjsLib.getDocument({ data: bytes });
  pdfDoc = await loadingTask.promise;
  pageNum = 1; rotations = {}; pageAnnotations = {}; historyStack = {}; redoStack = {};
  document.getElementById('page-count').textContent = pdfDoc.numPages;
  document.getElementById('btn-export-menu').disabled = false;
  document.getElementById('empty-state').classList.add('hidden');
  document.getElementById('editor-wrapper').classList.remove('hidden');
  setImportStatus(`${filename}: se abrió con ${pdfDoc.numPages} página(s). El PDF original se conserva como fondo; sus elementos internos no siempre son objetos editables.`);
  await renderPage(pageNum);
}

async function openEditableTextDocument(blocks, filename) {
  const width=1000, lineHeight=30, margin=48;
  const usable = blocks.slice(0,250);
  const estimatedHeight=Math.max(700, margin*2+usable.reduce((n,b)=>n+Math.max(lineHeight, (String(b.text||'').length>105?Math.ceil(String(b.text).length/105):1)*lineHeight),0));
  const height=Math.min(estimatedHeight,12000);
  const pdf=await PDFLib.PDFDocument.create(); pdf.addPage([width,height]);
  await loadPdfBytes(await pdf.save(),filename);
  isInternalChange=true;
  fabricCanvas.clear();
  let top=margin;
  usable.forEach((block)=>{
    const obj=new fabric.IText(String(block.text ?? ' '), {left:margin,top,width:width-margin*2,fontFamily:'Arial',fontSize:block.size||15,fill:'#202124',fontWeight:block.bold?'bold':'normal',lineHeight:1.2,editable:true,splitByGrapheme:false});
    fabricCanvas.add(obj);
    top += Math.max(lineHeight, Math.ceil(String(block.text||'').length/105)*lineHeight);
  });
  fabricCanvas.renderAll();
  pageAnnotations[1]=fabricCanvas.toJSON();
  historyStack[1]=[JSON.stringify(pageAnnotations[1])]; redoStack[1]=[];
  isInternalChange=false;
  setImportStatus(`${filename}: texto importado en objetos editables. Se conservaron los párrafos o filas extraíbles; el diseño avanzado del archivo original puede variar.`);
}

async function openMusicXml(xmlText, filename) {
  if (!window.opensheetmusicdisplay) throw new Error('No se pudo cargar el motor de partituras. Revisa tu conexión a Internet.');
  const holder=document.createElement('div');
  holder.style.cssText='position:fixed;left:-20000px;top:0;width:1400px;background:white;';
  document.body.appendChild(holder);
  try {
    const osmd=new opensheetmusicdisplay.OpenSheetMusicDisplay(holder,{autoResize:false,drawTitle:true,followCursor:false,backend:'svg',drawingParameters:'default'});
    await osmd.load(xmlText); osmd.zoom=1.25; osmd.render();
    const svg=holder.querySelector('svg');
    if (!svg) throw new Error('No se pudo dibujar la partitura.');
    const clone=svg.cloneNode(true); clone.setAttribute('xmlns','http://www.w3.org/2000/svg');
    const rect=svg.getBoundingClientRect(); const w=Math.max(1200,Math.ceil(rect.width||1400)); const h=Math.max(900,Math.ceil(rect.height||900));
    clone.setAttribute('width',w); clone.setAttribute('height',h);
    const url=URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)],{type:'image/svg+xml;charset=utf-8'}));
    try {
      const img=await loadImage(url); const canvas=document.createElement('canvas'); canvas.width=w; canvas.height=h;
      const ctx=canvas.getContext('2d'); ctx.fillStyle='#fff'; ctx.fillRect(0,0,w,h); ctx.drawImage(img,0,0,w,h);
      const pdf=await PDFLib.PDFDocument.create(); const page=pdf.addPage([w,h]); const png=await pdf.embedPng(await (await fetch(canvas.toDataURL('image/png'))).arrayBuffer()); page.drawImage(png,{x:0,y:0,width:w,height:h});
      await loadPdfBytes(await pdf.save(),filename);
      setImportStatus('Partitura MusicXML renderizada con un motor de notación para preservar pentagramas y símbolos. En esta versión se puede anotar encima, pero las notas individuales aún no se editan como objetos musicales.');
    } finally { URL.revokeObjectURL(url); }
  } finally { holder.remove(); }
}

function fileToDataURL(file) {
  return new Promise((resolve,reject)=>{const reader=new FileReader(); reader.onload=()=>resolve(reader.result); reader.onerror=reject; reader.readAsDataURL(file);});
}
function loadImage(src) {
  return new Promise((resolve,reject)=>{const img=new Image(); img.onload=()=>resolve(img); img.onerror=()=>reject(new Error('No se pudo leer la imagen.')); img.src=src;});
}
function setImportStatus(message) {
  let status=document.getElementById('editable-import-status');
  if (!status) { status=document.createElement('div'); status.id='editable-import-status'; status.setAttribute('role','status'); status.className='fixed bottom-3 left-3 z-40 max-w-xl rounded-lg bg-slate-900 text-white text-xs px-3 py-2 shadow-lg'; document.body.appendChild(status); }
  status.textContent=message;
}

function applyManualFont() {
  const field=document.getElementById('font-manual');
  const family=(field.value||'').trim();
  if (!family) return;
  let option=[...document.getElementById('font-family').options].find(o=>o.value.toLowerCase()===family.toLowerCase());
  const select=document.getElementById('font-family');
  if (!option) { option=document.createElement('option'); option.value=family; option.textContent=family+' (nombre introducido)'; select.appendChild(option); }
  select.value=family;
  const active=fabricCanvas.getActiveObject();
  if (active && active.type==='i-text') { active.set('fontFamily',family); active.dirty=true; fabricCanvas.requestRenderAll(); saveHistoryState(); }
  document.fonts.load(`16px "${family.replace(/"/g,'')}"`).then(()=>fabricCanvas.requestRenderAll()).catch(()=>{});
  setImportStatus(`Se seleccionó la familia “${family}”. La apariencia depende de que esa fuente esté instalada o cargada en este navegador; el editor no puede acceder a fuentes que no estén disponibles.`);
}

async function handleFontUpload(e) {
  const file=e.target.files && e.target.files[0]; if (!file) return;
  const ext=(file.name.split('.').pop()||'').toLowerCase();
  if (!['ttf','otf','woff','woff2'].includes(ext)) { alert('Elige un archivo de fuente .ttf, .otf, .woff o .woff2.'); e.target.value=''; return; }
  try {
    const family='Custom_'+file.name.replace(/\.[^.]+$/,'').replace(/[^a-zA-Z0-9_-]/g,'_');
    const url=URL.createObjectURL(file); const face=new FontFace(family,`url(${url})`); await face.load(); document.fonts.add(face);
    const select=document.getElementById('font-family');
    let group=select.querySelector('optgroup[data-custom-fonts="true"]');
    if (!group) { group=document.createElement('optgroup'); group.label='Fuentes cargadas por ti'; group.dataset.customFonts='true'; select.appendChild(group); }
    const option=document.createElement('option'); option.value=family; option.textContent=file.name; group.appendChild(option); select.value=family;
    const active=fabricCanvas.getActiveObject(); if (active && active.type==='i-text') { active.set('fontFamily',family); active.dirty=true; fabricCanvas.requestRenderAll(); saveHistoryState(); }
    setImportStatus(`Fuente ${file.name} cargada en esta sesión. Para que aparezca en otro equipo, debes volver a cargar el archivo de fuente.`);
  } catch(err) { alert('No se pudo cargar esa fuente. Puede estar dañada o el navegador no admitirla.'); }
  e.target.value='';
}

async function renderPage(num) {
  if (pageRendering) {
    pageNumPending = num;
    return;
  }

  pageRendering = true;

  try {
    const page = await pdfDoc.getPage(num);
    const rotation = (rotations[num] || 0);
    let viewport = page.getViewport({ scale: scale, rotation: rotation });

    if (viewport.width > 2500) {
      scale = 2500 / viewport.width;
      viewport = page.getViewport({ scale: scale, rotation: rotation });
    }

    pdfCanvas.height = viewport.height;
    pdfCanvas.width = viewport.width;

    const editorWrapper = document.getElementById('editor-wrapper');
    editorWrapper.style.width = `${viewport.width}px`;
    editorWrapper.style.height = `${viewport.height}px`;

    const renderContext = { canvasContext: pdfCtx, viewport: viewport };
    await page.render(renderContext).promise;

    pageRendering = false;

    if (pageNumPending !== null) {
      const pending = pageNumPending;
      pageNumPending = null;
      renderPage(pending);
    }
  } catch (err) {
    console.error("Error al renderizar página:", err);
    pageRendering = false;
  }

  fabricCanvas.setWidth(pdfCanvas.width);
  fabricCanvas.setHeight(pdfCanvas.height);

  loadCurrentPageAnnotations();

  document.getElementById('zoom-value').textContent = `${Math.round(scale * 100)}%`;
  document.getElementById('page-num').value = num;
  updateHistoryButtonsUI();
}

function queueRenderPage(num) {
  if (pageRendering) {
    pageNumPending = num;
  } else {
    renderPage(num);
  }
}

function onPrevPage() {
  if (pageNum <= 1) return;
  saveCurrentPageAnnotations();
  pageNum--;
  queueRenderPage(pageNum);
}

function onNextPage() {
  if (pageNum >= pdfDoc.numPages) return;
  saveCurrentPageAnnotations();
  pageNum++;
  queueRenderPage(pageNum);
}

function saveCurrentPageAnnotations() {
  if (!fabricCanvas) return;
  const json = fabricCanvas.toJSON();
  pageAnnotations[pageNum] = json;
}

function loadCurrentPageAnnotations() {
  isInternalChange = true;
  fabricCanvas.clear();
  
  if (pageAnnotations[pageNum]) {
    fabricCanvas.loadFromJSON(pageAnnotations[pageNum], () => {
      fabricCanvas.renderAll();
      isInternalChange = false;
      setTool(currentTool);
      updateHistoryButtonsUI();
    });
  } else {
    isInternalChange = false;
    setTool(currentTool);
    saveHistoryState();
  }
}

function setTool(tool) {
  currentTool = tool;
  fabricCanvas.isDrawingMode = false;

  if (tool === 'draw') {
    fabricCanvas.isDrawingMode = true;
    updateBrushProperties();
  } else if (tool === 'highlight') {
    fabricCanvas.isDrawingMode = true;
    fabricCanvas.freeDrawingBrush.color = 'rgba(250, 204, 21, 0.45)';
    fabricCanvas.freeDrawingBrush.width = 25;
  }
}

function updateBrushProperties() {
  if (currentTool === 'draw') {
    const color = document.getElementById('draw-color').value;
    const width = parseInt(document.getElementById('draw-width').value);
    fabricCanvas.freeDrawingBrush.color = color;
    fabricCanvas.freeDrawingBrush.width = width;
  }
}

function addText() {
  setTool('select');
  const font = document.getElementById('font-family').value;
  const size = parseInt(document.getElementById('font-size').value);
  const color = document.getElementById('text-color').value;

  const text = new fabric.IText('Escribe tu texto aquí...', {
    left: fabricCanvas.width / 4,
    top: fabricCanvas.height / 4,
    fontFamily: font,
    fontSize: size,
    fill: color,
  });

  fabricCanvas.add(text);
  fabricCanvas.setActiveObject(text);
  saveHistoryState();
}

function addStickyNote() {
  setTool('select');
  const rect = new fabric.Rect({
    width: 160, height: 110, fill: '#fef08a', stroke: '#facc15', strokeWidth: 1, rx: 6, ry: 6
  });
  const text = new fabric.IText('Nota de revisión...', {
    fontSize: 14, fontFamily: 'Inter', fill: '#713f12', left: 12, top: 12, width: 135
  });
  const group = new fabric.Group([rect, text], {
    left: fabricCanvas.width / 3, top: fabricCanvas.height / 3
  });
  fabricCanvas.add(group);
  fabricCanvas.setActiveObject(group);
  saveHistoryState();
}

function syncTextControls() {
  const activeObj = fabricCanvas.getActiveObject();
  if (activeObj && activeObj.type === 'i-text') {
    document.getElementById('font-family').value = activeObj.fontFamily || 'Inter';
    document.getElementById('font-size').value = activeObj.fontSize || 16;
    document.getElementById('text-color').value = activeObj.fill || '#000000';
  }
}

function updateTextProperty() {
  const activeObj = fabricCanvas.getActiveObject();
  if (activeObj && activeObj.type === 'i-text') {
    activeObj.set({
      fontFamily: document.getElementById('font-family').value,
      fontSize: parseInt(document.getElementById('font-size').value),
      fill: document.getElementById('text-color').value,
    });
    fabricCanvas.renderAll();
    saveHistoryState();
  }
}

function toggleBold() {
  const activeObj = fabricCanvas.getActiveObject();
  if (activeObj && activeObj.type === 'i-text') {
    activeObj.set('fontWeight', activeObj.fontWeight === 'bold' ? 'normal' : 'bold');
    fabricCanvas.renderAll();
    saveHistoryState();
  }
}

function toggleItalic() {
  const activeObj = fabricCanvas.getActiveObject();
  if (activeObj && activeObj.type === 'i-text') {
    activeObj.set('fontStyle', activeObj.fontStyle === 'italic' ? 'normal' : 'italic');
    fabricCanvas.renderAll();
    saveHistoryState();
  }
}

function toggleUnderline() {
  const activeObj = fabricCanvas.getActiveObject();
  if (activeObj && activeObj.type === 'i-text') {
    activeObj.set('underline', !activeObj.underline);
    fabricCanvas.renderAll();
    saveHistoryState();
  }
}

function addWhiteout() {
  setTool('select');
  const rect = new fabric.Rect({
    left: fabricCanvas.width / 3,
    top: fabricCanvas.height / 3,
    width: 180,
    height: 35,
    fill: '#ffffff',
    stroke: '#e2e8f0',
    strokeWidth: 1,
  });
  fabricCanvas.add(rect);
  fabricCanvas.setActiveObject(rect);
  saveHistoryState();
}

function addShape(shapeType) {
  setTool('select');
  let shape;

  if (shapeType === 'rect') {
    shape = new fabric.Rect({ left: 100, top: 100, width: 140, height: 80, fill: 'transparent', stroke: '#2563eb', strokeWidth: 2.5 });
  } else if (shapeType === 'circle') {
    shape = new fabric.Circle({ left: 100, top: 100, radius: 50, fill: 'transparent', stroke: '#2563eb', strokeWidth: 2.5 });
  } else if (shapeType === 'line') {
    shape = new fabric.Line([50, 100, 220, 100], { stroke: '#2563eb', strokeWidth: 3 });
  } else if (shapeType === 'arrow') {
    const line = new fabric.Line([0, 10, 110, 10], { stroke: '#2563eb', strokeWidth: 3 });
    const triangle = new fabric.Triangle({ left: 110, top: 0, pointX: 10, pointY: 10, width: 16, height: 22, fill: '#2563eb', angle: 90 });
    shape = new fabric.Group([line, triangle], { left: 100, top: 100 });
  }

  if (shape) {
    fabricCanvas.add(shape);
    fabricCanvas.setActiveObject(shape);
    saveHistoryState();
  }
}

function bringForward() {
  const activeObj = fabricCanvas.getActiveObject();
  if (activeObj) {
    fabricCanvas.bringForward(activeObj);
    saveHistoryState();
  }
}

function sendBackward() {
  const activeObj = fabricCanvas.getActiveObject();
  if (activeObj) {
    fabricCanvas.sendBackwards(activeObj);
    saveHistoryState();
  }
}

function handleImageUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function (f) {
    const data = f.target.result;
    fabric.Image.fromURL(data, function (img) {
      img.scaleToWidth(180);
      img.set({ left: 100, top: 100 });
      fabricCanvas.add(img);
      fabricCanvas.setActiveObject(img);
      saveHistoryState();
    });
  };
  reader.readAsDataURL(file);
}

// FIRMA A MANO ALZADA
let sigCanvas = null;
function openSignatureModal() {
  document.getElementById('signature-modal').classList.remove('hidden');
  if (!sigCanvas) {
    sigCanvas = new fabric.Canvas('signature-pad-canvas', {
      isDrawingMode: true,
      freeDrawingBrush: new fabric.PencilBrush(),
    });
    sigCanvas.freeDrawingBrush.color = document.getElementById('sig-color').value;
    sigCanvas.freeDrawingBrush.width = 3;

    document.getElementById('sig-color').addEventListener('input', (e) => {
      if (sigCanvas) sigCanvas.freeDrawingBrush.color = e.target.value;
    });
  } else {
    sigCanvas.clear();
  }
}

function closeSignatureModal() {
  document.getElementById('signature-modal').classList.add('hidden');
}

function clearSignaturePad() {
  if (sigCanvas) sigCanvas.clear();
}

function insertSignatureToPDF() {
  if (!sigCanvas) return;
  const dataUrl = sigCanvas.toDataURL({ format: 'png', multiplier: 2 });
  
  fabric.Image.fromURL(dataUrl, function (img) {
    img.scaleToWidth(200);
    img.set({ left: fabricCanvas.width / 3, top: fabricCanvas.height / 3 });
    fabricCanvas.add(img);
    fabricCanvas.setActiveObject(img);
    saveHistoryState();
  });

  closeSignatureModal();
}

// SELLOS PREDISEÑADOS
function addStamp(textValue, textColor, bgColor) {
  setTool('select');
  const rect = new fabric.Rect({
    width: 140, height: 45, fill: bgColor, stroke: textColor, strokeWidth: 2, rx: 6, ry: 6
  });
  const text = new fabric.IText(textValue, {
    fontSize: 14, fontFamily: 'Inter', fontWeight: 'bold', fill: textColor, left: 15, top: 12
  });
  const group = new fabric.Group([rect, text], {
    left: fabricCanvas.width / 3, top: fabricCanvas.height / 3, angle: -10
  });
  fabricCanvas.add(group);
  fabricCanvas.setActiveObject(group);
  saveHistoryState();
}

function deleteSelectedObject() {
  const activeObjects = fabricCanvas.getActiveObjects();
  if (activeObjects && activeObjects.length > 0) {
    activeObjects.forEach((obj) => fabricCanvas.remove(obj));
    fabricCanvas.discardActiveObject();
    fabricCanvas.requestRenderAll();
    saveHistoryState();
  }
}

function rotatePage(deg) {
  rotations[pageNum] = ((rotations[pageNum] || 0) + deg) % 360;
  renderPage(pageNum);
}

async function deleteCurrentPage() {
  if (!pdfDoc || pdfDoc.numPages <= 1) {
    alert("No es posible eliminar la última página restante del documento.");
    return;
  }

  saveCurrentPageAnnotations();

  const pdfDocLib = await PDFLib.PDFDocument.load(originalPdfBytes);
  pdfDocLib.removePage(pageNum - 1);
  originalPdfBytes = await pdfDocLib.save();

  const loadingTask = pdfjsLib.getDocument({ data: originalPdfBytes });
  pdfDoc = await loadingTask.promise;

  delete pageAnnotations[pageNum];
  if (pageNum > pdfDoc.numPages) pageNum = pdfDoc.numPages;

  document.getElementById('page-count').textContent = pdfDoc.numPages;
  renderPage(pageNum);
}

async function exportFile(type) {
  if (!originalPdfBytes) return;
  saveCurrentPageAnnotations();

  if (type === 'pdf') {
    const pdfDocLib = await PDFLib.PDFDocument.load(originalPdfBytes);
    const pages = pdfDocLib.getPages();

    for (let i = 1; i <= pdfDoc.numPages; i++) {
      const pdfPage = pages[i - 1];
      if (rotations[i]) {
        const currentRotation = pdfPage.getRotation().angle;
        pdfPage.setRotation(PDFLib.degrees(currentRotation + rotations[i]));
      }

      if (pageAnnotations[i] && pageAnnotations[i].objects && pageAnnotations[i].objects.length > 0) {
        const tempCanvasElem = document.createElement('canvas');
        const pageViewport = (await pdfDoc.getPage(i)).getViewport({ scale: 1.0, rotation: 0 });
        
        tempCanvasElem.width = pageViewport.width;
        tempCanvasElem.height = pageViewport.height;

        const tempFabric = new fabric.Canvas(tempCanvasElem);

        await new Promise((resolve) => {
          tempFabric.loadFromJSON(pageAnnotations[i], () => {
            const objects = tempFabric.getObjects();
            const currentScale = scale;
            objects.forEach((obj) => {
              obj.scaleX /= currentScale;
              obj.scaleY /= currentScale;
              obj.left /= currentScale;
              obj.top /= currentScale;
              obj.setCoordinates();
            });
            tempFabric.renderAll();
            resolve();
          });
        });

        const dataUrl = tempCanvasElem.toDataURL({ format: 'png', multiplier: 2 });
        const pngImage = await pdfDocLib.embedPng(dataUrl);
        const { width, height } = pdfPage.getSize();
        pdfPage.drawImage(pngImage, { x: 0, y: 0, width: width, height: height });
        tempFabric.dispose();
      }
    }

    const pdfBytes = await pdfDocLib.save();
    downloadBlob(new Blob([pdfBytes], { type: 'application/pdf' }), 'documento_licenciado_pro.pdf');

  } else if (type === 'png') {
    const dataUrl = fabricCanvas.toDataURL({ format: 'png', multiplier: 2 });
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = `pagina_${pageNum}_render.png`;
    link.click();

  } else if (type === 'txt') {
    let allText = '';
    Object.keys(pageAnnotations).forEach(p => {
      if (pageAnnotations[p] && pageAnnotations[p].objects) {
        pageAnnotations[p].objects.forEach(obj => {
          if (obj.type === 'i-text' && obj.text) {
            allText += `[Pág ${p}] ${obj.text}\n`;
          }
        });
      }
    });

    const blob = new Blob([allText || 'No se han agregado textos editables en este documento.'], { type: 'text/plain;charset=utf-8' });
    downloadBlob(blob, 'textos_extraidos_editor.txt');
  }
}

function downloadBlob(blob, filename) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}
