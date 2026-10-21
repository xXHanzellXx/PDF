pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';

let pdfDoc = null;
let originalPdfBytes = null;
let pageNum = 1;
let pageRendering = false;
let pageNumPending = null;
let scale = 1.0; 
let rotations = {}; 
let pageAnnotations = {};
let annotationSizes = {};
let copiedObject = null;
let documentMode = 'background'; // 'reconstructed' = solo objetos extraídos, sin la página original debajo
let currentFilename = 'documento.pdf';

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
    preserveObjectStacking: true,
    selection: true,
    stopContextMenu: true,
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
  const fontUpload = document.getElementById('font-upload');
  if (fontUpload) fontUpload.addEventListener('change', handleFontUpload);
  const fontManualApply = document.getElementById('font-manual-apply');
  if (fontManualApply) fontManualApply.addEventListener('click', applyManualFont);
  
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
    if (scale < 3) { saveCurrentPageAnnotations(); scale = Math.min(3, +(scale + 0.25).toFixed(2)); renderPage(pageNum); }
  });
  document.getElementById('btn-zoom-out').addEventListener('click', () => {
    if (scale > 0.5) { saveCurrentPageAnnotations(); scale = Math.max(0.5, +(scale - 0.25).toFixed(2)); renderPage(pageNum); }
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
  document.querySelectorAll('[data-shape]').forEach(button => button.addEventListener('click', () => addShape(button.dataset.shape)));
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
  document.getElementById('draw-width').addEventListener('input', () => { updateBrushProperties(); if (sigCanvas) sigCanvas.freeDrawingBrush.width = parseInt(document.getElementById('draw-width').value, 10) || 3; });
  document.getElementById('sig-color').addEventListener('input', (e) => { if (sigCanvas) sigCanvas.freeDrawingBrush.color = e.target.value; });

  document.getElementById('btn-bring-forward').addEventListener('click', bringForward);
  document.getElementById('btn-send-backward').addEventListener('click', sendBackward);

  document.getElementById('btn-rotate-left').addEventListener('click', () => rotatePage(-90));
  document.getElementById('btn-rotate-right').addEventListener('click', () => rotatePage(90));
  document.getElementById('btn-delete-page').addEventListener('click', deleteCurrentPage);

  const guideModal = document.getElementById('guide-modal');
  const closeGuide = () => guideModal.classList.add('hidden');
  document.getElementById('btn-guide').addEventListener('click', () => guideModal.classList.remove('hidden'));
  document.getElementById('close-guide').addEventListener('click', closeGuide);
  document.getElementById('btn-understood').addEventListener('click', closeGuide);
  guideModal.addEventListener('click', (e) => { if (e.target === guideModal) closeGuide(); });
  document.getElementById('signature-modal').addEventListener('click', (e) => { if (e.target.id === 'signature-modal') closeSignatureModal(); });
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
      if (activeObj) { e.preventDefault(); deleteSelectedObject(); }
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
      await loadPdfBytes(new Uint8Array(bytes), file.name, { reconstructText: false });
      return;
    }
    if (['png','jpg','jpeg','webp','gif','bmp','tif','tiff'].includes(ext) || file.type.startsWith('image/')) {
      const dataUrl = await fileToDataURL(file);
      const img = await loadImage(dataUrl);
      await openImageAsObject(dataUrl, file.name, img.naturalWidth || img.width, img.naturalHeight || img.height);
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
      const normalized = text.replace(/\r/g,'').replace(/[ \t]+\n/g,'\n');
      const paragraphs = normalized.split(/\n\s*\n/).map(p=>p.split('\n').join(' ').replace(/\s+/g,' ').trim()).filter(Boolean);
      const blocks = (paragraphs.length ? paragraphs : [normalized.trim()]).map(paragraph=>({text:paragraph || ' ',size:15}));
      await openEditableTextDocument(blocks, file.name);
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
        await openImageAsObject(c.toDataURL('image/png'),file.name,c.width,c.height);
        setImportStatus(`${file.name}: se insertó como imagen seleccionable. Puedes moverla y cambiar su tamaño; los trazos internos no se separan automáticamente.`);
      } finally { URL.revokeObjectURL(url); }
      return;
    }
    throw new Error(`El formato .${ext || '(desconocido)'} todavía no tiene un importador compatible. Convierte el archivo a PDF, DOCX, XLSX, CSV, TXT o MusicXML para abrirlo aquí.`);
  } catch (err) {
    console.error('Error al importar archivo:', err);
    alert(`No se pudo importar “${file.name}”.\n\n${err.message || 'Archivo no compatible o dañado.'}`);
  } finally { e.target.value = ''; }
}

