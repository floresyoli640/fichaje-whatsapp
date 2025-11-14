const fs = require('fs');
const PDFDocument = require('pdfkit');
const pathArch = 'fichajes.json';
const archivoPDF = 'informe_fichajes.pdf';

const usuarios = {
    '34696963442': { usuario: 'Yolanda Flores Frías', dni: '26044247J' },
    '34666141093': { usuario: 'María Muñoz Sanchez', dni: '26515105V' },
    '34649682249': { usuario: 'Alcázar Marín Ruiz', dni: '75096786X' }
};

if (!fs.existsSync(pathArch)) {
    console.log('No hay registros de fichajes.');
    process.exit(0);
}

let fichajes = JSON.parse(fs.readFileSync(pathArch));

if (fichajes.length === 0) {
    console.log('El archivo está vacío, no hay fichajes registrados.');
    process.exit(0);
}

fichajes.sort((a, b) => new Date(a.fecha) - new Date(b.fecha));

const doc = new PDFDocument({
    size: 'A4',
    layout: 'portrait',
    margin: 40
});
doc.pipe(fs.createWriteStream(archivoPDF));

doc.fontSize(18).text('Informe de Fichajes', { align: 'center' });
doc.moveDown(1.5);

// Anchura de columnas
const cols = [
    { title: 'Nombre', width: 210 },
    { title: 'DNI', width: 90 },
    { title: 'Fecha/Hora', width: 140 },
    { title: 'Tipo Asistencia', width: 90 }
];

let x = doc.page.margins.left;
let y = doc.y;

// Imprime los encabezados de la tabla
cols.forEach(col => {
    doc.fontSize(12).font('Helvetica-Bold').text(col.title, x, y, { width: col.width, align: 'center' });
    x += col.width;
});

// Línea divisoria debajo de encabezados
y += 22;
doc.moveTo(doc.page.margins.left, y).lineTo(doc.page.width - doc.page.margins.right, y).stroke();
y += 5;

fichajes.forEach((fichaje) => {
    const numeroLimpio = fichaje.numero.replace('@c.us', '');
    const datosUsuario = usuarios[numeroLimpio] || { usuario: 'Desconocido', dni: '-' };
    x = doc.page.margins.left;

    doc.fontSize(10).font('Helvetica').text(datosUsuario.usuario, x, y, { width: cols[0].width, align: 'left' });
    x += cols[0].width;
    doc.text(datosUsuario.dni, x, y, { width: cols[1].width, align: 'center' });
    x += cols[1].width;
    doc.text(new Date(fichaje.fecha).toLocaleString(), x, y, { width: cols[2].width, align: 'center' });
    x += cols[2].width;
    doc.text(fichaje.accion, x, y, { width: cols[3].width, align: 'center' });

    y += 20;

    // Salto de página si se llena la hoja
    if (y > doc.page.height - doc.page.margins.bottom - 40) {
        doc.addPage();
        y = doc.page.margins.top;

        // Repetir encabezados en cada hoja nueva
        x = doc.page.margins.left;
        cols.forEach(col => {
            doc.fontSize(12).font('Helvetica-Bold').text(col.title, x, y, { width: col.width, align: 'center' });
            x += col.width;
        });
        y += 22;
        doc.moveTo(doc.page.margins.left, y).lineTo(doc.page.width - doc.page.margins.right, y).stroke();
        y += 5;
    }
}

);

doc.end();

console.log(`Informe PDF generado: ${archivoPDF}`);


