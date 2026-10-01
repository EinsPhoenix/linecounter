// @ts-check
/* global html2canvas */
// PDF export of the statistics page: every selected section is rendered with html2canvas and laid out with jsPDF.
(function () {
  const PAGE = { a4: [841.89, 595.28], letter: [792, 612] }; // landscape, pt

  function sections() {
    return [...document.querySelectorAll('main > h2[id]')].map(h => ({ id: h.id, title: h.textContent.trim() }));
  }

  /** Top-level blocks of a section: the h2 and every sibling up to the next h2. */
  function blocksOf(id) {
    const h = document.getElementById(id);
    const out = [h];
    for (let el = h.nextElementSibling; el && el.tagName !== 'H2'; el = el.nextElementSibling) out.push(el);
    return out.filter(el => el.offsetHeight > 0);
  }

  function openDialog(ui) {
    const { esc, icon } = ui;
    const old = document.getElementById('pdfDialog');
    if (old) old.remove();
    const saved = (() => { try { return JSON.parse(localStorage.getItem('lc.pdf') || 'null'); } catch { return null; } })() || {};
    const secs = sections();
    const dlg = document.createElement('div');
    dlg.id = 'pdfDialog';
    dlg.className = 'modal-backdrop';
    dlg.innerHTML = `<div class="modal" role="dialog" aria-label="Export PDF">
      <h3>${icon('download')} Export PDF report</h3>
      <div class="modal-cols">
        <div>
          <div class="modal-label">Sections <button class="link" data-pdf-all>all</button> <button class="link" data-pdf-none>none</button></div>
          <div class="modal-secs">${secs.map(s => `<label class="check"><input type="checkbox" value="${esc(s.id)}" ${!saved.sections || saved.sections.includes(s.id) ? 'checked' : ''}> ${esc(s.title)}</label>`).join('')}</div>
        </div>
        <div>
          <div class="modal-label">Paper</div>
          <label class="check"><input type="radio" name="pdfPaper" value="a4" ${saved.paper !== 'letter' ? 'checked' : ''}> A4 landscape</label>
          <label class="check"><input type="radio" name="pdfPaper" value="letter" ${saved.paper === 'letter' ? 'checked' : ''}> Letter landscape</label>
          <div class="modal-label">Look</div>
          <label class="check"><input type="checkbox" id="pdfLight" ${saved.light ? 'checked' : ''}> Light, printer-friendly theme</label>
          <label class="check"><input type="checkbox" id="pdfCover" ${saved.cover !== false ? 'checked' : ''}> Cover page with key numbers</label>
          <div class="modal-label">Quality</div>
          <label class="check"><input type="radio" name="pdfQ" value="1.5" ${saved.scale !== 2 ? 'checked' : ''}> Normal (smaller file)</label>
          <label class="check"><input type="radio" name="pdfQ" value="2" ${saved.scale === 2 ? 'checked' : ''}> High</label>
        </div>
      </div>
      <div class="modal-progress" id="pdfProgress"></div>
      <div class="modal-actions"><button class="btn" data-pdf-cancel>Cancel</button><button class="btn primary" data-pdf-go>${icon('download')} Create PDF</button></div>
    </div>`;
    document.body.appendChild(dlg);
    dlg.addEventListener('click', async ev => {
      const t = /** @type {HTMLElement} */ (ev.target);
      if (t === dlg || t.closest('[data-pdf-cancel]')) { dlg.remove(); return; }
      if (t.closest('[data-pdf-all]')) dlg.querySelectorAll('.modal-secs input').forEach(i => { /** @type {HTMLInputElement} */ (i).checked = true; });
      if (t.closest('[data-pdf-none]')) dlg.querySelectorAll('.modal-secs input').forEach(i => { /** @type {HTMLInputElement} */ (i).checked = false; });
      if (t.closest('[data-pdf-go]')) {
        const opts = {
          sections: [...dlg.querySelectorAll('.modal-secs input:checked')].map(i => /** @type {HTMLInputElement} */ (i).value),
          paper: /** @type {HTMLInputElement} */ (dlg.querySelector('input[name=pdfPaper]:checked')).value,
          light: /** @type {HTMLInputElement} */ (dlg.querySelector('#pdfLight')).checked,
          cover: /** @type {HTMLInputElement} */ (dlg.querySelector('#pdfCover')).checked,
          scale: Number(/** @type {HTMLInputElement} */ (dlg.querySelector('input[name=pdfQ]:checked')).value),
        };
        try { localStorage.setItem('lc.pdf', JSON.stringify(opts)); } catch { /* ignore */ }
        if (!opts.sections.length) return;
        dlg.querySelectorAll('button').forEach(b => { /** @type {HTMLButtonElement} */ (b).disabled = true; });
        const prog = /** @type {HTMLElement} */ (dlg.querySelector('#pdfProgress'));
        try {
          const base64 = await createPdf(ui, opts, msg => { prog.textContent = msg; });
          prog.textContent = 'Saving…';
          ui.post({ type: 'savePdf', data: base64 });
          dlg.remove();
        } catch (e) {
          prog.textContent = 'Export failed: ' + (e && e.message ? e.message : e);
          dlg.querySelectorAll('button').forEach(b => { /** @type {HTMLButtonElement} */ (b).disabled = false; });
        }
      }
    });
  }

  async function createPdf(ui, opts, progress) {
    const { jsPDF } = /** @type {any} */ (window).jspdf;
    const [W, H] = PAGE[opts.paper] || PAGE.a4;
    const M = 26, HEAD = 22;
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: opts.paper === 'letter' ? 'letter' : 'a4', compress: true });
    const D = ui.data();
    const bg = opts.light ? '#ffffff' : '#1b1b1b';
    const fg = opts.light ? [30, 30, 30] : [232, 230, 227];
    const muted = opts.light ? [110, 110, 110] : [154, 152, 148];
    const accent = [217, 97, 26];
    const title = `Code Statistics – ${D.workspace || ''}`;
    const dateStr = new Date(D.generated).toLocaleString();

    const paintPage = () => {
      pdf.setFillColor(bg);
      pdf.rect(0, 0, W, H, 'F');
      pdf.setFillColor(...accent);
      pdf.rect(0, 0, W, 3, 'F');
    };
    const header = (n) => {
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(8);
      pdf.setTextColor(...muted);
      pdf.text(title, M, 15);
      pdf.text(`${dateStr}  ·  page ${n}`, W - M, 15, { align: 'right' });
    };

    document.body.classList.add('pdf-mode');
    if (opts.light) document.body.classList.add('print-light');
    ui.onThemeChange();
    await new Promise(r => setTimeout(r, 120));
    let page = 0;
    const newPage = () => {
      if (page > 0) pdf.addPage();
      page++;
      paintPage();
      header(page);
      return M + HEAD;
    };

    try {
      // ---- cover ----
      if (opts.cover) {
        newPage();
        const t = D.totals;
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(30);
        pdf.setTextColor(...fg);
        pdf.text('Code Statistics', M + 10, 120);
        pdf.setFontSize(16);
        pdf.setTextColor(...accent);
        pdf.text(String(D.workspace || ''), M + 10, 148);
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(10);
        pdf.setTextColor(...muted);
        pdf.text(`Generated ${dateStr} with Line Counter`, M + 10, 168);
        const kpis = [
          ['Total lines', t.lines], ['Code lines', t.code], ['Comment lines', t.comment], ['Blank lines', t.blank],
          ['Files', t.files], ['Languages', D.languages.filter(l => l.key !== 'Binary').length],
        ];
        const R = D.dependencies;
        if (R && R.packages) {
          kpis.push(['Dependencies', R.packages.filter(p => p.direct).length], ['License issues', R.packages.filter(p => p.status === 'problematic' && !p.ignored).length]);
          if (R.vulns && R.vulns.enabled && !R.vulns.error) kpis.push(['Vulnerabilities', (R.vulns.items || []).length]);
        }
        if (D.importGraph) kpis.push(['Circular imports', D.importGraph.cycleCount || 0]);
        const colW = (W - 2 * M - 20) / 4;
        kpis.slice(0, 12).forEach(([label, value], i) => {
          const x = M + 10 + (i % 4) * colW, y = 220 + Math.floor(i / 4) * 78;
          pdf.setDrawColor(...accent); pdf.setLineWidth(2); pdf.line(x, y, x + colW - 16, y);
          pdf.setFontSize(9); pdf.setTextColor(...muted); pdf.text(label, x, y + 16);
          pdf.setFont('helvetica', 'bold'); pdf.setFontSize(22); pdf.setTextColor(...fg);
          pdf.text(Number(value).toLocaleString('en-US'), x, y + 42);
          pdf.setFont('helvetica', 'normal');
        });
        pdf.setFontSize(9); pdf.setTextColor(...muted);
        const toc = sections().filter(s => opts.sections.includes(s.id)).map(s => s.title).join('  ·  ');
        pdf.text(pdf.splitTextToSize('Contents: ' + toc, W - 2 * M - 20), M + 10, H - 60);
      }

      // ---- sections: one render per section, page breaks preferably between blocks ----
      const contentW = W - 2 * M;
      const main = document.querySelector('main');
      const all = [...main.children];
      for (const [si, id] of opts.sections.entries()) {
        const blocks = blocksOf(id);
        const title = (sections().find(s => s.id === id) || { title: id }).title;
        progress(`Rendering “${title}” (${si + 1}/${opts.sections.length})…`);
        const keep = new Set(blocks);
        const top0 = blocks[0].getBoundingClientRect().top;
        // block boundaries in CSS px relative to the section start
        const cuts = blocks.map(b => b.getBoundingClientRect().top - top0).concat([blocks[blocks.length - 1].getBoundingClientRect().bottom - top0 + 8]);
        const canvas = await html2canvas(main, {
          backgroundColor: bg, scale: opts.scale, logging: false,
          ignoreElements: el => el.parentElement === main && !keep.has(el) && all.includes(el),
        });
        const scale = canvas.width / main.getBoundingClientRect().width;
        const ratio = contentW / canvas.width;
        const cutPx = cuts.map(c => Math.round(c * scale));
        let y = newPage();
        let srcY = 0;
        const total = Math.min(canvas.height, cutPx[cutPx.length - 1]);
        while (srcY < total - 2) {
          const avail = Math.floor((H - M - y) / ratio);
          let end = Math.min(total, srcY + avail);
          if (end < total) {
            // prefer the last block boundary that fits on this page (if it keeps at least a third of the page)
            const fitting = cutPx.filter(c => c > srcY + avail / 3 && c <= end);
            if (fitting.length) end = fitting[fitting.length - 1];
          }
          const h = end - srcY;
          const slice = document.createElement('canvas');
          slice.width = canvas.width; slice.height = h;
          const sctx = slice.getContext('2d');
          sctx.fillStyle = bg; sctx.fillRect(0, 0, slice.width, h);
          sctx.drawImage(canvas, 0, srcY, canvas.width, h, 0, 0, canvas.width, h);
          pdf.addImage(slice, 'JPEG', M, y, contentW, h * ratio, undefined, 'FAST');
          srcY = end;
          if (srcY < total - 2) y = newPage();
        }
      }
    } finally {
      document.body.classList.remove('pdf-mode', 'print-light');
      ui.onThemeChange();
    }
    progress('Compressing…');
    return pdf.output('datauristring').split(',')[1];
  }

  // ---------------------------------------------------------------- table reports
  /** Vector (text) table with wrapping, zebra rows, repeated header and page breaks. */
  function drawTable(pdf, ctx, cols, rows, opts = {}) {
    const { M, W, H } = ctx;
    const tableW = W - 2 * M;
    const widths = cols.map(c => c.w * tableW);
    const pad = 4, lh = 10.5;
    const headerRow = () => {
      pdf.setFillColor(36, 36, 36);
      pdf.rect(M, ctx.y, tableW, 18, 'F');
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(8); pdf.setTextColor(255, 255, 255);
      let x = M;
      cols.forEach((c, i) => { pdf.text(c.label, x + pad, ctx.y + 12); x += widths[i]; });
      ctx.y += 18;
    };
    headerRow();
    rows.forEach((r, ri) => {
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8);
      const cells = cols.map((c, i) => {
        const st = c.style ? c.style(r) : null;
        pdf.setFont('helvetica', st && st.bold ? 'bold' : 'normal');
        return pdf.splitTextToSize(String(c.get(r) ?? ''), widths[i] - 2 * pad);
      });
      const h = Math.max(...cells.map(x => x.length)) * lh + 6;
      if (ctx.y + h > H - M - 14) { ctx.newPage(); headerRow(); }
      if (ri % 2) { pdf.setFillColor(246, 245, 243); pdf.rect(M, ctx.y, tableW, h, 'F'); }
      let x = M;
      cols.forEach((c, i) => {
        const style = c.style ? c.style(r) : null;
        if (style && style.fill) {
          pdf.setFillColor(...style.fill);
          const tw = Math.min(widths[i] - 2 * pad, pdf.getTextWidth(cells[i][0] || '') + 8);
          pdf.roundedRect(x + pad - 2, ctx.y + 3, tw, lh + 1, 3, 3, 'F');
        }
        pdf.setTextColor(...((style && style.color) || [30, 30, 30]));
        pdf.setFont('helvetica', style && style.bold ? 'bold' : 'normal');
        pdf.text(cells[i], x + pad, ctx.y + 11);
        x += widths[i];
      });
      pdf.setDrawColor(225, 222, 218); pdf.setLineWidth(0.4);
      pdf.line(M, ctx.y + h, M + tableW, ctx.y + h);
      ctx.y += h;
    });
    ctx.y += 10;
  }

  function reportDoc(title, subtitle) {
    const { jsPDF } = /** @type {any} */ (window).jspdf;
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4', compress: true });
    const W = 595.28, H = 841.89, M = 36;
    let page = 0;
    const ctx = { M, W, H, y: 0, newPage: null };
    ctx.newPage = () => {
      if (page) pdf.addPage();
      page++;
      pdf.setFillColor(217, 97, 26); pdf.rect(0, 0, W, 4, 'F');
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(120, 120, 120);
      pdf.text(`${title} – ${subtitle}`, M, 20);
      pdf.text(`page ${page}`, W - M, 20, { align: 'right' });
      ctx.y = M + 8;
    };
    ctx.newPage();
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(22); pdf.setTextColor(25, 25, 25);
    pdf.text(title, M, ctx.y + 20);
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(10); pdf.setTextColor(217, 97, 26);
    pdf.text(subtitle, M, ctx.y + 38);
    ctx.y += 56;
    ctx.heading = text => {
      if (ctx.y > H - M - 80) ctx.newPage();
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(12); pdf.setTextColor(25, 25, 25);
      pdf.text(text, M, ctx.y + 12);
      pdf.setDrawColor(217, 97, 26); pdf.setLineWidth(1.5); pdf.line(M, ctx.y + 17, M + 40, ctx.y + 17);
      ctx.y += 28;
    };
    ctx.para = (text, color) => {
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(...(color || [70, 70, 70]));
      const lines = pdf.splitTextToSize(text, W - 2 * M);
      if (ctx.y + lines.length * 12 > H - M) ctx.newPage();
      pdf.text(lines, M, ctx.y + 9);
      ctx.y += lines.length * 12 + 6;
    };
    ctx.kpis = list => {
      const w = (W - 2 * M) / list.length;
      list.forEach(([label, value, color], i) => {
        const x = M + i * w;
        pdf.setDrawColor(...(color || [217, 97, 26])); pdf.setLineWidth(2); pdf.line(x, ctx.y, x + w - 10, ctx.y);
        pdf.setFontSize(8); pdf.setTextColor(110, 110, 110); pdf.setFont('helvetica', 'normal'); pdf.text(label, x, ctx.y + 13);
        pdf.setFontSize(18); pdf.setTextColor(...(color || [25, 25, 25])); pdf.setFont('helvetica', 'bold'); pdf.text(String(value), x, ctx.y + 33);
      });
      ctx.y += 48;
    };
    return { pdf, ctx };
  }

  const STATUS_STYLE = {
    problematic: { fill: [255, 77, 79], color: [255, 255, 255], bold: true },
    review: { fill: [247, 174, 98], color: [40, 25, 10], bold: true },
    ok: { color: [90, 90, 90] },
  };
  const SEV_STYLE = {
    CRITICAL: { fill: [255, 77, 79], color: [255, 255, 255], bold: true },
    HIGH: { fill: [224, 98, 27], color: [255, 255, 255], bold: true },
    MEDIUM: { fill: [247, 174, 98], color: [40, 25, 10], bold: true },
    LOW: { fill: [200, 200, 200], color: [30, 30, 30], bold: true },
    UNKNOWN: { fill: [225, 225, 225], color: [60, 60, 60] },
  };

  function licensePdf(D) {
    const R = D.dependencies;
    const { pdf, ctx } = reportDoc('License report', `${D.workspace || ''} · ${new Date(D.generated).toLocaleString()}`);
    const P = R.packages;
    const count = st => P.filter(p => p.status === st && !p.ignored).length;
    ctx.kpis([['Packages', P.length], ['Direct', P.filter(p => p.direct).length], ['Problematic', count('problematic'), [200, 40, 40]], ['Needs review', count('review'), [200, 120, 30]], ['OK', count('ok')]]);
    ctx.heading('Policy');
    const pol = R.policy || {};
    ctx.para(`Problematic: ${(pol.problematic || []).join(', ') || '–'}`);
    ctx.para(`Needs review: ${(pol.review || []).join(', ') || '–'}`);
    if (pol.allowed && pol.allowed.length) ctx.para(`Allowlist: ${pol.allowed.join(', ')} (everything else is problematic)`);
    ctx.para(`Manifests: ${R.manifests.map(m => `${m.file} (${m.ecosystem})`).join(', ')}`);
    ctx.heading('Licenses in use');
    const lic = new Map();
    for (const p of P) { const e = lic.get(p.license) || { license: p.license, category: p.category, status: p.status, n: 0 }; e.n++; lic.set(p.license, e); }
    drawTable(pdf, ctx, [
      { label: 'License', w: 0.4, get: r => r.license },
      { label: 'Category', w: 0.25, get: r => r.category },
      { label: 'Status', w: 0.2, get: r => r.status, style: r => STATUS_STYLE[r.status] },
      { label: 'Packages', w: 0.15, get: r => r.n },
    ], [...lic.values()].sort((a, b) => b.n - a.n));
    const unknown = P.filter(p => p.license === 'Unknown' || p.license === 'Custom');
    if (unknown.length) {
      ctx.heading(`Unknown & custom licenses (${unknown.length}) – check these manually`);
      ctx.para('Unknown: no license was found in the package metadata, the registry, the package archive (LICENSE files), deps.dev or the GitHub repository. Custom: a license text exists but is not a standard license.');
      drawTable(pdf, ctx, [
        { label: 'Package', w: 0.28, get: r => `${r.name}${r.version ? '@' + r.version : ''}\n${r.ecosystem}${r.direct ? '' : ' · transitive'}`, style: () => ({ bold: true }) },
        { label: 'License', w: 0.12, get: r => r.license, style: r => (r.license === 'Unknown' ? STATUS_STYLE.review : STATUS_STYLE.problematic) },
        { label: 'What was checked', w: 0.6, get: r => (r.licenseTrail && r.licenseTrail.length ? r.licenseTrail.map(t => `${t.source}: ${t.result}`).join('\n') : (r.installed ? 'local metadata: no license field or file' : 'not installed, online lookup off')) },
      ], unknown);
    }
    const rank = { problematic: 0, review: 1, ok: 2 };
    const rows = P.slice().sort((a, b) => rank[a.status] - rank[b.status] || Number(b.direct) - Number(a.direct) || a.name.localeCompare(b.name));
    ctx.heading(`All packages (${P.length})`);
    drawTable(pdf, ctx, [
      { label: 'Package', w: 0.23, get: r => r.name, style: () => ({ bold: true }) },
      { label: 'Version', w: 0.1, get: r => r.version || r.spec || '–' },
      { label: 'Ecosystem', w: 0.11, get: r => r.ecosystem },
      { label: 'License', w: 0.2, get: r => r.license },
      { label: 'Status', w: 0.12, get: r => (r.ignored ? 'ignored' : r.status), style: r => (r.ignored ? null : STATUS_STYLE[r.status]) },
      { label: 'Scope', w: 0.12, get: r => `${r.direct ? 'direct' : 'transitive'}${r.dev ? ' dev' : ''}` },
      { label: 'Vulns', w: 0.12, get: r => r.vulnCount || '' },
    ], rows);
    return pdf.output('datauristring').split(',')[1];
  }

  function vulnPdf(D) {
    const R = D.dependencies;
    const V = (R.vulns && R.vulns.items) || [];
    const { pdf, ctx } = reportDoc('Vulnerability report', `${D.workspace || ''} · ${new Date(D.generated).toLocaleString()} · source: OSV.dev`);
    const sev = s => V.filter(v => v.severity === s).length;
    ctx.kpis([['Vulnerabilities', V.length], ['Critical', sev('CRITICAL'), [200, 40, 40]], ['High', sev('HIGH'), [224, 98, 27]], ['Medium', sev('MEDIUM'), [200, 130, 40]], ['Packages checked', R.vulns.checked || 0]]);
    if (R.vulns.error) ctx.para(`OSV.dev could not be reached: ${R.vulns.error}`, [200, 40, 40]);
    if (!V.length && !R.vulns.error) ctx.para('No known vulnerabilities were found in the checked packages.');
    const affected = new Map();
    for (const v of V) { const k = `${v.ecosystem}|${v.name}|${v.version}`; const e = affected.get(k) || { ...v, n: 0, fixed: new Set() }; e.n++; v.fixed.forEach(f => e.fixed.add(f)); affected.set(k, e); }
    if (affected.size) {
      ctx.heading('Affected packages – what to update');
      drawTable(pdf, ctx, [
        { label: 'Package', w: 0.3, get: r => `${r.name}@${r.version}`, style: () => ({ bold: true }) },
        { label: 'Eco', w: 0.1, get: r => r.ecosystem },
        { label: 'Scope', w: 0.14, get: r => `${r.direct ? 'direct' : 'transitive'}${r.dev ? ' dev' : ''}` },
        { label: 'Advisories', w: 0.12, get: r => r.n },
        { label: 'Update to (fixed in)', w: 0.34, get: r => [...r.fixed].join(', ') || '–' },
      ], [...affected.values()].sort((a, b) => b.n - a.n));
    }
    if (V.length) {
      ctx.heading(`Advisories (${V.length})`);
      drawTable(pdf, ctx, [
        { label: 'Severity', w: 0.13, get: r => `${r.severity}${r.score != null ? ' ' + r.score.toFixed(1) : ''}`, style: r => SEV_STYLE[r.severity] || SEV_STYLE.UNKNOWN },
        { label: 'Package', w: 0.2, get: r => `${r.name}@${r.version}\n${r.ecosystem}${r.direct ? '' : ' · transitive'}` },
        { label: 'Advisory', w: 0.2, get: r => [r.id, ...(r.aliases || [])].join('\n') },
        { label: 'Summary', w: 0.35, get: r => r.summary || '' },
        { label: 'Fixed in', w: 0.12, get: r => (r.fixed || []).join(', ') || '–' },
      ], V);
    }
    if (R.vulns.unresolved && R.vulns.unresolved.length) {
      ctx.heading('Not checked (no exact version installed or pinned)');
      ctx.para(R.vulns.unresolved.join(', '));
    }
    return pdf.output('datauristring').split(',')[1];
  }

  const SECRET_STYLE = {
    critical: { fill: [255, 77, 79], color: [255, 255, 255], bold: true },
    high: { fill: [224, 98, 27], color: [255, 255, 255], bold: true },
    medium: { fill: [247, 174, 98], color: [40, 25, 10], bold: true },
    low: { fill: [200, 200, 200], color: [30, 30, 30] },
  };

  function healthPdf(D) {
    const H = D.health;
    const { pdf, ctx } = reportDoc('Code health report', `${D.workspace || ''} · ${new Date(D.generated).toLocaleString()}`);
    const gradeColor = H.score >= 80 ? [90, 90, 90] : H.score >= 65 ? [200, 130, 40] : H.score >= 50 ? [224, 98, 27] : [200, 40, 40];
    ctx.kpis([['Grade', `${H.grade} (${H.score})`, gradeColor], ['Functions', H.functions], ['Too complex', H.overComplex, H.overComplex ? [224, 98, 27] : null],
      ['Too long', H.overLong], ['Duplicated', H.duplicates ? H.duplicates.percent.toFixed(1) + '%' : 'off'], ['Secrets', H.secrets ? H.secrets.total : 'off', H.secrets && H.secrets.total ? [200, 40, 40] : null]]);
    ctx.para(`Thresholds: complexity > ${H.thresholds.maxComplexity}, function length > ${H.thresholds.maxFunctionLines} lines, duplicates of ${H.thresholds.duplicateMinLines}+ lines (linecounter.health.*). Average complexity ${H.avgComplexity.toFixed(1)}, maximum ${H.maxComplexity}.`);
    ctx.heading('Complexity distribution');
    drawTable(pdf, ctx, [
      { label: 'Cyclomatic complexity', w: 0.5, get: r => r.label },
      { label: 'Functions', w: 0.25, get: r => r.count },
      { label: 'Share', w: 0.25, get: r => (H.functions ? ((r.count / H.functions) * 100).toFixed(1) + '%' : '–') },
    ], H.complexityBuckets);
    const cxStyle = r => (r.complexity > H.thresholds.maxComplexity * 2 ? { fill: [255, 77, 79], color: [255, 255, 255], bold: true } : r.complexity > H.thresholds.maxComplexity ? { fill: [247, 174, 98], color: [40, 25, 10], bold: true } : null);
    const lenStyle = r => (r.lines > H.thresholds.maxFunctionLines ? { fill: [247, 174, 98], color: [40, 25, 10], bold: true } : null);
    const fnCols = [
      { label: 'Function', w: 0.24, get: r => r.name + '()', style: () => ({ bold: true }) },
      { label: 'File', w: 0.46, get: r => `${r.path}:${r.line}` },
      { label: 'Complexity', w: 0.11, get: r => r.complexity, style: cxStyle },
      { label: 'Lines', w: 0.1, get: r => r.lines, style: lenStyle },
      { label: 'Params', w: 0.09, get: r => r.params },
    ];
    ctx.heading('Most complex functions – refactor these first');
    drawTable(pdf, ctx, fnCols, H.complex.slice(0, 40));
    ctx.heading('Longest functions');
    drawTable(pdf, ctx, fnCols, H.long.slice(0, 25));
    if (H.manyParams.length) { ctx.heading('Functions with 6+ parameters'); drawTable(pdf, ctx, fnCols, H.manyParams); }
    if (H.hotspots.length) {
      ctx.heading('Hotspot files');
      drawTable(pdf, ctx, [
        { label: 'File', w: 0.55, get: r => r.path },
        { label: 'Functions', w: 0.15, get: r => r.functions },
        { label: 'Total complexity', w: 0.15, get: r => r.complexity },
        { label: 'Worst', w: 0.15, get: r => r.maxComplexity, style: r => cxStyle({ complexity: r.maxComplexity }) },
      ], H.hotspots);
    }
    if (H.risk && H.risk.files.length) {
      ctx.heading('Risk hotspots – often changed AND complex');
      drawTable(pdf, ctx, [
        { label: 'Risk', w: 0.1, get: r => r.risk, style: r => (r.risk >= 60 ? { fill: [255, 77, 79], color: [255, 255, 255], bold: true } : r.risk >= 35 ? { fill: [247, 174, 98], color: [40, 25, 10], bold: true } : null) },
        { label: 'File', w: 0.5, get: r => r.path },
        { label: 'Commits', w: 0.13, get: r => r.churn },
        { label: 'Complexity', w: 0.14, get: r => r.complexity },
        { label: 'Lines', w: 0.13, get: r => r.lines },
      ], H.risk.files.slice(0, 25));
    }
    if (H.deadCode && H.deadCode.items.length) {
      ctx.heading(`Possibly unused functions (${H.deadCode.total})`);
      drawTable(pdf, ctx, [
        { label: 'Function', w: 0.3, get: r => r.name + '()', style: () => ({ bold: true }) },
        { label: 'File', w: 0.5, get: r => `${r.path}:${r.line}` },
        { label: 'Lines', w: 0.08, get: r => r.lines },
        { label: 'Scope', w: 0.12, get: r => (r.exported ? 'exported' : 'internal') },
      ], H.deadCode.items.slice(0, 80));
    }
    if (H.duplicates) {
      ctx.heading(`Duplicated code (${H.duplicates.total} blocks, ${H.duplicates.duplicatedLines} lines)`);
      if (!H.duplicates.groups.length) ctx.para('No duplicated blocks found.');
      else drawTable(pdf, ctx, [
        { label: 'Lines', w: 0.1, get: r => r.lines, style: () => ({ bold: true }) },
        { label: 'First occurrence', w: 0.45, get: r => `${r.occurrences[0].path}:${r.occurrences[0].line}-${r.occurrences[0].end}` },
        { label: 'Copy', w: 0.45, get: r => `${r.occurrences[1].path}:${r.occurrences[1].line}-${r.occurrences[1].end}` },
      ], H.duplicates.groups.slice(0, 80));
    }
    if (H.secrets && H.secrets.total) {
      ctx.heading(`Hard-coded secrets (${H.secrets.total}) – details in the secrets report`);
      ctx.para(H.secrets.byRule.map(r => `${r.label}: ${r.count}`).join(' · '));
    }
    return pdf.output('datauristring').split(',')[1];
  }

  function secretsPdf(D) {
    const S = D.health && D.health.secrets;
    const { pdf, ctx } = reportDoc('Secrets report', `${D.workspace || ''} · ${new Date(D.generated).toLocaleString()}`);
    if (!S) { ctx.para('Secret scanning is disabled (linecounter.secrets.enabled).'); return pdf.output('datauristring').split(',')[1]; }
    ctx.kpis([['Findings', S.total, S.total ? [200, 40, 40] : null], ['Critical', S.bySeverity.critical, [200, 40, 40]], ['High', S.bySeverity.high, [224, 98, 27]], ['Medium', S.bySeverity.medium, [200, 130, 40]]]);
    ctx.para('Values are masked. Every real credential that was committed must be rotated (revoked and replaced) – removing it from the file does not remove it from the git history. Move secrets to environment variables or a secret manager, and ignore test fixtures via linecounter.secrets.ignore.');
    if (!S.items.length) { ctx.para('No hard-coded secrets were found.'); return pdf.output('datauristring').split(',')[1]; }
    ctx.heading('By type');
    drawTable(pdf, ctx, [{ label: 'Type', w: 0.7, get: r => r.label }, { label: 'Findings', w: 0.3, get: r => r.count }], S.byRule);
    ctx.heading('Findings');
    drawTable(pdf, ctx, [
      { label: 'Severity', w: 0.12, get: r => r.severity, style: r => SECRET_STYLE[r.severity] },
      { label: 'Type', w: 0.22, get: r => r.name },
      { label: 'Location', w: 0.36, get: r => `${r.path}:${r.line}` },
      { label: 'Match (masked)', w: 0.3, get: r => r.preview },
    ], S.items);
    return pdf.output('datauristring').split(',')[1];
  }

  window.LCExport = { openDialog, createPdf, licensePdf, vulnPdf, healthPdf, secretsPdf };
})();