async function loadPdfBytes(bytes, filename='documento.pdf', options={}) {
  originalPdfBytes = bytes;
  currentFilename = filename;
  documentMode = options.reconstructText ? 'reconstructed' : 'background';
  const loadingTask = pdfjsLib.getDocument({ data: bytes });
  pdfDoc = await loadingTask.promise;
  pageNum = 1; rotations = {}; pageAnnotations = {}; annotationSizes = {}; historyStack = {}; redoStack = {};
  document.getElementById('page-count').textContent = pdfDoc.numPages;
  document.getElementById('btn-export-menu').disabled = false;
  document.getElementById('empty-state').classList.add('hidden');
  document.getElementById('editor-wrapper').classList.remove('hidden');
  if (documentMode === 'reconstructed') {
    setImportStatus(`${filename}: modo de reconstrucción editable activado. Se extraerá el texto en objetos independientes y no se mostrará el PDF original como fondo. Las imágenes, gráficos y trazos originales que no sean texto requieren extracción especializada.`);
  } else {
    setImportStatus(`${filename}: se abrió en modo visual original. El fondo se conserva porque este formato se convirtió en una página visual; los objetos añadidos sí se pueden seleccionar y editar.`);
  }
  await renderPage(pageNum);
}

// Reconstruye texto PDF como cajas Fabric editables. Agrupa palabras en líneas y líneas cercanas
// en párrafos para que no se convierta cada palabra o renglón en un objeto separado.
async function extractPdfTextObjects(pageNumber, viewport, targetCanvas=fabricCanvas) {
  const page = await pdfDoc.getPage(pageNumber);
  const content = await page.getTextContent({ includeMarkedContent: false });
  const raw = [];
  for (const item of (content.items || [])) {
    if (!item.str || !item.str.trim() || !item.transform) continue;
    const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
    const fontSize = Math.max(5, Math.hypot(tx[2], tx[3]) || Math.abs(item.height * viewport.scale) || 12);
    const x = tx[4];
    const baseline = tx[5];
    const top = baseline - fontSize * 0.88;
    raw.push({ text: item.str, x, top, baseline, width: Math.max(0, (item.width || 0) * viewport.scale), size: fontSize, font: item.fontName || 'Arial' });
  }
  raw.sort((a,b) => Math.abs(a.baseline-b.baseline) < 2 ? a.x-b.x : a.baseline-b.baseline);
  const lines = [];
  for (const item of raw) {
    let line = lines.find(l => Math.abs(l.baseline-item.baseline) <= Math.max(2.5, Math.min(l.size,item.size)*0.32));
    if (!line) { line={items:[],baseline:item.baseline,top:item.top,size:item.size}; lines.push(line); }
    line.items.push(item);
    line.baseline = line.items.reduce((n,v)=>n+v.baseline,0)/line.items.length;
    line.top = Math.min(line.top,item.top);
    line.size = line.items.reduce((n,v)=>n+v.size,0)/line.items.length;
  }
  lines.sort((a,b)=>a.top-b.top);
  for (const line of lines) {
    line.items.sort((a,b)=>a.x-b.x);
    let text=''; let prev=null;
    for (const item of line.items) {
      if (prev) {
        const gap=item.x-(prev.x+prev.width);
        if (gap > Math.max(1.8, item.size*0.18) && !/\s$/.test(text) && !/^\s/.test(item.text)) text+=' ';
      }
      text+=item.text;
      prev=item;
    }
    line.text=text.trim();
    line.left=Math.min(...line.items.map(i=>i.x));
    line.right=Math.max(...line.items.map(i=>i.x+i.width));
    line.size=Math.max(6,line.size);
    line.font=line.items[0]?.font || 'Arial';
  }
  const paragraphs=[];
  for (const line of lines.filter(l=>l.text)) {
    const prev=paragraphs[paragraphs.length-1];
    const gap=prev ? line.top-(prev.top+prev.height) : Infinity;
    const indent=prev ? Math.abs(line.left-prev.left) : Infinity;
    if (prev && gap <= Math.max(line.size*0.95, prev.size*0.95) && indent <= Math.max(line.size*3, 28)) {
      prev.lines.push(line);
      prev.height=Math.max(prev.height, line.top+line.size-prev.top);
      prev.right=Math.max(prev.right,line.right);
      prev.size=(prev.size*(prev.lines.length-1)+line.size)/prev.lines.length;
    } else {
      paragraphs.push({lines:[line],left:line.left,top:line.top,right:line.right,height:line.size*1.2,size:line.size,font:line.font});
    }
  }
  // OCR para PDF escaneado sin texto embebido. No conserva fotos ni gráficos, pero recupera texto aproximado.
  if (!paragraphs.length && window.Tesseract) {
    try {
      const scaleForOcr=1.6;
      const ocrViewport=page.getViewport({scale:scaleForOcr,rotation:rotations[pageNumber]||0});
      const off=document.createElement('canvas'); off.width=Math.ceil(ocrViewport.width); off.height=Math.ceil(ocrViewport.height);
      await page.render({canvasContext:off.getContext('2d'),viewport:ocrViewport}).promise;
      const result=await Tesseract.recognize(off,'spa+eng');
      const factor=viewport.width/off.width;
      for (const line of (result.data.lines||[])) {
        const text=(line.text||'').trim(); if(!text) continue;
        const left=line.bbox.x0*factor, top=line.bbox.y0*factor;
        const fs=Math.max(8,(line.bbox.y1-line.bbox.y0)*factor);
        const prev=paragraphs[paragraphs.length-1];
        if(prev && top-(prev.top+prev.height) < fs*0.85 && Math.abs(left-prev.left) < fs*3) {
          prev.lines.push({text}); prev.height=top+fs-prev.top; prev.right=Math.max(prev.right,line.bbox.x1*factor);
        } else paragraphs.push({lines:[{text}],left,top,right:line.bbox.x1*factor,height:fs*1.2,size:fs,font:'Arial',ocrWord:false});
      }
    } catch (e) { console.warn('OCR no disponible o falló:',e); }
  }
  let count=0;
  for (const para of paragraphs) {
    const text=para.ocrWord ? para.lines[0].text : para.lines.map(l=>l.text).join(' ');
    if (!text.trim()) continue;
    const left=Math.max(0,para.left);
    const top=Math.max(0,para.top);
    const naturalWidth=Math.max(para.size*4,para.right-para.left);
    const width=Math.max(40,Math.min(viewport.width-left-8, Math.max(naturalWidth, viewport.width-left-48)));
    const obj=new fabric.Textbox(text,{left,top,width,fontFamily:'Arial',fontSize:Math.max(6,para.size),fill:'#111827',lineHeight:1.16,splitByGrapheme:false,editable:true,objectCaching:false,originX:'left',originY:'top',padding:0,transparentCorners:false,cornerColor:'#4f46e5',borderColor:'#4f46e5'});
    obj.set({ data:{ source:'pdf-text', page:pageNumber, reconstructed:true } });
    targetCanvas.add(obj); count++;
  }
  return count;
}


