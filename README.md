# PDF Master Suite Pro — versión de reconstrucción

## Inicio en Windows

1. Extrae todos los archivos del ZIP en una carpeta normal (por ejemplo, `C:\PDFMaster`).
2. Instala Python 3 si todavía no está instalado: https://www.python.org/downloads/windows/ (activa **Add Python to PATH** durante la instalación).
3. Haz doble clic en `INICIAR_EDITOR.bat`.
4. Se abrirá `http://localhost:8000`. Mantén abierta la ventana negra mientras uses el editor.
5. Para detener el servidor, vuelve a esa ventana y pulsa `Ctrl+C`.

No abras `index.html` con doble clic (`file://`): PDF.js, los trabajadores y algunos motores de importación necesitan un servidor local.

## Qué hace esta versión

- **PDF con texto digital:** el editor intenta extraer los elementos de texto y reconstruirlos como cajas editables sobre una página blanca. No dibuja el PDF original detrás de esas cajas.
- **PDF escaneado:** intenta usar OCR (Tesseract.js, español e inglés) si no encuentra texto. El OCR es aproximado y puede cometer errores; el primer uso descarga componentes de idioma.
- **Imágenes y SVG:** se insertan como un objeto de imagen seleccionable, movible, redimensionable y girable; no se fijan como fondo del editor.
- **DOCX:** Mammoth extrae estructura básica de texto, encabezados, párrafos y listas; no es un clon de Microsoft Word.
- **XLSX/XLS/ODS/CSV/TSV:** SheetJS lee datos, pero la importación actual muestra una hoja como texto editable; no reconstruye fórmulas, estilos, validaciones ni todas las pestañas.
- **PPTX/ODT/ODP:** se extrae texto básico. No se reconstruyen completamente los diseños, imágenes, gráficos ni animaciones.
- **MusicXML/MXL:** OpenSheetMusicDisplay dibuja la partitura y la coloca como imagen seleccionable. Para editar notas, alturas y duraciones se requiere conectar un motor musical/editor como MuseScore; el dibujo no convierte las notas en objetos musicales.
- **Fuentes:** puede usar fuentes disponibles en el navegador, fuentes web incluidas y archivos `.ttf`, `.otf`, `.woff` o `.woff2` cargados manualmente. No puede usar mágicamente todas las fuentes instaladas en Microsoft Word en todos los equipos.
- **Zoom:** los objetos Fabric se escalan al cambiar el tamaño de página.
- **Exportación:** en modo PDF reconstruido, el PDF exportado se genera a partir de los objetos visibles. Para conservar una apariencia aproximada se rasteriza la página; eso no equivale a un DOCX con texto editable.

## Límites importantes

No hay una biblioteca única que convierta cualquier formato en objetos editables perfectos. Un PDF puede contener texto, imágenes, vectores, escaneos y fuentes incrustadas. Esta versión reconstruye texto, no todos los gráficos internos. Las imágenes importadas son seleccionables como imagen completa, no separables en cada elemento interno.

## Motores necesarios para la siguiente etapa

Para edición real de documentos Office (DOCX, XLSX y PPTX) conviene integrar un servidor de documentos como **ONLYOFFICE Docs** o **Collabora Online**. Eso requiere un servidor de documentos, una API/backend para recibir archivos y guardar los cambios, y almacenamiento accesible desde el servidor. No basta con añadir un `<script>` al HTML.

Para conversión de formatos antiguos (`.doc`, `.ppt`, `.xls`) y conversión por lotes, conviene instalar **LibreOffice** y usarlo desde un backend local. Para partituras, la edición de notas debe pasar por un formato estructurado MusicXML y un motor musical especializado.

No se incluye una instalación automática de esos servidores porque son servicios separados y pueden consumir varios GB; el editor actual no los necesita para abrirse. Cuando esta versión esté probada, el siguiente paso es configurar el backend y después conectar ONLYOFFICE/Collabora y el motor musical.
