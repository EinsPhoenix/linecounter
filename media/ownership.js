// @ts-check
// "Ownership" section: who owns which code (git), stale files, knowledge at risk.
(function () {
  const ago = d => (d >= 730 ? `${(d / 365).toFixed(1)} years` : d >= 60 ? `${Math.round(d / 30)} months` : `${d} days`);

  function render(ui, D) {
    const O = D.ownership;
    if (!O) return '';
    const { esc, fmt, card, tiles, hbars, columns, tipAttr } = ui;
    const colors = window.LCGraphs ? LCGraphs.palette(O.owners.map(o => o.name)) : new Map();
    const colorOf = n => colors.get(n) || '#8a8a8a';
    const bus1 = O.folders.filter(f => f.busFactor === 1 && f.owners.length).length;
    const folderRows = O.folders.map(f => `<tr>
      <td class="hl-path">${esc(f.folder)}/</td><td class="num">${fmt(f.files)}</td><td class="num">${fmt(f.lines)}</td>
      <td><div class="own-bar">${f.owners.map(o => `<span style="flex:${o.share};background:${colorOf(o.name)}" ${tipAttr(`<b>${esc(o.name)}</b><br>${o.share}% of the lines in ${esc(f.folder)}/`)}></span>`).join('')}</div>
        <span class="muted own-top">${esc(f.owners[0] ? f.owners[0].name : '')} ${f.owners[0] ? f.owners[0].share + '%' : ''}</span></td>
      <td class="num">${f.busFactor === 1 ? '<span class="dep-bad">1</span>' : fmt(f.busFactor)}</td></tr>`).join('');
    return `${tiles([
        { label: 'Code owners', value: fmt(O.owners.length), sub: `${fmt(O.files)} tracked files` },
        { label: 'Stale files', html: `<span class="${O.staleCount ? 'dep-bad' : ''}">${fmt(O.staleCount)}</span>`, sub: `no commit for ${fmt(O.staleDays)}+ days · ${fmt(O.staleLines)} lines` },
        { label: 'Knowledge at risk', html: `<span class="${O.atRiskCount ? 'dep-bad' : ''}">${fmt(O.atRiskCount)}</span>`, sub: 'main author inactive for 6+ months' },
        { label: 'Bus factor 1 folders', value: fmt(bus1), sub: 'one person wrote most of it' },
      ])}
      <div class="grid-2 hl-bottom">
        ${card('Who owns the code', hbars(O.owners.slice(0, 12).map(o => ({ label: o.name, value: o.lines, color: colorOf(o.name), tip: `<b>${esc(o.name)}</b><br>main author of ${fmt(o.files)} files · ${fmt(o.lines)} lines${o.lastCommit ? `<br>last commit ${new Date(o.lastCommit).toLocaleDateString()}` : ''}` }))), { sub: 'lines of files where they are the main author' })}
        ${card('Last change per file', columns(O.ages.map(a => ({ label: a.label, value: a.count })), { color: '#e0621b' }), { sub: 'from git history' })}
      </div>
      ${card('Ownership per folder', `<div class="table-scroll small"><table class="grid"><thead><tr><th>Folder</th><th class="num">Files</th><th class="num">Lines</th><th>Owners</th><th class="num" title="How many people wrote half of it">Bus factor</th></tr></thead><tbody>${folderRows}</tbody></table></div>`)}
      <div class="grid-2 hl-bottom">
        ${card(`Stale files <span class="dep-chip ${O.staleCount ? 'warn' : ''}">${fmt(O.staleCount)}</span>`, O.stale.length ? `<div class="table-scroll small"><table class="grid"><thead><tr><th>File</th><th>Last change</th><th>Owner</th></tr></thead><tbody>${O.stale.slice(0, 100).map(r => `<tr class="clickable" data-abs="${esc(r.abs)}"><td class="hl-path">${esc(r.path)}</td><td>${ago(r.ageDays)} ago</td><td>${esc(r.owner)}</td></tr>`).join('')}</tbody></table></div>` : `<p class="dep-okmsg">Every file changed within the last ${fmt(O.staleDays)} days.</p>`, { sub: `untouched for ${fmt(O.staleDays)}+ days – still needed?` })}
        ${card(`Knowledge at risk <span class="dep-chip ${O.atRiskCount ? 'bad' : ''}">${fmt(O.atRiskCount)}</span>`, O.atRisk.length ? `<div class="table-scroll small"><table class="grid"><thead><tr><th>File</th><th>Main author</th><th class="num">Share</th><th>Inactive</th></tr></thead><tbody>${O.atRisk.slice(0, 100).map(r => `<tr class="clickable" data-abs="${esc(r.abs)}"><td class="hl-path">${esc(r.path)}</td><td>${esc(r.owner)}</td><td class="num">${r.share}%</td><td>${ago(r.ownerGoneDays)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="dep-okmsg">The main authors of all files are still active.</p>', { sub: 'written mostly by someone who stopped committing' })}
      </div>`;
  }

  function rants(ui, D) {
    const O = D.ownership;
    if (!O) return [];
    const out = [];
    if (O.atRiskCount >= 3) out.push(['🧳', `${ui.fmt(O.atRiskCount)} files were written mostly by people who stopped committing. Hope they left good comments. (They didn't.)`]);
    if (O.staleCount >= 10) out.push(['🕸️', `${ui.fmt(O.staleCount)} files haven't been touched in over ${Math.round(O.staleDays / 30)} months. Archaeologists welcome.`]);
    return out;
  }

  window.LCOwnership = { render, rants };
})();