async function openImageAsObject(dataUrl, filename, width, height) {
  const pdf=await PDFLib.PDFDocument.create();
  pdf.addPage([Math.max(1,width),Math.max(1,height)]);
  await loadPdfBytes(await pdf.save(),filename);
  const img=await new Promise((resolve,reject)=>fabric.Image.fromURL(dataUrl,resolve,{crossOrigin:'anonymous'}));
  img.set({left:0,top:0,selectable:true,evented:true,objectCaching:false,hasControls:true,hasBorders:true});
  img.scaleToWidth(Math.min(width,fabricCanvas.getWidth()));
  if (img.getScaledHeight()>fabricCanvas.getHeight()) img.scaleToHeight(fabricCanvas.getHeight());
  fabricCanvas.add(img); fabricCanvas.setActiveObject(img); fabricCanvas.requestRenderAll();
  saveCurrentPageAnnotations(); saveHistoryState();
  setImportStatus(`${filename}: la imagen original está como objeto seleccionable y movible, no como fondo fijo. Su contenido interno sigue siendo una imagen plana.`);
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
    const obj=new fabric.Textbox(String(block.text ?? ' '), {left:margin,top,width:width-margin*2,fontFamily:'Arial',fontSize:block.size||15,fill:'#202124',fontWeight:block.bold?'bold':'normal',lineHeight:1.2,editable:true,splitByGrapheme:false,breakWords:false});
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
      await openImageAsObject(canvas.toDataURL('image/png'),filename,w,h);
      setImportStatus('Partitura MusicXML renderizada con un motor de notación y colocada como imagen seleccionable (no como fondo). Puedes moverla y escalarla, pero la edición individual de notas requiere un editor musical como MuseScore.');
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
  let status = document.getElementById('editable-import-status');

  if (!status) {
    status = document.createElement('div');
    status.id = 'editable-import-status';
    status.setAttribute('role', 'status');
    document.body.appendChild(status);
  }

  status.className =
    'fixed bottom-3 left-3 z-40 max-w-md rounded-lg bg-slate-900 text-white text-xs px-3 py-2 shadow-lg pointer-events-none';

  status.textContent = message;
  status.classList.remove('hidden');

  clearTimeout(status._hideTimer);
  status._hideTimer = setTimeout(() => {
    status.classList.add('hidden');
  }, 4500);
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
  if (pageRendering) { pageNumPending = num; return; }
  pageRendering = true;
  let viewport;
  try {
    const page = await pdfDoc.getPage(num);
    const rotation = (rotations[num] || 0);
    viewport = page.getViewport({ scale, rotation });
    if (viewport.width > 2500) { scale = 2500 / viewport.width; viewport = page.getViewport({ scale, rotation }); }
    pdfCanvas.height = Math.ceil(viewport.height); pdfCanvas.width = Math.ceil(viewport.width);
    const editorWrapper = document.getElementById('editor-wrapper');
    editorWrapper.style.width = `${pdfCanvas.width}px`; editorWrapper.style.height = `${pdfCanvas.height}px`;
    if (documentMode === 'reconstructed') {
      // La página original NO se pinta detrás: solo fondo blanco y objetos reconstruidos.
      pdfCtx.save(); pdfCtx.setTransform(1,0,0,1,0,0); pdfCtx.fillStyle='#ffffff'; pdfCtx.fillRect(0,0,pdfCanvas.width,pdfCanvas.height); pdfCtx.restore();
    } else {
      await page.render({ canvasContext: pdfCtx, viewport }).promise;
    }
  } catch (err) {
    console.error('Error al renderizar página:',err); pageRendering=false; return;
  }
  pageRendering = false;
  fabricCanvas.setWidth(pdfCanvas.width); fabricCanvas.setHeight(pdfCanvas.height);
  if (documentMode === 'reconstructed' && !pageAnnotations[num]) {
    isInternalChange=true; fabricCanvas.clear();
    const count=await extractPdfTextObjects(num,viewport,fabricCanvas);
    fabricCanvas.requestRenderAll(); isInternalChange=false;
    annotationSizes[num]={width:fabricCanvas.getWidth(),height:fabricCanvas.getHeight()};
    saveCurrentPageAnnotations(); saveHistoryState();
    if (!count) setImportStatus(`Página ${num}: no se detectó texto editable. Si es un escaneo, asegúrate de tener conexión para cargar el motor OCR; los gráficos e imágenes no se reconstruyen como objetos con esta importación.`);
  } else {
    loadCurrentPageAnnotations();
  }
  document.getElementById('zoom-value').textContent = `${Math.round(scale * 100)}%`;
  document.getElementById('page-num').value = num;
  updateHistoryButtonsUI();
  if (pageNumPending !== null) { const pending=pageNumPending; pageNumPending=null; renderPage(pending); }
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
  pageAnnotations[pageNum] = fabricCanvas.toJSON();
  annotationSizes[pageNum] = { width: fabricCanvas.getWidth(), height: fabricCanvas.getHeight() };
}

