// ============================================================
// EBR — app.js  (application principale)
// Utilise Supabase pour toutes les données
// ============================================================

import {
  supabase, login, logout, getCurrentUser, loadRefData,
  updateConfig, addEtab, updateEtab, deleteEtab,
  addCentre, updateCentre, deleteCentre,
  getMatieresBepc, getMatieresBac, addMatiereBepc,
  getCandidatsBepc, addCandidatBepc, updateCandidatBepc,
  deleteCandidatBepc, validerBepc, deverrouillerBepc,
  upsertCandidatsBepc, getNotesBepc, upsertNoteBepc, importNotesBepc,
  getCandidatsBac, addCandidatBac, updateCandidatBac,
  deleteCandidatBac, validerBac, deverrouillerBac,
  upsertCandidatsBac, getNotesBac, upsertNoteBac, importNotesBac,
  uploadPhoto, getProfiles, updateProfile
} from './supabase.js';

// ─── ÉTAT GLOBAL ─────────────────────────────────────────────
let G = {
  user:      null,   // utilisateur connecté
  role:      null,   // 'admin' | 'operateur'
  ref:       {},     // données de référence (config, etabs, centres, matieres)
  page:      'dashboard',
  // cache local des notes en cours de saisie (évite trop d'appels API)
  notesCache: {},
};

// ─── UTILITAIRES ─────────────────────────────────────────────
function loading(msg = 'Chargement...') {
  return `<div class="loading"><div class="spinner"></div>${msg}</div>`;
}

function badge(txt, cls) {
  return `<span class="badge badge-${cls}">${txt}</span>`;
}

function decisionBadge(d) {
  if (d === 'Admis')   return badge('✓ Admis',  'green');
  if (d === 'Refusé')  return badge('✗ Refusé', 'red');
  if (d === 'Absent')  return badge('● Absent', 'gray');
  return badge(d, 'gray');
}

function getEtabNom(id) {
  const e = (G.ref.etablissements||[]).find(x => x.id === id);
  return e ? e.nom : id || '—';
}
function getCentreNom(id) {
  const c = (G.ref.centres||[]).find(x => x.id === id);
  return c ? c.nom : id || '—';
}

function calcMoyenneBepc(notes, inaptEPS, artsPlastiques) {
  const mats = G.ref.matBepc || [];
  let pts = 0, coef = 0;
  for (const m of mats) {
    if (m.facultatif && !artsPlastiques) continue;
    if (m.id === 'MB08' && inaptEPS) continue;
    const n = notes[m.id];
    if (n !== undefined && n !== null) { pts += n * m.coef; coef += m.coef; }
  }
  return coef === 0 ? { pts: 0, coef: 0, moy: null }
    : { pts: Math.round(pts*100)/100, coef, moy: Math.round(pts/coef*100)/100 };
}

function calcMoyenneBac(notes, serie, inaptEPS) {
  const mats = (G.ref.matBac||{})[serie] || [];
  let pts = 0, coef = 0;
  for (const m of mats) {
    if (m.id.endsWith('_10') && inaptEPS) continue;
    const n = notes[m.id];
    if (n !== undefined && n !== null) { pts += n * m.coef; coef += m.coef; }
  }
  return coef === 0 ? { pts: 0, coef: 0, moy: null }
    : { pts: Math.round(pts*100)/100, coef, moy: Math.round(pts/coef*100)/100 };
}

function getDecision(moy, absent) {
  if (absent) return 'Absent';
  if (moy === null) return '—';
  return moy >= 10 ? 'Admis' : 'Refusé';
}

function showToast(msg, type = 'success') {
  let t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    t.style.cssText = 'position:fixed;bottom:24px;right:24px;padding:12px 20px;border-radius:8px;font-size:13px;font-weight:500;z-index:9999;transition:opacity .3s;box-shadow:0 4px 16px rgba(0,0,0,.15)';
    document.body.appendChild(t);
  }
  t.style.background = type === 'success' ? '#1a6b3a' : type === 'error' ? '#8b1a1a' : '#1a4a8a';
  t.style.color = '#fff';
  t.textContent = msg;
  t.style.opacity = '1';
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.style.opacity = '0'; }, 3000);
}

// ─── AUTH ─────────────────────────────────────────────────────
window.doLogin = async function() {
  const email = document.getElementById('loginEmail').value.trim();
  const pwd   = document.getElementById('loginPwd').value;
  const btn   = document.getElementById('loginBtn');
  const err   = document.getElementById('loginError');
  if (!email || !pwd) { err.style.display='flex'; err.textContent='Remplissez tous les champs.'; return; }
  btn.disabled = true; btn.textContent = 'Connexion...';
  err.style.display = 'none';
  try {
    await login(email, pwd);
    await initApp();
  } catch(e) {
    err.style.display = 'flex'; err.textContent = 'Email ou mot de passe incorrect.';
    btn.disabled = false; btn.textContent = 'Se connecter';
  }
};

document.getElementById('loginPwd').addEventListener('keydown', e => {
  if (e.key === 'Enter') window.doLogin();
});

window.doLogout = async function() {
  if (!confirm('Se déconnecter ?')) return;
  await logout();
  location.reload();
};

// ─── INITIALISATION ──────────────────────────────────────────
async function initApp() {
  G.user = await getCurrentUser();
  if (!G.user) { document.getElementById('loginScreen').style.display='flex'; return; }
  G.role = G.user.profile?.role || 'operateur';

  // Charger les données de référence
  try { G.ref = await loadRefData(); } catch(e) { G.ref = {}; }

  // Afficher l'interface
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('appScreen').style.display   = 'flex';

  // Sidebar utilisateur
  const nom = G.user.profile?.nom || G.user.email || 'Utilisateur';
  document.getElementById('sbNom').textContent    = nom;
  document.getElementById('sbRole').textContent   = G.role === 'admin' ? 'Administrateur' : 'Opérateur';
  document.getElementById('sbAvatar').textContent = nom.split(' ').map(w=>w[0]).join('').substring(0,2).toUpperCase();

  // Masquer la section admin pour les opérateurs
  if (G.role !== 'admin') document.getElementById('adminSection').style.display = 'none';

  nav('dashboard');
}

// Vérifier si déjà connecté au chargement
(async () => {
  const { data: { session } } = await supabase.auth.getSession();
  if (session) { await initApp(); }
  else { document.getElementById('loginScreen').style.display = 'flex'; }
})();

// ─── NAVIGATION ──────────────────────────────────────────────
window.nav = function(page) {
  G.page = page;
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(el => {
    if (el.getAttribute('onclick')?.includes(`'${page}'`)) el.classList.add('active');
  });
  const c = document.getElementById('content');
  c.className = 'fade-in'; void c.offsetWidth;
  renderPage(page);
};

async function renderPage(page) {
  const c = document.getElementById('content');
  c.innerHTML = loading();
  const pages = {
    dashboard:      renderDashboard,
    candidats:      renderCandidats,
    etablissements: renderEtablissements,
    centres:        renderCentres,
    matieres:       renderMatieres,
    'saisie-bepc':  renderSaisieBepc,
    'saisie-bac':   renderSaisieBac,
    'import-notes': renderImportNotes,
    bilan:          renderBilan,
    statistiques:   renderStatistiques,
    classement:     renderClassement,
    releves:        renderReleves,
    'bilan-eleve':  renderBilanEleve,
    utilisateurs:   renderUtilisateurs,
    parametres:     renderParametres,
  };
  const fn = pages[page];
  if (fn) { try { c.innerHTML = await fn(); } catch(e) { c.innerHTML = `<div class="alert alert-danger">Erreur : ${e.message}</div>`; } }
  else c.innerHTML = '<div class="card">Page en construction</div>';
}

// ─── MODAL ────────────────────────────────────────────────────
window.showModal = function(title, body, actions = []) {
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalBody').innerHTML    = body;
  document.getElementById('modalFooter').innerHTML  = actions.map((a,i) =>
    `<button class="btn ${a.cls}" id="modalBtn${i}">${a.label}</button>`
  ).join('');
  actions.forEach((a,i) => {
    document.getElementById(`modalBtn${i}`).onclick = a.action;
  });
  document.getElementById('modalOverlay').style.display = 'flex';
};

window.closeModal = function() {
  document.getElementById('modalOverlay').style.display = 'none';
};

window.closeModalOverlay = function(e) {
  if (e.target === document.getElementById('modalOverlay')) closeModal();
};

document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

// ─────────────────────────────────────────────────────────────
// PARTIE I — DASHBOARD
// ─────────────────────────────────────────────────────────────
async function renderDashboard() {
  const [bepc, bac] = await Promise.all([
    getCandidatsBepc(),
    getCandidatsBac(),
  ]);
  const etabs   = G.ref.etablissements || [];
  const centres = G.ref.centres        || [];
  const annee   = G.ref.config?.annee  || '—';

  // Pour les stats on a besoin des notes — on calcule sur les validés seulement
  // (les notes non chargées donnent moy=null donc pas comptés dans admis)
  const total      = bepc.length + bac.length;
  const valides    = [...bepc,...bac].filter(c=>c.valide).length;
  const progression = total > 0 ? Math.round(valides/total*100) : 0;

  const serieStats = ['A1','A2','C','D'].map(s => {
    const sc = bac.filter(c=>c.serie===s);
    return { s, total:sc.length, valides:sc.filter(c=>c.valide).length };
  });

  return `
    <div class="page-header">
      <div>
        <div class="page-title">Tableau de bord</div>
        <div class="page-subtitle">Année scolaire ${annee} · EBR</div>
      </div>
      <div class="header-actions">
        <button class="btn btn-primary btn-sm" onclick="nav('saisie-bepc')">✏️ Saisie notes</button>
      </div>
    </div>

    <div class="dash-grid">
      <div class="stat-card stat-accent">
        <div class="stat-value">${total}</div>
        <div class="stat-label">Total candidats</div>
        <div class="stat-sub">${bepc.length} BEPC · ${bac.length} BAC</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${valides}</div>
        <div class="stat-label">Fiches traitées</div>
        <div class="stat-sub">${total - valides} en attente</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${etabs.length}</div>
        <div class="stat-label">Établissements</div>
        <div class="stat-sub">${centres.length} centres</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${progression}%</div>
        <div class="stat-label">Progression globale</div>
        <div class="progress-bar" style="margin-top:8px"><div class="progress-fill pf-green" style="width:${progression}%"></div></div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">
      <div class="card">
        <div class="card-title">Saisie BEPC</div>
        <div style="display:flex;justify-content:space-between;margin-bottom:6px">
          <span style="font-size:13px">${bepc.filter(c=>c.valide).length} / ${bepc.length} traitées</span>
          <span class="badge badge-blue">${bepc.length>0?Math.round(bepc.filter(c=>c.valide).length/bepc.length*100):0}%</span>
        </div>
        <div class="progress-bar"><div class="progress-fill" style="width:${bepc.length>0?bepc.filter(c=>c.valide).length/bepc.length*100:0}%"></div></div>
      </div>
      <div class="card">
        <div class="card-title">BAC par série</div>
        ${serieStats.map(r=>`
          <div style="display:flex;align-items:center;gap:10px;padding:5px 0;border-bottom:1px solid var(--border)">
            <span class="badge badge-${r.s==='C'?'red':r.s==='D'?'amber':r.s==='A1'?'green':'blue'}" style="width:38px;justify-content:center">Sér.${r.s}</span>
            <span style="flex:1;font-size:13px">${r.total} candidats</span>
            <span class="badge badge-gray">${r.valides} traités</span>
          </div>`).join('')}
      </div>
    </div>

    <div class="card">
      <div class="card-title">Accès rapide</div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn btn-outline" onclick="nav('candidats')">👥 Candidats</button>
        <button class="btn btn-outline" onclick="nav('saisie-bepc')">✏️ Saisie BEPC</button>
        <button class="btn btn-outline" onclick="nav('saisie-bac')">✏️ Saisie BAC</button>
        <button class="btn btn-outline" onclick="nav('bilan')">📊 Bilans</button>
        <button class="btn btn-outline" onclick="nav('classement')">🏆 Classement</button>
        <button class="btn btn-outline" onclick="nav('releves')">📄 Relevés</button>
      </div>
    </div>`;
}

