const fs = require('fs');

// Escritura atómica: serializa a un temporal y hace rename (operación atómica
// en el FS). Si el proceso muere a mitad, el archivo original queda intacto —
// nunca un JSON truncado. Es la diferencia entre "perdí el último cambio" y
// "perdí todo el archivo": sin esto, una escritura cortada del vault, del grafo
// o del historial corrompe el estado completo en silencio.
//
// Fallback Windows: rename puede tirar EPERM/EACCES si otro proceso tiene el
// destino abierto (antivirus, indexador). En ese caso se escribe directo —se
// pierde la atomicidad pero no la escritura.
function writeFileAtomic(filePath, contents) {
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, contents);
  try {
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    if (error.code === 'EPERM' || error.code === 'EACCES') {
      fs.writeFileSync(filePath, contents);
      fs.rmSync(tempPath, { force: true });
      return;
    }
    throw error;
  }
}

function writeJsonAtomic(filePath, data) {
  writeFileAtomic(filePath, JSON.stringify(data, null, 2));
}

module.exports = { writeFileAtomic, writeJsonAtomic };