function scaleSerializedCanvas(json, ratioX, ratioY) {
  const copy = JSON.parse(JSON.stringify(json));
  const scaleObject = (obj) => {
    if (Number.isFinite(obj.left)) obj.left *= ratioX;
    if (Number.isFinite(obj.top)) obj.top *= ratioY;
    if (Number.isFinite(obj.scaleX)) obj.scaleX *= ratioX;
    if (Number.isFinite(obj.scaleY)) obj.scaleY *= ratioY;
    if (obj.clipPath) scaleObject(obj.clipPath);
    if (Array.isArray(obj.objects)) obj.objects.forEach(scaleObject);
  };
  (copy.objects || []).forEach(scaleObject);
  return copy;
}

function loadCurrentPageAnnotations() {
  isInternalChange = true;
  fabricCanvas.clear();
  const stored = pageAnnotations[pageNum];
  if (stored) {
    const oldSize = annotationSizes[pageNum];
    const newSize = { width: fabricCanvas.getWidth(), height: fabricCanvas.getHeight() };
    let jsonToLoad = stored;
    if (oldSize && oldSize.width > 0 && oldSize.height > 0 &&
        (oldSize.width !== newSize.width || oldSize.height !== newSize.height)) {
      jsonToLoad = scaleSerializedCanvas(stored, newSize.width / oldSize.width, newSize.height / oldSize.height);
      pageAnnotations[pageNum] = jsonToLoad;
    }
    annotationSizes[pageNum] = newSize;
    fabricCanvas.loadFromJSON(jsonToLoad, () => {
      fabricCanvas.renderAll();
      isInternalChange = false;
      setTool(currentTool);
      saveHistoryState();
      updateHistoryButtonsUI();
    });
  } else {
    annotationSizes[pageNum] = { width: fabricCanvas.getWidth(), height: fabricCanvas.getHeight() };
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
    updateBrushProperties();
  }
}