// ─────────────────────────────────────────────────────────────
// PARTIE I — CANDIDATS
// ─────────────────────────────────────────────────────────────
async function renderCandidats() {
  const [bepc, bac] = await Promise.all([getCandidatsBepc(), getCandidatsBac()]);
  window._candBepc = bepc; window._candBac = bac; window._candTab = 'bepc';
  return `
    <div class="page-header">
      <div>
        <div class="page-title">Candidats</div>
        <div class="page-subtitle">${bepc.length} BEPC · ${bac.length} BAC</div>
      </div>
      <div class="header-actions">
        <button class="btn btn-outline btn-sm" onclick="downloadModeleCand('bepc')">⬇ Modèle BEPC</button>
        <button class="btn btn-outline btn-sm" onclick="downloadModeleCand('bac')">⬇ Modèle BAC</button>
        <button class="btn btn-outline btn-sm" onclick="showImportCandidats()">📂 Importer</button>
        ${G.role==='admin'?`<button class="btn btn-primary btn-sm" onclick="showAddCandidat()">+ Ajouter</button>`:''}
      </div>
    </div>
    <div class="tabs">
      <div class="tab active" id="tabCBepc" onclick="switchCandTab('bepc')">BEPC (${bepc.length})</div>
      <div class="tab" id="tabCBac" onclick="switchCandTab('bac')">BAC (${bac.length})</div>
    </div>
    <div id="candContent">${renderCandTable(bepc, 'bepc')}</div>`;
}

function renderCandTable(list, type) {
  const isBac = type === 'bac';
  const centres = G.ref.centres || [];
  return `
    <div class="search-bar">
      <input class="search-input" id="candSearch" placeholder="Rechercher nom, matricule, N° table..."
        oninput="filterCandidats('${type}')"/>
      ${isBac?`<select class="form-select" style="width:auto" id="candSerie" onchange="filterCandidats('${type}')">
        <option value="">Toutes les séries</option>
        <option>A1</option><option>A2</option><option>C</option><option>D</option>
      </select>`:''}
      <select class="form-select" style="width:auto" id="candCentre" onchange="filterCandidats('${type}')">
        <option value="">Tous les centres</option>
        ${centres.map(c=>`<option value="${c.id}">${c.nom}</option>`).join('')}
      </select>
    </div>
    <div class="table-wrap"><table>
      <thead><tr>
        <th>N° Table</th><th>Matricule</th><th>Nom & Prénoms</th>
        <th>Sexe</th><th>Classe</th>${isBac?'<th>Série</th>':''}
        <th>Établissement</th><th>Centre</th><th>Statut</th><th>Actions</th>
      </tr></thead>
      <tbody id="candTbody">${renderCandRows(list, type)}</tbody>
    </table></div>`;
}

function renderCandRows(list, type) {
  if (!list.length) return `<tr><td colspan="10" style="text-align:center;padding:32px;color:var(--text3)">Aucun candidat</td></tr>`;
  return list.map(c => `<tr>
    <td class="td-mono">${c.num_table}</td>
    <td class="td-mono">${c.matricule}</td>
    <td><strong>${c.nom}</strong> ${c.prenoms}</td>
    <td>${badge(c.sexe,'F'===c.sexe?'pink':'blue')}</td>
    <td>${c.classe}</td>
    ${type==='bac'?`<td>${badge(c.serie,c.serie==='C'?'red':c.serie==='D'?'amber':c.serie==='A1'?'green':'blue')}</td>`:''}
    <td style="max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${getEtabNom(c.etab_id)}</td>
    <td style="max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${getCentreNom(c.centre_id)}</td>
    <td>${c.valide?badge('✓ Validé','green'):badge('En attente','gray')}</td>
    <td style="white-space:nowrap">
      <button class="btn btn-xs btn-outline" onclick="editCandidat('${c.id}','${type}')">✏</button>
      ${G.role==='admin'?`<button class="btn btn-xs btn-danger" onclick="deleteCandidat('${c.id}','${type}')" style="margin-left:4px">✕</button>`:''}
    </td>
  </tr>`).join('');
}

window.switchCandTab = function(type) {
  window._candTab = type;
  document.getElementById('tabCBepc').classList.toggle('active', type==='bepc');
  document.getElementById('tabCBac').classList.toggle('active', type==='bac');
  const list = type === 'bepc' ? window._candBepc : window._candBac;
  document.getElementById('candContent').innerHTML = renderCandTable(list, type);
};

window.filterCandidats = function(type) {
  const q = (document.getElementById('candSearch')?.value||'').toLowerCase();
  const serie  = document.getElementById('candSerie')?.value  || '';
  const centre = document.getElementById('candCentre')?.value || '';
  let list = type === 'bepc' ? (window._candBepc||[]) : (window._candBac||[]);
  if (q) list = list.filter(c =>
    c.nom.toLowerCase().includes(q) || c.prenoms.toLowerCase().includes(q) ||
    c.matricule.toLowerCase().includes(q) || c.num_table.includes(q));
  if (serie)  list = list.filter(c => c.serie    === serie);
  if (centre) list = list.filter(c => c.centre_id === centre);
  document.getElementById('candTbody').innerHTML = renderCandRows(list, type);
};

window.showAddCandidat = function() {
  const etabs   = G.ref.etablissements || [];
  const centres = G.ref.centres        || [];
  const type    = window._candTab || 'bepc';
  showModal('Ajouter un candidat', `
    <div class="form-grid">
      <div class="form-group"><label class="form-label">Type</label>
        <select class="form-select" id="mc_type" onchange="toggleSerieField()">
          <option value="bepc" ${type==='bepc'?'selected':''}>BEPC</option>
          <option value="bac"  ${type==='bac'?'selected':''}>BAC</option>
        </select></div>
      <div class="form-group"><label class="form-label">N° Table <span class="form-required">*</span></label>
        <input class="form-input" id="mc_num" placeholder="001"/></div>
      <div class="form-group"><label class="form-label">Matricule <span class="form-required">*</span></label>
        <input class="form-input" id="mc_mat" placeholder="BEPC2025001"/></div>
      <div class="form-group"><label class="form-label">Nom <span class="form-required">*</span></label>
        <input class="form-input" id="mc_nom" placeholder="KONÉ"/></div>
      <div class="form-group"><label class="form-label">Prénoms <span class="form-required">*</span></label>
        <input class="form-input" id="mc_pre" placeholder="Aminata Marie"/></div>
      <div class="form-group"><label class="form-label">Sexe</label>
        <select class="form-select" id="mc_sx"><option value="M">Masculin</option><option value="F">Féminin</option></select></div>
      <div class="form-group"><label class="form-label">Classe <span class="form-required">*</span></label>
        <input class="form-input" id="mc_cls" placeholder="3eA ou TleD"/></div>
      <div class="form-group" id="serieField" style="${type==='bac'?'':'display:none'}">
        <label class="form-label">Série</label>
        <select class="form-select" id="mc_sr"><option value="A1">A1</option><option value="A2">A2</option><option value="C">C</option><option value="D">D</option></select></div>
      <div class="form-group"><label class="form-label">Établissement <span class="form-required">*</span></label>
        <select class="form-select" id="mc_etab"><option value="">Choisir...</option>
          ${etabs.map(e=>`<option value="${e.id}">${e.nom}</option>`).join('')}
        </select></div>
      <div class="form-group"><label class="form-label">Centre <span class="form-required">*</span></label>
        <select class="form-select" id="mc_ctr"><option value="">Choisir...</option>
          ${centres.map(c=>`<option value="${c.id}">${c.nom}</option>`).join('')}
        </select></div>
    </div>
    <div class="form-group"><label class="form-label">Photo</label>
      <input type="file" id="mc_photo" accept="image/*" class="form-input" style="padding:4px"/></div>`,
    [{ label:'Annuler', cls:'btn-outline', action: closeModal },
     { label:'Enregistrer', cls:'btn-primary', action: saveAddCandidat }]);
};

window.toggleSerieField = function() {
  const isBac = document.getElementById('mc_type')?.value === 'bac';
  document.getElementById('serieField').style.display = isBac ? '' : 'none';
};

window.saveAddCandidat = async function() {
  const type = document.getElementById('mc_type').value;
  const obj = {
    num_table:  document.getElementById('mc_num').value.trim(),
    matricule:  document.getElementById('mc_mat').value.trim(),
    nom:        document.getElementById('mc_nom').value.trim().toUpperCase(),
    prenoms:    document.getElementById('mc_pre').value.trim(),
    sexe:       document.getElementById('mc_sx').value,
    classe:     document.getElementById('mc_cls').value.trim(),
    etab_id:    document.getElementById('mc_etab').value,
    centre_id:  document.getElementById('mc_ctr').value,
  };
  if (type === 'bac') obj.serie = document.getElementById('mc_sr').value;
  if (!obj.num_table || !obj.matricule || !obj.nom || !obj.etab_id || !obj.centre_id) {
    alert('Remplissez tous les champs obligatoires'); return;
  }
  const photoFile = document.getElementById('mc_photo').files[0];
  try {
    if (photoFile) obj.photo_url = await uploadPhoto(photoFile, obj.matricule);
    if (type === 'bepc') await addCandidatBepc(obj);
    else                 await addCandidatBac(obj);
    closeModal(); showToast('Candidat ajouté !'); nav('candidats');
  } catch(e) { alert('Erreur : ' + e.message); }
};

window.editCandidat = async function(id, type) {
  const etabs   = G.ref.etablissements || [];
  const centres = G.ref.centres        || [];
  const list    = type === 'bepc' ? window._candBepc : window._candBac;
  const c       = list.find(x => x.id === id); if (!c) return;
  showModal('Modifier le candidat', `
    <div class="form-grid">
      <div class="form-group"><label class="form-label">N° Table</label>
        <input class="form-input" id="ec_num" value="${c.num_table}"/></div>
      <div class="form-group"><label class="form-label">Matricule</label>
        <input class="form-input" id="ec_mat" value="${c.matricule}"/></div>
      <div class="form-group"><label class="form-label">Nom</label>
        <input class="form-input" id="ec_nom" value="${c.nom}"/></div>
      <div class="form-group"><label class="form-label">Prénoms</label>
        <input class="form-input" id="ec_pre" value="${c.prenoms}"/></div>
      <div class="form-group"><label class="form-label">Sexe</label>
        <select class="form-select" id="ec_sx">
          <option value="M" ${c.sexe==='M'?'selected':''}>Masculin</option>
          <option value="F" ${c.sexe==='F'?'selected':''}>Féminin</option>
        </select></div>
      <div class="form-group"><label class="form-label">Classe</label>
        <input class="form-input" id="ec_cls" value="${c.classe}"/></div>
      ${type==='bac'?`<div class="form-group"><label class="form-label">Série</label>
        <select class="form-select" id="ec_sr">
          ${['A1','A2','C','D'].map(s=>`<option value="${s}" ${c.serie===s?'selected':''}>${s}</option>`).join('')}
        </select></div>`:''}
      <div class="form-group"><label class="form-label">Établissement</label>
        <select class="form-select" id="ec_etab">
          ${etabs.map(e=>`<option value="${e.id}" ${c.etab_id===e.id?'selected':''}>${e.nom}</option>`).join('')}
        </select></div>
      <div class="form-group"><label class="form-label">Centre</label>
        <select class="form-select" id="ec_ctr">
          ${centres.map(x=>`<option value="${x.id}" ${c.centre_id===x.id?'selected':''}>${x.nom}</option>`).join('')}
        </select></div>
    </div>
    <div class="form-group"><label class="form-label">Nouvelle photo (optionnel)</label>
      <input type="file" id="ec_photo" accept="image/*" class="form-input" style="padding:4px"/></div>
    ${c.photo_url?`<img src="${c.photo_url}" style="height:60px;margin-top:8px;border-radius:4px;border:1px solid var(--border)"/>`:''}`,
    [{ label:'Annuler', cls:'btn-outline', action: closeModal },
     { label:'Sauvegarder', cls:'btn-primary', action: () => saveEditCandidat(id, type) }]);
};

