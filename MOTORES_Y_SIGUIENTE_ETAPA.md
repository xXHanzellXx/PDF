# Motores y siguiente etapa de PDF Master Suite Pro

## Estado actual

Esta es una aplicación de navegador. Carga motores desde CDNs y no tiene backend propio. La importación PDF reconstruida extrae texto con PDF.js; Tesseract.js es un OCR de respaldo; Fabric.js proporciona objetos manipulables; PDF-Lib exporta PDF; Mammoth y SheetJS extraen estructuras parciales; OpenSheetMusicDisplay renderiza MusicXML.

## Qué instalar para la siguiente etapa

### 1. Python para ejecutar la versión actual

En Windows instala Python 3 desde https://www.python.org/downloads/windows/ y activa `Add Python to PATH`. Luego ejecuta `INICIAR_EDITOR.bat`.

### 2. Docker Desktop para motor Office real

Para conectar un editor completo de DOCX/XLSX/PPTX se recomienda Docker Desktop para Windows con WSL 2. Sitio oficial: https://www.docker.com/products/docker-desktop/ . No ejecutes contenedores de origen desconocido. La siguiente fase debe configurar el servidor de documentos y el backend juntos, con claves y URL de callback correctas; iniciar solamente el contenedor no integra la edición en esta página.

### 3. LibreOffice para conversión de formatos antiguos

Instala LibreOffice desde https://www.libreoffice.org/download/download-libreoffice/ si necesitas convertir `.doc`, `.xls`, `.ppt`, ODT/ODS/ODP y exportar lotes. Para que la web lo use, hay que añadir un backend que invoque LibreOffice en el equipo servidor; el navegador no puede ejecutarlo directamente.

### 4. Partituras

Para editar notas, compases, alturas y duraciones, importa/exporta MusicXML y conecta un motor musical compatible. OpenSheetMusicDisplay es un renderizador: dibuja la partitura, pero no ofrece por sí solo una interfaz de edición de cada nota. MuseScore es una opción de escritorio para esa edición especializada: https://musescore.org/ .

## Prueba que necesito para verificar el siguiente avance

Después de abrir el editor, prueba un PDF que tenga texto seleccionable y otro escaneado. Comprueba si los párrafos aparecen en el lugar correcto, si las cajas se seleccionan y si el zoom conserva las posiciones. Si un archivo concreto falla, conserva una copia de prueba sin datos privados para reproducir el problema.
