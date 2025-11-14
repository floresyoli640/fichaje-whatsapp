const fs = require('fs');
const pathArch = './fichajes.json';

if (!fs.existsSync(pathArch)) {
    console.log('No hay registros de fichajes.');
    process.exit(0);
}

const fichajes = JSON.parse(fs.readFileSync(pathArch));

if (fichajes.length === 0) {
    console.log('El archivo está vacío, no hay fichajes registrados.');
    process.exit(0);
}

console.log('--- Registros de Fichajes ---');
fichajes.forEach((fichaje, index) => {
    console.log(`${index + 1}. ${fichaje.empresa} - ${fichaje.usuario}`);
    console.log(`   Número: ${fichaje.numero}`);
    console.log(`   Acción: ${fichaje.accion}`);
    console.log(`   Fecha: ${new Date(fichaje.fecha).toLocaleString()}`);
    console.log('-----------------------------');
});
