// Export รายงานเป็น Excel (.xlsx) — ยกมาจากระบบเดิม: ชีตข้อมูล + ChartData + ชีตกราฟโดนัทแบบ native
// โหลด ExcelJS / JSZip เมื่อกด Export ครั้งแรกเท่านั้น

const LIBS = {
  ExcelJS: 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js',
  JSZip: 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js',
};
function need(name) {
  if (window[name]) return Promise.resolve(window[name]);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = LIBS[name];
    s.onload = () => resolve(window[name]);
    s.onerror = () => reject(new Error('โหลด ' + name + ' ไม่สำเร็จ'));
    document.head.append(s);
  });
}

const x = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * exportReport({ title, subtitle, filename, header: [], rows: [[]], total: []|null, chart: { title, labels, values }|null })
 */
export async function exportReport({ title, subtitle, filename, header, rows, total, chart }) {
  const ExcelJS = await need('ExcelJS');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'First Aid';
  wb.created = new Date();

  // ชีต 1: ข้อมูล
  const ws = wb.addWorksheet('ข้อมูล');
  ws.addRow([title]).getCell(1).font = { bold: true, size: 14, color: { argb: 'FF0A2463' } };
  ws.addRow([subtitle]).getCell(1).font = { italic: true, color: { argb: 'FF5F6977' } };
  ws.addRow([]);
  const all = [header, ...rows, ...(total ? [total] : [])];
  all.forEach((row, i) => {
    const r = ws.addRow(row);
    const isHead = i === 0, isTotal = total && i === all.length - 1;
    r.eachCell({ includeEmpty: true }, (c) => {
      c.alignment = { vertical: 'middle', wrapText: true };
      if (isHead) {
        c.font = { bold: true, color: { argb: 'FF0A2463' } };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8ECF6' } };
        c.border = { bottom: { style: 'medium', color: { argb: 'FFCDD3DA' } } };
      } else if (isTotal) {
        c.font = { bold: true };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2F5F7' } };
        c.border = { top: { style: 'thin', color: { argb: 'FFCDD3DA' } } };
      } else if (i % 2 === 0) {
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFAFBFC' } };
      }
    });
  });
  const cols = Math.max(...all.map((r) => r.length));
  for (let c = 1; c <= cols; c++) {
    const max = Math.max(...all.map((r) => String(r[c - 1] ?? '').split('\n').reduce((m, l) => Math.max(m, l.length), 0)));
    ws.getColumn(c).width = Math.min(Math.max(max + 4, 10), 60);
  }

  const hasChart = chart && chart.labels.length > 0;
  if (hasChart) {
    const cd = wb.addWorksheet('ChartData');
    cd.addRow(['หมวด', 'จำนวน', 'ร้อยละ']);
    const sum = chart.values.reduce((s, v) => s + v, 0);
    chart.labels.forEach((l, i) => cd.addRow([l, chart.values[i], sum ? +(chart.values[i] / sum * 100).toFixed(2) : 0]));
    cd.getRow(1).eachCell((c) => { c.font = { bold: true }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8ECF6' } }; });
    cd.columns = [{ width: 45 }, { width: 12 }, { width: 12 }];
  }

  let buf = await wb.xlsx.writeBuffer();
  if (hasChart) buf = await injectDonut(buf, chart.title, chart.labels.length);
  download(buf, filename);
}

async function injectDonut(buf, title, n) {
  const JSZip = await need('JSZip');
  const zip = await JSZip.loadAsync(buf);
  const S = 'ChartData';
  zip.file('xl/charts/chart1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<c:date1904 val="0"/><c:lang val="th-TH"/>
<c:chart><c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr b="1" sz="1300"/></a:pPr><a:r><a:rPr lang="th-TH" b="1"/><a:t>${x(title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>
<c:autoTitleDeleted val="0"/><c:plotArea><c:doughnutChart><c:varyColors val="1"/>
<c:ser><c:idx val="0"/><c:order val="0"/>
<c:cat><c:strRef><c:f>${S}!$A$2:$A$${n + 1}</c:f><c:strCache><c:ptCount val="${n}"/></c:strCache></c:strRef></c:cat>
<c:val><c:numRef><c:f>${S}!$B$2:$B$${n + 1}</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${n}"/></c:numCache></c:numRef></c:val>
<c:dLbls><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr><c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="800" b="0"/></a:pPr></a:p></c:txPr>
<c:showLegendKey val="0"/><c:showVal val="0"/><c:showCatName val="1"/><c:showSerName val="0"/><c:showPercent val="1"/><c:showBubbleSize val="0"/><c:separator>
</c:separator><c:showLeaderLines val="1"/></c:dLbls></c:ser>
<c:firstSliceAng val="0"/><c:holeSize val="50"/></c:doughnutChart></c:plotArea>
<c:legend><c:legendPos val="r"/><c:overlay val="0"/></c:legend><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart></c:chartSpace>`);
  zip.file('xl/drawings/drawing1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<xdr:absoluteAnchor><xdr:pos x="0" y="0"/><xdr:ext cx="9144000" cy="6858000"/>
<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="2" name="Chart 1"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>
<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="9144000" cy="6858000"/></xdr:xfrm>
<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart r:id="rId1"/></a:graphicData></a:graphic></xdr:graphicFrame>
<xdr:clientData/></xdr:absoluteAnchor></xdr:wsDr>`);
  const rel = (type, target) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/></Relationships>`;
  zip.file('xl/drawings/_rels/drawing1.xml.rels', rel('chart', '../charts/chart1.xml'));
  zip.file('xl/chartsheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<chartsheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetViews><sheetView tabSelected="0" workbookViewId="0"/></sheetViews><drawing r:id="rId1"/></chartsheet>`);
  zip.file('xl/chartsheets/_rels/sheet1.xml.rels', rel('drawing', '../drawings/drawing1.xml'));

  let wbXml = await zip.file('xl/workbook.xml').async('string');
  const sid = Math.max(0, ...[...wbXml.matchAll(/sheetId="(\d+)"/g)].map((m) => +m[1])) + 1;
  let rels = await zip.file('xl/_rels/workbook.xml.rels').async('string');
  const rid = Math.max(0, ...[...rels.matchAll(/Id="rId(\d+)"/g)].map((m) => +m[1])) + 1;
  zip.file('xl/workbook.xml', wbXml.replace('</sheets>', `<sheet name="กราฟ" sheetId="${sid}" r:id="rId${rid}"/></sheets>`));
  zip.file('xl/_rels/workbook.xml.rels', rels.replace('</Relationships>', `<Relationship Id="rId${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chartsheet" Target="chartsheets/sheet1.xml"/></Relationships>`));
  let ct = await zip.file('[Content_Types].xml').async('string');
  ct = ct.replace('</Types>', `<Override PartName="/xl/chartsheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.chartsheet+xml"/><Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/><Override PartName="/xl/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/></Types>`);
  zip.file('[Content_Types].xml', ct);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

function download(buf, filename) {
  const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  Object.assign(document.createElement('a'), { href: url, download: filename }).click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