function hexToRgba(hex, alpha) {
  const value = String(hex || '#ffff00').replace('#', '');
  const full = value.length === 3 ? value.split('').map(ch => ch + ch).join('') : value;
  const number = parseInt(full, 16);
  if (!Number.isFinite(number)) return `rgba(255, 230, 0, ${alpha})`;
  return `rgba(${(number >> 16) & 255}, ${(number >> 8) & 255}, ${number & 255}, ${alpha})`;
}

function updateBrushProperties() {
  if (!fabricCanvas || !fabricCanvas.freeDrawingBrush) return;
  const color = document.getElementById('draw-color').value;
  const width = parseInt(document.getElementById('draw-width').value, 10) || 4;
  fabricCanvas.freeDrawingBrush.color = currentTool === 'highlight' ? hexToRgba(color, 0.32) : color;
  fabricCanvas.freeDrawingBrush.width = currentTool === 'highlight' ? Math.max(10, width * 4) : width;
  fabricCanvas.freeDrawingBrush.strokeLineCap = 'round';
  fabricCanvas.freeDrawingBrush.strokeLineJoin = 'round';
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
  if (activeObj && (activeObj.type === 'i-text' || activeObj.type === 'textbox')) {
    const style = {
      fontFamily: document.getElementById('font-family').value,
      fontSize: parseInt(document.getElementById('font-size').value, 10) || 16,
      fill: document.getElementById('text-color').value,
    };
    if (activeObj.isEditing && activeObj.selectionStart !== activeObj.selectionEnd) activeObj.setSelectionStyles(style);
    else activeObj.set(style);
    activeObj.dirty = true;
    fabricCanvas.requestRenderAll();
    saveHistoryState();
  }
}