window.saveEditCandidat = async function(id, type) {
  const u = {
    num_table:  document.getElementById('ec_num').value.trim(),
    matricule:  document.getElementById('ec_mat').value.trim(),
    nom:        document.getElementById('ec_nom').value.trim().toUpperCase(),
    prenoms:    document.getElementById('ec_pre').value.trim(),
    sexe:       document.getElementById('ec_sx').value,
    classe:     document.getElementById('ec_cls').value.trim(),
    etab_id:    document.getElementById('ec_etab').value,
    centre_id:  document.getElementById('ec_ctr').value,
  };
  if (type === 'bac') u.serie = document.getElementById('ec_sr').value;
  const photoFile = document.getElementById('ec_photo').files[0];
  try {
    if (photoFile) u.photo_url = await uploadPhoto(photoFile, u.matricule);
    if (type === 'bepc') await updateCandidatBepc(id, u);
    else                 await updateCandidatBac(id, u);
    closeModal(); showToast('Candidat modifié !'); nav('candidats');
  } catch(e) { alert('Erreur : ' + e.message); }
};

window.deleteCandidat = async function(id, type) {
  if (!confirm('Supprimer ce candidat ?')) return;
  try {
    if (type === 'bepc') await deleteCandidatBepc(id);
    else                 await deleteCandidatBac(id);
    showToast('Candidat supprimé.');
    nav('candidats');
  } catch(e) { alert('Erreur : ' + e.message); }
};

window.downloadModeleCand = function(type) {
  const csv = type === 'bepc'
    ? 'num_table,matricule,nom,prenoms,sexe,classe,etab_id,centre_id\n001,BEPC2025001,NOM,Prenoms,M,3eA,ETB001,CTR001'
    : 'num_table,matricule,nom,prenoms,sexe,classe,serie,etab_id,centre_id\nB001,BAC2025001,NOM,Prenoms,M,TleD,D,ETB001,CTR001';
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download = `modele_candidats_${type}.csv`;
  a.click();
};

window.showImportCandidats = function() {
  showModal('Importer candidats (CSV)', `
    <div class="alert alert-info">Colonnes CSV : num_table, matricule, nom, prenoms, sexe, classe, [serie], etab_id, centre_id</div>
    <div class="form-group" style="margin:12px 0"><label class="form-label">Type</label>
      <select class="form-select" id="imp_type"><option value="bepc">BEPC</option><option value="bac">BAC</option></select></div>
    <div class="import-zone" onclick="document.getElementById('impFile').click()">
      <div class="import-icon">📂</div>
      <div class="import-title">Choisir fichier CSV</div>
      <div class="import-sub">Cliquez ou glissez-déposez</div>
    </div>
    <input type="file" id="impFile" accept=".csv" style="display:none" onchange="processImportCand(this)"/>`,
    [{ label:'Fermer', cls:'btn-outline', action: closeModal }]);
};

window.processImportCand = async function(input) {
  const file = input.files[0]; if (!file) return;
  const type = document.getElementById('imp_type').value;
  const text = await file.text();
  const lines = text.split('\n').filter(l=>l.trim());
  const headers = lines[0].split(',').map(h=>h.trim().toLowerCase());
  const rows = [];
  for (let i=1; i<lines.length; i++) {
    const vals = lines[i].split(',').map(v=>v.trim());
    const obj = {};
    headers.forEach((h,idx) => obj[h] = vals[idx]||'');
    if (!obj.matricule) continue;
    rows.push({
      num_table: obj.num_table||obj.numtable||String(i),
      matricule: obj.matricule,
      nom:       (obj.nom||'').toUpperCase(),
      prenoms:   obj.prenoms||'',
      sexe:      obj.sexe||'M',
      classe:    obj.classe||'',
      serie:     obj.serie||undefined,
      etab_id:   obj.etab_id||'',
      centre_id: obj.centre_id||'',
    });
  }
  try {
    if (type === 'bepc') await upsertCandidatsBepc(rows);
    else                 await upsertCandidatsBac(rows);
    closeModal(); showToast(`${rows.length} candidat(s) importé(s) !`); nav('candidats');
  } catch(e) { alert('Erreur import : ' + e.message); }
};

// ─────────────────────────────────────────────────────────────
// PARTIE I — ÉTABLISSEMENTS / CENTRES / MATIÈRES
// ─────────────────────────────────────────────────────────────
async function renderEtablissements() {
  const etabs = G.ref.etablissements || [];
  return `
    <div class="page-header">
      <div><div class="page-title">Établissements</div>
        <div class="page-subtitle">${etabs.length} établissements</div></div>
      <div class="header-actions">
        ${G.role==='admin'?`<button class="btn btn-primary btn-sm" onclick="showAddEtab()">+ Ajouter</button>`:''}
      </div>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>Code</th><th>Nom</th><th>Type</th><th>Commune</th><th>Actions</th></tr></thead>
      <tbody>${etabs.map(e=>`<tr>
        <td class="td-mono">${e.id}</td><td><strong>${e.nom}</strong></td>
        <td>${badge(e.type,e.type==='Lycée'?'blue':'teal')}</td>
        <td>${e.commune}</td>
        <td>${G.role==='admin'?`
          <button class="btn btn-xs btn-outline" onclick="showEditEtab('${e.id}')">✏</button>
          <button class="btn btn-xs btn-danger" onclick="doDeleteEtab('${e.id}')" style="margin-left:4px">✕</button>`:''}</td>
      </tr>`).join('')}</tbody>
    </table></div>`;
}

window.showAddEtab = function() {
  showModal('Ajouter établissement', `
    <div class="form-grid">
      <div class="form-group"><label class="form-label">Code *</label><input class="form-input" id="ae_id" placeholder="ETB006"/></div>
      <div class="form-group"><label class="form-label">Nom *</label><input class="form-input" id="ae_nom"/></div>
      <div class="form-group"><label class="form-label">Type</label>
        <select class="form-select" id="ae_type"><option>Lycée</option><option>Collège</option><option>Autre</option></select></div>
      <div class="form-group"><label class="form-label">Commune</label><input class="form-input" id="ae_com"/></div>
    </div>`,
    [{ label:'Annuler', cls:'btn-outline', action: closeModal },
     { label:'Enregistrer', cls:'btn-primary', action: async () => {
       const id  = document.getElementById('ae_id').value.trim();
       const nom = document.getElementById('ae_nom').value.trim();
       if (!id||!nom) { alert('Code et nom obligatoires'); return; }
       try {
         await addEtab({ id, nom, type:document.getElementById('ae_type').value, commune:document.getElementById('ae_com').value });
         G.ref = await loadRefData();
         closeModal(); showToast('Établissement ajouté !'); nav('etablissements');
       } catch(e) { alert(e.message); }
     }}]);
};

window.showEditEtab = function(id) {
  const e = (G.ref.etablissements||[]).find(x=>x.id===id); if (!e) return;
  showModal('Modifier établissement', `
    <div class="form-grid">
      <div class="form-group"><label class="form-label">Code</label><input class="form-input" value="${e.id}" disabled/></div>
      <div class="form-group"><label class="form-label">Nom</label><input class="form-input" id="ee_nom" value="${e.nom}"/></div>
      <div class="form-group"><label class="form-label">Type</label>
        <select class="form-select" id="ee_type">${['Lycée','Collège','Autre'].map(t=>`<option ${e.type===t?'selected':''}>${t}</option>`).join('')}</select></div>
      <div class="form-group"><label class="form-label">Commune</label><input class="form-input" id="ee_com" value="${e.commune}"/></div>
    </div>`,
    [{ label:'Annuler', cls:'btn-outline', action: closeModal },
     { label:'Sauvegarder', cls:'btn-primary', action: async () => {
       try {
         await updateEtab(id, { nom:document.getElementById('ee_nom').value, type:document.getElementById('ee_type').value, commune:document.getElementById('ee_com').value });
         G.ref = await loadRefData(); closeModal(); showToast('Modifié !'); nav('etablissements');
       } catch(e) { alert(e.message); }
     }}]);
};

window.doDeleteEtab = async function(id) {
  if (!confirm('Supprimer ?')) return;
  try { await deleteEtab(id); G.ref = await loadRefData(); showToast('Supprimé.'); nav('etablissements'); }
  catch(e) { alert(e.message); }
};

async function renderCentres() {
  const centres = G.ref.centres || [];
  return `
    <div class="page-header">
      <div><div class="page-title">Centres d'examen</div></div>
      <div class="header-actions">
        ${G.role==='admin'?`<button class="btn btn-primary btn-sm" onclick="showAddCentre()">+ Ajouter</button>`:''}
      </div>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>Code</th><th>Nom</th><th>Ville</th><th>Capacité</th><th>Actions</th></tr></thead>
      <tbody>${centres.map(c=>`<tr>
        <td class="td-mono">${c.id}</td><td><strong>${c.nom}</strong></td>
        <td>${c.ville}</td><td class="td-mono">${c.capacite||'—'}</td>
        <td>${G.role==='admin'?`
          <button class="btn btn-xs btn-outline" onclick="showEditCentre('${c.id}')">✏</button>
          <button class="btn btn-xs btn-danger" onclick="doDeleteCentre('${c.id}')" style="margin-left:4px">✕</button>`:''}</td>
      </tr>`).join('')}</tbody>
    </table></div>`;
}

window.showAddCentre = function() {
  showModal('Ajouter centre', `
    <div class="form-grid">
      <div class="form-group"><label class="form-label">Code *</label><input class="form-input" id="ac_id" placeholder="CTR004"/></div>
      <div class="form-group"><label class="form-label">Nom *</label><input class="form-input" id="ac_nom"/></div>
      <div class="form-group"><label class="form-label">Ville</label><input class="form-input" id="ac_vil"/></div>
      <div class="form-group"><label class="form-label">Capacité</label><input class="form-input" id="ac_cap" type="number" value="0"/></div>
    </div>`,
    [{ label:'Annuler', cls:'btn-outline', action: closeModal },
     { label:'Enregistrer', cls:'btn-primary', action: async () => {
       const id=document.getElementById('ac_id').value.trim(), nom=document.getElementById('ac_nom').value.trim();
       if(!id||!nom){alert('Code et nom obligatoires');return;}
       try {
         await addCentre({id,nom,ville:document.getElementById('ac_vil').value,capacite:parseInt(document.getElementById('ac_cap').value)||0});
         G.ref=await loadRefData(); closeModal(); showToast('Centre ajouté !'); nav('centres');
       } catch(e){alert(e.message);}
     }}]);
};

window.showEditCentre = function(id) {
  const c=(G.ref.centres||[]).find(x=>x.id===id); if(!c) return;
  showModal('Modifier centre',`
    <div class="form-grid">
      <div class="form-group"><label class="form-label">Nom</label><input class="form-input" id="ec_nom" value="${c.nom}"/></div>
      <div class="form-group"><label class="form-label">Ville</label><input class="form-input" id="ec_vil" value="${c.ville}"/></div>
      <div class="form-group"><label class="form-label">Capacité</label><input class="form-input" id="ec_cap" type="number" value="${c.capacite||0}"/></div>
    </div>`,
    [{ label:'Annuler', cls:'btn-outline', action: closeModal },
     { label:'Sauvegarder', cls:'btn-primary', action: async()=>{
       try{await updateCentre(id,{nom:document.getElementById('ec_nom').value,ville:document.getElementById('ec_vil').value,capacite:parseInt(document.getElementById('ec_cap').value)||0});
       G.ref=await loadRefData();closeModal();showToast('Modifié!');nav('centres');}catch(e){alert(e.message);}
     }}]);
};

window.doDeleteCentre = async function(id) {
  if(!confirm('Supprimer ?'))return;
  try{await deleteCentre(id);G.ref=await loadRefData();showToast('Supprimé.');nav('centres');}
  catch(e){alert(e.message);}
};

