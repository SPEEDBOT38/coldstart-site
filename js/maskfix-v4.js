/* Cutout editor: shows the two segmentation outlines, lets a person paint keep/remove, then re-renders with that mask. */
(function () {
  const C = () => window.CS, Id = () => window.Identity, St = () => window.Studio;
  const toast = (m) => (window.AppV4 && window.AppV4.toast ? window.AppV4.toast(m) : alert(m));
  const loadImg = (u) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Image failed to load.')); i.src = u; });
  async function open(asset) {
    const store = window.AppV4 && window.AppV4.store ? window.AppV4.store() : null;
    const S = (window.CS && window.CS.S) || {}; const sku = (S.skus || []).find((s) => s.id === asset.skuId);
    const d = document.getElementById('dlg'); d.setAttribute('aria-label', 'Fix cutout');
    d.innerHTML = '<div class="dlg-h"><h2 class="disp s">Fix cutout</h2></div><div class="dlg-b"><p class="sub">Loading outlines…</p></div>'; d.showModal();
    try {
      const m = await Id().masterOf(sku), ref = await St().media.get(sku.refs[0].id);
      const mt = await window.CS.ops.post('matteFor', { masterId: m.id, reference: ref });
      const img = await loadImg(ref), W = img.naturalWidth, H = img.naturalHeight, scale = Math.min(1, 520 / W);
      const mats = { primary: await loadImg(mt.primary.matte), second: mt.second ? await loadImg(mt.second.matte) : null };
      const mask = document.createElement('canvas'); mask.width = W; mask.height = H; const mx = mask.getContext('2d');
      const draw = document.createElement('canvas'); draw.width = W; draw.height = H; draw.style.cssText = 'width:' + W * scale + 'px;height:' + H * scale + 'px;touch-action:none;cursor:crosshair;border:1px solid var(--line,#ccc)';
      const dx = draw.getContext('2d'); let mode = 'keep', size = Math.max(6, Math.round(W / 40)), base = 'primary';
      const setBase = (k) => { base = k; mx.fillStyle = '#000'; mx.fillRect(0, 0, W, H); mx.drawImage(mats[k], 0, 0, W, H); render(); };
      const render = () => { dx.clearRect(0, 0, W, H); dx.drawImage(img, 0, 0); const t = document.createElement('canvas'); t.width = W; t.height = H; const tx = t.getContext('2d'); tx.drawImage(mask, 0, 0); const id = tx.getImageData(0, 0, W, H), p = id.data; for (let i = 0; i < p.length; i += 4) { const v = p[i]; p[i] = 220; p[i + 1] = 30; p[i + 2] = 60; p[i + 3] = Math.round((255 - v) * 0.55); } tx.putImageData(id, 0, 0); dx.drawImage(t, 0, 0); };
      d.innerHTML = '<div class="dlg-h"><h2 class="disp s">Fix cutout</h2></div><div class="dlg-b" style="display:grid;gap:10px"><p class="sub">Red areas will be removed. Models agree: ' + (mt.agreement_iou == null ? 'n/a' : mt.agreement_iou) + '. Paint <b>Keep</b> over parts of the product that are red, and <b>Remove</b> over background that is not.</p><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn ghost" data-b="primary" type="button">Outline: ' + mt.primary.model + '</button>' + (mats.second ? '<button class="btn ghost" data-b="second" type="button">Outline: ' + mt.second.model + '</button>' : '') + '<button class="btn ghost" data-m="keep" type="button">Keep</button><button class="btn ghost" data-m="remove" type="button">Remove</button><label class="field" style="display:inline-flex;gap:6px;align-items:center">Brush <input id="mf-sz" type="range" min="2" max="' + Math.round(W / 8) + '" value="' + size + '"></label></div><div id="mf-c"></div><div id="mf-e"></div></div><div class="dlg-f"><button class="btn ghost" id="mf-x" type="button">Cancel</button><button class="btn yellow" id="mf-go" type="button">Re-render with this cutout</button></div>';
      d.querySelector('#mf-c').appendChild(draw);
      d.querySelectorAll('[data-b]').forEach((b) => b.onclick = () => setBase(b.dataset.b)); d.querySelectorAll('[data-m]').forEach((b) => b.onclick = () => { mode = b.dataset.m; }); d.querySelector('#mf-sz').oninput = (e) => { size = +e.target.value; };
      let down = false; const at = (e) => { const r = draw.getBoundingClientRect(); return [(e.clientX - r.left) * W / r.width, (e.clientY - r.top) * H / r.height]; };
      const stroke = (e) => { const [x, y] = at(e); mx.fillStyle = mode === 'keep' ? '#fff' : '#000'; mx.beginPath(); mx.arc(x, y, size, 0, 7); mx.fill(); render(); };
      draw.onpointerdown = (e) => { down = true; draw.setPointerCapture(e.pointerId); stroke(e); }; draw.onpointermove = (e) => { if (down) stroke(e); }; draw.onpointerup = () => { down = false; };
      d.querySelector('#mf-x').onclick = () => d.close();
      d.querySelector('#mf-go').onclick = async () => { const btn = d.querySelector('#mf-go'); btn.disabled = true; btn.textContent = 'Rendering…'; try { const r = await Id().generateLocked({ sku, ratio: asset.spec.ratio, scene: asset.spec.scene, mask: mask.toDataURL('image/png') }); d.close(); toast('Re-rendered with your cutout. Compare it before approving.'); window.AppV4.route(); Id().compare(r.asset.id); } catch (e) { btn.disabled = false; btn.textContent = 'Re-render with this cutout'; d.querySelector('#mf-e').innerHTML = '<div class="err">' + String(e.message).replace(/</g, '&lt;') + '</div>'; } };
      setBase('primary');
    } catch (e) { d.innerHTML = '<div class="dlg-h"><h2 class="disp s">Fix cutout</h2></div><div class="dlg-b"><div class="err">' + String(e.message).replace(/</g, '&lt;') + '</div></div><div class="dlg-f"><button class="btn" id="mf-x" type="button">Close</button></div>'; d.querySelector('#mf-x').onclick = () => d.close(); }
  }
  window.MaskFix = { open };
})();
