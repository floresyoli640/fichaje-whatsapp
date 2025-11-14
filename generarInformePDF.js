import PDFDocument from "pdfkit";
import fs from "fs";

export async function generatePDF() {
    return new Promise((resolve) => {
        const fichajes = JSON.parse(fs.readFileSync("fichajes.json", "utf8"));
        const filePath = "informe_fichajes.pdf";

        const doc = new PDFDocument();
        const stream = fs.createWriteStream(filePath);

        doc.pipe(stream);

        doc.fontSize(20).text("Informe de Fichajes", { align: "center" });
        doc.moveDown(2);

        fichajes.forEach((f) => {
            doc.fontSize(12).text(`Empleado: ${f.empleado}`);
            doc.text(`Hora: ${f.hora}`);
            doc.moveDown();
        });

        doc.end();

        stream.on("finish", () => {
            resolve(filePath);
        });
    });
}