async function renderMatieres() {
  const mBepc = G.ref.matBepc || [];
  const mBac  = G.ref.matBac  || {};
  return `
    <div class="page-header">
      <div><div class="page-title">Matières & Coefficients</div></div>
    </div>
    <div class="tabs">
      <div class="tab active" id="tabMBepc" onclick="switchMatTab('bepc')">BEPC</div>
      ${['A1','A2','C','D'].map(s=>`<div class="tab" id="tabM${s}" onclick="switchMatTab('${s}')">BAC ${s}</div>`).join('')}
    </div>
    <div id="matContent">${renderMatList(mBepc,'bepc')}</div>`;
}

function renderMatList(list, type) {
  const total = list.filter(m=>!m.facultatif).reduce((s,m)=>s+m.coef,0);
  return `
    <div style="display:flex;justify-content:space-between;margin-bottom:12px">
      <span style="font-size:13px;color:var(--text2)">Total coef. (hors facultatif) : <strong>${total}</strong></span>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>ID</th><th>Matière</th><th>Coefficient</th><th>Type</th><th>Facultatif</th></tr></thead>
      <tbody>${list.map(m=>`<tr>
        <td class="td-mono">${m.id}</td><td><strong>${m.nom}</strong></td>
        <td>${badge(m.coef,'blue')}</td>
        <td>${badge(m.type_mat||m.type||'écrit','gray')}</td>
        <td>${m.facultatif?badge('Oui — bonus','amber'):badge('Non','gray')}</td>
      </tr>`).join('')}</tbody>
    </table></div>`;
}

window.switchMatTab = function(type) {
  ['bepc','A1','A2','C','D'].forEach(t=>{
    const el=document.getElementById('tabM'+(t==='bepc'?'Bepc':t));
    if(el) el.classList.toggle('active',t===type);
  });
  const list = type==='bepc' ? (G.ref.matBepc||[]) : ((G.ref.matBac||{})[type]||[]);
  document.getElementById('matContent').innerHTML = renderMatList(list, type);
};

// ─────────────────────────────────────────────────────────────
// PARTIE II — SAISIE NOTES BEPC
// ─────────────────────────────────────────────────────────────
async function renderSaisieBepc() {
  const centres = G.ref.centres || [];
  return `
    <div class="page-header">
      <div><div class="page-title">Saisie des notes — BEPC</div>
        <div class="page-subtitle">Par centre · Verrouillage après validation</div></div>
    </div>
    <div class="card" style="margin-bottom:16px">
      <div class="form-grid" style="grid-template-columns:1fr 1fr;gap:16px;margin-bottom:0">
        <div class="form-group"><label class="form-label">Centre d'examen</label>
          <select class="form-select" id="sbCentre" onchange="loadSaisieBepc()">
            <option value="">— Sélectionner un centre —</option>
            ${centres.map(c=>`<option value="${c.id}">${c.nom}</option>`).join('')}
          </select></div>
        <div class="form-group"><label class="form-label">Rechercher</label>
          <input class="form-input" id="sbSearch" placeholder="Matricule ou N° table..." oninput="filterSaisieBepc()"/></div>
      </div>
    </div>
    <div id="sbStats" style="display:none" class="saisie-header">
      <strong id="sbCentreNom"></strong>
      <div class="saisie-stats">
        <div><div class="saisie-stat-val" id="sbTotal">0</div><div class="saisie-stat-lbl">Total</div></div>
        <div><div class="saisie-stat-val" id="sbFilles" style="color:var(--purple)">0</div><div class="saisie-stat-lbl">Filles</div></div>
        <div><div class="saisie-stat-val" id="sbGarcons" style="color:var(--accent2)">0</div><div class="saisie-stat-lbl">Garçons</div></div>
        <div><div class="saisie-stat-val" id="sbTraites" style="color:var(--green)">0</div><div class="saisie-stat-lbl">Traités</div></div>
        <div><div class="saisie-stat-val" id="sbNonTraites" style="color:var(--amber)">0</div><div class="saisie-stat-lbl">Non traités</div></div>
        <div><div class="saisie-stat-val" id="sbAbsents" style="color:var(--text3)">0</div><div class="saisie-stat-lbl">Absents</div></div>
      </div>
    </div>
    <div id="sbList"></div>`;
}

window.loadSaisieBepc = async function() {
  const centreId = document.getElementById('sbCentre').value;
  if (!centreId) { document.getElementById('sbStats').style.display='none'; document.getElementById('sbList').innerHTML=''; return; }
  document.getElementById('sbList').innerHTML = loading('Chargement candidats...');
  document.getElementById('sbStats').style.display = '';
  document.getElementById('sbCentreNom').textContent = getCentreNom(centreId);
  try {
    const cands = await getCandidatsBepc({ centreId });
    window._sbCands = cands;
    await renderSaisieBepcList(centreId, cands);
  } catch(e) { document.getElementById('sbList').innerHTML = `<div class="alert alert-danger">${e.message}</div>`; }
};

window.filterSaisieBepc = function() {
  const q = document.getElementById('sbSearch').value.toLowerCase();
  const all = window._sbCands || [];
  const filtered = q ? all.filter(c => c.matricule.toLowerCase().includes(q) || c.num_table.includes(q)) : all;
  renderSaisieBepcList(document.getElementById('sbCentre').value, filtered);
};

async function renderSaisieBepcList(centreId, cands) {
  const mats = G.ref.matBepc || [];
  const total   = cands.length;
  const filles  = cands.filter(c=>c.sexe==='F').length;
  const garcons = cands.filter(c=>c.sexe==='M').length;
  const traites = cands.filter(c=>c.valide).length;
  const absents = cands.filter(c=>c.absent).length;

  document.getElementById('sbTotal').textContent     = total;
  document.getElementById('sbFilles').textContent    = filles;
  document.getElementById('sbGarcons').textContent   = garcons;
  document.getElementById('sbTraites').textContent   = traites;
  document.getElementById('sbNonTraites').textContent= total - traites;
  document.getElementById('sbAbsents').textContent   = absents;

  if (!cands.length) {
    document.getElementById('sbList').innerHTML = `<div class="card" style="text-align:center;padding:32px;color:var(--text3)">Aucun candidat dans ce centre</div>`;
    return;
  }

  // Charger les notes pour tous les candidats du centre
  const notesMap = {};
  await Promise.all(cands.map(async c => {
    notesMap[c.id] = await getNotesBepc(c.id);
  }));
  window._sbNotes = notesMap;

  document.getElementById('sbList').innerHTML = cands.map(c => {
    const notes    = notesMap[c.id] || {};
    const isAdmin  = G.role === 'admin';
    const locked   = c.valide && !isAdmin;
    const res      = calcMoyenneBepc(notes, c.inapt_eps, c.arts_plastiques);
    const decision = getDecision(res.moy, c.absent);

    return `<div class="candidat-row ${c.valide?'validated':''}" id="row_${c.id}">
      <div class="candidat-info">
        <div class="candidat-photo">${c.photo_url?`<img src="${c.photo_url}"/>`:'👤'}</div>
        <div style="flex:1">
          <div class="candidat-name">${c.nom} ${c.prenoms}
            ${c.valide?`<span class="badge badge-green" style="margin-left:8px">✓ Validé${isAdmin?' (modifiable)':''}</span>`:''}
          </div>
          <div class="candidat-meta">N°Table: <b>${c.num_table}</b> · Matricule: <b>${c.matricule}</b> · ${c.classe} · ${getEtabNom(c.etab_id)}</div>
        </div>
      </div>
      <div style="display:flex;gap:10px;margin-bottom:10px;flex-wrap:wrap">
        <div class="form-checkbox-group">
          <input type="checkbox" id="eps_${c.id}" ${c.inapt_eps?'checked':''} ${locked?'disabled':''}
            onchange="toggleBepcFlag('${c.id}','inapt_eps',this.checked,'${centreId}')"/>
          <label for="eps_${c.id}">Inapte EPS</label></div>
        <div class="form-checkbox-group">
          <input type="checkbox" id="art_${c.id}" ${c.arts_plastiques?'checked':''} ${locked?'disabled':''}
            onchange="toggleBepcFlag('${c.id}','arts_plastiques',this.checked,'${centreId}')"/>
          <label for="art_${c.id}">Arts Plastiques (inclure)</label></div>
        <div class="form-checkbox-group">
          <input type="checkbox" id="abs_${c.id}" ${c.absent?'checked':''} ${locked?'disabled':''}
            onchange="toggleBepcFlag('${c.id}','absent',this.checked,'${centreId}')"/>
          <label for="abs_${c.id}" style="color:var(--red)">Absence totale</label></div>
      </div>
      <div class="matieres-grid">
        ${mats.map(m => {
          if (m.facultatif && !c.arts_plastiques) return '';
          const grised = (m.id==='MB08'&&c.inapt_eps) || c.absent;
          const val = notes[m.id] !== undefined ? notes[m.id] : '';
          return `<div class="matiere-input">
            <div class="matiere-label">${m.nom}</div>
            <div class="matiere-coef">Coef. ${m.coef}</div>
            <input type="number" min="0" max="20" step="0.25"
              class="${grised||locked?'inp-disabled':''} ${val!==''?'inp-filled':''}"
              value="${val}" ${grised||locked?'disabled':''}
              placeholder="—"
              onchange="saisirNoteBepc('${c.id}','${m.id}',this.value)"/>
          </div>`;
        }).join('')}
      </div>
      <div class="result-bar" id="res_${c.id}">
        <div class="result-item"><div class="result-val">${res.pts}</div><div class="result-lbl">Points</div></div>
        <div class="result-item"><div class="result-val">${res.coef}</div><div class="result-lbl">Coef.</div></div>
        <div class="result-item"><div class="result-val">${res.moy!==null?res.moy.toFixed(2):'—'}</div><div class="result-lbl">Moyenne</div></div>
        <div class="result-item"><div class="result-val ${decision==='Admis'?'d-admis':decision==='Refusé'?'d-refuse':'d-absent'}">${decision}</div><div class="result-lbl">Décision</div></div>
        <div style="margin-left:auto;display:flex;gap:8px">
          ${!c.valide?`<button class="btn btn-success btn-sm" onclick="doValiderBepc('${c.id}','${centreId}')">✓ Valider</button>`:''}
          ${c.valide&&isAdmin?`<button class="btn btn-outline btn-sm" onclick="doDeverrouillerBepc('${c.id}','${centreId}')">🔓 Déverrouiller</button>`:''}
        </div>
      </div>
    </div>`;
  }).join('');
}

window.saisirNoteBepc = async function(candidatId, matiereId, value) {
  if (!window._sbNotes) window._sbNotes = {};
  if (!window._sbNotes[candidatId]) window._sbNotes[candidatId] = {};
  const note = value === '' ? null : parseFloat(value);
  window._sbNotes[candidatId][matiereId] = note;
  // Mise à jour affichage résultat immédiat
  const cand = (window._sbCands||[]).find(c=>c.id===candidatId);
  if (cand) {
    const res = calcMoyenneBepc(window._sbNotes[candidatId], cand.inapt_eps, cand.arts_plastiques);
    updateResultBar(candidatId, res, getDecision(res.moy, cand.absent));
  }
  // Sauvegarde en base (debounce 800ms)
  clearTimeout(window['_t_'+candidatId+'_'+matiereId]);
  window['_t_'+candidatId+'_'+matiereId] = setTimeout(async () => {
    try {
      if (note !== null) await upsertNoteBepc(candidatId, matiereId, note, G.user.id);
    } catch(e) { console.error(e); }
  }, 800);
};

window.toggleBepcFlag = async function(id, flag, val, centreId) {
  try {
    await updateCandidatBepc(id, { [flag]: val });
    const idx = (window._sbCands||[]).findIndex(c=>c.id===id);
    if (idx >= 0) window._sbCands[idx][flag] = val;
    await renderSaisieBepcList(centreId, window._sbCands||[]);
  } catch(e) { alert(e.message); }
};