function toggleTextStyle(property, onValue, offValue) {
  const obj = fabricCanvas.getActiveObject();
  if (!obj || !['i-text', 'textbox'].includes(obj.type)) return;
  const current = obj[property];
  const value = current === onValue ? offValue : onValue;
  if (obj.isEditing && obj.selectionStart !== obj.selectionEnd) obj.setSelectionStyles({ [property]: value });
  else obj.set(property, value);
  obj.dirty = true;
  fabricCanvas.requestRenderAll();
  saveHistoryState();
}
function toggleBold() { toggleTextStyle('fontWeight', 'bold', 'normal'); }
function toggleItalic() { toggleTextStyle('fontStyle', 'italic', 'normal'); }
function toggleUnderline() { toggleTextStyle('underline', true, false); }

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
    shape = new fabric.Rect({ left: fabricCanvas.getWidth()/3, top: fabricCanvas.getHeight()/3, width: 140, height: 80, fill: 'transparent', stroke: '#2563eb', strokeWidth: 2.5 });
  } else if (shapeType === 'circle') {
    shape = new fabric.Circle({ left: fabricCanvas.getWidth()/3, top: fabricCanvas.getHeight()/3, radius: 50, fill: 'transparent', stroke: '#2563eb', strokeWidth: 2.5 });
  } else if (shapeType === 'line') {
    shape = new fabric.Line([fabricCanvas.getWidth()/3, fabricCanvas.getHeight()/3, fabricCanvas.getWidth()/3+170, fabricCanvas.getHeight()/3], { stroke: '#2563eb', strokeWidth: 3 });
  } else if (shapeType === 'arrow') {
    const line = new fabric.Line([0, 20, 120, 20], { left: 0, top: 0, stroke: '#2563eb', strokeWidth: 3, originX: 'left', originY: 'top' });
    const head = new fabric.Triangle({ left: 112, top: 10, width: 20, height: 20, fill: '#2563eb', angle: 90, originX: 'center', originY: 'center' });
    shape = new fabric.Group([line, head], { left: fabricCanvas.getWidth()/3, top: fabricCanvas.getHeight()/3, objectCaching: false });
  } else if (shapeType === 'triangle') {
    shape = new fabric.Triangle({ left: 100, top: 100, width: 110, height: 90, fill: 'rgba(37,99,235,0.08)', stroke: '#2563eb', strokeWidth: 2.5 });
  } else if (shapeType === 'ellipse') {
    shape = new fabric.Ellipse({ left: 100, top: 100, rx: 75, ry: 42, fill: 'transparent', stroke: '#2563eb', strokeWidth: 2.5 });
  } else if (shapeType === 'star') {
    shape = new fabric.Polygon(Array.from({length:10}, (_,i) => { const r=i%2?28:58; const a=-Math.PI/2+i*Math.PI/5; return {x:60+Math.cos(a)*r,y:60+Math.sin(a)*r}; }), { left: 100, top: 100, fill: 'rgba(37,99,235,0.08)', stroke: '#2563eb', strokeWidth: 2.5 });
  } else if (shapeType === 'diamond') {
    shape = new fabric.Polygon([{x:55,y:0},{x:110,y:50},{x:55,y:100},{x:0,y:50}], { left: 100, top: 100, fill: 'transparent', stroke: '#2563eb', strokeWidth: 2.5 });
  } else if (shapeType === 'pentagon') {
    shape = new fabric.Polygon(Array.from({length:5}, (_,i) => { const a=-Math.PI/2+i*2*Math.PI/5; return {x:55+Math.cos(a)*55,y:55+Math.sin(a)*55}; }), { left: 100, top: 100, fill: 'transparent', stroke: '#2563eb', strokeWidth: 2.5 });
  } else if (shapeType === 'cloud') {
    shape = new fabric.Path('M 25 65 C 0 65 0 35 25 35 C 25 5 65 0 80 25 C 110 10 135 35 120 60 C 140 80 110 100 90 85 L 35 85 C 10 90 0 70 25 65 Z', { left: 100, top: 100, fill: 'rgba(37,99,235,0.08)', stroke: '#2563eb', strokeWidth: 2.5 });
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
      img.set({ left: 100, top: 100, selectable: true, evented: true, objectCaching: false });
      img.setCoords();
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
  const modal = document.getElementById('signature-modal');
  modal.classList.remove('hidden');
  const canvasEl = document.getElementById('signature-pad-canvas');
  const wrapper = canvasEl.parentElement;
  const width = Math.max(280, Math.floor(wrapper.clientWidth || 380));
  const height = 160;
  if (!sigCanvas) {
    sigCanvas = new fabric.Canvas(canvasEl, { isDrawingMode: true, selection: false, backgroundColor: 'rgba(255,255,255,0)', enableRetinaScaling: true });
    sigCanvas.freeDrawingBrush = new fabric.PencilBrush(sigCanvas);
  }
  sigCanvas.setDimensions({ width, height });
  sigCanvas.clear();
  sigCanvas.backgroundColor = 'rgba(255,255,255,0)';
  sigCanvas.isDrawingMode = true;
  sigCanvas.freeDrawingBrush.color = document.getElementById('sig-color').value;
  sigCanvas.freeDrawingBrush.width = parseInt(document.getElementById('draw-width').value, 10) || 3;
  sigCanvas.freeDrawingBrush.strokeLineCap = 'round';
  sigCanvas.freeDrawingBrush.strokeLineJoin = 'round';
  sigCanvas.requestRenderAll();
}

function closeSignatureModal() {
  document.getElementById('signature-modal').classList.add('hidden');
}

function clearSignaturePad() {
  if (sigCanvas) {
    sigCanvas.clear();
    sigCanvas.backgroundColor = 'rgba(255,255,255,0)';
    sigCanvas.requestRenderAll();
  }
}

