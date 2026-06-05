// src/reports/pdf.ts — KPI report PDF generation (PRD Tool 5)
import PDFDocument from 'pdfkit';

export interface KpiReportData {
  brandName: string;
  periodLabel: string;
  kpis: { label: string; value: string }[];
  alerts?: string[];
  topIssues?: string[];
}

/** Render a one-page KPI report PDF and resolve with the file buffer. */
export function generateKpiReportPdf(data: KpiReportData): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.fillColor('#0D1547').fontSize(22).text('Social Emblue AI');
      doc.fillColor('#6B7280').fontSize(12).text(`Performance Report — ${data.brandName}`);
      doc.fillColor('#9CA3AF').fontSize(10).text(data.periodLabel);
      doc.moveDown(1.5);

      doc.fillColor('#1E293B').fontSize(14).text('Key Metrics');
      doc.moveDown(0.5).fontSize(11);
      for (const kpi of data.kpis) {
        doc.fillColor('#475569').text(`${kpi.label}:  `, { continued: true })
          .fillColor('#0D1547').text(kpi.value);
      }
      doc.moveDown(1);

      if (data.alerts?.length) {
        doc.fillColor('#1E293B').fontSize(14).text('Alerts');
        doc.moveDown(0.5).fontSize(11).fillColor('#92400E');
        data.alerts.forEach(a => doc.text(`- ${a}`));
        doc.moveDown(1);
      }

      if (data.topIssues?.length) {
        doc.fillColor('#1E293B').fontSize(14).text('Top Issues');
        doc.moveDown(0.5).fontSize(11).fillColor('#475569');
        data.topIssues.forEach(i => doc.text(`- ${i}`));
        doc.moveDown(1);
      }

      doc.fillColor('#9CA3AF').fontSize(9)
        .text(`Generated ${new Date().toISOString()}`, 50, doc.page.height - 60);
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