window.doValiderBepc = async function(id, centreId) {
  if (!confirm('Valider cette fiche ? Elle sera verrouillée.')) return;
  try {
    await validerBepc(id, G.user.id);
    const idx = (window._sbCands||[]).findIndex(c=>c.id===id);
    if (idx>=0) window._sbCands[idx].valide = true;
    await renderSaisieBepcList(centreId, window._sbCands||[]);
    showToast('Fiche validée et verrouillée.');
  } catch(e) { alert(e.message); }
};

window.doDeverrouillerBepc = async function(id, centreId) {
  if (!confirm('Déverrouiller cette fiche ? (Action admin)')) return;
  try {
    await deverrouillerBepc(id);
    const idx = (window._sbCands||[]).findIndex(c=>c.id===id);
    if (idx>=0) window._sbCands[idx].valide = false;
    await renderSaisieBepcList(centreId, window._sbCands||[]);
    showToast('Fiche déverrouillée.');
  } catch(e) { alert(e.message); }
};

function updateResultBar(id, res, decision) {
  const bar = document.getElementById('res_'+id); if(!bar) return;
  const items = bar.querySelectorAll('.result-val');
  if(items.length>=4){
    items[0].textContent = res.pts;
    items[1].textContent = res.coef;
    items[2].textContent = res.moy!==null?res.moy.toFixed(2):'—';
    items[3].textContent = decision;
    items[3].className   = 'result-val '+(decision==='Admis'?'d-admis':decision==='Refusé'?'d-refuse':'d-absent');
  }
}

// ─────────────────────────────────────────────────────────────
// PARTIE II — SAISIE NOTES BAC
// ─────────────────────────────────────────────────────────────
async function renderSaisieBac() {
  const centres = G.ref.centres || [];
  return `
    <div class="page-header">
      <div><div class="page-title">Saisie des notes — BAC</div>
        <div class="page-subtitle">Par centre et par série</div></div>
    </div>
    <div class="card" style="margin-bottom:16px">
      <div class="form-grid" style="grid-template-columns:1fr 1fr 1fr;gap:16px;margin-bottom:0">
        <div class="form-group"><label class="form-label">Centre</label>
          <select class="form-select" id="sBCentre" onchange="loadSaisieBac()">
            <option value="">— Sélectionner —</option>
            ${centres.map(c=>`<option value="${c.id}">${c.nom}</option>`).join('')}
          </select></div>
        <div class="form-group"><label class="form-label">Série</label>
          <select class="form-select" id="sBSerie" onchange="loadSaisieBac()">
            <option value="">— Toutes —</option>
            <option value="A1">A1</option><option value="A2">A2</option>
            <option value="C">C</option><option value="D">D</option>
          </select></div>
        <div class="form-group"><label class="form-label">Rechercher</label>
          <input class="form-input" id="sBSearch" placeholder="Matricule ou N° table..." oninput="filterSaisieBac()"/></div>
      </div>
    </div>
    <div id="sBStats" style="display:none" class="saisie-header">
      <strong id="sBCentreNom"></strong>
      <div class="saisie-stats">
        <div><div class="saisie-stat-val" id="sBTotal">0</div><div class="saisie-stat-lbl">Total</div></div>
        <div><div class="saisie-stat-val" id="sBTraites" style="color:var(--green)">0</div><div class="saisie-stat-lbl">Traités</div></div>
        <div><div class="saisie-stat-val" id="sBAbsents" style="color:var(--text3)">0</div><div class="saisie-stat-lbl">Absents</div></div>
      </div>
    </div>
    <div id="sBList"></div>`;
}

window.loadSaisieBac = async function() {
  const centreId = document.getElementById('sBCentre').value;
  const serie    = document.getElementById('sBSerie').value;
  if (!centreId) { document.getElementById('sBStats').style.display='none'; document.getElementById('sBList').innerHTML=''; return; }
  document.getElementById('sBList').innerHTML = loading();
  document.getElementById('sBStats').style.display = '';
  document.getElementById('sBCentreNom').textContent = getCentreNom(centreId) + (serie?' — Série '+serie:'');
  try {
    const cands = await getCandidatsBac({ centreId, serie: serie||undefined });
    window._sBCands = cands;
    await renderSaisieBacList(centreId, serie, cands);
  } catch(e) { document.getElementById('sBList').innerHTML = `<div class="alert alert-danger">${e.message}</div>`; }
};

window.filterSaisieBac = function() {
  const q = document.getElementById('sBSearch').value.toLowerCase();
  const all = window._sBCands || [];
  const filtered = q ? all.filter(c=>c.matricule.toLowerCase().includes(q)||c.num_table.includes(q)) : all;
  renderSaisieBacList(document.getElementById('sBCentre').value, document.getElementById('sBSerie').value, filtered);
};

async function renderSaisieBacList(centreId, serie, cands) {
  document.getElementById('sBTotal').textContent   = cands.length;
  document.getElementById('sBTraites').textContent = cands.filter(c=>c.valide).length;
  document.getElementById('sBAbsents').textContent = cands.filter(c=>c.absent).length;

  if (!cands.length) {
    document.getElementById('sBList').innerHTML = `<div class="card" style="text-align:center;padding:32px;color:var(--text3)">Aucun candidat</div>`;
    return;
  }

  const notesMap = {};
  await Promise.all(cands.map(async c => { notesMap[c.id] = await getNotesBac(c.id); }));
  window._sBNotes = notesMap;

  document.getElementById('sBList').innerHTML = cands.map(c => {
    const mats     = (G.ref.matBac||{})[c.serie] || [];
    const notes    = notesMap[c.id] || {};
    const isAdmin  = G.role === 'admin';
    const locked   = c.valide && !isAdmin;
    const res      = calcMoyenneBac(notes, c.serie, c.inapt_eps);
    const decision = getDecision(res.moy, c.absent);

    return `<div class="candidat-row ${c.valide?'validated':''}" id="row_${c.id}">
      <div class="candidat-info">
        <div class="candidat-photo">${c.photo_url?`<img src="${c.photo_url}"/>`:'👤'}</div>
        <div style="flex:1">
          <div class="candidat-name">${c.nom} ${c.prenoms}
            ${badge(c.serie,c.serie==='C'?'red':c.serie==='D'?'amber':c.serie==='A1'?'green':'blue')}
            ${c.valide?`<span class="badge badge-green" style="margin-left:6px">✓ Validé</span>`:''}
          </div>
          <div class="candidat-meta">N°Table: <b>${c.num_table}</b> · ${c.matricule} · ${c.classe} · ${getEtabNom(c.etab_id)}</div>
        </div>
      </div>
      <div style="display:flex;gap:10px;margin-bottom:10px;flex-wrap:wrap">
        <div class="form-checkbox-group">
          <input type="checkbox" id="beps_${c.id}" ${c.inapt_eps?'checked':''} ${locked?'disabled':''}
            onchange="toggleBacFlag('${c.id}','inapt_eps',this.checked,'${centreId}','${serie}')"/>
          <label for="beps_${c.id}">Inapte EPS</label></div>
        <div class="form-checkbox-group">
          <input type="checkbox" id="babs_${c.id}" ${c.absent?'checked':''} ${locked?'disabled':''}
            onchange="toggleBacFlag('${c.id}','absent',this.checked,'${centreId}','${serie}')"/>
          <label for="babs_${c.id}" style="color:var(--red)">Absence totale</label></div>
      </div>
      <div class="matieres-grid">
        ${mats.map(m=>{
          const grised = (m.id.endsWith('_10')&&c.inapt_eps)||c.absent;
          const val = notes[m.id]!==undefined?notes[m.id]:'';
          return `<div class="matiere-input">
            <div class="matiere-label">${m.nom}</div>
            <div class="matiere-coef">Coef. ${m.coef}</div>
            <input type="number" min="0" max="20" step="0.25"
              class="${grised||locked?'inp-disabled':''} ${val!==''?'inp-filled':''}"
              value="${val}" ${grised||locked?'disabled':''} placeholder="—"
              onchange="saisirNoteBac('${c.id}','${m.id}',this.value)"/>
          </div>`;
        }).join('')}
      </div>
      <div class="result-bar" id="res_${c.id}">
        <div class="result-item"><div class="result-val">${res.pts}</div><div class="result-lbl">Points</div></div>
        <div class="result-item"><div class="result-val">${res.coef}</div><div class="result-lbl">Coef.</div></div>
        <div class="result-item"><div class="result-val">${res.moy!==null?res.moy.toFixed(2):'—'}</div><div class="result-lbl">Moyenne</div></div>
        <div class="result-item"><div class="result-val ${decision==='Admis'?'d-admis':decision==='Refusé'?'d-refuse':'d-absent'}">${decision}</div><div class="result-lbl">Décision</div></div>
        <div style="margin-left:auto;display:flex;gap:8px">
          ${!c.valide?`<button class="btn btn-success btn-sm" onclick="doValiderBac('${c.id}','${centreId}','${serie}')">✓ Valider</button>`:''}
          ${c.valide&&isAdmin?`<button class="btn btn-outline btn-sm" onclick="doDeverrouillerBac('${c.id}','${centreId}','${serie}')">🔓 Déverrouiller</button>`:''}
        </div>
      </div>
    </div>`;
  }).join('');
}

window.saisirNoteBac = async function(candidatId, matiereId, value) {
  if (!window._sBNotes) window._sBNotes = {};
  if (!window._sBNotes[candidatId]) window._sBNotes[candidatId] = {};
  const note = value===''?null:parseFloat(value);
  window._sBNotes[candidatId][matiereId] = note;
  const cand = (window._sBCands||[]).find(c=>c.id===candidatId);
  if (cand) {
    const res = calcMoyenneBac(window._sBNotes[candidatId], cand.serie, cand.inapt_eps);
    updateResultBar(candidatId, res, getDecision(res.moy, cand.absent));
  }
  clearTimeout(window['_tb_'+candidatId+'_'+matiereId]);
  window['_tb_'+candidatId+'_'+matiereId] = setTimeout(async()=>{
    try { if(note!==null) await upsertNoteBac(candidatId, matiereId, note, G.user.id); }
    catch(e){ console.error(e); }
  }, 800);
};

window.toggleBacFlag = async function(id, flag, val, centreId, serie) {
  try {
    await updateCandidatBac(id, {[flag]:val});
    const idx=(window._sBCands||[]).findIndex(c=>c.id===id);
    if(idx>=0) window._sBCands[idx][flag]=val;
    await renderSaisieBacList(centreId, serie, window._sBCands||[]);
  } catch(e){alert(e.message);}
};

window.doValiderBac = async function(id, centreId, serie) {
  if(!confirm('Valider cette fiche ?')) return;
  try {
    await validerBac(id, G.user.id);
    const idx=(window._sBCands||[]).findIndex(c=>c.id===id);
    if(idx>=0) window._sBCands[idx].valide=true;
    await renderSaisieBacList(centreId, serie, window._sBCands||[]);
    showToast('Fiche validée !');
  } catch(e){alert(e.message);}
};

window.doDeverrouillerBac = async function(id, centreId, serie) {
  if(!confirm('Déverrouiller ?')) return;
  try {
    await deverrouillerBac(id);
    const idx=(window._sBCands||[]).findIndex(c=>c.id===id);
    if(idx>=0) window._sBCands[idx].valide=false;
    await renderSaisieBacList(centreId, serie, window._sBCands||[]);
    showToast('Fiche déverrouillée.');
  } catch(e){alert(e.message);}
};

// ─────────────────────────────────────────────────────────────
// PARTIE II — IMPORT NOTES
// ─────────────────────────────────────────────────────────────
async function renderImportNotes() {
  return `
    <div class="page-header">
      <div><div class="page-title">Import des notes (Excel/CSV)</div></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
      <div class="card">
        <div class="card-title">Notes BEPC</div>
        <div class="alert alert-info" style="font-size:12px">CSV : matricule, matiere_id, note</div>
        <div class="import-zone" style="margin-top:10px" onclick="document.getElementById('impNB').click()">
          <div class="import-icon">📊</div><div class="import-title">Importer notes BEPC</div>
        </div>
        <input type="file" id="impNB" accept=".csv" style="display:none" onchange="processImportNotes(this,'bepc')"/>
        <button class="btn btn-outline btn-sm" style="margin-top:10px" onclick="dlModeleNotes('bepc')">⬇ Modèle CSV</button>
      </div>
      <div class="card">
        <div class="card-title">Notes BAC</div>
        <div class="alert alert-info" style="font-size:12px">CSV : matricule, matiere_id, note</div>
        <div class="import-zone" style="margin-top:10px" onclick="document.getElementById('impNBAC').click()">
          <div class="import-icon">📊</div><div class="import-title">Importer notes BAC</div>
        </div>
        <input type="file" id="impNBAC" accept=".csv" style="display:none" onchange="processImportNotes(this,'bac')"/>
        <button class="btn btn-outline btn-sm" style="margin-top:10px" onclick="dlModeleNotes('bac')">⬇ Modèle CSV</button>
      </div>
    </div>`;
}