function insertSignatureToPDF() {
  if (!sigCanvas || sigCanvas.getObjects().length === 0) {
    alert('Primero dibuja tu firma dentro del recuadro.');
    return;
  }
  const objects = sigCanvas.getObjects();
  const bounds = objects.reduce((acc, obj) => {
    const r = obj.getBoundingRect();
    acc.left = Math.min(acc.left, r.left); acc.top = Math.min(acc.top, r.top);
    acc.right = Math.max(acc.right, r.left + r.width); acc.bottom = Math.max(acc.bottom, r.top + r.height);
    return acc;
  }, { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity });
  const dataUrl = sigCanvas.toDataURL({ format: 'png', multiplier: 2, left: Math.max(0,bounds.left-8), top: Math.max(0,bounds.top-8), width: Math.min(sigCanvas.getWidth()-Math.max(0,bounds.left-8), bounds.right-bounds.left+16), height: Math.min(sigCanvas.getHeight()-Math.max(0,bounds.top-8), bounds.bottom-bounds.top+16) });
  fabric.Image.fromURL(dataUrl, function (img) {
    img.set({ left: Math.max(10, fabricCanvas.getWidth()/3), top: Math.max(10, fabricCanvas.getHeight()/3), selectable: true, evented: true, objectCaching: false });
    img.scaleToWidth(Math.min(220, fabricCanvas.getWidth()/2));
    fabricCanvas.add(img);
    fabricCanvas.setActiveObject(img);
    fabricCanvas.requestRenderAll();
    saveHistoryState();
  }, { crossOrigin: 'anonymous' });
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

  if (type === 'pdf' && documentMode === 'reconstructed') {
    const outPdf = await PDFLib.PDFDocument.create();
    for (let i=1;i<=pdfDoc.numPages;i++) {
      const srcPage=await pdfDoc.getPage(i);
      const vp=srcPage.getViewport({scale:1,rotation:rotations[i]||0});
      const stored=pageAnnotations[i];
      const tempEl=document.createElement('canvas'); tempEl.width=Math.ceil(vp.width); tempEl.height=Math.ceil(vp.height);
      const temp=new fabric.Canvas(tempEl,{backgroundColor:'#ffffff',selection:false});
      if (stored) {
        const old=annotationSizes[i];
        const json=old&&old.width&&old.height ? scaleSerializedCanvas(stored,tempEl.width/old.width,tempEl.height/old.height) : stored;
        await new Promise(resolve=>temp.loadFromJSON(json,()=>{temp.renderAll();resolve();}));
      } else {
        await extractPdfTextObjects(i,vp,temp);
        temp.renderAll();
      }
      const png=await outPdf.embedPng(tempEl.toDataURL('image/png'));
      outPdf.addPage([vp.width,vp.height]).drawImage(png,{x:0,y:0,width:vp.width,height:vp.height});
      temp.dispose();
    }
    const outBytes=await outPdf.save();
    downloadBlob(new Blob([outBytes],{type:'application/pdf'}),`${currentFilename.replace(/\.[^.]+$/,'')}_reconstruido.pdf`);
  } else if (type === 'pdf') {
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

        const storedSize = annotationSizes[i];
        const normalizedJson = storedSize && storedSize.width > 0 && storedSize.height > 0
          ? scaleSerializedCanvas(pageAnnotations[i], tempCanvasElem.width / storedSize.width, tempCanvasElem.height / storedSize.height)
          : scaleSerializedCanvas(pageAnnotations[i], 1 / (scale || 1), 1 / (scale || 1));
        await new Promise((resolve) => {
          tempFabric.loadFromJSON(normalizedJson, () => {
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
    const out = document.createElement('canvas');
    out.width = pdfCanvas.width; out.height = pdfCanvas.height;
    const ctx = out.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(pdfCanvas, 0, 0);
    if (fabricCanvas && fabricCanvas.lowerCanvasEl) ctx.drawImage(fabricCanvas.lowerCanvasEl, 0, 0);
    const link = document.createElement('a');
    link.href = out.toDataURL('image/png');
    link.download = `pagina_${pageNum}_render.png`;
    link.click();

  } else if (type === 'txt') {
    let allText = '';
    Object.keys(pageAnnotations).forEach(p => {
      if (pageAnnotations[p] && pageAnnotations[p].objects) {
        pageAnnotations[p].objects.forEach(obj => {
          if (['i-text', 'textbox'].includes(obj.type) && obj.text) {
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