window.processImportNotes = async function(input, type) {
  const file = input.files[0]; if(!file) return;
  const text = await file.text();
  const lines = text.split('\n').filter(l=>l.trim());
  const headers = lines[0].split(',').map(h=>h.trim().toLowerCase());
  const rows = [];
  const allCands = type==='bepc'
    ? await getCandidatsBepc()
    : await getCandidatsBac();
  const matMap = {};
  allCands.forEach(c => { matMap[c.matricule] = c.id; });

  for (let i=1;i<lines.length;i++) {
    const vals=lines[i].split(',').map(v=>v.trim());
    const obj={};
    headers.forEach((h,idx)=>{obj[h]=vals[idx]||'';});
    const candidatId = matMap[obj.matricule];
    if (!candidatId || !obj.matiere_id) continue;
    const note = parseFloat(obj.note);
    if (isNaN(note)) continue;
    rows.push({ candidat_id:candidatId, matiere_id:obj.matiere_id, note });
  }
  try {
    if (type==='bepc') await importNotesBepc(rows);
    else               await importNotesBac(rows);
    showToast(`${rows.length} note(s) importée(s) !`);
  } catch(e){ alert('Erreur : '+e.message); }
};

window.dlModeleNotes = function(type) {
  const csv = type==='bepc'
    ? 'matricule,matiere_id,note\nBEPC2025001,MB01,14.5\nBEPC2025001,MB02,12'
    : 'matricule,matiere_id,note\nBAC2025001,BD_01,16\nBAC2025001,BD_02,14';
  const a=document.createElement('a');
  a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(csv);
  a.download=`modele_notes_${type}.csv`; a.click();
};

// ─────────────────────────────────────────────────────────────
// PARTIE III — BILAN
// ─────────────────────────────────────────────────────────────
async function renderBilan() {
  window._bilanTab = 'bepc';
  return `
    <div class="page-header">
      <div><div class="page-title">Bilan BEPC & BAC</div></div>
      <div class="header-actions">
        <button class="btn btn-outline btn-sm" onclick="window.print()">🖨 Imprimer</button>
      </div>
    </div>
    <div class="tabs">
      <div class="tab active" id="tabBB" onclick="switchBilanTab('bepc')">BEPC</div>
      <div class="tab" id="tabBBAC" onclick="switchBilanTab('bac')">BAC</div>
    </div>
    <div class="card" style="margin-bottom:16px">
      <div style="display:flex;gap:12px;flex-wrap:wrap">
        <div class="form-group" style="min-width:160px"><label class="form-label">Regrouper par</label>
          <select class="form-select" id="bilanFiltre" onchange="loadBilanContent()">
            <option value="centre">Par centre</option>
            <option value="etab">Par établissement</option>
          </select></div>
        <div class="form-group" id="bilanSerieDiv" style="min-width:140px;display:none">
          <label class="form-label">Série</label>
          <select class="form-select" id="bilanSerie" onchange="loadBilanContent()">
            <option value="">Toutes</option>
            <option>A1</option><option>A2</option><option>C</option><option>D</option>
          </select></div>
      </div>
    </div>
    <div id="bilanContent">${loading()}</div>`;
}

window.switchBilanTab = async function(type) {
  window._bilanTab = type;
  document.getElementById('tabBB').classList.toggle('active', type==='bepc');
  document.getElementById('tabBBAC').classList.toggle('active', type==='bac');
  document.getElementById('bilanSerieDiv').style.display = type==='bac'?'':'none';
  await loadBilanContent();
};

window.loadBilanContent = async function() {
  document.getElementById('bilanContent').innerHTML = loading();
  const type   = window._bilanTab || 'bepc';
  const filtre = document.getElementById('bilanFiltre').value;
  const serie  = document.getElementById('bilanSerie')?.value || '';
  try {
    let cands = type==='bepc' ? await getCandidatsBepc() : await getCandidatsBac();
    if (serie && type==='bac') cands = cands.filter(c=>c.serie===serie);

    // Charger toutes les notes
    const notesMap = {};
    await Promise.all(cands.map(async c => {
      notesMap[c.id] = type==='bepc' ? await getNotesBepc(c.id) : await getNotesBac(c.id);
    }));

    const groupIds = [...new Set(cands.map(c=>filtre==='centre'?c.centre_id:c.etab_id))];
    const getNom   = filtre==='centre' ? getCentreNom : getEtabNom;

    const rows = groupIds.map(gid => {
      const g = cands.filter(c=>(filtre==='centre'?c.centre_id:c.etab_id)===gid);
      const total   = g.length;
      const filles  = g.filter(c=>c.sexe==='F').length;
      const garcons = g.filter(c=>c.sexe==='M').length;
      const traites = g.filter(c=>c.valide).length;
      const absents = g.filter(c=>c.absent).length;
      const admis   = g.filter(c=>{
        const r = type==='bepc'?calcMoyenneBepc(notesMap[c.id]||{},c.inapt_eps,c.arts_plastiques):calcMoyenneBac(notesMap[c.id]||{},c.serie,c.inapt_eps);
        return r.moy!==null&&r.moy>=10&&!c.absent;
      });
      const refuses = g.filter(c=>{
        const r = type==='bepc'?calcMoyenneBepc(notesMap[c.id]||{},c.inapt_eps,c.arts_plastiques):calcMoyenneBac(notesMap[c.id]||{},c.serie,c.inapt_eps);
        return r.moy!==null&&r.moy<10&&!c.absent&&c.valide;
      });
      const taux = traites>0?Math.round(admis.length/traites*100):0;
      return `<tr>
        <td><strong>${getNom(gid)}</strong></td>
        <td class="td-mono">${total}</td><td class="td-mono">${filles}</td><td class="td-mono">${garcons}</td>
        <td class="td-mono">${traites}</td><td class="td-mono">${total-traites}</td><td class="td-mono">${absents}</td>
        <td class="td-mono">${admis.length}</td><td class="td-mono">${refuses.length}</td>
        <td>${badge(taux+'%',taux>=50?'green':'amber')}</td>
      </tr>`;
    });

    document.getElementById('bilanContent').innerHTML = `
      <div class="table-wrap"><table>
        <thead><tr>
          <th>${filtre==='centre'?'Centre':'Établissement'}</th>
          <th>Total</th><th>Filles</th><th>Garçons</th>
          <th>Traités</th><th>Non traités</th><th>Absents</th>
          <th>Admis</th><th>Refusés</th><th>% Admis</th>
        </tr></thead>
        <tbody>${rows.join('')||'<tr><td colspan="10" style="text-align:center;padding:24px;color:var(--text3)">Aucune donnée</td></tr>'}</tbody>
      </table></div>`;
  } catch(e) { document.getElementById('bilanContent').innerHTML=`<div class="alert alert-danger">${e.message}</div>`; }
};

// ─────────────────────────────────────────────────────────────
// PARTIE IV — STATISTIQUES
// ─────────────────────────────────────────────────────────────
async function renderStatistiques() {
  window._statTab = 'bepc';
  return `
    <div class="page-header"><div><div class="page-title">Statistiques</div></div></div>
    <div class="tabs">
      <div class="tab active" id="tabSB" onclick="switchStatTab('bepc')">BEPC</div>
      <div class="tab" id="tabSBAC" onclick="switchStatTab('bac')">BAC</div>
    </div>
    <div id="statContent">${loading()}</div>`;
}

window.switchStatTab = async function(type) {
  window._statTab = type;
  document.getElementById('tabSB').classList.toggle('active',type==='bepc');
  document.getElementById('tabSBAC').classList.toggle('active',type==='bac');
  await loadStatContent();
};

window.loadStatContent = async function() {
  if (!document.getElementById('statContent')) return;
  document.getElementById('statContent').innerHTML = loading();
  const type = window._statTab||'bepc';
  try {
    const cands = type==='bepc'?await getCandidatsBepc():await getCandidatsBac();
    const notesMap={};
    await Promise.all(cands.map(async c=>{
      notesMap[c.id]=type==='bepc'?await getNotesBepc(c.id):await getNotesBac(c.id);
    }));
    const centres = G.ref.centres||[];
    const total   = cands.length;
    const traites = cands.filter(c=>c.valide).length;
    const admisT  = cands.filter(c=>{
      const r=type==='bepc'?calcMoyenneBepc(notesMap[c.id]||{},c.inapt_eps,c.arts_plastiques):calcMoyenneBac(notesMap[c.id]||{},c.serie,c.inapt_eps);
      return r.moy!==null&&r.moy>=10&&!c.absent;
    }).length;

    const rows = centres.map(ctr=>{
      const g=cands.filter(c=>c.centre_id===ctr.id);
      if(!g.length) return '';
      const tr=g.filter(c=>c.valide).length;
      const ab=g.filter(c=>c.absent).length;
      const ad=g.filter(c=>{const r=type==='bepc'?calcMoyenneBepc(notesMap[c.id]||{},c.inapt_eps,c.arts_plastiques):calcMoyenneBac(notesMap[c.id]||{},c.serie,c.inapt_eps);return r.moy!==null&&r.moy>=10&&!c.absent;}).length;
      const rf=g.filter(c=>{const r=type==='bepc'?calcMoyenneBepc(notesMap[c.id]||{},c.inapt_eps,c.arts_plastiques):calcMoyenneBac(notesMap[c.id]||{},c.serie,c.inapt_eps);return r.moy!==null&&r.moy<10&&!c.absent&&c.valide;}).length;
      const taux=tr>0?(ad/tr*100).toFixed(1):'0.0';
      return `<tr>
        <td><strong>${ctr.nom}</strong></td>
        <td class="td-mono">${g.length}</td><td class="td-mono">${tr}</td>
        <td>${badge(tr>0?Math.round(tr/g.length*100)+'%':'0%',tr/g.length>=0.8?'green':'amber')}</td>
        <td class="td-mono">${ad}</td>
        <td>${badge(taux+'%',parseFloat(taux)>=50?'green':parseFloat(taux)>=30?'amber':'red')}</td>
        <td class="td-mono">${ab}</td><td class="td-mono">${rf}</td>
      </tr>`;
    });

    document.getElementById('statContent').innerHTML = `
      <div class="card-grid" style="grid-template-columns:repeat(4,1fr);margin-bottom:20px">
        <div class="stat-card stat-accent"><div class="stat-value">${total}</div><div class="stat-label">Total inscrits</div></div>
        <div class="stat-card"><div class="stat-value">${total>0?(traites/total*100).toFixed(1):0}%</div><div class="stat-label">% traités</div></div>
        <div class="stat-card stat-green"><div class="stat-value" style="color:var(--green)">${traites>0?(admisT/traites*100).toFixed(1):0}%</div><div class="stat-label">Taux admission</div></div>
        <div class="stat-card"><div class="stat-value">${admisT}</div><div class="stat-label">Total admis</div></div>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Centre</th><th>Inscrits</th><th>Traités</th><th>% Traités</th><th>Admis</th><th>% Admis</th><th>Absents</th><th>Refusés</th></tr></thead>
        <tbody>${rows.join('')||'<tr><td colspan="8" style="text-align:center;padding:24px">Aucune donnée</td></tr>'}</tbody>
      </table></div>`;
  } catch(e){document.getElementById('statContent').innerHTML=`<div class="alert alert-danger">${e.message}</div>`;}
};

// ─────────────────────────────────────────────────────────────
// PARTIE V — CLASSEMENT
// ─────────────────────────────────────────────────────────────
async function renderClassement() {
  const centres = G.ref.centres||[];
  return `
    <div class="page-header">
      <div><div class="page-title">Classement par mérite</div>
        <div class="page-subtitle">Tableau d'honneur : moyenne ≥ 13/20</div></div>
      <div class="header-actions"><button class="btn btn-outline btn-sm" onclick="window.print()">🖨 Imprimer</button></div>
    </div>
    <div class="tabs">
      <div class="tab active" id="tabCLB" onclick="switchClsTab('bepc')">BEPC</div>
      <div class="tab" id="tabCLBAC" onclick="switchClsTab('bac')">BAC</div>
    </div>
    <div class="card" style="margin-bottom:16px">
      <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end">
        <div class="form-group" style="min-width:180px"><label class="form-label">Centre</label>
          <select class="form-select" id="clsCentre" onchange="loadClassement()">
            <option value="">Tous les centres</option>
            ${centres.map(c=>`<option value="${c.id}">${c.nom}</option>`).join('')}
          </select></div>
        <div class="form-group" id="clsSerieDiv" style="min-width:140px;display:none">
          <label class="form-label">Série</label>
          <select class="form-select" id="clsSerie" onchange="loadClassement()">
            <option value="">Toutes</option><option>A1</option><option>A2</option><option>C</option><option>D</option>
          </select></div>
        <div class="form-checkbox-group">
          <input type="checkbox" id="clsHonneur" onchange="loadClassement()"/>
          <label for="clsHonneur">Tableau d'honneur uniquement (≥ 13)</label>
        </div>
      </div>
    </div>
    <div id="clsContent">${loading()}</div>`;
}

window.switchClsTab = async function(type) {
  window._clsTab = type;
  document.getElementById('tabCLB').classList.toggle('active',type==='bepc');
  document.getElementById('tabCLBAC').classList.toggle('active',type==='bac');
  document.getElementById('clsSerieDiv').style.display=type==='bac'?'':'none';
  await loadClassement();
};

window.loadClassement = async function() {
  if (!document.getElementById('clsContent')) return;
  document.getElementById('clsContent').innerHTML = loading();
  const type    = window._clsTab||'bepc';
  const centreId= document.getElementById('clsCentre')?.value||'';
  const serie   = document.getElementById('clsSerie')?.value||'';
  const honneur = document.getElementById('clsHonneur')?.checked||false;
  try {
    let cands = type==='bepc'?await getCandidatsBepc({centreId:centreId||undefined}):await getCandidatsBac({centreId:centreId||undefined,serie:serie||undefined});
    cands = cands.filter(c=>c.valide&&!c.absent);
    const notesMap={};
    await Promise.all(cands.map(async c=>{notesMap[c.id]=type==='bepc'?await getNotesBepc(c.id):await getNotesBac(c.id);}));
    let ranked = cands.map(c=>{
      const r=type==='bepc'?calcMoyenneBepc(notesMap[c.id]||{},c.inapt_eps,c.arts_plastiques):calcMoyenneBac(notesMap[c.id]||{},c.serie,c.inapt_eps);
      return {...c,moy:r.moy};
    }).filter(c=>c.moy!==null).sort((a,b)=>b.moy-a.moy);
    if(honneur) ranked=ranked.filter(c=>c.moy>=13);

    document.getElementById('clsContent').innerHTML = `
      <div class="alert alert-info" style="margin-bottom:12px">
        🏆 ${ranked.filter(c=>c.moy>=13).length} au tableau d'honneur · ${ranked.length} affiché(s)
      </div>
      <div style="border:1px solid var(--border);border-radius:var(--r2);overflow:hidden">
        ${!ranked.length?`<div style="text-align:center;padding:32px;color:var(--text3)">Aucun résultat</div>`:
        ranked.map((c,i)=>`
          <div class="rank-row">
            <div class="rank-num ${i===0?'rank-1':i===1?'rank-2':i===2?'rank-3':'rank-other'}">${i+1}</div>
            <div class="candidat-photo" style="width:34px;height:34px">${c.photo_url?`<img src="${c.photo_url}" style="width:100%;height:100%;object-fit:cover;border-radius:4px"/>`:'👤'}</div>
            <div style="flex:1">
              <div style="font-weight:600;font-size:13px">${c.nom} ${c.prenoms}
                ${c.moy>=13?`<span class="honour-badge" style="margin-left:6px">⭐ Tableau d'honneur</span>`:''}
              </div>
              <div style="font-size:11px;color:var(--text2)">${c.num_table} · ${c.matricule} · ${getEtabNom(c.etab_id)}</div>
            </div>
            <div style="text-align:right">
              <div style="font-size:18px;font-weight:700;font-family:var(--mono);color:${c.moy>=13?'var(--green)':c.moy>=10?'var(--accent)':'var(--red)'}">${c.moy.toFixed(2)}</div>
              <div style="font-size:10px;color:var(--text3)">/20</div>
            </div>
            ${type==='bac'?`<div style="margin-left:8px">${badge('Sér.'+c.serie,c.serie==='C'?'red':c.serie==='D'?'amber':c.serie==='A1'?'green':'blue')}</div>`:''}
          </div>`).join('')}
      </div>`;
  } catch(e){document.getElementById('clsContent').innerHTML=`<div class="alert alert-danger">${e.message}</div>`;}
};

// ─────────────────────────────────────────────────────────────
// PARTIE VI — RELEVÉS DE NOTES
// ─────────────────────────────────────────────────────────────
async function renderReleves() {
  const centres = G.ref.centres||[];
  const etabs   = G.ref.etablissements||[];
  return `
    <div class="page-header">
      <div><div class="page-title">Relevés de notes</div>
        <div class="page-subtitle">Avec photo · Filtre par centre / établissement</div></div>
      <div class="header-actions"><button class="btn btn-outline btn-sm" onclick="window.print()">🖨 Imprimer</button></div>
    </div>
    <div class="card" style="margin-bottom:16px">
      <div class="form-grid" style="grid-template-columns:repeat(4,1fr)">
        <div class="form-group"><label class="form-label">Type</label>
          <select class="form-select" id="relType"><option value="bepc">BEPC</option><option value="bac">BAC</option></select></div>
        <div class="form-group"><label class="form-label">Centre</label>
          <select class="form-select" id="relCentre">
            <option value="">Tous</option>
            ${centres.map(c=>`<option value="${c.id}">${c.nom}</option>`).join('')}
          </select></div>
        <div class="form-group"><label class="form-label">Établissement</label>
          <select class="form-select" id="relEtab">
            <option value="">Tous</option>
            ${etabs.map(e=>`<option value="${e.id}">${e.nom}</option>`).join('')}
          </select></div>
        <div class="form-group"><label class="form-label">Série (BAC)</label>
          <select class="form-select" id="relSerie">
            <option value="">Toutes</option><option>A1</option><option>A2</option><option>C</option><option>D</option>
          </select></div>
      </div>
      <div style="display:flex;gap:10px;margin-top:10px">
        <input class="search-input" id="relSearch" placeholder="Rechercher par matricule ou N° table..."/>
        <button class="btn btn-primary" onclick="searchReleve()">Rechercher</button>
        <button class="btn btn-outline" onclick="showAllReleves()">Afficher tout (filtré)</button>
      </div>
    </div>
    <div id="relevesContent"></div>`;
}

window.searchReleve = async function() {
  const type=document.getElementById('relType').value;
  const q=document.getElementById('relSearch').value.trim().toLowerCase();
  const centreId=document.getElementById('relCentre').value;
  const etabId=document.getElementById('relEtab').value;
  const serie=document.getElementById('relSerie').value;
  if(!q){showAllReleves();return;}
  const el=document.getElementById('relevesContent');
  el.innerHTML=loading();
  try {
    let list=type==='bepc'?await getCandidatsBepc({centreId:centreId||undefined,etabId:etabId||undefined,search:q}):
      await getCandidatsBac({centreId:centreId||undefined,etabId:etabId||undefined,serie:serie||undefined,search:q});
    if(!list.length){el.innerHTML=`<div class="alert alert-warning">Aucun candidat trouvé pour "${q}"</div>`;return;}
    const html=await Promise.all(list.map(c=>genReleve(c,type)));
    el.innerHTML=html.join('<hr style="margin:16px 0;border:none;border-top:1px dashed var(--border)"/>');
  } catch(e){el.innerHTML=`<div class="alert alert-danger">${e.message}</div>`;}
};

window.showAllReleves = async function() {
  const type=document.getElementById('relType').value;
  const centreId=document.getElementById('relCentre').value;
  const etabId=document.getElementById('relEtab').value;
  const serie=document.getElementById('relSerie').value;
  const el=document.getElementById('relevesContent');
  el.innerHTML=loading();
  try {
    let list=type==='bepc'?await getCandidatsBepc({centreId:centreId||undefined,etabId:etabId||undefined}):
      await getCandidatsBac({centreId:centreId||undefined,etabId:etabId||undefined,serie:serie||undefined});
    if(!list.length){el.innerHTML=`<div class="alert alert-warning">Aucun candidat avec ces filtres</div>`;return;}
    if(list.length>15){
      el.innerHTML=`<div class="alert alert-warning">⚠ ${list.length} candidats. <button class="btn btn-primary btn-sm" style="margin-left:10px" onclick="forceAllReleves()">Afficher quand même</button></div>`;
      window._pendingReleves={list,type}; return;
    }
    const html=await Promise.all(list.map(c=>genReleve(c,type)));
    el.innerHTML=html.join('<hr style="margin:16px 0;border:none;border-top:1px dashed var(--border)"/>');
  } catch(e){el.innerHTML=`<div class="alert alert-danger">${e.message}</div>`;}
};

window.forceAllReleves = async function() {
  const {list,type}=window._pendingReleves||{};
  if(!list) return;
  const el=document.getElementById('relevesContent');
  el.innerHTML=loading();
  const html=await Promise.all(list.map(c=>genReleve(c,type)));
  el.innerHTML=html.join('<hr style="margin:16px 0;border:none;border-top:1px dashed var(--border)"/>');
};

async function genReleve(c, type) {
  const mats  = type==='bepc'?(G.ref.matBepc||[]):((G.ref.matBac||{})[c.serie]||[]);
  const notes = type==='bepc'?await getNotesBepc(c.id):await getNotesBac(c.id);
  const res   = type==='bepc'?calcMoyenneBepc(notes,c.inapt_eps,c.arts_plastiques):calcMoyenneBac(notes,c.serie,c.inapt_eps);
  const dec   = getDecision(res.moy,c.absent);
  const annee = G.ref.config?.annee||'2024-2025';
  return `
    <div class="releve">
      <div class="releve-header">
        <div>
          <div class="releve-title">RELEVÉ DE NOTES — EXAMEN BLANC RÉGIONAL</div>
          <div class="releve-sub">Année ${annee} · ${type==='bepc'?'BEPC':'BAC'} · ${getCentreNom(c.centre_id)}</div>
        </div>
        <div style="text-align:right;font-size:12px;color:#666">
          <div>N° Table : <strong>${c.num_table}</strong></div>
          <div>Matricule : <strong>${c.matricule}</strong></div>
        </div>
      </div>
      <div class="releve-candidat">
        <div class="releve-photo">${c.photo_url?`<img src="${c.photo_url}"/>`:'👤'}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 16px;font-size:12px">
          <div><strong>Nom :</strong> ${c.nom}</div>
          <div><strong>Prénoms :</strong> ${c.prenoms}</div>
          <div><strong>Classe :</strong> ${c.classe}</div>
          <div><strong>Sexe :</strong> ${c.sexe==='F'?'Féminin':'Masculin'}</div>
          <div style="grid-column:1/-1"><strong>Établissement :</strong> ${getEtabNom(c.etab_id)}</div>
          ${type==='bac'?`<div><strong>Série :</strong> ${c.serie}</div>`:''}
        </div>
      </div>
      <table class="releve-table">
        <thead><tr><th class="td-left">Matière</th><th>Coef.</th><th>Note /20</th><th>Points</th></tr></thead>
        <tbody>
          ${mats.map(m=>{
            if(m.facultatif&&!c.arts_plastiques) return '';
            const isEPS=m.id==='MB08'||(m.id&&m.id.endsWith('_10'));
            const grised=(isEPS&&c.inapt_eps)||c.absent;
            const n=notes[m.id];
            const nStr=grised?(c.absent?'ABS':'INAP'):(n!==undefined?n:'—');
            const pts=!grised&&n!==undefined?(n*m.coef).toFixed(2):'—';
            return `<tr>
              <td class="td-left">${m.nom}${m.facultatif?' (fac.)':''}</td>
              <td>${m.coef}</td><td><strong>${nStr}</strong></td><td>${pts}</td>
            </tr>`;
          }).join('')}
        </tbody>
        <tfoot><tr style="background:#f0f0f0;font-weight:600">
          <td class="td-left">TOTAL</td>
          <td>${res.coef}</td>
          <td>${res.moy!==null?res.moy.toFixed(2):'—'}/20</td>
          <td style="color:${dec==='Admis'?'#1a6b3a':'#8b1a1a'};font-weight:700">${dec}</td>
        </tr></tfoot>
      </table>
      <div class="releve-footer">
        <div>Fait à ${G.ref.config?.ville||'Bouaké'}, le ${new Date().toLocaleDateString('fr-FR')}</div>
        <div style="font-weight:700;color:${dec==='Admis'?'#1a6b3a':'#8b1a1a'}">${dec==='Admis'?'✓ ADMIS(E)':dec==='Refusé'?'✗ REFUSÉ(E)':'ABSENT(E)'}</div>
        <div>Signature & Cachet</div>
      </div>
    </div>`;
}

// ─────────────────────────────────────────────────────────────
// PARTIE VII — BILAN ÉLÈVE
// ─────────────────────────────────────────────────────────────
async function renderBilanEleve() {
  return `
    <div class="page-header">
      <div><div class="page-title">Bilan élève</div>
        <div class="page-subtitle">Consultation individuelle par matricule</div></div>
    </div>
    <div class="card" style="margin-bottom:16px">
      <div style="display:flex;gap:10px">
        <input class="search-input" id="beSearch" placeholder="Matricule ou N° de table..." style="flex:1"/>
        <button class="btn btn-primary" onclick="searchBilanEleve()">Rechercher</button>
      </div>
    </div>
    <div id="beContent"></div>`;
}

window.searchBilanEleve = async function() {
  const q=document.getElementById('beSearch').value.trim().toLowerCase();
  if(!q) return;
  const el=document.getElementById('beContent');
  el.innerHTML=loading();
  try {
    const [bepcList, bacList]=await Promise.all([
      getCandidatsBepc({search:q}),
      getCandidatsBac({search:q}),
    ]);
    const c = bepcList[0]||bacList[0];
    if(!c){el.innerHTML=`<div class="alert alert-warning">Aucun candidat trouvé pour "${q}"</div>`;return;}
    const type=bepcList[0]?'bepc':'bac';
    const notes=type==='bepc'?await getNotesBepc(c.id):await getNotesBac(c.id);
    const res=type==='bepc'?calcMoyenneBepc(notes,c.inapt_eps,c.arts_plastiques):calcMoyenneBac(notes,c.serie,c.inapt_eps);
    const dec=getDecision(res.moy,c.absent);
    const mats=type==='bepc'?(G.ref.matBepc||[]):((G.ref.matBac||{})[c.serie]||[]);
    el.innerHTML=`
      <div class="card">
        <div style="display:flex;gap:20px;align-items:flex-start;margin-bottom:16px">
          <div style="width:80px;height:90px;border-radius:var(--r);border:1px solid var(--border);overflow:hidden;flex-shrink:0;background:var(--surface2);display:flex;align-items:center;justify-content:center;font-size:32px">
            ${c.photo_url?`<img src="${c.photo_url}" style="width:100%;height:100%;object-fit:cover"/>` :'👤'}
          </div>
          <div style="flex:1">
            <div style="font-size:20px;font-weight:700;margin-bottom:6px">${c.nom} ${c.prenoms}</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:6px">
              ${badge(c.num_table,'gray')} ${badge(c.matricule,'gray')}
              ${badge(c.sexe==='F'?'Féminin':'Masculin',c.sexe==='F'?'pink':'blue')}
              ${badge(c.classe,'gray')}
              ${type==='bac'?badge('Série '+c.serie,c.serie==='C'?'red':c.serie==='D'?'amber':c.serie==='A1'?'green':'blue'):''}
            </div>
            <div style="font-size:13px;color:var(--text2)">
              🏫 ${getEtabNom(c.etab_id)} &nbsp;·&nbsp; 📍 ${getCentreNom(c.centre_id)}
            </div>
          </div>
          <div style="text-align:center;padding:16px 20px;background:${dec==='Admis'?'var(--green-bg)':dec==='Refusé'?'var(--red-bg)':'var(--surface2)'};border-radius:var(--r2);flex-shrink:0">
            <div style="font-size:34px;font-weight:700;font-family:var(--mono);color:${dec==='Admis'?'var(--green)':dec==='Refusé'?'var(--red)':'var(--text2)'}">${res.moy!==null?res.moy.toFixed(2):'—'}</div>
            <div style="font-size:11px;color:var(--text2)">/20 · coef. ${res.coef}</div>
            <div style="font-weight:600;margin-top:6px;color:${dec==='Admis'?'var(--green)':dec==='Refusé'?'var(--red)':'var(--text2)'}">${dec}</div>
          </div>
        </div>
        <div class="table-wrap"><table>
          <thead><tr><th>Matière</th><th>Coef.</th><th>Note</th><th>Points</th></tr></thead>
          <tbody>${mats.map(m=>{
            if(m.facultatif&&!c.arts_plastiques) return '';
            const isEPS=m.id==='MB08'||(m.id&&m.id.endsWith('_10'));
            const grised=(isEPS&&c.inapt_eps)||c.absent;
            const n=notes[m.id];
            const nStr=grised?(c.absent?'ABS':'INAP'):(n!==undefined?n:'—');
            const pts=!grised&&n!==undefined?(n*m.coef).toFixed(2):'—';
            return `<tr ${grised?'style="opacity:.5"':''}>
              <td>${m.nom}</td><td class="td-mono">${m.coef}</td>
              <td class="td-mono" style="font-weight:600">${nStr}</td>
              <td class="td-mono">${pts}</td>
            </tr>`;
          }).join('')}</tbody>
        </table></div>
        <div style="margin-top:14px;display:flex;gap:10px;justify-content:flex-end">
          <button class="btn btn-outline btn-sm" onclick="window.print()">🖨 Imprimer</button>
        </div>
      </div>`;
  } catch(e){el.innerHTML=`<div class="alert alert-danger">${e.message}</div>`;}
};

// ─────────────────────────────────────────────────────────────
// UTILISATEURS (admin seulement)
// ─────────────────────────────────────────────────────────────
async function renderUtilisateurs() {
  if (G.role !== 'admin') return `<div class="alert alert-danger">Accès réservé à l'administrateur</div>`;
  const profiles = await getProfiles();
  const centres  = G.ref.centres||[];
  return `
    <div class="page-header">
      <div><div class="page-title">Utilisateurs</div>
        <div class="page-subtitle">${profiles.length} utilisateurs enregistrés</div></div>
    </div>
    <div class="alert alert-info" style="margin-bottom:16px">
      Pour créer un nouvel opérateur : allez dans Supabase > Authentication > Users > Add user,
      puis revenez ici pour lui assigner son rôle et son centre.
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>Nom</th><th>Email</th><th>Rôle</th><th>Centre assigné</th><th>Actions</th></tr></thead>
      <tbody>${profiles.map(p=>`<tr>
        <td><strong>${p.nom||'—'}</strong></td>
        <td class="td-mono">${p.email||'—'}</td>
        <td>${badge(p.role==='admin'?'Administrateur':'Opérateur', p.role==='admin'?'red':'blue')}</td>
        <td>${getCentreNom(p.centre_id)||'—'}</td>
        <td><button class="btn btn-xs btn-outline" onclick="editProfile('${p.id}')">✏ Modifier</button></td>
      </tr>`).join('')}</tbody>
    </table></div>`;
}

window.editProfile = async function(id) {
  const profiles = await getProfiles();
  const p = profiles.find(x=>x.id===id); if(!p) return;
  const centres = G.ref.centres||[];
  showModal('Modifier utilisateur',`
    <div class="form-grid">
      <div class="form-group"><label class="form-label">Nom</label>
        <input class="form-input" id="ep_nom" value="${p.nom||''}"/></div>
      <div class="form-group"><label class="form-label">Rôle</label>
        <select class="form-select" id="ep_role">
          <option value="admin" ${p.role==='admin'?'selected':''}>Administrateur</option>
          <option value="operateur" ${p.role==='operateur'?'selected':''}>Opérateur</option>
        </select></div>
      <div class="form-group"><label class="form-label">Centre assigné</label>
        <select class="form-select" id="ep_centre">
          <option value="">Aucun (admin)</option>
          ${centres.map(c=>`<option value="${c.id}" ${p.centre_id===c.id?'selected':''}>${c.nom}</option>`).join('')}
        </select></div>
    </div>`,
    [{ label:'Annuler', cls:'btn-outline', action: closeModal },
     { label:'Sauvegarder', cls:'btn-primary', action: async()=>{
       try {
         await updateProfile(id,{
           nom:document.getElementById('ep_nom').value,
           role:document.getElementById('ep_role').value,
           centre_id:document.getElementById('ep_centre').value||null
         });
         closeModal(); showToast('Profil mis à jour !'); nav('utilisateurs');
       } catch(e){alert(e.message);}
     }}]);
};

// ─────────────────────────────────────────────────────────────
// PARAMÈTRES
// ─────────────────────────────────────────────────────────────
async function renderParametres() {
  const cfg = G.ref.config||{};
  return `
    <div class="page-header">
      <div><div class="page-title">Paramètres</div></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
      <div class="card">
        <div class="card-title">Configuration générale</div>
        <div class="form-group" style="margin-bottom:12px">
          <label class="form-label">Année académique</label>
          <input class="form-input" id="pAnnee" value="${cfg.annee||'2024-2025'}"/></div>
        <div class="form-group" style="margin-bottom:12px">
          <label class="form-label">Région</label>
          <input class="form-input" id="pRegion" value="${cfg.region||'Vallée du Bandama'}"/></div>
        <div class="form-group" style="margin-bottom:12px">
          <label class="form-label">Ville</label>
          <input class="form-input" id="pVille" value="${cfg.ville||'Bouaké'}"/></div>
        <button class="btn btn-primary btn-sm" onclick="saveParams()">Sauvegarder</button>
      </div>
      <div class="card">
        <div class="card-title">Compte connecté</div>
        <div style="font-size:13px;margin-bottom:12px">
          <div>Email : <strong>${G.user?.email||'—'}</strong></div>
          <div style="margin-top:4px">Rôle : <strong>${G.role==='admin'?'🔑 Administrateur':'✏️ Opérateur'}</strong></div>
        </div>
        <div class="alert ${G.role==='admin'?'alert-success':'alert-info'}">
          ${G.role==='admin'?'Accès complet à toutes les fonctionnalités.':'Accès saisie : vous ne pouvez pas modifier les fiches validées.'}
        </div>
      </div>
    </div>`;
}

window.saveParams = async function() {
  try {
    await updateConfig({
      annee:  document.getElementById('pAnnee').value,
      region: document.getElementById('pRegion').value,
      ville:  document.getElementById('pVille').value,
    });
    G.ref = await loadRefData();
    showToast('Paramètres sauvegardés !');
  } catch(e){ alert(e.message); }
};

// Chargement initial du bilan/stats/classement au clic
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('content').addEventListener('click', e => {
    if (e.target.matches('[data-load]')) {
      const fn = e.target.dataset.load;
      if (window[fn]) window[fn]();
    }
  });
});
