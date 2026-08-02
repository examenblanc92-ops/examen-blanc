// ============================================================
// EBR — app.js  (application principale)
// Utilise Supabase pour toutes les données
// ============================================================

import {
  supabase, login, logout, getCurrentUser, loadRefData,
  updateConfig, addEtab, updateEtab, deleteEtab, upsertEtabs,
  addCentre, updateCentre, deleteCentre, upsertCentres,
  getMatieresBepc, getMatieresBac, addMatiereBepc,
  getCandidatsBepc, addCandidatBepc, updateCandidatBepc,
  deleteCandidatBepc, validerBepc, deverrouillerBepc, validerBepcBulk,
  upsertCandidatsBepc, getNotesBepc, upsertNoteBepc, importNotesBepc,
  getCandidatsBac, addCandidatBac, updateCandidatBac,
  deleteCandidatBac, validerBac, deverrouillerBac, validerBacBulk,
  upsertCandidatsBac, getNotesBac, upsertNoteBac, importNotesBac,
  uploadPhoto, getProfiles, updateProfile
} from './supabase.js?v=20260802f';

// ─── ÉTAT GLOBAL ─────────────────────────────────────────────
let G = {
  user:      null,   // utilisateur connecté
  role:      null,   // 'admin' | 'operateur' | 'directeur'
  ref:       {},     // données de référence (config, etabs, centres, matieres)
  page:      'dashboard',
  saison:    'ouverte', // 'ouverte' | 'cloturee'
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
  G.saison = G.ref.config?.statut_saison || 'ouverte';

  // Afficher l'interface
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('appScreen').style.display   = 'flex';

  // Sidebar utilisateur
  const nom = G.user.profile?.nom || G.user.email || 'Utilisateur';
  const roleLabel = G.role === 'directeur' ? '🔑 Directeur Régional'
                  : G.role === 'admin'     ? 'Administrateur' : 'Opérateur';
  document.getElementById('sbNom').textContent    = nom;
  document.getElementById('sbRole').textContent   = roleLabel;
  document.getElementById('sbAvatar').textContent = nom.split(' ').map(w=>w[0]).join('').substring(0,2).toUpperCase();

  // ── ACCÈS PAR RÔLE ──────────────────────────────────────────
  if (G.role === 'directeur') {
    // DIRECTEUR : voit tout + section clôture
    document.getElementById('sbAvatar').style.background = '#7a1a8a';
    // Ajouter le lien clôture dans la sidebar
    const adminSec = document.getElementById('adminSection');
    if (adminSec && !document.getElementById('navCloture')) {
      adminSec.insertAdjacentHTML('afterbegin', `
        <div class="nav-item" id="navCloture" onclick="nav('cloture')" style="color:${G.saison==='cloturee'?'#e74c3c':'rgba(255,200,0,0.9)'}">
          <svg class="nav-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="3" y="7" width="10" height="8" rx="1"/><path d="M5 7V5a3 3 0 0 1 6 0v2"/>
          </svg>
          ${G.saison==='cloturee'?'🔴 Saison CLÔTURÉE':'🟢 Clôture de saison'}
        </div>`);
    }

  } else if (G.role === 'admin') {
    // ADMIN : voit tout SAUF la section Directeur Régional ET SAUF Paramètres (Directeur uniquement)
    // Supprimer IMMÉDIATEMENT toute trace de section directeur
    ['navDirecteurExtra','navCloture','navClotureInfo'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.remove();
    });
    const navParams = document.getElementById('navParametres');
    if (navParams) navParams.style.display = 'none';
    // Juste un indicateur statut saison non cliquable
    const adminSec = document.getElementById('adminSection');
    if (adminSec) {
      const statut = G.saison === 'cloturee'
        ? `<div id="navClotureInfo" style="color:#e74c3c;font-size:11px;padding:6px 20px">🔴 Saison clôturée</div>`
        : `<div id="navClotureInfo" style="color:rgba(255,200,0,0.7);font-size:11px;padding:6px 20px">🟢 Saison ouverte</div>`;
      adminSec.insertAdjacentHTML('afterbegin', statut);
    }

  } else {
    // SUPERVISEUR (opérateur / chef de centre) :
    // Accès autorisé : consultation du Journal des modifications
    // Accès bloqué : Résultats, Classement, Documents, section Directeur,
    //                Utilisateurs, Import photos, Paramètres, clôture de session
    ['navResultats','navClassement','navDocuments',
     'navDirecteurExtra','navCloture','navClotureInfo',
     'navUtilisateurs','navImportPhotos','navParametres'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
    document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'none');
    document.getElementById('sbAvatar').style.background = '#1a6b3a';
  }

  // Bannière clôture si saison fermée
  afficherBanniereCloture();

  // Message du directeur pour tous
  await chargerMessageDirecteur();

  // Section directeur dans la sidebar (uniquement directeur)
  if (G.role === 'directeur') {
    setTimeout(() => {
      _injecterSidebarDirecteur();
      initRealtimeNotifications();
      initPresence();
    }, 300);
  } else {
    // Sécurité : supprimer toute section directeur injectée dynamiquement
    setTimeout(() => {
      ['navDirecteurExtra','navCloture'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.remove();
      });
    }, 1500);
  }

  nav('dashboard');
}

// Vérifier si déjà connecté au chargement
(async () => {
  const { data: { session } } = await supabase.auth.getSession();
  if (session) { await initApp(); }
  else { document.getElementById('loginScreen').style.display = 'flex'; }
})();

// ─── NAVIGATION ──────────────────────────────────────────────
// Pages réservées aux administrateurs uniquement
const PAGES_ADMIN = ['bilan','statistiques','classement','releves','bilan-eleve',
                     'etablissements','centres','matieres','candidats','import-notes'];

window.nav = function(page) {
  // Page clôture : STRICTEMENT réservée au Directeur Régional
  if (page === 'cloture' && G.role !== 'directeur') {
    document.getElementById('content').innerHTML = `
      <div class="card" style="text-align:center;padding:48px">
        <div style="font-size:40px;margin-bottom:12px">⛔</div>
        <div style="font-size:18px;font-weight:600;margin-bottom:8px">Accès interdit</div>
        <div style="color:var(--text2);font-size:13px">Cette section est réservée au Directeur Régional uniquement.</div>
      </div>`;
    return;
  }
  // Pages directeur uniquement (admin et opérateur bloqués)
  const PAGES_DIRECTEUR = ['notifications','connectes','inspecteur','sauvegarde',
                           'alertes-fraude','journal-cnx','rapport-session','utilisateurs','parametres'];
  if (PAGES_DIRECTEUR.includes(page) && G.role !== 'directeur') {
    document.getElementById('content').innerHTML = `
      <div class="card" style="text-align:center;padding:48px">
        <div style="font-size:40px;margin-bottom:12px">⛔</div>
        <div style="font-size:18px;font-weight:600;margin-bottom:8px">Accès interdit</div>
        <div style="color:var(--text2);font-size:13px">Cette section est réservée au Directeur Régional uniquement.</div>
      </div>`;
    return;
  }
  // Pages admin uniquement (opérateur bloqué)
  const isPriv = G.role === 'admin' || G.role === 'directeur';
  if (!isPriv && PAGES_ADMIN.includes(page)) {
    document.getElementById('content').innerHTML = `
      <div class="card" style="text-align:center;padding:48px">
        <div style="font-size:40px;margin-bottom:12px">🔒</div>
        <div style="font-size:18px;font-weight:600;margin-bottom:8px">Accès restreint</div>
        <div style="color:var(--text2);font-size:13px">Cette section est réservée aux administrateurs.</div>
      </div>`;
    return;
  }
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
    'import-photos': renderImportPhotos,
    bilan:          renderBilan,
    statistiques:   renderStatistiques,
    classement:     renderClassement,
    releves:        renderReleves,
    'bilan-eleve':  renderBilanEleve,
    utilisateurs:   renderUtilisateurs,
    parametres:     renderParametres,
    journal:        window.renderJournal,
    'notes-matieres': renderNotesMatieres,
    cloture:        renderCloture,
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
        ${serieStats.map(r=>{
          const pct = r.total > 0 ? Math.round(r.valides/r.total*100) : 0;
          const col = r.s==='C'?'red':r.s==='D'?'amber':r.s==='A1'?'green':'blue';
          return `
          <div style="padding:6px 0;border-bottom:1px solid var(--border)">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">
              <span class="badge badge-${col}" style="width:38px;justify-content:center">Sér.${r.s}</span>
              <span style="flex:1;font-size:13px">${r.total} candidats</span>
              <span class="badge badge-blue">${pct}%</span>
              <span class="badge badge-gray">${r.valides} traités</span>
            </div>
            <div class="progress-bar" style="height:5px"><div class="progress-fill pf-${col==='amber'?'green':col}" style="width:${pct}%"></div></div>
          </div>`;
        }).join('')}
      </div>
    </div>

    <div class="card">
      <div class="card-title">Accès rapide</div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn btn-outline" onclick="nav('saisie-bepc')">✏️ Saisie BEPC</button>
        <button class="btn btn-outline" onclick="nav('saisie-bac')">✏️ Saisie BAC</button>
        <button class="btn btn-outline" onclick="nav('import-notes')">⬇ Import notes</button>
        ${G.role==='admin'?`
        <button class="btn btn-outline" onclick="nav('candidats')">👥 Candidats</button>
        <button class="btn btn-outline" onclick="nav('bilan')">📊 Bilans</button>
        <button class="btn btn-outline" onclick="nav('classement')">🏆 Classement</button>
        <button class="btn btn-outline" onclick="nav('releves')">📄 Relevés</button>
        `:''}
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

// ── Chargement dynamique de SheetJS ──────────────────────────
function loadSheetJS() {
  return new Promise((resolve, reject) => {
    if (window.XLSX) { resolve(); return; }
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    s.onload  = resolve;
    s.onerror = () => reject(new Error('Impossible de charger SheetJS'));
    document.head.appendChild(s);
  });
}

window.downloadModeleCand = async function(type) {
  await loadSheetJS();
  const headers = type === 'bepc'
    ? ['num_table','matricule','nom','prenoms','sexe','classe','etab_id','centre_id']
    : ['num_table','matricule','nom','prenoms','sexe','classe','serie','etab_id','centre_id'];
  const exemple = type === 'bepc'
    ? ['001','BEPC2025001','NOM','Prénoms','M','3eA','ETB001','CTR001']
    : ['B001','BAC2025001','NOM','Prénoms','M','TleD','D','ETB001','CTR001'];

  // Listes de référence pour aider l'utilisateur
  const etabs   = G.ref.etablissements || [];
  const centres = G.ref.centres        || [];

  const wb = XLSX.utils.book_new();

  // Feuille principale : données à remplir
  const wsData = XLSX.utils.aoa_to_sheet([headers, exemple]);
  // Largeur colonnes
  wsData['!cols'] = headers.map(h => ({ wch: Math.max(h.length + 4, 14) }));
  XLSX.utils.book_append_sheet(wb, wsData, 'Candidats');

  // Feuille de référence établissements
  if (etabs.length) {
    const wsEtab = XLSX.utils.aoa_to_sheet([
      ['Code (etab_id)', 'Nom', 'Type', 'Commune'],
      ...etabs.map(e => [e.id, e.nom, e.type||'', e.commune||''])
    ]);
    wsEtab['!cols'] = [{ wch:14 },{ wch:40 },{ wch:12 },{ wch:20 }];
    XLSX.utils.book_append_sheet(wb, wsEtab, 'Établissements (ref)');
  }

  // Feuille de référence centres
  if (centres.length) {
    const wsCtr = XLSX.utils.aoa_to_sheet([
      ['Code (centre_id)', 'Nom', 'Ville'],
      ...centres.map(c => [c.id, c.nom, c.ville||''])
    ]);
    wsCtr['!cols'] = [{ wch:16 },{ wch:40 },{ wch:20 }];
    XLSX.utils.book_append_sheet(wb, wsCtr, 'Centres (ref)');
  }

  XLSX.writeFile(wb, `modele_candidats_${type}.xlsx`);
  showToast('Modèle Excel téléchargé !');
};

window.showImportCandidats = function() {
  showModal('Importer candidats (Excel .xlsx)', `
    <div class="alert alert-info" style="font-size:12px">
      📌 Colonnes requises : <strong>num_table, matricule, nom, prenoms, sexe, classe, etab_id, centre_id</strong>
      ${''} (+ <strong>serie</strong> pour le BAC)<br>
      💡 Utilisez le bouton <em>⬇ Modèle</em> pour télécharger un fichier pré-formaté avec les codes des établissements et centres.
    </div>
    <div class="form-group" style="margin:12px 0"><label class="form-label">Type d'examen</label>
      <select class="form-select" id="imp_type"><option value="bepc">BEPC</option><option value="bac">BAC</option></select></div>
    <div class="import-zone" onclick="document.getElementById('impFile').click()" style="cursor:pointer">
      <div class="import-icon">📊</div>
      <div class="import-title">Choisir fichier Excel (.xlsx)</div>
      <div class="import-sub">Cliquez ou glissez-déposez votre fichier</div>
    </div>
    <input type="file" id="impFile" accept=".xlsx,.xls" style="display:none" onchange="processImportCand(this)"/>
    <div id="impPreview" style="margin-top:12px"></div>`,
    [{ label:'Fermer', cls:'btn-outline', action: closeModal }]);
};

window.processImportCand = async function(input) {
  const file = input.files[0]; if (!file) return;
  const type = document.getElementById('imp_type').value;
  const preview = document.getElementById('impPreview');
  preview.innerHTML = '<div style="font-size:12px;color:var(--text2)">⏳ Lecture du fichier...</div>';

  try {
    await loadSheetJS();
  } catch(e) {
    preview.innerHTML = `<div class="alert alert-danger">Erreur chargement SheetJS : ${e.message}</div>`;
    return;
  }

  // Déterminer le type de lecture selon l'extension
  const fileName = file.name.toLowerCase();
  const isXls = fileName.endsWith('.xls') && !fileName.endsWith('.xlsx');

  const reader = new FileReader();
  reader.onload = async function(ev) {
    try {
      let wb;
      if (isXls) {
        // Ancien format .xls binaire : lire en binary string
        wb = XLSX.read(ev.target.result, { type: 'binary', cellDates: true });
      } else {
        // Format .xlsx moderne : lire en array buffer
        const data = new Uint8Array(ev.target.result);
        wb = XLSX.read(data, { type: 'array', cellDates: true });
      }
      // Utiliser la première feuille (feuille "Candidats" si elle existe)
      const sheetName = wb.SheetNames.includes('Candidats') ? 'Candidats' : wb.SheetNames[0];
      const ws      = wb.Sheets[sheetName];
      const jsonRows = XLSX.utils.sheet_to_json(ws, { defval: '' });

      if (!jsonRows.length) {
        preview.innerHTML = `<div class="alert alert-danger">Aucune donnée trouvée dans la feuille "${sheetName}".</div>`;
        return;
      }

      // Normaliser les noms de colonnes (minuscules, sans espaces, sans accents)
      const normalizeKey = (k) => k.trim().toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
        .replace(/\s+/g,'_').replace(/[^a-z0-9_]/g,'');
      const normalize = (rows) => rows.map(row => {
        const n = {};
        // Garde aussi les colonnes originales pour débogage
        Object.keys(row).forEach(k => {
          const nk = normalizeKey(k);
          n[nk] = String(row[k]).trim();
          // Alias supplémentaires pour colonnes "Etablissement" dupliquées (G et H)
          if (!n['etab_id'] && (nk.includes('etablissement') || nk.includes('etab'))) {
            n['etab_id'] = n['etab_id'] || String(row[k]).trim();
          }
        });
        return n;
      });
      const normRows = normalize(jsonRows);

      // Maps nom→id depuis les données de référence
      const etabs   = G.ref.etablissements || [];
      const centres = G.ref.centres        || [];
      const etabById    = {};
      const centreById  = {};
      const etabByNom   = {};
      const centreByNom = {};

      // Fonction de normalisation : retire accents, ponctuation, met en minuscules
      const normalizeStr = (s) => (s||'').toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
        .replace(/[^a-z0-9\s]/g,'').replace(/\s+/g,' ').trim();

      etabs.forEach(e => {
        etabById[e.id.toLowerCase()] = e.id;
        etabByNom[normalizeStr(e.nom)] = e.id;
      });
      centres.forEach(c => {
        centreById[c.id.toLowerCase()] = c.id;
        centreByNom[normalizeStr(c.nom)] = c.id;
      });

      // Résolution intelligente : code exact → nom exact normalisé → recherche partielle → mots clés communs
      const resolveId = (raw, byId, byNom) => {
        if (!raw) return '';
        const lo = raw.toLowerCase().trim();
        const norm = normalizeStr(raw);
        // 1. Code exact (ex: ETB001)
        if (byId[lo]) return byId[lo];
        // 2. Nom exact normalisé
        if (byNom[norm]) return byNom[norm];
        // 3. La valeur contient un code connu (ex: "ETB001 - Lycée...")
        const codeMatch = lo.match(/[a-z]{2,4}\d{3}/);
        if (codeMatch && byId[codeMatch[0]]) return byId[codeMatch[0]];
        // 4. Recherche partielle : est-ce que le nom de référence est contenu dans la valeur ?
        for (const [k, v] of Object.entries(byNom)) {
          if (norm.includes(k) || k.includes(norm)) return v;
        }
        // 5. Correspondance par mots-clés significatifs (≥4 lettres)
        const words = norm.split(' ').filter(w => w.length >= 4);
        for (const w of words) {
          for (const [k, v] of Object.entries(byNom)) {
            if (k.includes(w)) return v;
          }
        }
        return '';
      };

      const rows    = [];
      const erreurs = [];

      normRows.forEach((obj, idx) => {
        const lineNum = idx + 2; // ligne Excel (entête = 1)
        if (!obj.matricule) return;

        // Résoudre etab_id : cherche dans toutes les colonnes possibles
        let etabId = '';
        const rawEtab = obj.etab_id || obj.etablissement || obj['etablissement'] || obj['etab'] || obj['g'] || obj['h'] || '';
        if (rawEtab) {
          etabId = resolveId(rawEtab, etabById, etabByNom);
        }

        // Résoudre centre_id : cherche dans toutes les colonnes possibles
        let centreId = '';
        const rawCtr = obj.centre_id || obj.centre || '';
        if (rawCtr) {
          centreId = resolveId(rawCtr, centreById, centreByNom);
        }

        // Si centre vide mais etab trouvé, on peut accepter sans centre si un seul centre existe
        if (!centreId && centres.length === 1) {
          centreId = centres[0].id;
        }

        if (!etabId) {
          erreurs.push(`Ligne ${lineNum} (${obj.matricule}) : établissement "${rawEtab}" introuvable`);
          return;
        }
        if (!centreId) {
          erreurs.push(`Ligne ${lineNum} (${obj.matricule}) : centre "${rawCtr}" introuvable`);
          return;
        }

        const row = {
          num_table:  obj.num_table || obj.numtable || String(idx+1),
          matricule:  obj.matricule,
          nom:        (obj.nom||'').toUpperCase(),
          prenoms:    obj.prenoms||obj['prénoms']||'',
          sexe:       (obj.sexe||'M').charAt(0).toUpperCase(),
          classe:     obj.classe||'',
          etab_id:    etabId,
          centre_id:  centreId,
        };
        if (type === 'bac' && obj.serie) row.serie = obj.serie.trim();
        rows.push(row);
      });

      // Aperçu
      const previewHtml = `
        <div style="font-size:12px;margin-bottom:8px">
          <span style="color:var(--green);font-weight:600">✓ ${rows.length} ligne(s) valide(s)</span>
          ${erreurs.length ? `&nbsp;·&nbsp; <span style="color:var(--red);font-weight:600">⚠ ${erreurs.length} erreur(s)</span>` : ''}
        </div>
        ${erreurs.length ? `<div class="alert alert-warning" style="font-size:11px;max-height:80px;overflow-y:auto">${erreurs.slice(0,5).map(e=>`• ${e}`).join('<br>')}${erreurs.length>5?`<br>...et ${erreurs.length-5} autres`:''}</div>` : ''}
        ${rows.length ? `<button class="btn btn-primary btn-sm" onclick="confirmerImportCand()">✅ Importer ${rows.length} candidat(s)</button>` : ''}`;
      preview.innerHTML = previewHtml;

      // Stocker en mémoire pour confirmation
      window._pendingImport = { rows, type, erreurs };

      if (erreurs.length && rows.length) {
        if (!confirm(`⚠️ ${erreurs.length} ligne(s) ignorée(s).\n\nImporter les ${rows.length} lignes valides quand même ?`)) {
          preview.innerHTML = '<div class="alert alert-info">Import annulé.</div>';
          window._pendingImport = null; return;
        }
        await confirmerImportCand();
      } else if (rows.length && !erreurs.length) {
        await confirmerImportCand();
      }

    } catch(e) {
      preview.innerHTML = `<div class="alert alert-danger">❌ Erreur lecture Excel : ${e.message}</div>`;
    }
  };
  // Lire selon le format : binary string pour .xls, array buffer pour .xlsx
  if (isXls) {
    reader.readAsBinaryString(file);
  } else {
    reader.readAsArrayBuffer(file);
  }
};

window.confirmerImportCand = async function() {
  const p = window._pendingImport;
  if (!p || !p.rows.length) return;
  try {
    if (p.type === 'bepc') await upsertCandidatsBepc(p.rows);
    else                   await upsertCandidatsBac(p.rows);
    window._pendingImport = null;
    closeModal();
    showToast(`✓ ${p.rows.length} candidat(s) importé(s) avec succès !`);
    G.ref = await loadRefData();
    nav('candidats');
  } catch(e) {
    alert('Erreur import : ' + e.message);
  }
};

// ─────────────────────────────────────────────────────────────
// PARTIE I — ÉTABLISSEMENTS / CENTRES / MATIÈRES
// ─────────────────────────────────────────────────────────────
async function renderEtablissements() {
  G.ref = await loadRefData(); // toujours recharger depuis Supabase
  const etabs = G.ref.etablissements || [];
  return `
    <div class="page-header">
      <div><div class="page-title">Établissements</div>
        <div class="page-subtitle">${etabs.length} établissements</div></div>
      <div class="header-actions">
        <button class="btn btn-outline btn-sm" onclick="downloadModeleRef('etab')">⬇ Modèle Excel</button>
        <button class="btn btn-outline btn-sm" onclick="showImportRef('etab')">📂 Importer</button>
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
          <button class="btn btn-xs btn-outline" data-edit-etab="${e.id}">✏</button>
          <button class="btn btn-xs btn-danger" data-del-etab="${e.id}" style="margin-left:4px">✕</button>`:''}</td>
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
  if (!confirm('Supprimer cet établissement ?')) return;
  try {
    const { data, error } = await supabase.from('etablissements').delete().eq('id', id).select();
    if (error) throw error;
    G.ref = await loadRefData();
    showToast('Établissement supprimé.');
    nav('etablissements');
  } catch(e) { alert('Erreur suppression établissement : ' + e.message); }
};

async function renderCentres() {
  G.ref = await loadRefData(); // toujours recharger depuis Supabase
  const centres = G.ref.centres || [];
  return `
    <div class="page-header">
      <div><div class="page-title">Centres d'examen</div></div>
      <div class="header-actions">
        <button class="btn btn-outline btn-sm" onclick="downloadModeleRef('centre')">⬇ Modèle Excel</button>
        <button class="btn btn-outline btn-sm" onclick="showImportRef('centre')">📂 Importer</button>
        ${G.role==='admin'?`<button class="btn btn-primary btn-sm" onclick="showAddCentre()">+ Ajouter</button>`:''}
      </div>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>Code</th><th>Nom</th><th>Ville</th><th>Capacité</th><th>Actions</th></tr></thead>
      <tbody>${centres.map(c=>`<tr>
        <td class="td-mono">${c.id}</td><td><strong>${c.nom}</strong></td>
        <td>${c.ville}</td><td class="td-mono">${c.capacite||'—'}</td>
        <td>${G.role==='admin'?`
          <button class="btn btn-xs btn-outline" data-edit-centre="${c.id}">✏</button>
          <button class="btn btn-xs btn-danger" data-del-centre="${c.id}" style="margin-left:4px">✕</button>`:''}</td>
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
      <div class="form-group"><label class="form-label">Nom</label><input class="form-input" id="ctr_nom" value="${c.nom}"/></div>
      <div class="form-group"><label class="form-label">Ville</label><input class="form-input" id="ctr_vil" value="${c.ville}"/></div>
      <div class="form-group"><label class="form-label">Capacité</label><input class="form-input" id="ctr_cap" type="number" value="${c.capacite||0}"/></div>
    </div>`,
    [{ label:'Annuler', cls:'btn-outline', action: closeModal },
     { label:'Sauvegarder', cls:'btn-primary', action: async()=>{
       try{await updateCentre(id,{nom:document.getElementById('ctr_nom').value,ville:document.getElementById('ctr_vil').value,capacite:parseInt(document.getElementById('ctr_cap').value)||0});
       G.ref=await loadRefData();closeModal();showToast('Modifié!');nav('centres');}catch(e){alert(e.message);}
     }}]);
};

window.doDeleteCentre = async function(id) {
  if (!confirm('Supprimer ce centre ?')) return;
  try {
    const { data, error } = await supabase.from('centres').delete().eq('id', id).select();
    if (error) throw error;
    G.ref = await loadRefData();
    showToast('Centre supprimé.');
    nav('centres');
  } catch(e) { alert('Erreur suppression centre : ' + e.message); }
};

// ─── IMPORT / MODÈLE EXCEL — ÉTABLISSEMENTS & CENTRES ────────
window.downloadModeleRef = async function(type) {
  await loadSheetJS();
  const isEtab = type === 'etab';
  const headers = isEtab
    ? ['id','nom','type','commune']
    : ['id','nom','ville','capacite'];
  const exemple = isEtab
    ? ['ETB006','Lycée Moderne Exemple','Lycée','Bouaké']
    : ['CTR004','Centre Exemple','Bouaké','200'];

  const wb = XLSX.utils.book_new();
  const wsData = XLSX.utils.aoa_to_sheet([headers, exemple]);
  wsData['!cols'] = headers.map(h => ({ wch: Math.max(h.length + 4, 14) }));
  XLSX.utils.book_append_sheet(wb, wsData, isEtab ? 'Établissements' : 'Centres');

  XLSX.writeFile(wb, isEtab ? 'modele_etablissements.xlsx' : 'modele_centres.xlsx');
  showToast('Modèle Excel téléchargé !');
};

window.showImportRef = function(type) {
  const isEtab = type === 'etab';
  showModal(isEtab ? 'Importer établissements (Excel .xlsx/.xls)' : "Importer centres d'examen (Excel .xlsx/.xls)", `
    <div class="alert alert-info" style="font-size:12px">
      📌 Colonnes requises : ${isEtab
        ? '<strong>id, nom, type, commune</strong>'
        : '<strong>id, nom, ville, capacite</strong>'}<br>
      💡 Utilisez le bouton <em>⬇ Modèle Excel</em> pour télécharger un fichier pré-formaté.
    </div>
    <div class="import-zone" onclick="document.getElementById('impRefFile').click()" style="cursor:pointer">
      <div class="import-icon">📊</div>
      <div class="import-title">Choisir fichier Excel (.xlsx ou .xls)</div>
      <div class="import-sub">Cliquez ou glissez-déposez votre fichier</div>
    </div>
    <input type="file" id="impRefFile" accept=".xlsx,.xls" style="display:none" onchange="processImportRef(this,'${type}')"/>
    <div id="impRefPreview" style="margin-top:12px"></div>`,
    [{ label:'Fermer', cls:'btn-outline', action: closeModal }]);
};

window.processImportRef = async function(input, type) {
  const file = input.files[0]; if (!file) return;
  const isEtab = type === 'etab';
  const preview = document.getElementById('impRefPreview');
  preview.innerHTML = '<div style="font-size:12px;color:var(--text2)">⏳ Lecture du fichier...</div>';

  try {
    await loadSheetJS();
  } catch(e) {
    preview.innerHTML = `<div class="alert alert-danger">Erreur chargement SheetJS : ${e.message}</div>`;
    return;
  }

  const fileName = file.name.toLowerCase();
  const isXls = fileName.endsWith('.xls') && !fileName.endsWith('.xlsx');

  const reader = new FileReader();
  reader.onload = async function(ev) {
    try {
      let wb;
      if (isXls) {
        wb = XLSX.read(ev.target.result, { type: 'binary', cellDates: true });
      } else {
        const data = new Uint8Array(ev.target.result);
        wb = XLSX.read(data, { type: 'array', cellDates: true });
      }
      const sheetLabel = isEtab ? 'Établissements' : 'Centres';
      const sheetName = wb.SheetNames.includes(sheetLabel) ? sheetLabel : wb.SheetNames[0];
      const ws = wb.Sheets[sheetName];
      const jsonRows = XLSX.utils.sheet_to_json(ws, { defval: '' });

      if (!jsonRows.length) {
        preview.innerHTML = `<div class="alert alert-danger">Aucune donnée trouvée dans la feuille "${sheetName}".</div>`;
        return;
      }

      const normalizeKey = (k) => k.trim().toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
        .replace(/\s+/g,'_').replace(/[^a-z0-9_]/g,'');
      const normRows = jsonRows.map(row => {
        const n = {};
        Object.keys(row).forEach(k => { n[normalizeKey(k)] = String(row[k]).trim(); });
        return n;
      });

      const rows = [];
      const erreurs = [];
      normRows.forEach((obj, idx) => {
        const lineNum = idx + 2; // ligne Excel (entête = 1)
        const id  = obj.id || obj.code || '';
        const nom = obj.nom || '';
        if (!id || !nom) { erreurs.push(`Ligne ${lineNum} : code (id) et nom obligatoires`); return; }
        if (isEtab) {
          rows.push({
            id: id.toUpperCase(),
            nom,
            type: obj.type || 'Lycée',
            commune: obj.commune || obj.ville || ''
          });
        } else {
          rows.push({
            id: id.toUpperCase(),
            nom,
            ville: obj.ville || obj.commune || '',
            capacite: parseInt(obj.capacite || obj.capacite_ || 0) || 0
          });
        }
      });

      const label = isEtab ? 'établissement(s)' : 'centre(s)';
      const previewHtml = `
        <div style="font-size:12px;margin-bottom:8px">
          <span style="color:var(--green);font-weight:600">✓ ${rows.length} ligne(s) valide(s)</span>
          ${erreurs.length ? `&nbsp;·&nbsp; <span style="color:var(--red);font-weight:600">⚠ ${erreurs.length} erreur(s)</span>` : ''}
        </div>
        ${erreurs.length ? `<div class="alert alert-warning" style="font-size:11px;max-height:80px;overflow-y:auto">${erreurs.slice(0,5).map(e=>`• ${e}`).join('<br>')}${erreurs.length>5?`<br>...et ${erreurs.length-5} autres`:''}</div>` : ''}
        ${rows.length ? `<button class="btn btn-primary btn-sm" onclick="confirmerImportRef('${type}')">✅ Importer ${rows.length} ${label}</button>` : ''}`;
      preview.innerHTML = previewHtml;

      window._pendingImportRef = { rows, type, erreurs };

      if (erreurs.length && rows.length) {
        if (!confirm(`⚠️ ${erreurs.length} ligne(s) ignorée(s).\n\nImporter les ${rows.length} lignes valides quand même ?`)) {
          preview.innerHTML = '<div class="alert alert-info">Import annulé.</div>';
          window._pendingImportRef = null; return;
        }
        await confirmerImportRef(type);
      } else if (rows.length && !erreurs.length) {
        await confirmerImportRef(type);
      }

    } catch(e) {
      preview.innerHTML = `<div class="alert alert-danger">❌ Erreur lecture Excel : ${e.message}</div>`;
    }
  };
  if (isXls) {
    reader.readAsBinaryString(file);
  } else {
    reader.readAsArrayBuffer(file);
  }
};

window.confirmerImportRef = async function(type) {
  const p = window._pendingImportRef;
  if (!p || !p.rows.length) return;
  const isEtab = p.type === 'etab';
  try {
    if (isEtab) await upsertEtabs(p.rows);
    else        await upsertCentres(p.rows);
    window._pendingImportRef = null;
    closeModal();
    showToast(`✓ ${p.rows.length} ${isEtab?'établissement(s)':'centre(s)'} importé(s) avec succès !`);
    G.ref = await loadRefData();
    nav(isEtab ? 'etablissements' : 'centres');
  } catch(e) {
    alert('Erreur import : ' + e.message);
  }
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
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
        <strong id="sbCentreNom"></strong>
        <button class="btn btn-success btn-sm" onclick="validerGroupeBepc(document.getElementById('sbCentre').value)">✓✓ Valider groupé</button>
      </div>
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

  // Mémoriser les valeurs actuelles comme référence "avant" pour la traçabilité,
  // sans écraser une valeur déjà suivie pendant la session en cours
  if (!window._sbNotesAvant) window._sbNotesAvant = {};
  Object.keys(notesMap).forEach(candId => {
    if (!window._sbNotesAvant[candId]) window._sbNotesAvant[candId] = {};
    Object.keys(notesMap[candId]).forEach(matId => {
      if (window._sbNotesAvant[candId][matId] === undefined) {
        window._sbNotesAvant[candId][matId] = notesMap[candId][matId];
      }
    });
  });

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
  if (G.saison === 'cloturee') {
    showToast('🔴 Saison clôturée — saisie impossible. Contactez le Directeur Régional.', 'danger');
    return;
  }
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
      if (note !== null) {
        const noteAvant = window._sbNotesAvant?.[candidatId]?.[matiereId] ?? null;
        await upsertNoteBepc(candidatId, matiereId, note, G.user.id);
        await logModification('bepc', candidatId, matiereId, noteAvant, note, '', cand);
        if (!window._sbNotesAvant) window._sbNotesAvant = {};
        if (!window._sbNotesAvant[candidatId]) window._sbNotesAvant[candidatId] = {};
        window._sbNotesAvant[candidatId][matiereId] = note;
      }
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

window.validerGroupeBepc = async function(centreId) {
  if (!centreId) return;
  const cands = (window._sbCands || []).filter(c => !c.valide);
  if (!cands.length) { showToast('Aucune fiche à valider — tout est déjà validé.'); return; }

  const notesMap = window._sbNotes || {};
  let incompletes = 0;
  cands.forEach(c => {
    if (c.absent) return;
    const res = calcMoyenneBepc(notesMap[c.id]||{}, c.inapt_eps, c.arts_plastiques);
    if (res.moy === null) incompletes++;
  });

  let msg = `Valider ${cands.length} fiche(s) d'un coup ?\nElles seront toutes verrouillées.`;
  if (incompletes) msg += `\n\n⚠️ Attention : ${incompletes} candidat(s) n'ont pas encore toutes leurs notes saisies.`;
  if (!confirm(msg)) return;

  try {
    showToast('⏳ Validation en cours...');
    await validerBepcBulk(cands.map(c=>c.id), G.user.id);
    cands.forEach(c => { c.valide = true; });
    await renderSaisieBepcList(centreId, window._sbCands||[]);
    showToast(`✓ ${cands.length} fiche(s) validée(s) !`);
  } catch(e) { alert('Erreur : ' + e.message); }
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
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
        <strong id="sBCentreNom"></strong>
        <button class="btn btn-success btn-sm" onclick="validerGroupeBac(document.getElementById('sBCentre').value, document.getElementById('sBSerie').value)">✓✓ Valider groupé</button>
      </div>
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

  // Mémoriser les valeurs actuelles comme référence "avant" pour la traçabilité,
  // sans écraser une valeur déjà suivie pendant la session en cours
  if (!window._sBNotesAvant) window._sBNotesAvant = {};
  Object.keys(notesMap).forEach(candId => {
    if (!window._sBNotesAvant[candId]) window._sBNotesAvant[candId] = {};
    Object.keys(notesMap[candId]).forEach(matId => {
      if (window._sBNotesAvant[candId][matId] === undefined) {
        window._sBNotesAvant[candId][matId] = notesMap[candId][matId];
      }
    });
  });

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
  if (G.saison === 'cloturee') {
    showToast('🔴 Saison clôturée — saisie impossible. Contactez le Directeur Régional.', 'danger');
    return;
  }
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
    try {
      if(note!==null) {
        const noteAvant = window._sBNotesAvant?.[candidatId]?.[matiereId] ?? null;
        await upsertNoteBac(candidatId, matiereId, note, G.user.id);
        await logModification('bac', candidatId, matiereId, noteAvant, note, '', cand);
        if (!window._sBNotesAvant) window._sBNotesAvant = {};
        if (!window._sBNotesAvant[candidatId]) window._sBNotesAvant[candidatId] = {};
        window._sBNotesAvant[candidatId][matiereId] = note;
      }
    }
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

window.validerGroupeBac = async function(centreId, serie) {
  if (!centreId) return;
  const cands = (window._sBCands || []).filter(c => !c.valide);
  if (!cands.length) { showToast('Aucune fiche à valider — tout est déjà validé.'); return; }

  const notesMap = window._sBNotes || {};
  let incompletes = 0;
  cands.forEach(c => {
    if (c.absent) return;
    const res = calcMoyenneBac(notesMap[c.id]||{}, c.serie, c.inapt_eps);
    if (res.moy === null) incompletes++;
  });

  let msg = `Valider ${cands.length} fiche(s) d'un coup ?\nElles seront toutes verrouillées.`;
  if (incompletes) msg += `\n\n⚠️ Attention : ${incompletes} candidat(s) n'ont pas encore toutes leurs notes saisies.`;
  if (!confirm(msg)) return;

  try {
    showToast('⏳ Validation en cours...');
    await validerBacBulk(cands.map(c=>c.id), G.user.id);
    cands.forEach(c => { c.valide = true; });
    await renderSaisieBacList(centreId, serie, window._sBCands||[]);
    showToast(`✓ ${cands.length} fiche(s) validée(s) !`);
  } catch(e) { alert('Erreur : ' + e.message); }
};

// ─────────────────────────────────────────────────────────────
// PARTIE II — IMPORT NOTES
// ─────────────────────────────────────────────────────────────
async function renderImportNotes() {
  return `
    <div class="page-header">
      <div><div class="page-title">Import des notes (Excel)</div></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
      <div class="card">
        <div class="card-title">Notes BEPC</div>
        <div class="alert alert-info" style="font-size:12px">
          📌 Téléchargez le modèle Excel (une ligne par candidat, une colonne par matière), remplissez les notes, puis réimportez-le.
        </div>
        <div class="import-zone" style="margin-top:10px" onclick="document.getElementById('impNB').click()">
          <div class="import-icon">📊</div><div class="import-title">Importer notes BEPC</div>
          <div class="import-sub">Fichier Excel (.xlsx ou .xls)</div>
        </div>
        <input type="file" id="impNB" accept=".xlsx,.xls" style="display:none" onchange="processImportNotes(this,'bepc')"/>
        <div id="impNBPreview" style="margin-top:10px"></div>
        <button class="btn btn-outline btn-sm" style="margin-top:10px" onclick="downloadModeleNotes('bepc')">⬇ Modèle Excel</button>
      </div>
      <div class="card">
        <div class="card-title">Notes BAC</div>
        <div class="alert alert-info" style="font-size:12px">
          📌 Le modèle contient un onglet par série (une ligne par candidat, une colonne par matière).
        </div>
        <div class="import-zone" style="margin-top:10px" onclick="document.getElementById('impNBAC').click()">
          <div class="import-icon">📊</div><div class="import-title">Importer notes BAC</div>
          <div class="import-sub">Fichier Excel (.xlsx ou .xls)</div>
        </div>
        <input type="file" id="impNBAC" accept=".xlsx,.xls" style="display:none" onchange="processImportNotes(this,'bac')"/>
        <div id="impNBACPreview" style="margin-top:10px"></div>
        <button class="btn btn-outline btn-sm" style="margin-top:10px" onclick="downloadModeleNotes('bac')">⬇ Modèle Excel</button>
      </div>
    </div>`;
}

// ─── Modèle Excel (une ligne par candidat, une colonne par matière) ──
window.downloadModeleNotes = async function(type) {
  await loadSheetJS();
  try {
    const wb = XLSX.utils.book_new();

    if (type === 'bepc') {
      const mats  = G.ref.matBepc || [];
      const cands = await getCandidatsBepc();
      const headers = ['matricule','nom','prenoms', ...mats.map(m=>m.id)];
      const rows = cands.length
        ? cands.map(c => [c.matricule, c.nom||'', c.prenoms||'', ...mats.map(()=>'')])
        : [['VOTRE_MATRICULE','NOM','Prénoms', ...mats.map(()=>'')]];
      const wsData = XLSX.utils.aoa_to_sheet([headers, ...rows]);
      wsData['!cols'] = headers.map(h => ({ wch: Math.max(String(h).length + 4, 10) }));
      XLSX.utils.book_append_sheet(wb, wsData, 'Notes BEPC');

      const wsRef = XLSX.utils.aoa_to_sheet([
        ['Code (colonne)', 'Matière', 'Facultative'],
        ...mats.map(m => [m.id, m.nom, m.facultatif ? 'Oui' : 'Non'])
      ]);
      wsRef['!cols'] = [{ wch:14 },{ wch:32 },{ wch:14 }];
      XLSX.utils.book_append_sheet(wb, wsRef, 'Matières (ref)');

    } else {
      const matBac    = G.ref.matBac || {};
      const allCands  = await getCandidatsBac();
      const series    = Object.keys(matBac);
      let sheetsAdded = 0;

      series.forEach(serie => {
        const mats  = matBac[serie] || [];
        const cands = allCands.filter(c => c.serie === serie);
        if (!mats.length) return;
        const headers = ['matricule','nom','prenoms', ...mats.map(m=>m.id)];
        const rows = cands.length
          ? cands.map(c => [c.matricule, c.nom||'', c.prenoms||'', ...mats.map(()=>'')])
          : [['VOTRE_MATRICULE','NOM','Prénoms', ...mats.map(()=>'')]];
        const wsData = XLSX.utils.aoa_to_sheet([headers, ...rows]);
        wsData['!cols'] = headers.map(h => ({ wch: Math.max(String(h).length + 4, 10) }));
        const safeName = ('Notes ' + serie).replace(/[\\/?*[\]:]/g,'').slice(0,31);
        XLSX.utils.book_append_sheet(wb, wsData, safeName);
        sheetsAdded++;
      });

      if (!sheetsAdded) {
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['matricule','nom','prenoms']]), 'Notes BAC');
      }

      const refRows = [['Série','Code (colonne)','Matière']];
      series.forEach(s => (matBac[s]||[]).forEach(m => refRows.push([s, m.id, m.nom])));
      const wsRef = XLSX.utils.aoa_to_sheet(refRows);
      wsRef['!cols'] = [{ wch:10 },{ wch:14 },{ wch:32 }];
      XLSX.utils.book_append_sheet(wb, wsRef, 'Matières (ref)');
    }

    XLSX.writeFile(wb, `modele_notes_${type}.xlsx`);
    showToast('Modèle Excel téléchargé !');
  } catch(e) {
    alert('Erreur génération du modèle : ' + e.message);
  }
};

// ─── Import du fichier Excel rempli ──────────────────────────
window.processImportNotes = async function(input, type) {
  if (G.saison === 'cloturee') {
    alert('🔴 Saison clôturée — import impossible. Contactez le Directeur Régional.');
    return;
  }
  const file = input.files[0]; if (!file) return;
  const previewId = type === 'bepc' ? 'impNBPreview' : 'impNBACPreview';
  const preview = document.getElementById(previewId);
  if (preview) preview.innerHTML = '<div style="font-size:12px;color:var(--text2)">⏳ Lecture du fichier...</div>';

  try {
    await loadSheetJS();
  } catch(e) {
    if (preview) preview.innerHTML = `<div class="alert alert-danger">Erreur chargement moteur Excel : ${e.message}</div>`;
    return;
  }

  const fileName = file.name.toLowerCase();
  const isXls = fileName.endsWith('.xls') && !fileName.endsWith('.xlsx');

  const reader = new FileReader();
  reader.onload = async function(ev) {
    try {
      let wb;
      if (isXls) {
        wb = XLSX.read(ev.target.result, { type: 'binary', cellDates: true });
      } else {
        const data = new Uint8Array(ev.target.result);
        wb = XLSX.read(data, { type: 'array', cellDates: true });
      }

      // Ensemble des codes matière valides selon le type
      const matiereIds = new Set();
      if (type === 'bepc') {
        (G.ref.matBepc || []).forEach(m => matiereIds.add(m.id));
      } else {
        Object.values(G.ref.matBac || {}).forEach(list => list.forEach(m => matiereIds.add(m.id)));
      }

      const allCands = type === 'bepc' ? await getCandidatsBepc() : await getCandidatsBac();
      const matMap = {};
      allCands.forEach(c => { matMap[c.matricule.toUpperCase()] = c.id; });

      const rows = [];
      let ignoresLignes = 0, ignoresCellules = 0;

      wb.SheetNames.forEach(sheetName => {
        if (/r[ée]f/i.test(sheetName)) return; // on saute la feuille "(ref)"
        const ws = wb.Sheets[sheetName];
        const jsonRows = XLSX.utils.sheet_to_json(ws, { defval: '' });

        jsonRows.forEach(obj => {
          const norm = {};
          Object.keys(obj).forEach(k => { norm[k.trim()] = obj[k]; });
          const matriculeKey = Object.keys(norm).find(k => k.toLowerCase() === 'matricule');
          const matricule = matriculeKey ? String(norm[matriculeKey]).trim().toUpperCase() : '';
          const candidatId = matMap[matricule];
          if (!candidatId) { if (matricule) ignoresLignes++; return; }

          Object.keys(norm).forEach(col => {
            if (!matiereIds.has(col)) return; // colonnes non-matière (nom, prénoms…) ignorées
            const raw = norm[col];
            if (raw === '' || raw === null || raw === undefined) return; // case vide = rien à importer
            const note = parseFloat(String(raw).trim().replace(',', '.'));
            if (isNaN(note)) { ignoresCellules++; return; }
            rows.push({ candidat_id: candidatId, matiere_id: col, note });
          });
        });
      });

      if (!rows.length) {
        if (preview) preview.innerHTML = `<div class="alert alert-danger">
          Aucune note valide trouvée.
          ${ignoresLignes ? `<br>${ignoresLignes} ligne(s) avec un matricule non reconnu.` : ''}
          ${ignoresCellules ? `<br>${ignoresCellules} cellule(s) illisible(s).` : ''}
          <br>Vérifiez que les matricules correspondent bien à des candidats déjà enregistrés.
        </div>`;
        return;
      }

      if (type === 'bepc') await importNotesBepc(rows);
      else                 await importNotesBac(rows);

      const msg = `✓ ${rows.length} note(s) importée(s) avec succès !`
        + (ignoresLignes   ? ` (${ignoresLignes} ligne(s) ignorée(s) — matricule non reconnu)` : '')
        + (ignoresCellules ? ` (${ignoresCellules} cellule(s) ignorée(s) — valeur invalide)`   : '');
      if (preview) preview.innerHTML = `<div class="alert alert-info" style="font-size:12px">${msg}</div>`;
      showToast(`✓ ${rows.length} note(s) importée(s) !`);

    } catch(e) {
      if (preview) preview.innerHTML = `<div class="alert alert-danger">❌ Erreur lecture Excel : ${e.message}</div>`;
    }
  };
  if (isXls) reader.readAsBinaryString(file);
  else       reader.readAsArrayBuffer(file);
};

// ─────────────────────────────────────────────────────────────
// IMPORT PHOTOS
// ─────────────────────────────────────────────────────────────
async function renderImportPhotos() {
  return `
    <div class="page-header">
      <div>
        <div class="page-title">Import des photos</div>
        <div class="page-subtitle">Importez les photos des candidats BEPC et BAC</div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px">
      <div class="card">
        <div class="card-title">📸 Photos BEPC</div>
        <p style="font-size:12px;color:var(--text2);margin-bottom:12px">
          Sélectionnez plusieurs photos à la fois.<br/>
          Le nom de chaque fichier doit être le <strong>matricule</strong> de l'élève.<br/>
          Exemple : <code>21012369K.jpg</code>
        </p>
        <div class="import-zone" style="cursor:pointer" onclick="document.getElementById('impPhotoBepc').click()">
          <div class="import-icon">🖼️</div>
          <div class="import-title">Choisir les photos BEPC</div>
          <div style="font-size:11px;color:#888;margin-top:4px">JPG, PNG acceptés — plusieurs fichiers à la fois</div>
        </div>
        <input type="file" id="impPhotoBepc" accept="image/*" multiple style="display:none"
          onchange="processImportPhotos(this,'bepc')"/>
        <div id="progressBepc" style="margin-top:10px;font-size:12px;color:var(--text2)"></div>
      </div>

      <div class="card">
        <div class="card-title">📸 Photos BAC</div>
        <p style="font-size:12px;color:var(--text2);margin-bottom:12px">
          Sélectionnez plusieurs photos à la fois.<br/>
          Le nom de chaque fichier doit être le <strong>matricule</strong> de l'élève.<br/>
          Exemple : <code>21012369K.jpg</code>
        </p>
        <div class="import-zone" style="cursor:pointer" onclick="document.getElementById('impPhotoBac').click()">
          <div class="import-icon">🖼️</div>
          <div class="import-title">Choisir les photos BAC</div>
          <div style="font-size:11px;color:#888;margin-top:4px">JPG, PNG acceptés — plusieurs fichiers à la fois</div>
        </div>
        <input type="file" id="impPhotoBac" accept="image/*" multiple style="display:none"
          onchange="processImportPhotos(this,'bac')"/>
        <div id="progressBac" style="margin-top:10px;font-size:12px;color:var(--text2)"></div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">ℹ️ Instructions</div>
      <div style="font-size:13px;color:var(--text2);line-height:1.8">
        <p>1. Renommez chaque photo avec le <strong>matricule exact</strong> du candidat (ex: <code>21012369K.jpg</code>)</p>
        <p>2. Sélectionnez toutes les photos d'un coup dans le bouton ci-dessus</p>
        <p>3. L'application associe automatiquement chaque photo au bon candidat</p>
        <p>4. Les photos non reconnues (matricule introuvable) sont ignorées</p>
      </div>
    </div>`;
}

window.processImportPhotos = async function(input, type) {
  const files = Array.from(input.files);
  if (!files.length) return;

  const progressEl = document.getElementById(type === 'bepc' ? 'progressBepc' : 'progressBac');
  progressEl.innerHTML = `⏳ Chargement des candidats...`;

  const allCands = type === 'bepc' ? await getCandidatsBepc() : await getCandidatsBac();
  const matMap = {};
  allCands.forEach(c => { if (c.matricule) matMap[c.matricule.toUpperCase().trim()] = c; });

  let ok = 0, inconnus = 0, erreurs = 0;
  const total = files.length;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    // Extraire le matricule depuis le nom de fichier (sans extension)
    const matricule = file.name.replace(/\.[^.]+$/, '').toUpperCase().trim();
    const cand = matMap[matricule];

    progressEl.innerHTML = `⏳ Import ${i+1}/${total} — ${file.name}`;

    if (!cand) { inconnus++; continue; }

    try {
      const photoUrl = await uploadPhoto(file, cand.matricule);
      // Mettre à jour photo_url dans la table candidats
      const table = type === 'bepc' ? 'candidats_bepc' : 'candidats_bac';
      const { error } = await supabase.from(table).update({ photo_url: photoUrl }).eq('id', cand.id);
      if (error) throw new Error(error.message);
      ok++;
    } catch(e) {
      erreurs++;
    }
  }

  input.value = '';
  progressEl.innerHTML = '';

  let msg = `✅ ${ok} photo(s) importée(s)`;
  if (inconnus) msg += ` · ${inconnus} matricule(s) non trouvé(s)`;
  if (erreurs)  msg += ` · ${erreurs} erreur(s)`;
  showToast(msg, ok > 0 ? 'success' : 'error');
};

// ─────────────────────────────────────────────────────────────
// PARTIE III — BILAN
// ─────────────────────────────────────────────────────────────
async function renderBilan() {
  window._bilanTab = 'bepc';
  window._bilanVue = 'centre'; // 'centre' | 'etab' | 'serie'
  setTimeout(() => loadBilanContent(), 50);
  return `
    <div class="page-header">
      <div><div class="page-title">Bilan BEPC & BAC</div>
        <div class="page-subtitle">Par centre · par établissement · par série</div></div>
      <div class="header-actions">
        <button class="btn btn-outline btn-sm" onclick="exportBilanCSV()">⬇ Exporter CSV</button>
        <button class="btn btn-outline btn-sm" onclick="window.print()">🖨 Imprimer</button>
      </div>
    </div>

    <!-- Onglets Examen -->
    <div class="tabs">
      <div class="tab active" id="tabBB"    onclick="switchBilanTab('bepc')">BEPC</div>
      <div class="tab"        id="tabBBAC"  onclick="switchBilanTab('bac')">BAC</div>
    </div>

    <!-- Onglets Vue -->
    <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">
      <button class="btn btn-primary btn-sm"  id="vueBtn_centre" onclick="switchBilanVue('centre')">📍 Par centre</button>
      <button class="btn btn-outline btn-sm"  id="vueBtn_etab"   onclick="switchBilanVue('etab')">🏫 Par établissement</button>
      <button class="btn btn-outline btn-sm"  id="vueBtn_serie"  onclick="switchBilanVue('serie')" id="vueBtnSerie">📚 Par série (BAC)</button>
    </div>

    <div id="bilanContent">${loading()}</div>`;
}

window.switchBilanTab = async function(type) {
  window._bilanTab = type;
  document.getElementById('tabBB').classList.toggle('active', type==='bepc');
  document.getElementById('tabBBAC').classList.toggle('active', type==='bac');
  // Si on revient sur BEPC depuis vue "série", basculer sur "centre"
  if (type==='bepc' && window._bilanVue==='serie') {
    window._bilanVue = 'centre';
    _updateVueBtns();
  }
  await loadBilanContent();
};

window.switchBilanVue = async function(vue) {
  window._bilanVue = vue;
  _updateVueBtns();
  await loadBilanContent();
};

function _updateVueBtns() {
  ['centre','etab','serie'].forEach(v => {
    const btn = document.getElementById('vueBtn_'+v);
    if (!btn) return;
    btn.className = window._bilanVue===v ? 'btn btn-primary btn-sm' : 'btn btn-outline btn-sm';
  });
}

// ── Calcul des stats d'un groupe ──────────────────────────────
function _calcBilanGroupe(g, notesMap, type) {
  const total   = g.length;
  const filles  = g.filter(c=>c.sexe==='F').length;
  const garcons = g.filter(c=>c.sexe==='M').length;
  const traites = g.filter(c=>c.valide).length;
  const absents = g.filter(c=>c.absent).length;
  const admis   = g.filter(c=>{
    const r = type==='bepc'
      ? calcMoyenneBepc(notesMap[c.id]||{}, c.inapt_eps, c.arts_plastiques)
      : calcMoyenneBac(notesMap[c.id]||{}, c.serie, c.inapt_eps);
    return r.moy!==null && r.moy>=10 && !c.absent;
  }).length;
  const refuses = g.filter(c=>{
    const r = type==='bepc'
      ? calcMoyenneBepc(notesMap[c.id]||{}, c.inapt_eps, c.arts_plastiques)
      : calcMoyenneBac(notesMap[c.id]||{}, c.serie, c.inapt_eps);
    return r.moy!==null && r.moy<10 && !c.absent && c.valide;
  }).length;
  const taux = traites>0 ? Math.round(admis/traites*100) : 0;
  return { total, filles, garcons, traites, nonTraites:total-traites, absents, admis, refuses, taux };
}

// ── Rendu HTML du tableau bilan ───────────────────────────────
function _renderBilanTable(groupStats, tot, colLabel, type) {
  const tauxGlobal = tot.traites>0 ? Math.round(tot.admis/tot.traites*100) : 0;

  const cartes = `
    <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:20px">
      <div class="stat-card stat-accent">
        <div class="stat-value">${tot.total}</div>
        <div class="stat-label">Total inscrits</div>
        <div class="stat-sub">${tot.filles} F · ${tot.garcons} G</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${tot.traites}</div>
        <div class="stat-label">Fiches traitées</div>
        <div class="stat-sub">${tot.nonTraites} en attente</div>
      </div>
      <div class="stat-card stat-green">
        <div class="stat-value" style="color:var(--green)">${tot.admis}</div>
        <div class="stat-label">Admis</div>
        <div class="stat-sub">${tauxGlobal}% de réussite</div>
      </div>
      <div class="stat-card stat-red">
        <div class="stat-value" style="color:var(--red)">${tot.refuses}</div>
        <div class="stat-label">Refusés</div>
        <div class="stat-sub">${tot.traites>0?Math.round(tot.refuses/tot.traites*100):0}%</div>
      </div>
      <div class="stat-card stat-amber">
        <div class="stat-value" style="color:var(--amber)">${tot.absents}</div>
        <div class="stat-label">Absents</div>
        <div class="stat-sub">${tot.total>0?Math.round(tot.absents/tot.total*100):0}%</div>
      </div>
    </div>`;

  const rows = groupStats.map(s => `<tr>
    <td><strong>${s.nom}</strong></td>
    <td class="td-mono">${s.total}</td>
    <td class="td-mono">${s.filles}</td>
    <td class="td-mono">${s.garcons}</td>
    <td class="td-mono">${s.traites}</td>
    <td class="td-mono" style="color:var(--text3)">${s.nonTraites}</td>
    <td class="td-mono" style="color:var(--amber)">${s.absents}</td>
    <td class="td-mono" style="color:var(--green);font-weight:600">${s.admis}</td>
    <td class="td-mono" style="color:var(--red)">${s.refuses}</td>
    <td>${badge(s.taux+'%', s.taux>=50?'green':s.taux>=30?'amber':'red')}</td>
  </tr>`).join('');

  const ligneTotal = `
    <tr style="background:var(--surface2);border-top:2px solid var(--border2)">
      <td style="font-weight:700">🔢 TOTAL GÉNÉRAL</td>
      <td class="td-mono" style="font-weight:700">${tot.total}</td>
      <td class="td-mono" style="font-weight:700">${tot.filles}</td>
      <td class="td-mono" style="font-weight:700">${tot.garcons}</td>
      <td class="td-mono" style="font-weight:700">${tot.traites}</td>
      <td class="td-mono" style="font-weight:700;color:var(--text3)">${tot.nonTraites}</td>
      <td class="td-mono" style="font-weight:700;color:var(--amber)">${tot.absents}</td>
      <td class="td-mono" style="font-weight:700;color:var(--green)">${tot.admis}</td>
      <td class="td-mono" style="font-weight:700;color:var(--red)">${tot.refuses}</td>
      <td>${badge(tauxGlobal+'%', tauxGlobal>=50?'green':tauxGlobal>=30?'amber':'red')}</td>
    </tr>`;

  return cartes + `
    <div class="table-wrap"><table>
      <thead><tr>
        <th>${colLabel}</th>
        <th>Inscrits</th><th>Filles</th><th>Garçons</th>
        <th>Traités</th><th>Non traités</th><th>Absents</th>
        <th>Admis</th><th>Refusés</th><th>% Admis</th>
      </tr></thead>
      <tbody>
        ${rows || '<tr><td colspan="10" style="text-align:center;padding:24px;color:var(--text3)">Aucune donnée</td></tr>'}
        ${ligneTotal}
      </tbody>
    </table></div>`;
}

window.loadBilanContent = async function() {
  const el = document.getElementById('bilanContent');
  if (!el) return;
  el.innerHTML = loading();
  const type = window._bilanTab || 'bepc';
  const vue  = window._bilanVue || 'centre';

  // Vue "par série" uniquement pour le BAC
  if (vue === 'serie' && type === 'bepc') {
    el.innerHTML = `<div class="alert alert-info">La vue "Par série" est disponible uniquement pour le BAC.</div>`;
    return;
  }

  try {
    const cands = type==='bepc' ? await getCandidatsBepc() : await getCandidatsBac();
    const notesMap = {};
    await Promise.all(cands.map(async c => {
      notesMap[c.id] = type==='bepc' ? await getNotesBepc(c.id) : await getNotesBac(c.id);
    }));

    let groupStats, colLabel;

    if (vue === 'serie') {
      // Bilan par série BAC (A1, A2, C, D)
      const series = ['A1','A2','C','D'];
      groupStats = series.map(s => {
        const g = cands.filter(c=>c.serie===s);
        const colBadge = s==='C'?'red':s==='D'?'amber':s==='A1'?'green':'blue';
        return { nom: `<span class="badge badge-${colBadge}">Série ${s}</span>`, ...(_calcBilanGroupe(g, notesMap, type)) };
      }).filter(s=>s.total>0);
      colLabel = 'Série';
    } else {
      // Bilan par centre ou établissement
      const groupIds = [...new Set(cands.map(c=>vue==='centre'?c.centre_id:c.etab_id))];
      const getNom   = vue==='centre' ? getCentreNom : getEtabNom;
      groupStats = groupIds.map(gid => {
        const g = cands.filter(c=>(vue==='centre'?c.centre_id:c.etab_id)===gid);
        return { nom: getNom(gid), ..._calcBilanGroupe(g, notesMap, type) };
      });
      colLabel = vue==='centre' ? 'Centre' : 'Établissement';
    }

    const tot = _calcBilanGroupe(cands, notesMap, type);
    window._bilanData = { groupStats, tot, type, vue, colLabel };
    el.innerHTML = _renderBilanTable(groupStats, tot, colLabel, type);

  } catch(e) { el.innerHTML=`<div class="alert alert-danger">${e.message}</div>`; }
};

window.exportBilanCSV = function() {
  const d = window._bilanData;
  if (!d) { showToast('Chargez d\'abord le bilan', 'error'); return; }
  const header = `${d.colLabel};Inscrits;Filles;Garçons;Traités;Non traités;Absents;Admis;Refusés;% Admis`;
  const rows = d.groupStats.map(s => {
    const nom = s.nom.replace(/<[^>]+>/g,''); // enlever HTML badges
    return `${nom};${s.total};${s.filles};${s.garcons};${s.traites};${s.nonTraites};${s.absents};${s.admis};${s.refuses};${s.taux}%`;
  });
  const t = d.tot;
  const tG = t.traites>0?Math.round(t.admis/t.traites*100):0;
  rows.push(`TOTAL GÉNÉRAL;${t.total};${t.filles};${t.garcons};${t.traites};${t.nonTraites};${t.absents};${t.admis};${t.refuses};${tG}%`);
  const csv = [header,...rows].join('\n');
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download = `bilan_${d.type}_${d.vue}_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  showToast('Export CSV téléchargé !');
};

// ─────────────────────────────────────────────────────────────
// PARTIE IV — STATISTIQUES
// ─────────────────────────────────────────────────────────────
async function renderStatistiques() {
  window._statTab = 'bepc';
  setTimeout(() => loadStatContent(), 50);
  return `
    <div class="page-header">
      <div><div class="page-title">Statistiques</div>
        <div class="page-subtitle">Répartition par sexe · % admis · % refusés · % absents</div></div>
      <div class="header-actions">
        <button class="btn btn-outline btn-sm" onclick="window.print()">🖨 Imprimer</button>
      </div>
    </div>
    <div class="tabs">
      <div class="tab active" id="tabSB"   onclick="switchStatTab('bepc')">BEPC</div>
      <div class="tab"        id="tabSBAC" onclick="switchStatTab('bac')">BAC</div>
    </div>
    <div id="statContent">${loading()}</div>`;
}

window.switchStatTab = async function(type) {
  window._statTab = type;
  document.getElementById('tabSB').classList.toggle('active', type==='bepc');
  document.getElementById('tabSBAC').classList.toggle('active', type==='bac');
  await loadStatContent();
};

// Barre de proportion visuelle (admis vert / refusés rouge / absents amber)
function _barreRepartition(admis, refuses, absents, traites) {
  if (!traites) return `<div class="progress-bar" style="height:8px"><div style="width:100%;height:100%;background:var(--border)"></div></div>`;
  const pA  = (admis  / traites * 100).toFixed(1);
  const pR  = (refuses / traites * 100).toFixed(1);
  const pAb = (absents / traites * 100).toFixed(1);
  return `
    <div style="display:flex;height:8px;border-radius:4px;overflow:hidden;min-width:80px">
      <div style="width:${pA}%;background:var(--green)" title="Admis ${pA}%"></div>
      <div style="width:${pR}%;background:var(--red)"   title="Refusés ${pR}%"></div>
      <div style="width:${pAb}%;background:var(--amber)" title="Absents ${pAb}%"></div>
      <div style="flex:1;background:var(--border)"></div>
    </div>`;
}

window.loadStatContent = async function() {
  const el = document.getElementById('statContent');
  if (!el) return;
  el.innerHTML = loading();
  const type = window._statTab || 'bepc';
  try {
    const cands  = type==='bepc' ? await getCandidatsBepc() : await getCandidatsBac();
    const notesMap = {};
    await Promise.all(cands.map(async c => {
      notesMap[c.id] = type==='bepc' ? await getNotesBepc(c.id) : await getNotesBac(c.id);
    }));

    // ── Fonction stats pour un groupe ──
    function stats(g) {
      const total   = g.length;
      const filles  = g.filter(c=>c.sexe==='F').length;
      const garcons = g.filter(c=>c.sexe==='M').length;
      const traites = g.filter(c=>c.valide).length;
      const absents = g.filter(c=>c.absent).length;
      const admis   = g.filter(c=>{
        const r = type==='bepc' ? calcMoyenneBepc(notesMap[c.id]||{},c.inapt_eps,c.arts_plastiques) : calcMoyenneBac(notesMap[c.id]||{},c.serie,c.inapt_eps);
        return r.moy!==null && r.moy>=10 && !c.absent;
      }).length;
      const refuses = g.filter(c=>{
        const r = type==='bepc' ? calcMoyenneBepc(notesMap[c.id]||{},c.inapt_eps,c.arts_plastiques) : calcMoyenneBac(notesMap[c.id]||{},c.serie,c.inapt_eps);
        return r.moy!==null && r.moy<10 && !c.absent && c.valide;
      }).length;
      // Répartition admis par sexe
      const admisF  = g.filter(c=>{
        const r = type==='bepc' ? calcMoyenneBepc(notesMap[c.id]||{},c.inapt_eps,c.arts_plastiques) : calcMoyenneBac(notesMap[c.id]||{},c.serie,c.inapt_eps);
        return r.moy!==null && r.moy>=10 && !c.absent && c.sexe==='F';
      }).length;
      const admisG  = admis - admisF;
      const pAdmis  = traites>0 ? (admis/traites*100).toFixed(1)  : '0.0';
      const pRefus  = traites>0 ? (refuses/traites*100).toFixed(1) : '0.0';
      const pAbsent = total>0   ? (absents/total*100).toFixed(1)   : '0.0';
      return { total, filles, garcons, traites, absents, admis, refuses, admisF, admisG, pAdmis, pRefus, pAbsent };
    }

    const tot     = stats(cands);
    const centres = G.ref.centres || [];
    const etabs   = G.ref.etablissements || [];

    // ── Cartes globales ──────────────────────────────────────
    const cartes = `
      <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:12px;margin-bottom:24px">
        <div class="stat-card stat-accent">
          <div class="stat-value">${tot.total}</div>
          <div class="stat-label">Total inscrits</div>
          <div class="stat-sub">${tot.filles} F · ${tot.garcons} G</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${tot.traites}</div>
          <div class="stat-label">Fiches traitées</div>
          <div class="stat-sub">${tot.total>0?(tot.traites/tot.total*100).toFixed(1):0}% du total</div>
        </div>
        <div class="stat-card stat-green">
          <div class="stat-value" style="color:var(--green)">${tot.admis}</div>
          <div class="stat-label">Admis</div>
          <div class="stat-sub">${tot.pAdmis}% · ${tot.admisF}F / ${tot.admisG}G</div>
        </div>
        <div class="stat-card stat-red">
          <div class="stat-value" style="color:var(--red)">${tot.refuses}</div>
          <div class="stat-label">Refusés</div>
          <div class="stat-sub">${tot.pRefus}% des traités</div>
        </div>
        <div class="stat-card stat-amber">
          <div class="stat-value" style="color:var(--amber)">${tot.absents}</div>
          <div class="stat-label">Absents</div>
          <div class="stat-sub">${tot.pAbsent}% des inscrits</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" style="color:var(--purple)">${tot.filles}</div>
          <div class="stat-label">Filles inscrites</div>
          <div class="stat-sub">${tot.admisF} admises · ${tot.filles>0?(tot.admisF/tot.filles*100).toFixed(0):0}%</div>
        </div>
      </div>`;

    // ── Légende barre ────────────────────────────────────────
    const legende = `
      <div style="display:flex;gap:16px;margin-bottom:12px;font-size:12px;align-items:center">
        <span style="font-weight:600;color:var(--text2)">Répartition :</span>
        <span style="display:flex;align-items:center;gap:4px"><span style="width:12px;height:12px;border-radius:2px;background:var(--green);display:inline-block"></span> Admis</span>
        <span style="display:flex;align-items:center;gap:4px"><span style="width:12px;height:12px;border-radius:2px;background:var(--red);display:inline-block"></span> Refusés</span>
        <span style="display:flex;align-items:center;gap:4px"><span style="width:12px;height:12px;border-radius:2px;background:var(--amber);display:inline-block"></span> Absents</span>
        <span style="display:flex;align-items:center;gap:4px"><span style="width:12px;height:12px;border-radius:2px;background:var(--border);display:inline-block"></span> Non traités</span>
      </div>`;

    // ── Tableau par centre ───────────────────────────────────
    const rowsCentre = centres.map(ctr => {
      const g = cands.filter(c=>c.centre_id===ctr.id);
      if (!g.length) return '';
      const s = stats(g);
      return `<tr>
        <td><strong>${ctr.nom}</strong></td>
        <td class="td-mono">${s.total}</td>
        <td class="td-mono">${s.filles} <span style="color:var(--text3)">F</span> · ${s.garcons} <span style="color:var(--text3)">G</span></td>
        <td class="td-mono">${s.traites}</td>
        <td class="td-mono" style="color:var(--green);font-weight:600">${s.admis}
          <span style="font-size:10px;color:var(--text3)">(${s.admisF}F·${s.admisG}G)</span></td>
        <td>${badge(s.pAdmis+'%', parseFloat(s.pAdmis)>=50?'green':parseFloat(s.pAdmis)>=30?'amber':'red')}</td>
        <td class="td-mono" style="color:var(--red)">${s.refuses}</td>
        <td>${badge(s.pRefus+'%', parseFloat(s.pRefus)<=30?'green':parseFloat(s.pRefus)<=50?'amber':'red')}</td>
        <td class="td-mono" style="color:var(--amber)">${s.absents}</td>
        <td>${badge(s.pAbsent+'%', parseFloat(s.pAbsent)<=5?'green':parseFloat(s.pAbsent)<=15?'amber':'red')}</td>
        <td style="min-width:100px">${_barreRepartition(s.admis, s.refuses, s.absents, s.traites)}</td>
      </tr>`;
    }).filter(Boolean);

    // Ligne total centre
    const totalRowC = `
      <tr style="background:var(--surface2);border-top:2px solid var(--border2)">
        <td style="font-weight:700">🔢 TOTAL</td>
        <td class="td-mono" style="font-weight:700">${tot.total}</td>
        <td class="td-mono" style="font-weight:700">${tot.filles}F · ${tot.garcons}G</td>
        <td class="td-mono" style="font-weight:700">${tot.traites}</td>
        <td class="td-mono" style="font-weight:700;color:var(--green)">${tot.admis}</td>
        <td>${badge(tot.pAdmis+'%', parseFloat(tot.pAdmis)>=50?'green':parseFloat(tot.pAdmis)>=30?'amber':'red')}</td>
        <td class="td-mono" style="font-weight:700;color:var(--red)">${tot.refuses}</td>
        <td>${badge(tot.pRefus+'%','gray')}</td>
        <td class="td-mono" style="font-weight:700;color:var(--amber)">${tot.absents}</td>
        <td>${badge(tot.pAbsent+'%','gray')}</td>
        <td>${_barreRepartition(tot.admis, tot.refuses, tot.absents, tot.traites)}</td>
      </tr>`;

    // ── Tableau par établissement ────────────────────────────
    const rowsEtab = etabs.map(etab => {
      const g = cands.filter(c=>c.etab_id===etab.id);
      if (!g.length) return '';
      const s = stats(g);
      return `<tr>
        <td style="max-width:180px"><strong>${etab.nom}</strong></td>
        <td class="td-mono">${s.total}</td>
        <td class="td-mono">${s.filles}F · ${s.garcons}G</td>
        <td class="td-mono">${s.traites}</td>
        <td class="td-mono" style="color:var(--green);font-weight:600">${s.admis}
          <span style="font-size:10px;color:var(--text3)">(${s.admisF}F·${s.admisG}G)</span></td>
        <td>${badge(s.pAdmis+'%', parseFloat(s.pAdmis)>=50?'green':parseFloat(s.pAdmis)>=30?'amber':'red')}</td>
        <td class="td-mono" style="color:var(--red)">${s.refuses}</td>
        <td>${badge(s.pRefus+'%', parseFloat(s.pRefus)<=30?'green':parseFloat(s.pRefus)<=50?'amber':'red')}</td>
        <td class="td-mono" style="color:var(--amber)">${s.absents}</td>
        <td>${badge(s.pAbsent+'%', parseFloat(s.pAbsent)<=5?'green':parseFloat(s.pAbsent)<=15?'amber':'red')}</td>
        <td style="min-width:100px">${_barreRepartition(s.admis, s.refuses, s.absents, s.traites)}</td>
      </tr>`;
    }).filter(Boolean);

    const totalRowE = `
      <tr style="background:var(--surface2);border-top:2px solid var(--border2)">
        <td style="font-weight:700">🔢 TOTAL</td>
        <td class="td-mono" style="font-weight:700">${tot.total}</td>
        <td class="td-mono" style="font-weight:700">${tot.filles}F · ${tot.garcons}G</td>
        <td class="td-mono" style="font-weight:700">${tot.traites}</td>
        <td class="td-mono" style="font-weight:700;color:var(--green)">${tot.admis}</td>
        <td>${badge(tot.pAdmis+'%', parseFloat(tot.pAdmis)>=50?'green':parseFloat(tot.pAdmis)>=30?'amber':'red')}</td>
        <td class="td-mono" style="font-weight:700;color:var(--red)">${tot.refuses}</td>
        <td>${badge(tot.pRefus+'%','gray')}</td>
        <td class="td-mono" style="font-weight:700;color:var(--amber)">${tot.absents}</td>
        <td>${badge(tot.pAbsent+'%','gray')}</td>
        <td>${_barreRepartition(tot.admis, tot.refuses, tot.absents, tot.traites)}</td>
      </tr>`;

    const entetes = `<tr>
      <th>Groupe</th><th>Inscrits</th><th>Filles/Garçons</th><th>Traités</th>
      <th>Admis</th><th>% Admis</th>
      <th>Refusés</th><th>% Refusés</th>
      <th>Absents</th><th>% Absents</th>
      <th>Répartition</th>
    </tr>`;

    el.innerHTML = cartes + legende + `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">

        <div>
          <div class="card-title" style="margin-bottom:8px">📍 Par centre</div>
          <div class="table-wrap"><table>
            <thead>${entetes}</thead>
            <tbody>
              ${rowsCentre.join('') || '<tr><td colspan="11" style="text-align:center;padding:20px;color:var(--text3)">Aucune donnée</td></tr>'}
              ${totalRowC}
            </tbody>
          </table></div>
        </div>

        <div>
          <div class="card-title" style="margin-bottom:8px">🏫 Par établissement</div>
          <div class="table-wrap"><table>
            <thead>${entetes}</thead>
            <tbody>
              ${rowsEtab.join('') || '<tr><td colspan="11" style="text-align:center;padding:20px;color:var(--text3)">Aucune donnée</td></tr>'}
              ${totalRowE}
            </tbody>
          </table></div>
        </div>

      </div>`;

  } catch(e) { el.innerHTML=`<div class="alert alert-danger">${e.message}</div>`; }
};

// ─────────────────────────────────────────────────────────────
// PARTIE V — CLASSEMENT
// ─────────────────────────────────────────────────────────────

// Mentions selon la moyenne
function getMention(moy) {
  if (moy === null) return { label: '—',           cls: 'gray'   };
  if (moy >= 16)    return { label: 'Très Bien',    cls: 'purple' };
  if (moy >= 14)    return { label: 'Bien',         cls: 'teal'   };
  if (moy >= 12)    return { label: 'Assez Bien',   cls: 'blue'   };
  if (moy >= 10)    return { label: 'Passable',     cls: 'green'  };
  return               { label: 'Insuffisant',  cls: 'red'    };
}

async function renderClassement() {
  const centres = G.ref.centres       || [];
  const etabs   = G.ref.etablissements || [];
  window._clsTab = 'bepc';
  setTimeout(() => loadClassement(), 50);
  return `
    <div class="page-header">
      <div><div class="page-title">Classement & Honneur</div>
        <div class="page-subtitle">Par ordre de mérite · Filles / Garçons / Total</div></div>
      <div class="header-actions">
        <button class="btn btn-outline btn-sm" onclick="exportClassementCSV()">⬇ Exporter CSV</button>
        <button class="btn btn-primary btn-sm" onclick="imprimerDiplomes()">🏆 Imprimer Diplômes</button>
        <button class="btn btn-outline btn-sm" onclick="window.print()">🖨 Imprimer</button>
      </div>
    </div>

    <!-- Onglets examen -->
    <div class="tabs">
      <div class="tab active" id="tabCLB"   onclick="switchClsTab('bepc')">BEPC</div>
      <div class="tab"        id="tabCLBAC" onclick="switchClsTab('bac')">BAC</div>
    </div>

    <!-- Filtres -->
    <div class="card" style="margin-bottom:16px">
      <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end">

        <div class="form-group" style="min-width:180px">
          <label class="form-label">Centre</label>
          <select class="form-select" id="clsCentre" onchange="loadClassement()">
            <option value="">Tous les centres</option>
            ${centres.map(c=>`<option value="${c.id}">${c.nom}</option>`).join('')}
          </select>
        </div>

        <div class="form-group" style="min-width:200px">
          <label class="form-label">Établissement</label>
          <select class="form-select" id="clsEtab" onchange="loadClassement()">
            <option value="">Tous les établissements</option>
            ${etabs.map(e=>`<option value="${e.id}">${e.nom}</option>`).join('')}
          </select>
        </div>

        <div class="form-group" id="clsSerieDiv" style="min-width:140px;display:none">
          <label class="form-label">Série</label>
          <select class="form-select" id="clsSerie" onchange="loadClassement()">
            <option value="">Toutes</option>
            <option>A1</option><option>A2</option><option>C</option><option>D</option>
          </select>
        </div>

        <div class="form-group" style="min-width:160px">
          <label class="form-label">Afficher</label>
          <select class="form-select" id="clsSexe" onchange="loadClassement()">
            <option value="">Tous (F + G)</option>
            <option value="F">Filles uniquement</option>
            <option value="M">Garçons uniquement</option>
          </select>
        </div>

        <div class="form-checkbox-group" style="margin-top:16px">
          <input type="checkbox" id="clsHonneur" onchange="loadClassement()"/>
          <label for="clsHonneur">⭐ Tableau d'honneur uniquement (≥ 13)</label>
        </div>

      </div>
    </div>

    <div id="clsContent">${loading()}</div>`;
}

window.switchClsTab = async function(type) {
  window._clsTab = type;
  document.getElementById('tabCLB').classList.toggle('active', type==='bepc');
  document.getElementById('tabCLBAC').classList.toggle('active', type==='bac');
  document.getElementById('clsSerieDiv').style.display = type==='bac' ? '' : 'none';
  await loadClassement();
};

window.loadClassement = async function() {
  const el = document.getElementById('clsContent');
  if (!el) return;
  el.innerHTML = loading();
  const type     = window._clsTab || 'bepc';
  const centreId = document.getElementById('clsCentre')?.value  || '';
  const etabId   = document.getElementById('clsEtab')?.value    || '';
  const serie    = document.getElementById('clsSerie')?.value   || '';
  const sexe     = document.getElementById('clsSexe')?.value    || '';
  const honneur  = document.getElementById('clsHonneur')?.checked || false;

  try {
    let cands = type==='bepc'
      ? await getCandidatsBepc({ centreId: centreId||undefined, etabId: etabId||undefined })
      : await getCandidatsBac({ centreId: centreId||undefined, etabId: etabId||undefined, serie: serie||undefined });

    cands = cands.filter(c => c.valide && !c.absent);
    if (sexe) cands = cands.filter(c => c.sexe === sexe);

    const notesMap = {};
    await Promise.all(cands.map(async c => {
      notesMap[c.id] = type==='bepc' ? await getNotesBepc(c.id) : await getNotesBac(c.id);
    }));

    let ranked = cands.map(c => {
      const r = type==='bepc'
        ? calcMoyenneBepc(notesMap[c.id]||{}, c.inapt_eps, c.arts_plastiques)
        : calcMoyenneBac(notesMap[c.id]||{}, c.serie, c.inapt_eps);
      return { ...c, moy: r.moy, pts: r.pts, coef: r.coef };
    }).filter(c => c.moy !== null).sort((a,b) => b.moy - a.moy);

    if (honneur) ranked = ranked.filter(c => c.moy >= 13);

    // Sauvegarder pour export
    window._clsData = { ranked, type };

    // Compteurs mentions
    const nTresBien  = ranked.filter(c=>c.moy>=16).length;
    const nBien      = ranked.filter(c=>c.moy>=14&&c.moy<16).length;
    const nAssezBien = ranked.filter(c=>c.moy>=12&&c.moy<14).length;
    const nPassable  = ranked.filter(c=>c.moy>=10&&c.moy<12).length;
    const nHonneur   = ranked.filter(c=>c.moy>=13).length;

    // Bandeau résumé
    const resume = `
      <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:10px;margin-bottom:16px">
        <div class="stat-card"><div class="stat-value">${ranked.length}</div><div class="stat-label">Classés</div></div>
        <div class="stat-card"><div class="stat-value" style="color:var(--purple)">${nHonneur}</div><div class="stat-label">⭐ Tableau honneur</div></div>
        <div class="stat-card"><div class="stat-value" style="color:var(--purple)">${nTresBien}</div><div class="stat-label">Très Bien (≥16)</div></div>
        <div class="stat-card"><div class="stat-value" style="color:var(--teal)">${nBien}</div><div class="stat-label">Bien (14-15)</div></div>
        <div class="stat-card"><div class="stat-value" style="color:var(--accent)">${nAssezBien}</div><div class="stat-label">Assez Bien (12-13)</div></div>
        <div class="stat-card"><div class="stat-value" style="color:var(--green)">${nPassable}</div><div class="stat-label">Passable (10-11)</div></div>
      </div>`;

    if (!ranked.length) {
      el.innerHTML = resume + `<div class="alert alert-warning">Aucun candidat à afficher avec ces filtres.</div>`;
      return;
    }

    const lignes = ranked.map((c, i) => {
      const mention = getMention(c.moy);
      const sexeBadge = badge(c.sexe, c.sexe==='F' ? 'pink' : 'blue');
      const serieBadge = type==='bac'
        ? badge('Sér.'+c.serie, c.serie==='C'?'red':c.serie==='D'?'amber':c.serie==='A1'?'green':'blue')
        : '';
      return `
        <div class="rank-row" style="${c.moy>=13?'background:linear-gradient(to right,rgba(255,215,0,.06),transparent)':''}">
          <!-- Rang -->
          <div class="rank-num ${i===0?'rank-1':i===1?'rank-2':i===2?'rank-3':'rank-other'}">${i+1}</div>

          <!-- Photo -->
          <div class="candidat-photo" style="width:38px;height:38px;flex-shrink:0">
            ${c.photo_url ? `<img src="${c.photo_url}" style="width:100%;height:100%;object-fit:cover;border-radius:4px"/>` : '👤'}
          </div>

          <!-- Infos candidat -->
          <div style="flex:1;min-width:0">
            <div style="font-weight:600;font-size:13px;display:flex;align-items:center;gap:6px;flex-wrap:wrap">
              ${c.nom} ${c.prenoms}
              ${sexeBadge}
              ${serieBadge}
              ${c.moy>=13 ? `<span class="honour-badge">⭐ Tableau d'honneur</span>` : ''}
            </div>
            <div style="font-size:11px;color:var(--text2);margin-top:2px">
              N°${c.num_table} · ${c.matricule} · ${getEtabNom(c.etab_id)} · ${getCentreNom(c.centre_id)}
            </div>
          </div>

          <!-- Points -->
          <div style="text-align:center;min-width:60px">
            <div style="font-size:11px;font-family:var(--mono);color:var(--text2)">${c.pts} pts</div>
            <div style="font-size:10px;color:var(--text3)">/ ${c.coef} coef</div>
          </div>

          <!-- Mention -->
          <div style="min-width:90px;text-align:center">
            ${badge(mention.label, mention.cls)}
          </div>

          <!-- Moyenne -->
          <div style="text-align:right;min-width:60px">
            <div style="font-size:20px;font-weight:700;font-family:var(--mono);color:${c.moy>=13?'var(--green)':c.moy>=10?'var(--accent)':'var(--red)'}">
              ${c.moy.toFixed(2)}
            </div>
            <div style="font-size:10px;color:var(--text3)">/20</div>
          </div>
        </div>`;
    }).join('');

    el.innerHTML = resume + `
      <div style="border:1px solid var(--border);border-radius:var(--r2);overflow:hidden">
        ${lignes}
      </div>`;

  } catch(e) { el.innerHTML=`<div class="alert alert-danger">${e.message}</div>`; }
};

window.exportClassementCSV = function() {
  const d = window._clsData;
  if (!d || !d.ranked?.length) { showToast('Chargez d\'abord le classement', 'error'); return; }
  const header = 'Rang;Nom;Prénoms;Sexe;Matricule;N° Table;Établissement;Centre;Points;Coef;Moyenne;Mention';
  const rows = d.ranked.map((c, i) => {
    const m = getMention(c.moy);
    return `${i+1};${c.nom};${c.prenoms};${c.sexe};${c.matricule};${c.num_table};${getEtabNom(c.etab_id)};${getCentreNom(c.centre_id)};${c.pts};${c.coef};${c.moy?.toFixed(2)};${m.label}`;
  });
  const csv = [header, ...rows].join('\n');
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download = `classement_${d.type}_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  showToast('Export CSV téléchargé !');
};

// ── Génère un diplôme d'honneur HTML pour un candidat ────────
function _genDiplome(c, rang, type) {
  const mention  = getMention(c.moy);
  const annee    = G.ref.config?.annee  || '2024-2025';
  const ville    = G.ref.config?.ville  || 'Bouaké';
  const region   = G.ref.config?.region || 'Vallée du Bandama';
  const session  = annee.split('-')[1] || new Date().getFullYear();
  const typeLabel = type==='bepc' ? 'BEPC' : 'BAC';
  const coefTotal = c.coef || 20;
  const ptsTotal  = c.pts  || 0;

  // Armoiries Côte d'Ivoire en SVG simplifié
  const armoiries = `<svg width="70" height="70" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
    <circle cx="50" cy="50" r="48" fill="#009A44" stroke="#F77F00" stroke-width="3"/>
    <circle cx="50" cy="50" r="35" fill="#fff"/>
    <text x="50" y="58" font-size="28" text-anchor="middle" fill="#009A44" font-weight="bold">🌿</text>
  </svg>`;

  return `
  <div style="
    width:210mm; min-height:297mm; margin:0 auto; padding:20mm 18mm;
    font-family:'Times New Roman',serif; background:#fff;
    border:3px double #1a4a8a; position:relative;
    page-break-after:always; box-sizing:border-box;
  ">
    <!-- Bordure décorative intérieure -->
    <div style="position:absolute;inset:8px;border:1px solid #c8a84b;pointer-events:none"></div>

    <!-- EN-TÊTE OFFICIEL -->
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10mm">
      <!-- Gauche -->
      <div style="font-size:11pt;line-height:1.6;color:#1a1916">
        <div style="font-weight:bold">Ministère de l'Éducation Nationale</div>
        <div style="border-top:1px solid #555;margin:4px 0;width:200px"></div>
        <div>Direction Régionale ${region}</div>
        <div style="font-size:9.5pt;color:#555">Bouaké 1 &amp; 2</div>
      </div>
      <!-- Centre — Armoiries -->
      <div style="text-align:center">
        ${armoiries}
        <div style="font-size:9pt;margin-top:4px;color:#333;font-style:italic">Union _ Discipline _ Travail</div>
      </div>
      <!-- Droite -->
      <div style="text-align:right;font-size:11pt;line-height:1.6;color:#1a1916">
        <div style="font-weight:bold">République de Côte d'Ivoire</div>
        <div style="border-top:1px solid #555;margin:4px 0"></div>
        <div>${ville}, le ${new Date().toLocaleDateString('fr-FR')}</div>
      </div>
    </div>

    <!-- TITRE EXAMEN -->
    <div style="text-align:center;margin-bottom:8mm">
      <div style="font-size:15pt;font-weight:bold;letter-spacing:2px;color:#1a1916;text-transform:uppercase">
        ${typeLabel} Blanc Régional — Session ${session}
      </div>
      <div style="width:80%;height:2px;background:linear-gradient(to right,transparent,#c8a84b,transparent);margin:6px auto"></div>
    </div>

    <!-- DIPLÔME D'HONNEUR -->
    <div style="text-align:center;margin:8mm 0 10mm">
      <div style="font-size:38pt;font-weight:900;color:#c0392b;letter-spacing:3px;text-transform:uppercase;
                  text-shadow:1px 1px 0 rgba(0,0,0,.15);line-height:1.1">
        DIPLÔME<br>D'HONNEUR
      </div>
      <div style="width:60%;height:3px;background:linear-gradient(to right,transparent,#c0392b,transparent);margin:8px auto"></div>
    </div>

    <!-- DÉCERNÉ À -->
    <div style="text-align:center;margin:8mm 0">
      <div style="font-size:12pt;color:#555;letter-spacing:1px;margin-bottom:6px">Décerné à :</div>
      <div style="font-size:22pt;font-weight:bold;color:#1a1916;text-transform:uppercase;letter-spacing:2px;
                  border-bottom:2px solid #c8a84b;display:inline-block;padding-bottom:4px">
        ${c.nom} ${c.prenoms}
      </div>
    </div>

    <!-- TEXTE DE RECONNAISSANCE -->
    <div style="text-align:center;margin:10mm 15mm;font-size:12pt;line-height:1.8;color:#1a1916">
      <p>En reconnaissance de son excellence académique et de ses performances</p>
      <p>remarquables lors de l'Examen Blanc Régional avec un total de</p>
      <p style="font-size:14pt;font-weight:bold;margin:6px 0">
        ${ptsTotal} / ${coefTotal * 20} points — soit une moyenne de
        <span style="color:#c0392b">${c.moy?.toFixed(2)} / 20</span>
      </p>
      <p>avec la mention <strong style="color:#1a4a8a;font-size:13pt">${mention.label}</strong></p>
      <p style="margin-top:6px;color:#555;font-size:10.5pt">
        Classé(e) <strong>${rang}${rang===1?'er':'ème'}</strong> ·
        ${getEtabNom(c.etab_id)} · Centre : ${getCentreNom(c.centre_id)}
        ${type==='bac' ? ` · Série ${c.serie}` : ''}
      </p>
    </div>

    <!-- ÉTOILES DÉCORATIVES -->
    <div style="text-align:center;font-size:18pt;color:#c8a84b;letter-spacing:8px;margin:4mm 0">
      ★ ★ ★ ★ ★
    </div>

    <!-- SIGNATURES -->
    <div style="display:flex;justify-content:space-between;margin-top:14mm;padding:0 10mm">
      <div style="text-align:center;min-width:120px">
        <div style="height:40px;border-bottom:1px solid #555;margin-bottom:6px"></div>
        <div style="font-size:10pt;font-weight:bold">Le Directeur de Centre</div>
        <div style="font-size:9pt;color:#555">${getCentreNom(c.centre_id)}</div>
      </div>
      <div style="text-align:center;min-width:120px">
        <div style="height:40px;border-bottom:1px solid #555;margin-bottom:6px"></div>
        <div style="font-size:10pt;font-weight:bold">Le Directeur Régional</div>
        <div style="font-size:9pt;color:#555">Direction Régionale ${region}</div>
      </div>
    </div>

    <!-- PIED DE PAGE -->
    <div style="position:absolute;bottom:12mm;left:18mm;right:18mm;text-align:center;
                font-size:8.5pt;color:#888;border-top:1px solid #ddd;padding-top:6px">
      Examen Blanc Régional ${session} · ${region} · Document officiel non authentifié
    </div>
  </div>`;
}

window.imprimerDiplomes = function() {
  const d = window._clsData;
  if (!d || !d.ranked?.length) { showToast('Chargez d\'abord le classement', 'error'); return; }

  // Filtrer uniquement les candidats du tableau d'honneur (≥ 13)
  const honores = d.ranked.filter(c => c.moy >= 13);
  if (!honores.length) {
    showToast('Aucun candidat au tableau d\'honneur (moyenne ≥ 13)', 'error'); return;
  }

  const diplomes = honores.map((c, i) => _genDiplome(c, i+1, d.type)).join('');

  const win = window.open('', '_blank');
  win.document.write(`<!DOCTYPE html><html><head>
    <meta charset="UTF-8">
    <title>Diplômes d'Honneur — EBR ${G.ref.config?.annee||''}</title>
    <style>
      *{box-sizing:border-box;margin:0;padding:0}
      body{background:#e0e0e0;font-family:'Times New Roman',serif}
      @media print{
        body{background:#fff}
        @page{size:A4 portrait;margin:0}
      }
    </style>
  </head><body>
    ${diplomes}
    <script>setTimeout(()=>window.print(),600)<\/script>
  </body></html>`);
  win.document.close();
  showToast(`${honores.length} diplôme(s) en cours d'impression...`);
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
  const type     = document.getElementById('relType').value;
  const q        = document.getElementById('relSearch').value.trim().toLowerCase();
  const centreId = document.getElementById('relCentre').value;
  const etabId   = document.getElementById('relEtab').value;
  const serie    = document.getElementById('relSerie').value;
  if (!q) { showAllReleves(); return; }
  const el = document.getElementById('relevesContent');
  el.innerHTML = loading();
  try {
    let list = type==='bepc'
      ? await getCandidatsBepc({ centreId:centreId||undefined, etabId:etabId||undefined, search:q })
      : await getCandidatsBac({ centreId:centreId||undefined, etabId:etabId||undefined, serie:serie||undefined, search:q });
    if (!list.length) { el.innerHTML=`<div class="alert alert-warning">Aucun candidat trouvé pour "${q}"</div>`; return; }
    // Calculer le rang global pour chaque candidat
    const allCands = type==='bepc' ? await getCandidatsBepc() : await getCandidatsBac();
    const rangs = await _calcRangs(allCands, type);
    const html = await Promise.all(list.map(c => genReleve(c, type, rangs[c.id])));
    el.innerHTML = html.join('<div style="height:1px;background:var(--border);margin:20px 0"></div>');
  } catch(e) { el.innerHTML=`<div class="alert alert-danger">${e.message}</div>`; }
};

window.showAllReleves = async function() {
  const type     = document.getElementById('relType').value;
  const centreId = document.getElementById('relCentre').value;
  const etabId   = document.getElementById('relEtab').value;
  const serie    = document.getElementById('relSerie').value;
  const el = document.getElementById('relevesContent');
  el.innerHTML = loading();
  try {
    let list = type==='bepc'
      ? await getCandidatsBepc({ centreId:centreId||undefined, etabId:etabId||undefined })
      : await getCandidatsBac({ centreId:centreId||undefined, etabId:etabId||undefined, serie:serie||undefined });
    if (!list.length) { el.innerHTML=`<div class="alert alert-warning">Aucun candidat avec ces filtres</div>`; return; }
    if (list.length > 15) {
      el.innerHTML = `<div class="alert alert-warning">⚠ ${list.length} candidats. <button class="btn btn-primary btn-sm" style="margin-left:10px" onclick="forceAllReleves()">Afficher quand même</button></div>`;
      window._pendingReleves = { list, type }; return;
    }
    const rangs = await _calcRangs(list, type);
    const html = await Promise.all(list.map(c => genReleve(c, type, rangs[c.id])));
    el.innerHTML = html.join('<div style="height:1px;background:var(--border);margin:20px 0"></div>');
  } catch(e) { el.innerHTML=`<div class="alert alert-danger">${e.message}</div>`; }
};

window.forceAllReleves = async function() {
  const { list, type } = window._pendingReleves || {};
  if (!list) return;
  const el = document.getElementById('relevesContent');
  el.innerHTML = loading();
  const rangs = await _calcRangs(list, type);
  const html = await Promise.all(list.map(c => genReleve(c, type, rangs[c.id])));
  el.innerHTML = html.join('<div style="height:1px;background:var(--border);margin:20px 0"></div>');
};

// Calcule le rang de chaque candidat dans une liste
async function _calcRangs(cands, type) {
  const notesMap = {};
  await Promise.all(cands.filter(c=>c.valide&&!c.absent).map(async c => {
    notesMap[c.id] = type==='bepc' ? await getNotesBepc(c.id) : await getNotesBac(c.id);
  }));
  const sorted = cands
    .filter(c => c.valide && !c.absent)
    .map(c => {
      const r = type==='bepc'
        ? calcMoyenneBepc(notesMap[c.id]||{}, c.inapt_eps, c.arts_plastiques)
        : calcMoyenneBac(notesMap[c.id]||{}, c.serie, c.inapt_eps);
      return { id: c.id, moy: r.moy };
    })
    .filter(c => c.moy !== null)
    .sort((a,b) => b.moy - a.moy);
  const rangs = {};
  sorted.forEach((c, i) => { rangs[c.id] = i + 1; });
  return rangs;
}

async function genReleve(c, type, rang) {
  const mats   = type==='bepc' ? (G.ref.matBepc||[]) : ((G.ref.matBac||{})[c.serie]||[]);
  const notes  = type==='bepc' ? await getNotesBepc(c.id) : await getNotesBac(c.id);
  const res    = type==='bepc' ? calcMoyenneBepc(notes,c.inapt_eps,c.arts_plastiques) : calcMoyenneBac(notes,c.serie,c.inapt_eps);
  const dec    = getDecision(res.moy, c.absent);
  const mention = getMention(res.moy);
  const annee  = G.ref.config?.annee || '2024-2025';
  const ville  = G.ref.config?.ville || 'Bouaké';
  const region = G.ref.config?.region || 'Vallée du Bandama';

  const decColor = dec==='Admis' ? '#1a6b3a' : dec==='Refusé' ? '#8b1a1a' : '#555';
  const rangTxt  = rang ? `<div style="font-size:11px;color:#444">Rang : <strong>${rang}</strong></div>` : '';

  return `
    <div class="releve" style="page-break-after:always">

      <!-- EN-TÊTE -->
      <div class="releve-header">
        <div>
          <div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.5px">République de Côte d'Ivoire — ${region}</div>
          <div class="releve-title" style="margin-top:2px">RELEVÉ DE NOTES</div>
          <div class="releve-sub">Examen Blanc Régional · ${type==='bepc'?'B.E.P.C':'BAC'} · Année ${annee}</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:10px;color:#888">Centre d'examen</div>
          <div style="font-weight:600;font-size:12px">${getCentreNom(c.centre_id)}</div>
          <div style="font-size:11px;color:#666;margin-top:4px">N° Table : <strong>${c.num_table}</strong></div>
          <div style="font-size:11px;color:#666">Matricule : <strong>${c.matricule}</strong></div>
        </div>
      </div>

      <!-- CANDIDAT -->
      <div class="releve-candidat" style="margin-bottom:12px;padding-bottom:12px;border-bottom:1px solid #ddd">
        <div class="releve-photo">${c.photo_url ? `<img src="${c.photo_url}"/>` : '👤'}</div>
        <div style="flex:1;display:grid;grid-template-columns:1fr 1fr;gap:3px 20px;font-size:12px;align-content:start">
          <div><span style="color:#888">Nom :</span> <strong>${c.nom}</strong></div>
          <div><span style="color:#888">Prénoms :</span> ${c.prenoms}</div>
          <div><span style="color:#888">Sexe :</span> ${c.sexe==='F'?'Féminin':'Masculin'}</div>
          <div><span style="color:#888">Classe :</span> ${c.classe}</div>
          <div style="grid-column:1/-1"><span style="color:#888">Établissement :</span> <strong>${getEtabNom(c.etab_id)}</strong></div>
          ${type==='bac' ? `<div><span style="color:#888">Série :</span> <strong>${c.serie}</strong></div>` : ''}
        </div>
        <!-- Résultat encadré -->
        <div style="text-align:center;padding:10px 16px;border:2px solid ${decColor};border-radius:6px;flex-shrink:0;min-width:100px">
          <div style="font-size:28px;font-weight:700;font-family:monospace;color:${decColor}">${res.moy!==null?res.moy.toFixed(2):'—'}</div>
          <div style="font-size:10px;color:#888">/20 · coef. ${res.coef}</div>
          <div style="font-weight:700;font-size:12px;color:${decColor};margin-top:4px">${dec==='Admis'?'✓ ADMIS(E)':dec==='Refusé'?'✗ REFUSÉ(E)':'ABSENT(E)'}</div>
          <div style="font-size:11px;color:#555;margin-top:3px;font-weight:600">${mention.label}</div>
          ${rangTxt}
        </div>
      </div>

      <!-- TABLEAU DES NOTES -->
      <table class="releve-table">
        <thead>
          <tr>
            <th class="td-left" style="width:45%">Matière</th>
            <th>Coef.</th>
            <th>Note /20</th>
            <th>Points</th>
            <th>Appréciation</th>
          </tr>
        </thead>
        <tbody>
          ${mats.map(m => {
            if (m.facultatif && !c.arts_plastiques) return '';
            const isEPS  = m.id==='MB08' || (m.id&&m.id.endsWith('_10'));
            const grised = (isEPS && c.inapt_eps) || c.absent;
            const n      = notes[m.id];
            const nVal   = grised ? null : (n !== undefined ? parseFloat(n) : null);
            const nStr   = grised ? (c.absent?'ABS':'INAP') : (n !== undefined ? n : '—');
            const pts    = nVal !== null ? (nVal * m.coef).toFixed(2) : '—';
            const appréc = nVal===null ? '' : nVal>=16?'Très Bien' : nVal>=14?'Bien' : nVal>=12?'Assez Bien' : nVal>=10?'Passable' : 'Insuffisant';
            const coulN  = nVal===null ? '' : nVal>=10 ? '#1a6b3a' : '#8b1a1a';
            return `<tr style="${grised?'opacity:.5':''}${m.facultatif?';font-style:italic':''}">
              <td class="td-left">${m.nom}${m.facultatif?' <span style="font-size:10px;color:#aaa">(bonus)</span>':''}</td>
              <td>${m.coef}</td>
              <td><strong style="color:${coulN}">${nStr}</strong></td>
              <td>${pts}</td>
              <td style="font-size:11px;color:${coulN}">${appréc}</td>
            </tr>`;
          }).join('')}
        </tbody>
        <tfoot>
          <tr style="background:#e8f0fa;font-weight:700">
            <td class="td-left">TOTAL GÉNÉRAL</td>
            <td>${res.coef}</td>
            <td style="color:${decColor};font-size:14px">${res.moy!==null?res.moy.toFixed(2):'—'}/20</td>
            <td>${res.pts}</td>
            <td style="color:${decColor};font-weight:700">${mention.label}</td>
          </tr>
        </tfoot>
      </table>

      <!-- PIED DE PAGE -->
      <div class="releve-footer" style="margin-top:12px">
        <div style="font-size:11px;color:#666">Fait à ${ville}, le ${new Date().toLocaleDateString('fr-FR')}</div>
        <div style="font-size:13px;font-weight:700;color:${decColor};border:1px solid ${decColor};padding:4px 14px;border-radius:4px">
          ${dec==='Admis'?'✓ ADMIS(E)' : dec==='Refusé'?'✗ REFUSÉ(E)' : '● ABSENT(E)'}
          &nbsp;—&nbsp; ${mention.label}
        </div>
        <div style="font-size:11px;color:#666;text-align:right">
          <div>Le Directeur de centre</div>
          <div style="margin-top:24px;border-top:1px solid #ccc;width:120px;text-align:center;font-size:10px">Signature & Cachet</div>
        </div>
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
        <div class="page-subtitle">Fiche complète · Historique · Impression individuelle</div></div>
    </div>
    <div class="card" style="margin-bottom:16px">
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
        <div class="form-group" style="flex:1;min-width:200px">
          <label class="form-label">Rechercher un candidat</label>
          <input class="search-input" id="beSearch" placeholder="Matricule, N° de table ou nom..." style="width:100%"
            onkeydown="if(event.key==='Enter') searchBilanEleve()"/>
        </div>
        <button class="btn btn-primary" onclick="searchBilanEleve()">🔍 Rechercher</button>
      </div>
      <div style="font-size:12px;color:var(--text3);margin-top:8px">
        💡 Tapez une partie du nom, le matricule ou le N° de table pour trouver un candidat
      </div>
    </div>
    <div id="beContent"></div>`;
}

window.searchBilanEleve = async function() {
  const q  = document.getElementById('beSearch').value.trim().toLowerCase();
  if (!q) return;
  const el = document.getElementById('beContent');
  el.innerHTML = loading();
  try {
    const [bepcList, bacList] = await Promise.all([
      getCandidatsBepc({ search: q }),
      getCandidatsBac({ search: q }),
    ]);
    const results = [...bepcList.map(c=>({...c,_type:'bepc'})), ...bacList.map(c=>({...c,_type:'bac'}))];

    if (!results.length) {
      el.innerHTML = `<div class="alert alert-warning">Aucun candidat trouvé pour "<strong>${q}</strong>"</div>`; return;
    }

    // Si plusieurs résultats, afficher la liste pour choisir
    if (results.length > 1) {
      el.innerHTML = `
        <div class="alert alert-info">${results.length} candidats trouvés. Cliquez sur un candidat pour voir sa fiche.</div>
        <div class="table-wrap"><table>
          <thead><tr><th>Type</th><th>N° Table</th><th>Matricule</th><th>Nom & Prénoms</th><th>Établissement</th><th>Centre</th><th></th></tr></thead>
          <tbody>${results.map(c=>`<tr>
            <td>${badge(c._type.toUpperCase(), c._type==='bepc'?'blue':'green')}</td>
            <td class="td-mono">${c.num_table}</td>
            <td class="td-mono">${c.matricule}</td>
            <td><strong>${c.nom}</strong> ${c.prenoms}</td>
            <td>${getEtabNom(c.etab_id)}</td>
            <td>${getCentreNom(c.centre_id)}</td>
            <td><button class="btn btn-primary btn-xs" onclick="showFicheEleve('${c.id}','${c._type}')">Voir fiche</button></td>
          </tr>`).join('')}
          </tbody>
        </table></div>`;
      return;
    }

    // Un seul résultat : afficher directement la fiche
    await showFicheEleve(results[0].id, results[0]._type);
  } catch(e) { el.innerHTML=`<div class="alert alert-danger">${e.message}</div>`; }
};

window.showFicheEleve = async function(id, type) {
  const el = document.getElementById('beContent');
  if (!el) return;
  el.innerHTML = loading();
  try {
    const allCands = type==='bepc' ? await getCandidatsBepc() : await getCandidatsBac();
    const c = allCands.find(x => x.id === id);
    if (!c) { el.innerHTML=`<div class="alert alert-danger">Candidat introuvable.</div>`; return; }

    const notes   = type==='bepc' ? await getNotesBepc(c.id) : await getNotesBac(c.id);
    const res     = type==='bepc' ? calcMoyenneBepc(notes,c.inapt_eps,c.arts_plastiques) : calcMoyenneBac(notes,c.serie,c.inapt_eps);
    const dec     = getDecision(res.moy, c.absent);
    const mention = getMention(res.moy);
    const mats    = type==='bepc' ? (G.ref.matBepc||[]) : ((G.ref.matBac||{})[c.serie]||[]);

    // Calculer le rang
    const rangs = await _calcRangs(allCands, type);
    const rang  = rangs[c.id] ? `${rangs[c.id]}e / ${allCands.filter(x=>x.valide&&!x.absent).length}` : '—';

    const decColor = dec==='Admis' ? 'var(--green)' : dec==='Refusé' ? 'var(--red)' : 'var(--text2)';
    const decBg    = dec==='Admis' ? 'var(--green-bg)' : dec==='Refusé' ? 'var(--red-bg)' : 'var(--surface2)';

    // Journal des modifications pour ce candidat
    const { data: auditData } = await supabase
      .from('audit_modifications')
      .select('*')
      .eq('candidat_id', c.id)
      .order('modifie_at', { ascending: false });

    const auditRows = (auditData||[]).map(log => `<tr>
      <td style="font-size:11px;white-space:nowrap">${new Date(log.modifie_at).toLocaleString('fr-FR')}</td>
      <td>${badge(log.modifie_par_nom,'red')}</td>
      <td class="td-mono" style="font-size:11px">${log.matiere_id}</td>
      <td class="td-mono">${log.note_avant??'—'} → <strong>${log.note_apres}</strong></td>
      <td style="font-size:11px;color:var(--text2)">${log.motif||'—'}</td>
    </tr>`).join('');

    el.innerHTML = `
      <!-- FICHE CANDIDAT -->
      <div class="card" style="margin-bottom:16px">

        <!-- Entête fiche -->
        <div style="display:flex;gap:20px;align-items:flex-start;margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid var(--border)">

          <!-- Photo -->
          <div style="width:90px;height:100px;border-radius:var(--r);border:1px solid var(--border);overflow:hidden;flex-shrink:0;background:var(--surface2);display:flex;align-items:center;justify-content:center;font-size:36px">
            ${c.photo_url ? `<img src="${c.photo_url}" style="width:100%;height:100%;object-fit:cover"/>` : '👤'}
          </div>

          <!-- Infos -->
          <div style="flex:1">
            <div style="font-size:22px;font-weight:700;letter-spacing:-.5px;margin-bottom:8px">${c.nom} <span style="font-weight:400">${c.prenoms}</span></div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">
              ${badge(type.toUpperCase(), type==='bepc'?'blue':'green')}
              ${badge(c.num_table,'gray')}
              ${badge(c.matricule,'gray')}
              ${badge(c.sexe==='F'?'Féminin':'Masculin', c.sexe==='F'?'pink':'blue')}
              ${badge(c.classe,'gray')}
              ${type==='bac' ? badge('Série '+c.serie, c.serie==='C'?'red':c.serie==='D'?'amber':c.serie==='A1'?'green':'blue') : ''}
              ${c.valide ? badge('✓ Validé','green') : badge('En attente','amber')}
            </div>
            <div style="font-size:13px;color:var(--text2)">
              🏫 <strong>${getEtabNom(c.etab_id)}</strong> &nbsp;·&nbsp; 📍 ${getCentreNom(c.centre_id)}
            </div>
          </div>

          <!-- Résultat -->
          <div style="text-align:center;padding:16px 24px;background:${decBg};border-radius:var(--r2);border:2px solid ${decColor};flex-shrink:0">
            <div style="font-size:38px;font-weight:700;font-family:var(--mono);color:${decColor};line-height:1">${res.moy!==null?res.moy.toFixed(2):'—'}</div>
            <div style="font-size:11px;color:var(--text2);margin-top:2px">/20 · ${res.pts} pts · coef. ${res.coef}</div>
            <div style="font-weight:700;color:${decColor};margin-top:8px;font-size:13px">${dec==='Admis'?'✓ ADMIS(E)':dec==='Refusé'?'✗ REFUSÉ(E)':'● ABSENT(E)'}</div>
            <div style="margin-top:6px">${badge(mention.label, mention.cls)}</div>
            <div style="font-size:11px;color:var(--text2);margin-top:6px">Rang : <strong>${rang}</strong></div>
          </div>
        </div>

        <!-- Tableau des notes -->
        <div class="card-title" style="margin-bottom:8px">📋 Détail des notes</div>
        <div class="table-wrap" style="margin-bottom:16px"><table>
          <thead><tr>
            <th style="text-align:left">Matière</th>
            <th>Coef.</th><th>Note /20</th><th>Points</th><th>Appréciation</th>
          </tr></thead>
          <tbody>${mats.map(m => {
            if (m.facultatif && !c.arts_plastiques) return '';
            const isEPS  = m.id==='MB08' || (m.id&&m.id.endsWith('_10'));
            const grised = (isEPS && c.inapt_eps) || c.absent;
            const n      = notes[m.id];
            const nVal   = grised ? null : (n !== undefined ? parseFloat(n) : null);
            const nStr   = grised ? (c.absent?'ABS':'INAP') : (n !== undefined ? n : '—');
            const pts    = nVal !== null ? (nVal * m.coef).toFixed(2) : '—';
            const appréc = nVal===null?'':nVal>=16?'Très Bien':nVal>=14?'Bien':nVal>=12?'Assez Bien':nVal>=10?'Passable':'Insuffisant';
            const coulN  = nVal===null?'':nVal>=10?'var(--green)':'var(--red)';
            return `<tr style="${grised?'opacity:.5':''}">
              <td>${m.nom}${m.facultatif?' <span style="font-size:10px;color:var(--text3)">(bonus)</span>':''}</td>
              <td class="td-mono">${m.coef}</td>
              <td class="td-mono" style="font-weight:600;color:${coulN}">${nStr}</td>
              <td class="td-mono">${pts}</td>
              <td style="font-size:12px;color:${coulN}">${appréc}</td>
            </tr>`;
          }).join('')}</tbody>
          <tfoot><tr style="background:var(--surface2);font-weight:700">
            <td>TOTAL GÉNÉRAL</td>
            <td class="td-mono">${res.coef}</td>
            <td class="td-mono" style="color:${decColor};font-size:15px">${res.moy!==null?res.moy.toFixed(2):'—'}/20</td>
            <td class="td-mono">${res.pts}</td>
            <td>${badge(mention.label, mention.cls)}</td>
          </tr></tfoot>
        </table></div>

        <!-- Journal des modifications -->
        ${auditRows ? `
          <div class="card-title" style="margin-bottom:8px">📝 Historique des modifications</div>
          <div class="table-wrap" style="margin-bottom:16px"><table>
            <thead><tr><th>Date</th><th>Modifié par</th><th>Matière</th><th>Note</th><th>Motif</th></tr></thead>
            <tbody>${auditRows}</tbody>
          </table></div>` : ''}

        <!-- Actions -->
        <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap">
          <button class="btn btn-outline btn-sm" onclick="nav('bilan-eleve')">↩ Nouvelle recherche</button>
          ${G.role==='admin' && c.valide ? `<button class="btn btn-outline btn-sm" onclick="doDeverrouiller_fiche('${c.id}','${type}')">🔓 Déverrouiller</button>` : ''}
          <button class="btn btn-primary btn-sm" onclick="imprimerFicheEleve('${c.id}','${type}')">🖨 Imprimer relevé</button>
        </div>
      </div>`;

  } catch(e) { el.innerHTML=`<div class="alert alert-danger">${e.message}</div>`; }
};

window.imprimerFicheEleve = async function(id, type) {
  const allCands = type==='bepc' ? await getCandidatsBepc() : await getCandidatsBac();
  const c = allCands.find(x => x.id === id);
  if (!c) return;
  const rangs = await _calcRangs(allCands, type);
  const html  = await genReleve(c, type, rangs[c.id]);
  const win   = window.open('', '_blank');
  win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8">
    <title>Relevé — ${c.nom} ${c.prenoms}</title>
    <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@300;400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet"/>
    <style>
      *{box-sizing:border-box;margin:0;padding:0}
      body{font-family:'IBM Plex Sans',sans-serif;font-size:13px;padding:24px;color:#1a1916}
      .releve{max-width:700px;margin:0 auto;border:1px solid #ccc;padding:24px;border-radius:4px}
      .releve-header{display:flex;justify-content:space-between;margin-bottom:14px;padding-bottom:14px;border-bottom:2px solid #1a4a8a}
      .releve-title{font-size:17px;font-weight:700;color:#1a4a8a}
      .releve-sub{font-size:11px;color:#666;margin-top:2px}
      .releve-candidat{display:flex;gap:14px;margin-bottom:14px;padding-bottom:14px;border-bottom:1px solid #ddd}
      .releve-photo{width:65px;height:75px;border:1px solid #ccc;border-radius:4px;overflow:hidden;background:#f5f5f5;display:flex;align-items:center;justify-content:center;font-size:26px;flex-shrink:0}
      .releve-photo img{width:100%;height:100%;object-fit:cover}
      .releve-table{width:100%;border-collapse:collapse;font-size:12px}
      .releve-table th,.releve-table td{padding:5px 8px;border:1px solid #ddd;text-align:center}
      .releve-table th{background:#e8f0fa;font-weight:600;font-size:11px}
      .releve-table .td-left{text-align:left}
      .releve-footer{margin-top:14px;padding-top:10px;border-top:1px solid #ccc;display:flex;justify-content:space-between;font-size:11px;align-items:flex-start}
      @media print{body{padding:0}@page{margin:1cm}}
    </style>
  </head><body>${html}</body></html>`);
  win.document.close();
  setTimeout(() => win.print(), 500);
};

window.doDeverrouiller_fiche = async function(id, type) {
  if (!confirm('Déverrouiller cette fiche ?')) return;
  try {
    if (type==='bepc') await deverrouillerBepc(id);
    else               await deverrouillerBac(id);
    showToast('Fiche déverrouillée.');
    await showFicheEleve(id, type);
  } catch(e) { alert(e.message); }
};

// ─────────────────────────────────────────────────────────────
// UTILISATEURS (admin seulement)
// ─────────────────────────────────────────────────────────────
async function renderUtilisateurs() {
  if (G.role !== 'directeur') return `
    <div class="card" style="text-align:center;padding:48px">
      <div style="font-size:40px;margin-bottom:12px">⛔</div>
      <div style="font-size:18px;font-weight:600;margin-bottom:8px">Accès interdit</div>
      <div style="color:var(--text2);font-size:13px">La gestion des utilisateurs est réservée au Directeur Régional uniquement.</div>
    </div>`;
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
  if (G.role !== 'directeur') { alert('⛔ Action réservée au Directeur Régional.'); return; }
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
  if (G.role !== 'directeur') return `<div class="alert alert-danger">Accès réservé au Directeur Régional</div>`;
  const cfg = G.ref.config||{};
  return `
    <div class="page-header">
      <div><div class="page-title">Paramètres</div>
        <div class="page-subtitle">Configuration · Compte · Réinitialisation</div></div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px">
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
        <button class="btn btn-primary btn-sm" onclick="saveParams()">💾 Sauvegarder</button>
      </div>
      <div class="card">
        <div class="card-title">Compte connecté</div>
        <div style="font-size:13px;margin-bottom:12px">
          <div>Email : <strong>${G.user?.email||'—'}</strong></div>
          <div style="margin-top:4px">Rôle : <strong>${G.role==='directeur'?'🔑 Directeur Régional':G.role==='admin'?'🛡 Administrateur':'👤 Superviseur'}</strong></div>
        </div>
        <div class="alert alert-success">
          ${G.role==='directeur'?'Accès complet à toutes les fonctionnalités, y compris la clôture de saison.':'Accès complet aux fonctionnalités administratives.'}
        </div>
      </div>
    </div>

    <!-- ZONE RÉINITIALISATION -->
    <div class="card" style="border:2px solid var(--red);border-radius:var(--r2)">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
        <div style="width:40px;height:40px;border-radius:50%;background:var(--red-bg);display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0">🗑️</div>
        <div>
          <div class="card-title" style="color:var(--red);margin-bottom:2px">Zone de réinitialisation — Nouvel examen</div>
          <div style="font-size:12px;color:var(--text2)">Réservé à l'Administrateur et au Directeur Régional · Action irréversible</div>
        </div>
      </div>

      <div class="alert alert-danger" style="margin-bottom:16px">
        ⚠️ <strong>Attention !</strong> Cette action supprime définitivement toutes les notes, tous les candidats,
        tous les centres et tous les établissements. Les matières et utilisateurs sont conservés.
        Cette opération est <strong>irréversible</strong>.
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
        <div style="background:var(--surface2);border-radius:var(--r);padding:12px;font-size:12px">
          <div style="font-weight:600;margin-bottom:6px;color:var(--red)">❌ Sera supprimé :</div>
          <div>• Tous les candidats BEPC</div>
          <div>• Tous les candidats BAC</div>
          <div>• Toutes les notes BEPC</div>
          <div>• Toutes les notes BAC</div>
          <div>• Journal des modifications</div>
          <div>• Tous les établissements</div>
          <div>• Tous les centres d'examen</div>
        </div>
        <div style="background:var(--green-bg);border-radius:var(--r);padding:12px;font-size:12px">
          <div style="font-weight:600;margin-bottom:6px;color:var(--green)">✅ Sera conservé :</div>
          <div>• Matières & coefficients BEPC</div>
          <div>• Matières & coefficients BAC</div>
          <div>• Comptes utilisateurs</div>
          <div>• Configuration générale</div>
        </div>
      </div>

      <button class="btn btn-danger" onclick="demanderReinitialisation()" style="width:100%;justify-content:center;padding:12px">
        🔄 Réinitialiser pour un nouvel examen
      </button>
    </div>`;
}

window.demanderReinitialisation = function() {
  if (G.role !== 'directeur') { showToast('Accès refusé', 'error'); return; }
  showModal('⚠️ Réinitialisation — Étape 1/2', `
    <div class="alert alert-danger" style="margin-bottom:16px">
      Vous êtes sur le point de supprimer <strong>tous les candidats, toutes les notes,
      tous les centres et tous les établissements</strong>.
    </div>
    <p style="font-size:13px;margin-bottom:16px">
      Cette action est <strong>irréversible</strong>. Toutes les données de l'examen en cours seront perdues.
    </p>
    <p style="font-size:13px;font-weight:600">Êtes-vous sûr de vouloir continuer ?</p>`,
    [
      { label: 'Annuler', cls: 'btn-outline', action: closeModal },
      { label: '⚠️ Oui, continuer', cls: 'btn-danger', action: () => {
        closeModal();
        confirmerReinitialisation();
      }}
    ]
  );
};

window.confirmerReinitialisation = function() {
  showModal('🔒 Réinitialisation — Étape 2/2 — Confirmation finale', `
    <div class="alert alert-danger" style="margin-bottom:16px">
      <strong>Dernière confirmation requise.</strong>
    </div>
    <p style="font-size:13px;margin-bottom:12px">
      Pour confirmer, tapez exactement : <strong>REINITIALISER</strong>
    </p>
    <input class="form-input" id="confirmText" placeholder="Tapez REINITIALISER" style="font-size:14px;font-weight:600;letter-spacing:1px"/>
    <p style="font-size:11px;color:var(--text3);margin-top:8px">
      Connecté en tant que : <strong>${G.user?.email}</strong>
    </p>`,
    [
      { label: 'Annuler', cls: 'btn-outline', action: closeModal },
      { label: '🗑️ Réinitialiser définitivement', cls: 'btn-danger', action: async () => {
        const val = document.getElementById('confirmText').value.trim();
        if (val !== 'REINITIALISER') {
          alert('Texte incorrect. Tapez exactement : REINITIALISER');
          return;
        }
        closeModal();
        await executerReinitialisation();
      }}
    ]
  );
};

window.executerReinitialisation = async function() {
  document.getElementById('content').innerHTML = `
    <div class="card" style="text-align:center;padding:60px">
      <div class="spinner" style="width:40px;height:40px;margin:0 auto 16px"></div>
      <div style="font-size:16px;font-weight:600;margin-bottom:8px">Réinitialisation en cours...</div>
      <div style="font-size:13px;color:var(--text2)" id="reinitStatus">Démarrage...</div>
    </div>`;

  const setStatus = (msg) => {
    const el = document.getElementById('reinitStatus');
    if (el) el.textContent = msg;
  };

  try {
    // ── Étape 1 : Suppression notes ────────────────────────────
    setStatus('Suppression des notes BEPC...');
    const { error: eNB } = await supabase.from('notes_bepc').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (eNB) throw new Error('notes_bepc : ' + eNB.message);

    setStatus('Suppression des notes BAC...');
    const { error: eNBac } = await supabase.from('notes_bac').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (eNBac) throw new Error('notes_bac : ' + eNBac.message);

    // ── Étape 2 : Suppression candidats ────────────────────────
    setStatus('Suppression des candidats BEPC...');
    const { error: eCB } = await supabase.from('candidats_bepc').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (eCB) throw new Error('candidats_bepc : ' + eCB.message);

    setStatus('Suppression des candidats BAC...');
    const { error: eCBac } = await supabase.from('candidats_bac').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (eCBac) throw new Error('candidats_bac : ' + eCBac.message);

    // ── Étape 3 : Suppression centres & établissements ─────────
    setStatus('Suppression des centres d\'examen...');
    const { error: eCtr } = await supabase.from('centres').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (eCtr) throw new Error('centres : ' + eCtr.message);

    setStatus('Suppression des établissements...');
    const { error: eEtab } = await supabase.from('etablissements').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (eEtab) throw new Error('etablissements : ' + eEtab.message);

    // ── Étape 4 : Journal des modifications ────────────────────
    setStatus('Nettoyage du journal...');
    await supabase.from('audit_modifications').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    // (pas de throw si erreur ici — non bloquant)

    // ── Étape 5 : Vider le cache local COMPLÈTEMENT ────────────
    setStatus('Mise à jour du cache local...');
    // Vider immédiatement le cache
    G.ref = { etablissements: [], centres: [], config: G.ref.config || {}, matBepc: G.ref.matBepc || [], matBac: G.ref.matBac || {} };
    // Attendre propagation Supabase
    await new Promise(r => setTimeout(r, 1500));
    // Recharger depuis Supabase
    const freshRef = await loadRefData();
    G.ref = { ...freshRef, etablissements: freshRef.etablissements || [], centres: freshRef.centres || [] };
    // Si encore des données, retry après délai supplémentaire
    if ((G.ref.etablissements||[]).length > 0 || (G.ref.centres||[]).length > 0) {
      await new Promise(r => setTimeout(r, 1500));
      const retry = await loadRefData();
      G.ref = { ...retry, etablissements: retry.etablissements || [], centres: retry.centres || [] };
    }

    document.getElementById('content').innerHTML = `
      <div class="card" style="text-align:center;padding:60px;border:2px solid var(--green)">
        <div style="font-size:48px;margin-bottom:16px">✅</div>
        <div style="font-size:20px;font-weight:700;color:var(--green);margin-bottom:8px">Réinitialisation terminée !</div>
        <div style="font-size:13px;color:var(--text2);margin-bottom:24px">
          Tous les candidats, toutes les notes, tous les centres<br>
          et tous les établissements ont été supprimés.<br>
          L'application est prête pour un nouvel examen.
        </div>
        <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
          <button class="btn btn-primary" onclick="nav('etablissements')">🏫 Créer les établissements</button>
          <button class="btn btn-primary" onclick="nav('centres')">📍 Créer les centres</button>
          <button class="btn btn-outline" onclick="nav('parametres')">⚙️ Mettre à jour l'année</button>
        </div>
      </div>`;

    showToast('✅ Réinitialisation complète effectuée !');

  } catch(e) {
    document.getElementById('content').innerHTML = `
      <div class="card" style="border:2px solid var(--red)">
        <div class="alert alert-danger">❌ Erreur : ${e.message}</div>
        <button class="btn btn-outline btn-sm" onclick="nav('parametres')">Retour aux paramètres</button>
      </div>`;
  }
};

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

// Délégation d'événements — attachée directement sur document (fonctionne avec ES modules)
document.addEventListener('click', e => {
  // Boutons data-load
  const loadBtn = e.target.closest('[data-load]');
  if (loadBtn) {
    const fn = loadBtn.dataset.load;
    if (window[fn]) window[fn]();
  }
  // Boutons établissements
  const editEtabBtn = e.target.closest('[data-edit-etab]');
  if (editEtabBtn) {
    window.showEditEtab(editEtabBtn.dataset.editEtab);
  }
  const delEtabBtn = e.target.closest('[data-del-etab]');
  if (delEtabBtn) {
    window.doDeleteEtab(delEtabBtn.dataset.delEtab);
  }
  // Boutons centres
  const editCentreBtn = e.target.closest('[data-edit-centre]');
  if (editCentreBtn) {
    window.showEditCentre(editCentreBtn.dataset.editCentre);
  }
  const delCentreBtn = e.target.closest('[data-del-centre]');
  if (delCentreBtn) {
    window.doDeleteCentre(delCentreBtn.dataset.delCentre);
  }
});

// ─────────────────────────────────────────────────────────────
// TRAÇABILITÉ DES MODIFICATIONS — ADMIN UNIQUEMENT
// ─────────────────────────────────────────────────────────────

async function logModification(typeExamen, candidatId, matiereId, noteAvant, noteApres, motif, candidatSnapshot) {
  try {
    const nomAdmin = G.user?.profile?.nom || G.user?.email || 'Admin';
    const c = candidatSnapshot || {};
    await supabase.from('audit_modifications').insert({
      type_examen:     typeExamen,
      candidat_id:     candidatId,
      matiere_id:      matiereId,
      note_avant:      noteAvant ?? null,
      note_apres:      noteApres,
      modifie_par:     G.user.id,
      modifie_par_nom: nomAdmin,
      motif:           motif || '',
      modifie_at:      new Date().toISOString(),
      // Instantané figé du candidat (reste intact même si le candidat est supprimé plus tard)
      candidat_nom:       c.nom || null,
      candidat_prenoms:   c.prenoms || null,
      candidat_matricule: c.matricule || null,
      candidat_num_table: c.num_table || null,
      centre_nom:         c.centre_id ? getCentreNom(c.centre_id) : (c.centre_nom || null),
    });
  } catch(e) { console.error('Erreur log:', e); }
}

window.showAuditLog = async function(candidatId, nomCandidat) {
  const { data, error } = await supabase
    .from('audit_modifications')
    .select('*')
    .eq('candidat_id', candidatId)
    .order('modifie_at', { ascending: false });
  if (error) { alert(error.message); return; }
  const rows = (data||[]).map(log=>`<tr>
    <td class="td-mono" style="font-size:11px">${new Date(log.modifie_at).toLocaleString('fr-FR')}</td>
    <td><span class="badge badge-red">${log.modifie_par_nom}</span></td>
    <td class="td-mono">${log.matiere_id}</td>
    <td class="td-mono">${log.note_avant??'—'} → <strong>${log.note_apres}</strong></td>
    <td style="font-size:12px;color:var(--text2)">${log.motif||'—'}</td>
  </tr>`).join('');
  showModal(`Journal — ${nomCandidat}`,`
    ${!data?.length?'<div class="alert alert-info">Aucune modification enregistrée.</div>':
    `<div class="table-wrap"><table>
      <thead><tr><th>Date</th><th>Par</th><th>Matière</th><th>Note</th><th>Motif</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`}`,
    [{label:'Fermer',cls:'btn-outline',action:closeModal}]);
};

window.modifierNoteAdmin = async function(candidatId, matiereId, noteActuelle, type, centreId, serie) {
  if (G.role !== 'admin') { showToast('Accès refusé — admin uniquement','error'); return; }
  const nomAdmin = G.user?.profile?.nom || G.user?.email;
  showModal('Modifier une note — Administrateur',`
    <div class="alert alert-warning" style="margin-bottom:14px">
      ⚠️ Action tracée dans le journal avec votre identité.
    </div>
    <div class="form-group" style="margin-bottom:12px">
      <label class="form-label">Note actuelle</label>
      <input class="form-input" value="${noteActuelle??'Non saisie'}" disabled/>
    </div>
    <div class="form-group" style="margin-bottom:12px">
      <label class="form-label">Nouvelle note <span class="form-required">*</span></label>
      <input class="form-input" type="number" id="mn_note" min="0" max="20" step="0.25" placeholder="0 — 20"/>
    </div>
    <div class="form-group">
      <label class="form-label">Motif obligatoire <span class="form-required">*</span></label>
      <textarea class="form-textarea" id="mn_motif" rows="3" placeholder="Ex: Erreur de saisie corrigée après vérification..."></textarea>
    </div>
    <div style="margin-top:10px;padding:10px;background:var(--surface2);border-radius:var(--r);font-size:12px;color:var(--text2)">
      📋 Enregistré par : <strong>${nomAdmin}</strong> · ${new Date().toLocaleString('fr-FR')}
    </div>`,
    [{label:'Annuler',cls:'btn-outline',action:closeModal},
     {label:'✓ Confirmer',cls:'btn-danger',action:async()=>{
       const n=parseFloat(document.getElementById('mn_note').value);
       const m=document.getElementById('mn_motif').value.trim();
       if(isNaN(n)||n<0||n>20){alert('Note invalide (0-20)');return;}
       if(!m){alert('Le motif est obligatoire');return;}
       try {
         const payload={candidat_id:candidatId,matiere_id:matiereId,note:n,saisie_par:G.user.id,modifie_par_nom:nomAdmin,modifie_at:new Date().toISOString(),updated_at:new Date().toISOString()};
         if(type==='bepc') await supabase.from('notes_bepc').upsert(payload,{onConflict:'candidat_id,matiere_id'});
         else await supabase.from('notes_bac').upsert(payload,{onConflict:'candidat_id,matiere_id'});
         const candSnap = type==='bepc'
           ? (window._sbCands||[]).find(c=>c.id===candidatId)
           : (window._sBCands||[]).find(c=>c.id===candidatId);
         await logModification(type,candidatId,matiereId,noteActuelle,n,m,candSnap);
         closeModal();
         showToast(`✓ Note modifiée par ${nomAdmin} — journalisée`);
         if(type==='bepc') await loadSaisieBepc();
         else await loadSaisieBac();
       } catch(e){alert(e.message);}
     }}]);
};

window.renderJournal = async function() {
  // Consultation ouverte à tous les rôles (Admin, Directeur Régional, Superviseur) — seuls
  // Admin et Directeur peuvent modifier des notes, donc seules leurs actions y apparaîtront.

  // Arrêter l'ancienne subscription si elle existe
  if (window._journalChannel) {
    supabase.removeChannel(window._journalChannel);
    window._journalChannel = null;
  }
  if (window._journalInterval) {
    clearInterval(window._journalInterval);
    window._journalInterval = null;
  }

  async function chargerJournal() {
    const {data,error} = await supabase
      .from('audit_modifications')
      .select('*')
      .order('modifie_at',{ascending:false})
      .limit(200);
    const tbody = document.getElementById('journalTbody');
    if (!tbody) return;
    if (error) { tbody.innerHTML=`<tr><td colspan="9" class="alert alert-danger">${error.message}</td></tr>`; return; }
    if (!data?.length) { tbody.innerHTML='<tr><td colspan="9" style="text-align:center;color:var(--text2)">Aucune modification enregistrée.</td></tr>'; return; }

    // Récupération des infos candidat (nom, matricule, n°table, centre) pour traçabilité
    // — uniquement nécessaire pour les entrées anciennes n'ayant pas encore l'instantané figé
    const sansSnapshot = data.filter(l => !l.candidat_matricule);
    const idsBepc = [...new Set(sansSnapshot.filter(l=>l.type_examen==='bepc').map(l=>l.candidat_id))];
    const idsBac  = [...new Set(sansSnapshot.filter(l=>l.type_examen==='bac').map(l=>l.candidat_id))];
    const candMap = {};
    const [rBepc, rBac] = await Promise.all([
      idsBepc.length ? supabase.from('candidats_bepc').select('id,nom,prenoms,matricule,num_table,centre_id').in('id', idsBepc) : Promise.resolve({data:[]}),
      idsBac.length  ? supabase.from('candidats_bac').select('id,nom,prenoms,matricule,num_table,centre_id').in('id', idsBac)  : Promise.resolve({data:[]}),
    ]);
    (rBepc.data||[]).forEach(c => { candMap[c.id] = c; });
    (rBac.data||[]).forEach(c => { candMap[c.id] = c; });

    tbody.innerHTML = data.map(log=>{
      const dt = new Date(log.modifie_at);
      const dateStr = dt.toLocaleDateString('fr-FR');
      const heureStr = dt.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
      const isNew = (Date.now()-dt.getTime()) < 30000;

      // Priorité à l'instantané figé au moment de la modification (immuable) ;
      // repli sur la jointure live pour les entrées antérieures à cette fonctionnalité
      const c = candMap[log.candidat_id];
      const candStr = log.candidat_matricule
        ? `${log.candidat_nom||''} ${log.candidat_prenoms||''}`
        : (c ? `${c.nom} ${c.prenoms||''}` : '<span style="color:var(--text3)">Candidat introuvable</span>');
      const matriculeStr = log.candidat_matricule || (c ? c.matricule : '—');
      const numTableStr   = log.candidat_num_table || (c ? c.num_table : '—');
      const centreStr     = log.centre_nom || (c ? getCentreNom(c.centre_id) : '—');
      return `<tr${isNew?' style="background:var(--green-light,#e8f5e9);animation:fadeIn .5s"':''}>
        <td class="td-mono" style="font-size:11px;white-space:nowrap">
          <div>${dateStr}</div>
          <div style="color:var(--text2);font-size:10px">${heureStr}</div>
        </td>
        <td><span class="badge badge-red">${log.modifie_par_nom}</span></td>
        <td>${badge((log.type_examen||'?').toUpperCase(),'blue')}</td>
        <td style="font-size:12px;white-space:nowrap">
          <div style="font-weight:600">${candStr}</div>
          <div style="color:var(--text2);font-size:11px">${matriculeStr} · N°${numTableStr}</div>
        </td>
        <td style="font-size:12px">${centreStr}</td>
        <td class="td-mono">${log.matiere_id}</td>
        <td class="td-mono" style="color:var(--red)">${log.note_avant??'—'}</td>
        <td class="td-mono" style="color:var(--green);font-weight:600">${log.note_apres}</td>
        <td style="font-size:12px;color:var(--text2)">${log.motif||'—'}</td>
      </tr>`;
    }).join('');
    // Badge compteur
    const badge0 = document.getElementById('journalCount');
    if (badge0) badge0.textContent = data.length;
  }

  // Abonnement Realtime Supabase
  window._journalChannel = supabase
    .channel('journal-realtime')
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'audit_modifications'
    }, payload => {
      chargerJournal();
      // Notification toast discrète
      const nom = payload.new?.modifie_par_nom || '??';
      const mat = payload.new?.matiere_id || '';
      const apres = payload.new?.note_apres ?? '';
      const dt = new Date(payload.new?.modifie_at || Date.now());
      const h = dt.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
      showToast(`🔔 ${nom} — ${mat} : ${apres}/20 à ${h}`);
    })
    .subscribe();

  // Fallback polling toutes les 15s au cas où realtime ne passe pas
  window._journalInterval = setInterval(chargerJournal, 15000);

  // HTML statique — le tbody sera rempli dynamiquement
  setTimeout(chargerJournal, 100);

  return `
    <div class="page-header">
      <div>
        <div class="page-title">🔔 Journal des modifications <span id="journalCount" style="font-size:13px;font-weight:normal;color:var(--text2)"></span></div>
        <div class="page-subtitle">Temps réel — mise à jour automatique</div>
      </div>
      <button class="btn btn-outline btn-sm" onclick="window.renderJournal().then(h=>{document.getElementById('mainContent').innerHTML=h})">🔄 Rafraîchir</button>
    </div>
    <style>@keyframes fadeIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}</style>
    <div class="table-wrap"><table>
      <thead><tr>
        <th>Date & Heure</th>
        <th>Utilisateur</th>
        <th>Type</th>
        <th>Candidat</th>
        <th>Centre</th>
        <th>Matière</th>
        <th>Avant</th>
        <th>Après</th>
        <th>Motif</th>
      </tr></thead>
      <tbody id="journalTbody">
        <tr><td colspan="9" style="text-align:center;padding:20px;color:var(--text2)">Chargement...</td></tr>
      </tbody>
    </table></div>`;
};
// ─────────────────────────────────────────────────────────────
// NOTES PAR MATIÈRE — RELEVÉ PROFESSEUR
// Filtres : Centre → Établissement → Classe → Matière
// ─────────────────────────────────────────────────────────────

async function renderNotesMatieres() {
  const centres = G.ref.centres || [];
  const etabs   = G.ref.etablissements || [];
  const matBepc = G.ref.matBepc || [];
  const matBac  = G.ref.matBac  || {};

  return `
    <div class="page-header">
      <div>
        <div class="page-title">📋 Notes par matière — Relevé professeur</div>
        <div class="page-subtitle">Filtrez et imprimez les notes d'une matière par classe pour les professeurs</div>
      </div>
      <div class="header-actions">
        <button class="btn btn-outline btn-sm" onclick="window.print()">🖨 Imprimer</button>
      </div>
    </div>

    <div class="card" style="margin-bottom:16px" id="nmFilters">
      <div class="form-grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr))">
        <div class="form-group">
          <label class="form-label">Type d'examen</label>
          <select class="form-select" id="nmType" onchange="nmUpdateMatieres()">
            <option value="bepc">BEPC</option>
            <option value="bac">BAC</option>
          </select>
        </div>
        <div class="form-group" id="nmSerieGroup" style="display:none">
          <label class="form-label">Série (BAC)</label>
          <select class="form-select" id="nmSerie" onchange="nmUpdateMatieres()">
            <option value="A1">A1</option>
            <option value="A2">A2</option>
            <option value="C">C</option>
            <option value="D">D</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Centre</label>
          <select class="form-select" id="nmCentre" onchange="nmLoadEtabs()">
            <option value="">— Tous les centres —</option>
            ${centres.map(c=>`<option value="${c.id}">${c.nom}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Établissement</label>
          <select class="form-select" id="nmEtab" onchange="nmLoadClasses()">
            <option value="">— Tous les établissements —</option>
            ${etabs.map(e=>`<option value="${e.id}">${e.nom}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Classe</label>
          <select class="form-select" id="nmClasse">
            <option value="">— Toutes les classes —</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Matière <span class="form-required">*</span></label>
          <select class="form-select" id="nmMatiere">
            <option value="">— Sélectionner une matière —</option>
            ${matBepc.map(m=>`<option value="${m.id}">${m.nom} (coef. ${m.coef})</option>`).join('')}
          </select>
        </div>
      </div>
      <div style="display:flex;gap:8px;margin-top:8px">
        <button class="btn btn-primary" onclick="nmCharger()">🔍 Afficher les notes</button>
        <button class="btn btn-outline" onclick="nmReset()">✕ Réinitialiser</button>
      </div>
    </div>

    <div id="nmResult"></div>`;
}

window.nmUpdateMatieres = function() {
  const type  = document.getElementById('nmType').value;
  const serie = document.getElementById('nmSerie')?.value || 'A1';
  const serieGroup = document.getElementById('nmSerieGroup');
  serieGroup.style.display = type === 'bac' ? '' : 'none';

  const mats = type === 'bepc'
    ? (G.ref.matBepc || [])
    : ((G.ref.matBac || {})[serie] || []);

  document.getElementById('nmMatiere').innerHTML =
    `<option value="">— Sélectionner une matière —</option>` +
    mats.map(m=>`<option value="${m.id}">${m.nom} (coef. ${m.coef})</option>`).join('');
};

window.nmLoadEtabs = function() {
  // Rien à faire — les étabs sont déjà chargés
  // On peut filtrer les étabs par centre si besoin
};

window.nmLoadClasses = async function() {
  const type    = document.getElementById('nmType').value;
  const etabId  = document.getElementById('nmEtab').value;
  const centreId= document.getElementById('nmCentre').value;

  let q = supabase.from('candidats_'+type).select('classe');
  if (etabId)   q = q.eq('etab_id', etabId);
  if (centreId) q = q.eq('centre_id', centreId);
  const { data } = await q;

  const classes = [...new Set((data||[]).map(c=>c.classe).filter(Boolean))].sort();
  document.getElementById('nmClasse').innerHTML =
    `<option value="">— Toutes les classes —</option>` +
    classes.map(cl=>`<option value="${cl}">${cl}</option>`).join('');
};

window.nmCharger = async function() {
  const type     = document.getElementById('nmType').value;
  const serie    = document.getElementById('nmSerie')?.value || '';
  const centreId = document.getElementById('nmCentre').value;
  const etabId   = document.getElementById('nmEtab').value;
  const classe   = document.getElementById('nmClasse').value;
  const matId    = document.getElementById('nmMatiere').value;

  if (!matId) { showToast('Sélectionnez une matière', 'error'); return; }

  const el = document.getElementById('nmResult');
  el.innerHTML = `<div class="loading"><div class="spinner"></div>Chargement...</div>`;

  // Récupérer la matière
  const mats = type === 'bepc' ? (G.ref.matBepc||[]) : ((G.ref.matBac||{})[serie]||[]);
  const matiere = mats.find(m => m.id === matId);

  // Charger les candidats
  let q = supabase.from('candidats_'+type).select('*').order('nom');
  if (centreId) q = q.eq('centre_id', centreId);
  if (etabId)   q = q.eq('etab_id', etabId);
  if (classe)   q = q.eq('classe', classe);
  if (serie && type==='bac') q = q.eq('serie', serie);
  const { data: cands, error } = await q;
  if (error) { el.innerHTML = `<div class="alert alert-danger">${error.message}</div>`; return; }
  if (!cands?.length) { el.innerHTML = `<div class="alert alert-warning">Aucun candidat trouvé avec ces filtres.</div>`; return; }

  // Charger les notes pour cette matière
  const candidatIds = cands.map(c=>c.id);
  const { data: notes } = await supabase
    .from('notes_'+type)
    .select('candidat_id, note')
    .eq('matiere_id', matId)
    .in('candidat_id', candidatIds);

  const notesMap = {};
  (notes||[]).forEach(n => { notesMap[n.candidat_id] = parseFloat(n.note); });

  // Stats
  const avecNote  = cands.filter(c => notesMap[c.id] !== undefined);
  const sansNote  = cands.filter(c => notesMap[c.id] === undefined && !c.absent);
  const absents   = cands.filter(c => c.absent);
  const notes_vals = avecNote.map(c => notesMap[c.id]).filter(n => !isNaN(n));
  const moyenne   = notes_vals.length > 0 ? (notes_vals.reduce((a,b)=>a+b,0)/notes_vals.length).toFixed(2) : '—';
  const max       = notes_vals.length > 0 ? Math.max(...notes_vals) : '—';
  const min       = notes_vals.length > 0 ? Math.min(...notes_vals) : '—';

  // Filtre info
  const filtreInfo = [
    centreId ? getCentreNom(centreId) : 'Tous centres',
    etabId   ? getEtabNom(etabId)    : 'Tous établissements',
    classe   ? `Classe : ${classe}`  : 'Toutes classes',
    type === 'bac' && serie ? `Série ${serie}` : '',
  ].filter(Boolean).join(' · ');

  el.innerHTML = `
    <div class="releve" style="max-width:900px" id="nmPrintZone">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;padding-bottom:12px;border-bottom:2px solid #1a4a8a">
        <div>
          <div style="font-size:18px;font-weight:700;color:#1a4a8a">RELEVÉ DE NOTES — ${(matiere?.nom||'').toUpperCase()}</div>
          <div style="font-size:12px;color:#666;margin-top:3px">Examen Blanc Régional · ${G.ref.config?.annee||'2024-2025'} · ${type.toUpperCase()}</div>
          <div style="font-size:12px;color:#666">${filtreInfo}</div>
        </div>
        <div style="text-align:right;font-size:12px;color:#666">
          <div>Coefficient : <strong>${matiere?.coef||'—'}</strong></div>
          <div>Imprimé le : ${new Date().toLocaleDateString('fr-FR')}</div>
        </div>
      </div>

      <div style="display:flex;gap:24px;margin-bottom:16px;flex-wrap:wrap">
        <div style="text-align:center;padding:8px 16px;background:#e8f0fa;border-radius:6px">
          <div style="font-size:20px;font-weight:700;font-family:monospace;color:#1a4a8a">${cands.length}</div>
          <div style="font-size:11px;color:#666">Élèves</div>
        </div>
        <div style="text-align:center;padding:8px 16px;background:#e8f5ee;border-radius:6px">
          <div style="font-size:20px;font-weight:700;font-family:monospace;color:#1a6b3a">${moyenne}</div>
          <div style="font-size:11px;color:#666">Moyenne classe</div>
        </div>
        <div style="text-align:center;padding:8px 16px;background:#e8f5ee;border-radius:6px">
          <div style="font-size:20px;font-weight:700;font-family:monospace;color:#1a6b3a">${max}</div>
          <div style="font-size:11px;color:#666">Note max</div>
        </div>
        <div style="text-align:center;padding:8px 16px;background:#fae8e8;border-radius:6px">
          <div style="font-size:20px;font-weight:700;font-family:monospace;color:#8b1a1a">${min}</div>
          <div style="font-size:11px;color:#666">Note min</div>
        </div>
        <div style="text-align:center;padding:8px 16px;background:#fef3dc;border-radius:6px">
          <div style="font-size:20px;font-weight:700;font-family:monospace;color:#7a4a00">${sansNote.length}</div>
          <div style="font-size:11px;color:#666">Non saisis</div>
        </div>
      </div>

      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead>
          <tr style="background:#e8f0fa">
            <th style="padding:8px 10px;text-align:center;border:1px solid #ccc;width:40px">N°</th>
            <th style="padding:8px 10px;text-align:center;border:1px solid #ccc;width:50px">Photo</th>
            <th style="padding:8px 10px;text-align:left;border:1px solid #ccc">Nom & Prénoms</th>
            <th style="padding:8px 10px;text-align:center;border:1px solid #ccc;width:80px">Matricule</th>
            <th style="padding:8px 10px;text-align:center;border:1px solid #ccc;width:60px">Classe</th>
            <th style="padding:8px 10px;text-align:center;border:1px solid #ccc;width:50px">Sexe</th>
            <th style="padding:8px 10px;text-align:center;border:1px solid #ccc;width:80px;background:#fff3cd">Note /20</th>
            <th style="padding:8px 10px;text-align:center;border:1px solid #ccc;width:80px">Appréciation</th>
          </tr>
        </thead>
        <tbody>
          ${cands.map((c, idx) => {
            const note = notesMap[c.id];
            const noteStr = c.absent ? 'ABS' : (note !== undefined ? note : '—');
            const apprec = c.absent ? 'Absent'
              : note === undefined ? 'Non saisi'
              : note >= 16 ? 'Très Bien'
              : note >= 14 ? 'Bien'
              : note >= 12 ? 'Assez Bien'
              : note >= 10 ? 'Passable'
              : 'Insuffisant';
            const bgRow = idx % 2 === 0 ? '#fff' : '#f9f9f9';
            const noteColor = c.absent ? '#888' : note === undefined ? '#aaa' : note >= 10 ? '#1a6b3a' : '#8b1a1a';
            return `<tr style="background:${bgRow}">
              <td style="padding:6px 10px;text-align:center;border:1px solid #ddd;color:#666">${idx+1}</td>
              <td style="padding:4px;text-align:center;border:1px solid #ddd">
                ${c.photo_url
                  ? `<img src="${c.photo_url}" style="width:32px;height:36px;object-fit:cover;border-radius:3px;border:1px solid #ccc"/>`
                  : `<div style="width:32px;height:36px;background:#f0f0f0;border-radius:3px;display:inline-flex;align-items:center;justify-content:center;font-size:16px">👤</div>`}
              </td>
              <td style="padding:6px 10px;border:1px solid #ddd"><strong>${c.nom}</strong> ${c.prenoms}</td>
              <td style="padding:6px 10px;text-align:center;border:1px solid #ddd;font-family:monospace;font-size:11px">${c.matricule}</td>
              <td style="padding:6px 10px;text-align:center;border:1px solid #ddd">${c.classe}</td>
              <td style="padding:6px 10px;text-align:center;border:1px solid #ddd">${c.sexe}</td>
              <td style="padding:6px 10px;text-align:center;border:1px solid #ddd;font-weight:700;font-size:15px;color:${noteColor};background:#fffef0">${noteStr}</td>
              <td style="padding:6px 10px;text-align:center;border:1px solid #ddd;font-size:11px;color:#666">${apprec}</td>
            </tr>`;
          }).join('')}
        </tbody>
        <tfoot>
          <tr style="background:#e8f0fa;font-weight:600">
            <td colspan="6" style="padding:8px 10px;border:1px solid #ccc;text-align:right">MOYENNE DE LA CLASSE :</td>
            <td style="padding:8px 10px;text-align:center;border:1px solid #ccc;font-size:15px;color:#1a4a8a">${moyenne}</td>
            <td style="padding:8px 10px;border:1px solid #ccc;font-size:11px;color:#666">${notes_vals.length} note(s) saisie(s)</td>
          </tr>
        </tfoot>
      </table>

      <div style="margin-top:20px;display:flex;justify-content:space-between;font-size:12px;color:#666;padding-top:12px;border-top:1px solid #ccc">
        <div>Fait à ${G.ref.config?.ville||'Bouaké'}, le ${new Date().toLocaleDateString('fr-FR')}</div>
        <div style="text-align:center">Signature du professeur<br/><br/>_______________________</div>
        <div style="text-align:right">Visa du Directeur<br/><br/>_______________________</div>
      </div>
    </div>

    <div style="margin-top:16px;display:flex;gap:10px" class="no-print">
      <button class="btn btn-primary" onclick="window.print()">🖨 Imprimer ce relevé</button>
      <button class="btn btn-outline" onclick="nmExportCSV()">📊 Exporter CSV</button>
    </div>`;

  // Stocker pour export CSV
  window._nmData = { cands, notesMap, matiere, type };
};

window.nmReset = function() {
  document.getElementById('nmCentre').value = '';
  document.getElementById('nmEtab').value   = '';
  document.getElementById('nmClasse').innerHTML = '<option value="">— Toutes les classes —</option>';
  document.getElementById('nmMatiere').value = '';
  document.getElementById('nmResult').innerHTML = '';
};

window.nmExportCSV = function() {
  const { cands, notesMap, matiere, type } = window._nmData || {};
  if (!cands) return;
  const rows = [['N°','Matricule','Nom','Prénoms','Sexe','Classe','Note /20','Appréciation']];
  cands.forEach((c, idx) => {
    const note = notesMap[c.id];
    const apprec = c.absent ? 'Absent' : note === undefined ? 'Non saisi'
      : note >= 16 ? 'Très Bien' : note >= 14 ? 'Bien'
      : note >= 12 ? 'Assez Bien' : note >= 10 ? 'Passable' : 'Insuffisant';
    rows.push([idx+1, c.matricule, c.nom, c.prenoms, c.sexe, c.classe,
      c.absent ? 'ABS' : (note !== undefined ? note : '—'), apprec]);
  });
  const csv = rows.map(r => r.join(';')).join('\n');
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,\uFEFF' + encodeURIComponent(csv);
  a.download = `notes_${matiere?.nom||'matiere'}_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
};


// ═══════════════════════════════════════════════════════════════
// CLÔTURE DE SAISON — Anti-fraude (Directeur Régional uniquement)
// ═══════════════════════════════════════════════════════════════

// Charger et afficher le message du directeur (pour tous les utilisateurs)
async function chargerMessageDirecteur() {
  try {
    const { data: cfg } = await supabase.from('config').select('message_directeur,message_directeur_type').eq('id','main').single();
    if (cfg?.message_directeur) {
      afficherBandeauMessage(cfg.message_directeur, cfg.message_directeur_type || 'info');
    }
  } catch(e) {}

  // Écouter les changements en temps réel du message
  supabase.channel('config-message')
    .on('postgres_changes', { event:'UPDATE', schema:'public', table:'config', filter:'id=eq.main' }, payload => {
      const msg  = payload.new?.message_directeur;
      const type = payload.new?.message_directeur_type || 'info';
      const old  = document.getElementById('bandeauDirecteur');
      if (old) old.remove();
      if (msg) afficherBandeauMessage(msg, type);
    })
    .subscribe();
}

function afficherBanniereCloture() {
  const existante = document.getElementById('banniereCloture');
  if (existante) existante.remove();
  if (G.saison !== 'cloturee') return;
  const banniere = document.createElement('div');
  banniere.id = 'banniereCloture';
  banniere.style.cssText = `
    position:fixed;top:0;left:0;right:0;z-index:9999;
    background:#8b1a1a;color:#fff;
    padding:10px 20px;font-size:13px;font-weight:600;
    display:flex;align-items:center;justify-content:center;gap:12px;
    box-shadow:0 2px 8px rgba(0,0,0,.3);
  `;
  banniere.innerHTML = `
    🔴 SAISON CLÔTURÉE — Toute saisie et modification est bloquée
    ${G.role==='directeur'?`<button onclick="nav('cloture')" style="background:rgba(255,255,255,.2);border:none;color:#fff;padding:4px 12px;border-radius:4px;cursor:pointer;font-size:12px">Gérer →</button>`:''}
  `;
  document.body.prepend(banniere);
  // Décaler le contenu pour éviter que la bannière cache le contenu
  document.getElementById('appScreen').style.marginTop = '42px';
}

async function renderCloture() {
  if (G.role !== 'directeur') {
    return `<div class="alert alert-danger">⛔ Accès réservé au Directeur Régional uniquement.</div>`;
  }

  // Recharger le statut depuis la base
  const { data: cfg } = await supabase.from('config').select('*').eq('id','main').single();
  G.saison = cfg?.statut_saison || 'ouverte';
  const clotureAt = cfg?.cloture_at ? new Date(cfg.cloture_at).toLocaleString('fr-FR') : null;
  const cloturePar = cfg?.cloture_par || null;

  // Stats rapides
  const [rbp, rbac] = await Promise.all([
    supabase.from('candidats_bepc').select('id', {count:'exact',head:true}),
    supabase.from('candidats_bac').select('id', {count:'exact',head:true}),
  ]);
  const nBepc = rbp.count || 0;
  const nBac  = rbac.count || 0;

  const estCloture = G.saison === 'cloturee';

  return `
    <div class="page-header">
      <div>
        <div class="page-title">${estCloture ? '🔴 Saison CLÔTURÉE' : '🟢 Gestion de la saison'}</div>
        <div class="page-subtitle">Contrôle anti-fraude — Directeur Régional uniquement</div>
      </div>
    </div>

    ${estCloture ? `
    <div class="alert alert-danger" style="font-size:14px;padding:16px">
      <div style="font-weight:700;font-size:16px;margin-bottom:8px">🔐 La saison est actuellement CLÔTURÉE</div>
      <div>Clôturé le : <strong>${clotureAt}</strong></div>
      ${cloturePar ? `<div>Par : <strong>${cloturePar}</strong></div>` : ''}
      <div style="margin-top:8px;color:#666;font-size:12px">Toute tentative de saisie ou d'import est bloquée pour tous les utilisateurs.</div>
    </div>
    ` : `
    <div class="alert alert-success" style="font-size:14px;padding:16px">
      <div style="font-weight:700;font-size:16px;margin-bottom:4px">✅ La saison est actuellement OUVERTE</div>
      <div style="font-size:13px">La saisie des notes et les imports sont actifs.</div>
    </div>
    `}

    <div class="card-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:24px">
      <div class="stat-card stat-accent">
        <div class="stat-value">${nBepc}</div>
        <div class="stat-label">Candidats BEPC</div>
      </div>
      <div class="stat-card stat-green">
        <div class="stat-value">${nBac}</div>
        <div class="stat-label">Candidats BAC</div>
      </div>
      <div class="stat-card stat-amber">
        <div class="stat-value">${nBepc + nBac}</div>
        <div class="stat-label">Total candidats</div>
      </div>
    </div>

    <div class="card" style="max-width:600px">
      <div class="card-title">${estCloture ? '🔓 Déverrouiller la saison' : '🔒 Clôturer la saison'}</div>

      ${estCloture ? `
        <div class="alert alert-warning" style="margin-bottom:16px">
          ⚠️ Le déverrouillage permettra à nouveau la saisie et les modifications de notes. Procédez uniquement après vérification complète.
        </div>
        <div style="margin-bottom:16px">
          <label class="form-label">Votre mot de passe directeur (confirmation)</label>
          <input type="password" id="pwdConfirm" class="form-input" placeholder="••••••••" style="margin-top:6px"/>
        </div>
        <button class="btn btn-success" onclick="doOuvrirSaison()">
          🔓 Déverrouiller et ouvrir la saison
        </button>
      ` : `
        <div class="alert alert-warning" style="margin-bottom:16px">
          ⚠️ La clôture bloquera IMMÉDIATEMENT toute saisie et modification pour tous les utilisateurs, y compris les administrateurs. Cette action est réversible uniquement par vous.
        </div>
        <div style="margin-bottom:16px">
          <label class="form-label">Motif de clôture</label>
          <input type="text" id="motifCloture" class="form-input" placeholder="Ex: Fin de saisie — délibération terminée" style="margin-top:6px"/>
        </div>
        <div style="margin-bottom:16px">
          <label class="form-label">Votre mot de passe directeur (confirmation)</label>
          <input type="password" id="pwdConfirm" class="form-input" placeholder="••••••••" style="margin-top:6px"/>
        </div>
        <button class="btn btn-danger" onclick="doClôturerSaison()">
          🔒 Clôturer définitivement la saison
        </button>
      `}
    </div>

    <!-- ── MESSAGE DIRECTEUR (bandeau pour tous) ── -->
    <div class="card" style="max-width:600px;margin-top:20px">
      <div class="card-title">📢 Message aux utilisateurs (bandeau défilant)</div>
      <p style="font-size:12px;color:var(--text2);margin-bottom:14px">
        Ce message s'affichera en bandeau défilant sur <strong>tous les écrans</strong> (admins + opérateurs) dès que vous l'envoyez.
      </p>
      <div style="margin-bottom:12px">
        <label class="form-label">Votre message</label>
        <input type="text" id="msgDirecteur" class="form-input" style="margin-top:6px"
          placeholder="Ex: Les modifications de notes sont maintenant disponibles pour les administrateurs."
          maxlength="200"/>
        <div style="font-size:11px;color:var(--text3);margin-top:4px">200 caractères max</div>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px">
        <select id="msgType" class="form-select" style="width:auto">
          <option value="info">ℹ️ Information</option>
          <option value="warning">⚠️ Avertissement</option>
          <option value="success">✅ Succès</option>
          <option value="danger">🔴 Urgent</option>
        </select>
        <button class="btn btn-primary" onclick="envoyerMessageDirecteur()">📢 Envoyer à tous</button>
        <button class="btn btn-outline" onclick="effacerMessageDirecteur()">✕ Effacer le message</button>
      </div>
      <div id="msgActuelZone" style="display:none;padding:10px;border-radius:6px;font-size:13px;border:1px solid var(--border)">
        <strong>Message actuel :</strong> <span id="msgActuelTexte"></span>
      </div>
    </div>`;
}

window.envoyerMessageDirecteur = async function() {
  const msg  = document.getElementById('msgDirecteur')?.value?.trim();
  const type = document.getElementById('msgType')?.value || 'info';
  if (!msg) { alert('Saisissez un message.'); return; }

  try {
    await supabase.from('config').update({
      message_directeur:      msg,
      message_directeur_type: type,
      message_directeur_at:   new Date().toISOString(),
    }).eq('id', 'main');

    // Afficher immédiatement sur l'écran du directeur aussi
    afficherBandeauMessage(msg, type);
    showToast('✅ Message envoyé à tous les utilisateurs !');

    // Afficher le message actuel dans la zone
    document.getElementById('msgActuelZone').style.display = 'block';
    document.getElementById('msgActuelTexte').textContent  = msg;
    document.getElementById('msgDirecteur').value = '';
  } catch(e) { alert('Erreur : ' + e.message); }
};

window.effacerMessageDirecteur = async function() {
  try {
    await supabase.from('config').update({
      message_directeur:      null,
      message_directeur_type: null,
      message_directeur_at:   null,
    }).eq('id', 'main');

    // Retirer le bandeau
    const b = document.getElementById('bandeauDirecteur');
    if (b) b.remove();
    document.getElementById('msgActuelZone').style.display = 'none';
    showToast('Message effacé.');
  } catch(e) { alert('Erreur : ' + e.message); }
};

// Afficher le bandeau défilant message du directeur
function afficherBandeauMessage(msg, type) {
  const old = document.getElementById('bandeauDirecteur');
  if (old) old.remove();

  const colors = {
    info:    { bg:'#1a4a8a', text:'#fff' },
    warning: { bg:'#7a4a00', text:'#fff' },
    success: { bg:'#1a6b3a', text:'#fff' },
    danger:  { bg:'#8b1a1a', text:'#fff' },
  };
  const c = colors[type] || colors.info;
  const icons = { info:'ℹ️', warning:'⚠️', success:'✅', danger:'🔴' };

  const b = document.createElement('div');
  b.id = 'bandeauDirecteur';
  b.style.cssText = `background:${c.bg};color:${c.text};padding:8px 0;overflow:hidden;white-space:nowrap;position:relative;z-index:200;`;
  b.innerHTML = `
    <div id="bandeauTicker" style="display:inline-block;animation:ticker 25s linear infinite;padding-left:100%">
      ${icons[type]||'📢'} MESSAGE DU DIRECTEUR RÉGIONAL : ${msg} &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
      ${icons[type]||'📢'} MESSAGE DU DIRECTEUR RÉGIONAL : ${msg}
    </div>
    <style>@keyframes ticker{0%{transform:translateX(0)}100%{transform:translateX(-50%)}}</style>
  `;

  // Insérer sous la bannière de clôture si elle existe, sinon en haut du main
  const main = document.getElementById('main');
  const clotureBanner = document.getElementById('banniereCloture');
  if (clotureBanner) {
    clotureBanner.after(b);
  } else {
    main.prepend(b);
  }
}

window.doClôturerSaison = async function() {
  const pwd   = document.getElementById('pwdConfirm')?.value;
  const motif = document.getElementById('motifCloture')?.value || '';
  if (!pwd) { alert('Entrez votre mot de passe pour confirmer.'); return; }

  // Vérifier le mot de passe en re-authentifiant
  try {
    const { error } = await supabase.auth.signInWithPassword({
      email: G.user.email, password: pwd
    });
    if (error) { alert('❌ Mot de passe incorrect.'); return; }
  } catch(e) { alert('Erreur : ' + e.message); return; }

  if (!confirm(`⚠️ ATTENTION\n\nVous allez clôturer la saison.\nToute saisie sera immédiatement bloquée pour TOUS les utilisateurs.\n\nConfirmer ?`)) return;

  try {
    const nomDir = G.user.profile?.nom || G.user.email;
    await supabase.from('config').update({
      statut_saison: 'cloturee',
      cloture_par:   nomDir,
      cloture_at:    new Date().toISOString(),
      cloture_motif: motif
    }).eq('id','main');

    G.saison = 'cloturee';
    afficherBanniereCloture();

    // Mettre à jour le nav
    const navCl = document.getElementById('navCloture');
    if (navCl) { navCl.style.color='#e74c3c'; navCl.innerHTML = navCl.innerHTML.replace('🟢 Clôture de saison','🔴 Saison CLÔTURÉE'); }

    showToast('🔴 Saison clôturée — toutes les saisies sont bloquées.');
    nav('cloture');
  } catch(e) { alert('Erreur : ' + e.message); }
};

window.doOuvrirSaison = async function() {
  const pwd = document.getElementById('pwdConfirm')?.value;
  if (!pwd) { alert('Entrez votre mot de passe pour confirmer.'); return; }

  try {
    const { error } = await supabase.auth.signInWithPassword({
      email: G.user.email, password: pwd
    });
    if (error) { alert('❌ Mot de passe incorrect.'); return; }
  } catch(e) { alert('Erreur : ' + e.message); return; }

  if (!confirm('Vous allez rouvrir la saison. La saisie des notes sera à nouveau possible pour tous. Confirmer ?')) return;

  try {
    await supabase.from('config').update({
      statut_saison: 'ouverte',
      cloture_par:   null,
      cloture_at:    null,
      cloture_motif: null
    }).eq('id','main');

    G.saison = 'ouverte';

    // Retirer bannière
    const b = document.getElementById('banniereCloture');
    if (b) { b.remove(); document.getElementById('appScreen').style.marginTop = ''; }

    // Mettre à jour le nav
    const navCl = document.getElementById('navCloture');
    if (navCl) { navCl.style.color='rgba(255,200,0,0.9)'; navCl.innerHTML = navCl.innerHTML.replace('🔴 Saison CLÔTURÉE','🟢 Clôture de saison'); }

    showToast('✅ Saison rouverte — la saisie est à nouveau active.');
    nav('cloture');
  } catch(e) { alert('Erreur : ' + e.message); }
};

// ═══════════════════════════════════════════════════════════════
// GARDE DIRECTEUR — vérification centralisée
// Toutes les nouvelles fonctionnalités sont RÉSERVÉES au Directeur
// Admins et opérateurs n'ont pas accès.
// ═══════════════════════════════════════════════════════════════

function checkDirecteur() {
  if (G.role !== 'directeur') {
    return `
      <div class="card" style="text-align:center;padding:60px 40px;max-width:500px;margin:40px auto">
        <div style="font-size:48px;margin-bottom:16px">🔐</div>
        <div style="font-size:20px;font-weight:700;margin-bottom:8px;color:var(--red)">Accès restreint</div>
        <div style="font-size:14px;color:var(--text2);line-height:1.7">
          Cette section est réservée exclusivement au <strong>Directeur Régional</strong>.<br/>
          Les administrateurs et opérateurs n'ont pas accès à cette fonctionnalité.
        </div>
        <div style="margin-top:20px">
          <button class="btn btn-outline" onclick="nav('dashboard')">← Retour au tableau de bord</button>
        </div>
      </div>`;
  }
  return null; // null = accès autorisé
}


// ═══════════════════════════════════════════════════════════════
// ① NOTIFICATIONS TEMPS RÉEL — Supabase Realtime
//    RÉSERVÉ AU DIRECTEUR RÉGIONAL
// ═══════════════════════════════════════════════════════════════

let _realtimeChannels = [];

function initRealtimeNotifications() {
  // Uniquement pour le directeur
  if (G.role !== 'directeur') return;
  if (window._realtimeInit) return;
  window._realtimeInit = true;

  // Canal notes BEPC
  const chBepc = supabase
    .channel('notes-bepc-rt')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'notes_bepc' },
      (payload) => {
        if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
          showNotifRT(`📝 Note BEPC saisie : ${payload.new?.note ?? ''}/20`);
        }
      })
    .subscribe();

  // Canal notes BAC
  const chBac = supabase
    .channel('notes-bac-rt')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'notes_bac' },
      (payload) => {
        if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
          showNotifRT(`📝 Note BAC saisie : ${payload.new?.note ?? ''}/20`);
        }
      })
    .subscribe();

  // Canal candidats BEPC (ajout)
  const chCand = supabase
    .channel('candidats-bepc-rt')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'candidats_bepc' },
      (payload) => {
        showNotifRT(`👤 Nouveau candidat BEPC : ${payload.new?.nom || ''}`);
      })
    .subscribe();

  // Canal config — détection clôture/ouverture par un autre directeur
  const chConfig = supabase
    .channel('config-rt')
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'config' },
      async (payload) => {
        const newStatut = payload.new?.statut_saison;
        const oldStatut = payload.old?.statut_saison;
        if (newStatut !== oldStatut) {
          if (newStatut === 'cloturee') {
            G.saison = 'cloturee';
            afficherBanniereCloture();
            showNotifRT('🔴 SAISON CLÔTURÉE !', 'danger', 8000);
          } else {
            G.saison = 'ouverte';
            const b = document.getElementById('banniereCloture');
            if (b) { b.remove(); document.getElementById('appScreen').style.marginTop = ''; }
            showNotifRT('✅ Saison rouverte — saisie active.', 'success', 6000);
          }
        }
      })
    .subscribe();

  _realtimeChannels = [chBepc, chBac, chCand, chConfig];
}

// Notification flottante en coin supérieur droit
function showNotifRT(msg, type = 'info', duration = 4500) {
  const now = Date.now();
  if (window._lastNotifTime && now - window._lastNotifTime < 600) return;
  window._lastNotifTime = now;

  let container = document.getElementById('notifContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'notifContainer';
    container.style.cssText = 'position:fixed;top:16px;right:16px;z-index:9998;display:flex;flex-direction:column;gap:8px;max-width:340px;pointer-events:none';
    document.body.appendChild(container);
  }

  const palettes = {
    info:    '#1a4a8a',
    success: '#1a6b3a',
    danger:  '#8b1a1a',
    warning: '#7a4a00',
  };
  const bg = palettes[type] || palettes.info;

  const notif = document.createElement('div');
  notif.style.cssText = `
    background:${bg};color:#fff;padding:12px 16px;border-radius:8px;
    font-size:13px;font-weight:500;box-shadow:0 4px 20px rgba(0,0,0,.25);
    display:flex;align-items:center;gap:10px;pointer-events:auto;
    animation:notifIn .25s ease;cursor:pointer;
  `;
  notif.innerHTML = `<span style="flex:1">${msg}</span><span style="opacity:.5;font-size:16px;line-height:1" onclick="this.parentElement.remove()">×</span>`;
  container.appendChild(notif);

  setTimeout(() => {
    notif.style.transition = 'opacity .35s';
    notif.style.opacity = '0';
    setTimeout(() => notif.remove(), 350);
  }, duration);
}

const _styleNotif = document.createElement('style');
_styleNotif.textContent = `@keyframes notifIn{from{opacity:0;transform:translateX(24px)}to{opacity:1;transform:translateX(0)}}`;
document.head.appendChild(_styleNotif);

async function renderNotifications() {
  const guard = checkDirecteur();
  if (guard) return guard;

  // Historique des modifications récentes (journal)
  const { data: journal } = await supabase
    .from('journal_modifications')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50);

  const rows = (journal || []).map(j => {
    const d = new Date(j.created_at).toLocaleString('fr-FR');
    const typeColor = j.type_examen === 'bepc' ? 'blue' : 'amber';
    return `<tr>
      <td style="font-size:11px;color:var(--text3)">${d}</td>
      <td><span class="badge badge-${typeColor}">${(j.type_examen||'').toUpperCase()}</span></td>
      <td style="font-size:12px">${j.matiere_id || '—'}</td>
      <td class="td-mono" style="color:var(--red)">${j.note_avant ?? '—'}</td>
      <td class="td-mono" style="color:var(--green)">${j.note_apres ?? '—'}</td>
      <td style="font-size:12px;color:var(--text2)">${j.saisie_par || '—'}</td>
    </tr>`;
  }).join('');

  return `
    <div class="page-header">
      <div>
        <div class="page-title">🔔 Notifications & Journal temps réel</div>
        <div class="page-subtitle">Réservé au Directeur Régional — surveillance des saisies en temps réel</div>
      </div>
      <div class="header-actions">
        <button class="btn btn-outline btn-sm" onclick="nav('notifications')">🔄 Actualiser</button>
      </div>
    </div>

    <div class="alert alert-success" style="margin-bottom:20px">
      ✅ Les notifications temps réel sont <strong>actives</strong>. Toute saisie ou import de note vous est signalé automatiquement en coin supérieur droit.
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:24px">
      <div class="card" style="border-left:3px solid var(--accent2)">
        <div style="font-size:11px;color:var(--text2);margin-bottom:4px">SURVEILLANCE ACTIVE</div>
        <div style="font-size:13px">Notes BEPC · Notes BAC · Ajout candidats · Clôture saison</div>
      </div>
      <div class="card" style="border-left:3px solid var(--green)">
        <div style="font-size:11px;color:var(--text2);margin-bottom:4px">ALERTES EN TEMPS RÉEL</div>
        <div style="font-size:13px">Notifications visuelles automatiques dès qu'une action est détectée</div>
      </div>
      <div class="card" style="border-left:3px solid var(--amber)">
        <div style="font-size:11px;color:var(--text2);margin-bottom:4px">JOURNAL COMPLET</div>
        <div style="font-size:13px">Historique de toutes les modifications avec avant/après</div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">📋 50 dernières modifications</div>
      ${rows ? `
        <div class="table-wrap">
          <table>
            <thead><tr>
              <th>Date/Heure</th><th>Examen</th><th>Matière</th>
              <th>Note avant</th><th>Note après</th><th>Par</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>` : `<div style="text-align:center;padding:32px;color:var(--text3)">Aucune modification enregistrée</div>`}
    </div>`;
}


// ═══════════════════════════════════════════════════════════════
// ② SAUVEGARDE AUTOMATIQUE — Backup CSV complet
//    RÉSERVÉ AU DIRECTEUR RÉGIONAL
// ═══════════════════════════════════════════════════════════════

async function renderSauvegarde() {
  const guard = checkDirecteur();
  if (guard) return guard;

  const [rbp, rbac, rnb, rnbac] = await Promise.all([
    supabase.from('candidats_bepc').select('id', { count: 'exact', head: true }),
    supabase.from('candidats_bac').select('id',  { count: 'exact', head: true }),
    supabase.from('notes_bepc').select('id',     { count: 'exact', head: true }),
    supabase.from('notes_bac').select('id',      { count: 'exact', head: true }),
  ]);

  return `
    <div class="page-header">
      <div>
        <div class="page-title">💾 Sauvegarde des données</div>
        <div class="page-subtitle">Réservé au Directeur Régional — Export complet en CSV</div>
      </div>
    </div>

    <div class="alert alert-warning" style="margin-bottom:20px">
      🔑 Accès Directeur Régional uniquement. Ces exports contiennent toutes les données de l'examen.
    </div>

    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:24px">
      <div class="stat-card stat-accent">
        <div class="stat-value">${rbp.count || 0}</div>
        <div class="stat-label">Candidats BEPC</div>
      </div>
      <div class="stat-card stat-green">
        <div class="stat-value">${rbac.count || 0}</div>
        <div class="stat-label">Candidats BAC</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${rnb.count || 0}</div>
        <div class="stat-label">Notes BEPC</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${rnbac.count || 0}</div>
        <div class="stat-label">Notes BAC</div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">
      <div class="card">
        <div class="card-title">📋 Candidats BEPC</div>
        <p style="font-size:13px;color:var(--text2);margin-bottom:14px">
          Export complet : matricule, nom, prénoms, centre, établissement, classe, sexe, statut validation.
        </p>
        <button class="btn btn-primary" onclick="backupCandidatsBepc()">⬇ Télécharger CSV Candidats BEPC</button>
      </div>
      <div class="card">
        <div class="card-title">📋 Candidats BAC</div>
        <p style="font-size:13px;color:var(--text2);margin-bottom:14px">
          Export complet : matricule, nom, prénoms, série, centre, établissement, classe, sexe, statut.
        </p>
        <button class="btn btn-primary" onclick="backupCandidatsBac()">⬇ Télécharger CSV Candidats BAC</button>
      </div>
      <div class="card">
        <div class="card-title">📊 Notes BEPC complètes + Moyennes</div>
        <p style="font-size:13px;color:var(--text2);margin-bottom:14px">
          Toutes les notes par candidat, toutes matières, avec moyenne calculée et décision.
        </p>
        <button class="btn btn-success" onclick="backupNotesBepc()">⬇ Télécharger Notes BEPC</button>
      </div>
      <div class="card">
        <div class="card-title">📊 Notes BAC complètes + Moyennes</div>
        <p style="font-size:13px;color:var(--text2);margin-bottom:14px">
          Toutes les notes par candidat, toutes matières, avec moyenne calculée et décision.
        </p>
        <button class="btn btn-success" onclick="backupNotesBac()">⬇ Télécharger Notes BAC</button>
      </div>
    </div>

    <div class="card" style="border:2px solid var(--amber);background:var(--amber-bg)">
      <div class="card-title" style="color:var(--amber)">🗂️ SAUVEGARDE COMPLÈTE — Tout en un clic</div>
      <p style="font-size:13px;color:var(--text2);margin-bottom:14px">
        Lance automatiquement les 4 exports ci-dessus en séquence. Votre navigateur téléchargera 4 fichiers CSV.
      </p>
      <button class="btn" style="background:var(--amber);color:#fff;border-color:var(--amber)" onclick="backupComplet()">
        ⬇ BACKUP COMPLET (4 fichiers)
      </button>
    </div>`;
}

window.backupCandidatsBepc = async function() {
  showToast('⏳ Export candidats BEPC...', 'info');
  try {
    const { data, error } = await supabase.from('candidats_bepc').select('*').order('num_table');
    if (error) throw error;
    const h = ['num_table','matricule','nom','prenoms','sexe','classe','etab_id','centre_id','valide','absent','inapt_eps'];
    const csv = [h.join(';'), ...data.map(c => h.map(k => {
      const v = c[k]; return v === true ? 'Oui' : v === false ? 'Non' : (v ?? '');
    }).join(';'))].join('\n');
    _dlCSV(csv, `candidats_bepc_${_dateFichier()}.csv`);
    showToast(`✅ ${data.length} candidats BEPC exportés !`);
  } catch(e) { showToast('Erreur : ' + e.message, 'error'); }
};

window.backupCandidatsBac = async function() {
  showToast('⏳ Export candidats BAC...', 'info');
  try {
    const { data, error } = await supabase.from('candidats_bac').select('*').order('num_table');
    if (error) throw error;
    const h = ['num_table','matricule','nom','prenoms','sexe','classe','serie','etab_id','centre_id','valide','absent','inapt_eps'];
    const csv = [h.join(';'), ...data.map(c => h.map(k => {
      const v = c[k]; return v === true ? 'Oui' : v === false ? 'Non' : (v ?? '');
    }).join(';'))].join('\n');
    _dlCSV(csv, `candidats_bac_${_dateFichier()}.csv`);
    showToast(`✅ ${data.length} candidats BAC exportés !`);
  } catch(e) { showToast('Erreur : ' + e.message, 'error'); }
};

window.backupNotesBepc = async function() {
  showToast('⏳ Export notes BEPC...', 'info');
  try {
    const [{ data: cands, error: e1 }, { data: notesRaw, error: e2 }] = await Promise.all([
      supabase.from('candidats_bepc').select('*').order('num_table'),
      supabase.from('notes_bepc').select('*'),
    ]);
    if (e1) throw e1; if (e2) throw e2;
    const mats = G.ref.matBepc || [];
    const idx = {};
    notesRaw.forEach(n => { if (!idx[n.candidat_id]) idx[n.candidat_id] = {}; idx[n.candidat_id][n.matiere_id] = n.note; });
    const h = ['num_table','matricule','nom','prenoms','sexe','classe', ...mats.map(m => m.nom), 'Moyenne', 'Decision'];
    const rows = cands.map(c => {
      const notes = idx[c.id] || {};
      const res = calcMoyenneBepc(notes, c.inapt_eps, c.arts_plastiques);
      return [...[c.num_table, c.matricule, c.nom, c.prenoms, c.sexe, c.classe],
        ...mats.map(m => notes[m.id] ?? ''),
        res.moy !== null ? res.moy.toFixed(2) : '',
        getDecision(res.moy, c.absent)
      ].join(';');
    });
    _dlCSV([h.join(';'), ...rows].join('\n'), `notes_bepc_${_dateFichier()}.csv`);
    showToast(`✅ Notes BEPC exportées — ${cands.length} candidats !`);
  } catch(e) { showToast('Erreur : ' + e.message, 'error'); }
};

window.backupNotesBac = async function() {
  showToast('⏳ Export notes BAC...', 'info');
  try {
    const [{ data: cands, error: e1 }, { data: notesRaw, error: e2 }] = await Promise.all([
      supabase.from('candidats_bac').select('*').order('num_table'),
      supabase.from('notes_bac').select('*'),
    ]);
    if (e1) throw e1; if (e2) throw e2;
    const allMats = []; const matIds = new Set();
    Object.values(G.ref.matBac || {}).forEach(ms => ms.forEach(m => { if (!matIds.has(m.id)) { allMats.push(m); matIds.add(m.id); } }));
    const idx = {};
    notesRaw.forEach(n => { if (!idx[n.candidat_id]) idx[n.candidat_id] = {}; idx[n.candidat_id][n.matiere_id] = n.note; });
    const h = ['num_table','matricule','nom','prenoms','sexe','classe','serie', ...allMats.map(m => m.nom), 'Moyenne', 'Decision'];
    const rows = cands.map(c => {
      const notes = idx[c.id] || {};
      const res = calcMoyenneBac(notes, c.serie, c.inapt_eps);
      return [...[c.num_table, c.matricule, c.nom, c.prenoms, c.sexe, c.classe, c.serie],
        ...allMats.map(m => notes[m.id] ?? ''),
        res.moy !== null ? res.moy.toFixed(2) : '',
        getDecision(res.moy, c.absent)
      ].join(';');
    });
    _dlCSV([h.join(';'), ...rows].join('\n'), `notes_bac_${_dateFichier()}.csv`);
    showToast(`✅ Notes BAC exportées — ${cands.length} candidats !`);
  } catch(e) { showToast('Erreur : ' + e.message, 'error'); }
};

window.backupComplet = async function() {
  showToast('⏳ Sauvegarde complète en cours...', 'info');
  await backupCandidatsBepc();
  await new Promise(r => setTimeout(r, 700));
  await backupCandidatsBac();
  await new Promise(r => setTimeout(r, 700));
  await backupNotesBepc();
  await new Promise(r => setTimeout(r, 700));
  await backupNotesBac();
  showToast('✅ Backup complet — 4 fichiers téléchargés !');
};

function _dlCSV(content, filename) {
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,\uFEFF' + encodeURIComponent(content);
  a.download = filename;
  a.click();
}
function _dateFichier() { return new Date().toISOString().slice(0, 10); }


// ═══════════════════════════════════════════════════════════════
// ③ UTILISATEURS CONNECTÉS EN TEMPS RÉEL — Presence Supabase
//    RÉSERVÉ AU DIRECTEUR RÉGIONAL
// ═══════════════════════════════════════════════════════════════

let _presenceChannel = null;

function initPresence() {
  // Tout le monde envoie sa présence, mais seul le directeur peut voir la page
  if (_presenceChannel) return;
  const nom   = G.user?.profile?.nom || G.user?.email || 'Utilisateur';
  const email = G.user?.email || '';

  _presenceChannel = supabase.channel('ebr-online', {
    config: { presence: { key: G.user?.id || email } }
  });

  _presenceChannel
    .on('presence', { event: 'sync' }, () => {
      _updatePresenceBadge(_presenceChannel.presenceState());
    })
    .on('presence', { event: 'join' }, ({ newPresences }) => {
      if (G.role === 'directeur') {
        newPresences.forEach(p => {
          if (p.email !== email) showNotifRT(`🟢 ${p.nom || p.email} connecté`, 'success', 3000);
        });
      }
    })
    .on('presence', { event: 'leave' }, ({ leftPresences }) => {
      if (G.role === 'directeur') {
        leftPresences.forEach(p => {
          if (p.email !== email) showNotifRT(`⚫ ${p.nom || p.email} déconnecté`, 'warning', 3000);
        });
      }
    })
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await _presenceChannel.track({
          nom, email,
          role:  G.role || 'operateur',
          page:  G.page || 'dashboard',
          heure: new Date().toISOString(),
        });
      }
    });
}

function updatePresencePage(page) {
  if (!_presenceChannel) return;
  _presenceChannel.track({
    nom:   G.user?.profile?.nom || G.user?.email || 'Utilisateur',
    email: G.user?.email || '',
    role:  G.role || 'operateur',
    page,
    heure: new Date().toISOString(),
  });
}

function _updatePresenceBadge(state) {
  const el = document.getElementById('presenceBadge');
  if (!el) return;
  const count = Object.values(state).flat().length;
  el.textContent = count;
  el.title = `${count} utilisateur(s) connecté(s)`;
}

async function renderConnectes() {
  const guard = checkDirecteur();
  if (guard) return guard;

  const state = _presenceChannel ? _presenceChannel.presenceState() : {};
  const users = Object.values(state).flat();

  const roleLabel  = r => r === 'directeur' ? '🔑 Directeur' : r === 'admin' ? '🛡 Admin' : '👤 Opérateur';
  const roleBadge  = r => r === 'directeur' ? 'purple' : r === 'admin' ? 'blue' : 'gray';
  const pageLabel  = p => ({
    'dashboard':      '📊 Tableau de bord',
    'saisie-bepc':    '✏️ Saisie BEPC',
    'saisie-bac':     '✏️ Saisie BAC',
    'import-notes':   '📥 Import notes',
    'candidats':      '👥 Candidats',
    'bilan':          '📈 Bilan',
    'statistiques':   '📊 Statistiques',
    'classement':     '🏆 Classement',
    'connectes':      '🟢 Connectés',
    'sauvegarde':     '💾 Sauvegarde',
    'notifications':  '🔔 Notifications',
    'inspecteur':     '🔍 Inspecteur',
  }[p] || (p || '—'));

  const lignes = users.map(u => {
    const heure = u.heure ? new Date(u.heure).toLocaleTimeString('fr-FR') : '—';
    return `<tr>
      <td>
        <div style="display:flex;align-items:center;gap:10px">
          <span style="width:10px;height:10px;border-radius:50%;background:#1a6b3a;flex-shrink:0;box-shadow:0 0 0 3px rgba(26,107,58,.2)"></span>
          <div>
            <div style="font-weight:600">${u.nom || '—'}</div>
            <div style="font-size:11px;color:var(--text3)">${u.email || ''}</div>
          </div>
        </div>
      </td>
      <td><span class="badge badge-${roleBadge(u.role)}">${roleLabel(u.role)}</span></td>
      <td style="font-size:13px">${pageLabel(u.page)}</td>
      <td style="font-size:12px;color:var(--text3)">${heure}</td>
    </tr>`;
  }).join('');

  return `
    <div class="page-header">
      <div>
        <div class="page-title">🟢 Utilisateurs connectés</div>
        <div class="page-subtitle">Réservé au Directeur Régional — Vue temps réel via Supabase Presence</div>
      </div>
      <div class="header-actions">
        <button class="btn btn-outline btn-sm" onclick="nav('connectes')">🔄 Actualiser</button>
      </div>
    </div>

    <div class="alert alert-info" style="margin-bottom:20px">
      🔑 Seul le Directeur Régional peut voir qui est connecté. Cette vue se met à jour automatiquement.
    </div>

    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:24px">
      <div class="stat-card stat-green">
        <div class="stat-value">${users.length}</div>
        <div class="stat-label">Utilisateurs en ligne</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${users.filter(u => u.role === 'admin').length}</div>
        <div class="stat-label">Administrateurs</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${users.filter(u => u.role === 'operateur').length}</div>
        <div class="stat-label">Opérateurs de saisie</div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">👥 Liste des utilisateurs actifs</div>
      ${users.length === 0 ? `
        <div style="text-align:center;padding:40px;color:var(--text3)">
          <div style="font-size:32px;margin-bottom:8px">👤</div>
          <div>Aucun autre utilisateur connecté en ce moment.</div>
        </div>` : `
        <div class="table-wrap">
          <table>
            <thead><tr><th>Utilisateur</th><th>Rôle</th><th>Page actuelle</th><th>Connecté depuis</th></tr></thead>
            <tbody>${lignes}</tbody>
          </table>
        </div>`}
    </div>`;
}


// ═══════════════════════════════════════════════════════════════
// ④ TABLEAU DE BORD INSPECTEUR — Vue filtrée par centre/zone
//    RÉSERVÉ AU DIRECTEUR RÉGIONAL
// ═══════════════════════════════════════════════════════════════

async function renderInspecteur() {
  const guard = checkDirecteur();
  if (guard) return guard;

  const centres = G.ref.centres        || [];
  const etabs   = G.ref.etablissements || [];

  return `
    <div class="page-header">
      <div>
        <div class="page-title">🔍 Tableau de bord Inspecteur</div>
        <div class="page-subtitle">Réservé au Directeur Régional — Vue détaillée par centre / établissement</div>
      </div>
      <div class="header-actions">
        <button class="btn btn-outline btn-sm" onclick="window.print()">🖨 Imprimer</button>
        <button class="btn btn-outline btn-sm" onclick="inspExportCSV()">⬇ Export CSV</button>
      </div>
    </div>

    <div class="alert alert-warning" style="margin-bottom:20px">
      🔑 Cette vue est réservée au Directeur Régional. Elle permet de superviser chaque centre et établissement individuellement.
    </div>

    <!-- Filtres -->
    <div class="card" style="margin-bottom:16px">
      <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:flex-end">
        <div class="form-group" style="min-width:160px">
          <label class="form-label">Examen</label>
          <select class="form-select" id="inspType" onchange="chargerInspecteur()">
            <option value="bepc">BEPC</option>
            <option value="bac">BAC</option>
          </select>
        </div>
        <div class="form-group" style="min-width:200px">
          <label class="form-label">Centre</label>
          <select class="form-select" id="inspCentre" onchange="chargerInspecteur()">
            <option value="">Tous les centres</option>
            ${centres.map(c => `<option value="${c.id}">${c.nom}</option>`).join('')}
          </select>
        </div>
        <div class="form-group" style="min-width:200px">
          <label class="form-label">Établissement</label>
          <select class="form-select" id="inspEtab" onchange="chargerInspecteur()">
            <option value="">Tous les établissements</option>
            ${etabs.map(e => `<option value="${e.id}">${e.nom}</option>`).join('')}
          </select>
        </div>
        <div class="form-group" style="min-width:120px">
          <label class="form-label">Série (BAC)</label>
          <select class="form-select" id="inspSerie" onchange="chargerInspecteur()">
            <option value="">Toutes</option>
            <option value="A1">A1</option><option value="A2">A2</option>
            <option value="C">C</option><option value="D">D</option>
          </select>
        </div>
        <div>
          <button class="btn btn-primary" onclick="chargerInspecteur()">🔍 Analyser</button>
        </div>
      </div>
    </div>

    <div id="inspResult"><div style="text-align:center;padding:48px;color:var(--text3)">
      Sélectionnez les filtres et cliquez sur <strong>Analyser</strong>.
    </div></div>`;
}

window.chargerInspecteur = async function() {
  const type     = document.getElementById('inspType')?.value   || 'bepc';
  const centreId = document.getElementById('inspCentre')?.value || '';
  const etabId   = document.getElementById('inspEtab')?.value   || '';
  const serie    = document.getElementById('inspSerie')?.value  || '';

  const el = document.getElementById('inspResult');
  if (!el) return;
  el.innerHTML = `<div class="loading"><div class="spinner"></div>Analyse en cours...</div>`;

  try {
    // Charger candidats avec filtres
    let q = supabase.from('candidats_' + type).select('*').order('nom');
    if (centreId) q = q.eq('centre_id', centreId);
    if (etabId)   q = q.eq('etab_id',   etabId);
    if (serie && type === 'bac') q = q.eq('serie', serie);
    const { data: cands, error } = await q;
    if (error) throw error;
    if (!cands?.length) {
      el.innerHTML = `<div class="alert alert-warning">Aucun candidat trouvé avec ces filtres.</div>`;
      return;
    }

    // Charger toutes les notes d'un coup
    const ids = cands.map(c => c.id);
    const { data: notesRaw } = await supabase
      .from('notes_' + type)
      .select('candidat_id, matiere_id, note')
      .in('candidat_id', ids);

    const notesIdx = {};
    (notesRaw || []).forEach(n => {
      if (!notesIdx[n.candidat_id]) notesIdx[n.candidat_id] = {};
      notesIdx[n.candidat_id][n.matiere_id] = parseFloat(n.note);
    });

    // Calculer stats globales
    const total   = cands.length;
    const valides = cands.filter(c => c.valide).length;
    const absents = cands.filter(c => c.absent).length;
    const filles  = cands.filter(c => c.sexe === 'F').length;
    const garcons = cands.filter(c => c.sexe === 'M').length;
    const nonTraites = total - valides;

    const admis = cands.filter(c => {
      const r = type === 'bepc'
        ? calcMoyenneBepc(notesIdx[c.id] || {}, c.inapt_eps, c.arts_plastiques)
        : calcMoyenneBac(notesIdx[c.id] || {}, c.serie, c.inapt_eps);
      return r.moy !== null && r.moy >= 10 && !c.absent;
    }).length;

    const refuses = cands.filter(c => {
      const r = type === 'bepc'
        ? calcMoyenneBepc(notesIdx[c.id] || {}, c.inapt_eps, c.arts_plastiques)
        : calcMoyenneBac(notesIdx[c.id] || {}, c.serie, c.inapt_eps);
      return r.moy !== null && r.moy < 10 && !c.absent && c.valide;
    }).length;

    const taux = valides > 0 ? Math.round(admis / valides * 100) : 0;
    const progPct = total > 0 ? Math.round(valides / total * 100) : 0;

    // Stats par centre pour vue détaillée
    const centres = G.ref.centres || [];
    const centresVus = [...new Set(cands.map(c => c.centre_id))];
    const statsCentres = centresVus.map(cid => {
      const g = cands.filter(c => c.centre_id === cid);
      const val = g.filter(c => c.valide).length;
      const abs = g.filter(c => c.absent).length;
      const adm = g.filter(c => {
        const r = type === 'bepc'
          ? calcMoyenneBepc(notesIdx[c.id] || {}, c.inapt_eps, c.arts_plastiques)
          : calcMoyenneBac(notesIdx[c.id] || {}, c.serie, c.inapt_eps);
        return r.moy !== null && r.moy >= 10 && !c.absent;
      }).length;
      const t = val > 0 ? Math.round(adm / val * 100) : 0;
      return { nom: getCentreNom(cid), total: g.length, valides: val, admis: adm, absents: abs, taux: t, nonTraites: g.length - val };
    }).sort((a, b) => b.taux - a.taux);

    // Stocker pour export CSV
    window._inspData = { cands, notesIdx, type, statsCentres };

    el.innerHTML = `
      <!-- Stats globales -->
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px">
        <div class="stat-card stat-accent">
          <div class="stat-value">${total}</div>
          <div class="stat-label">Candidats</div>
          <div class="stat-sub">${filles}F · ${garcons}G</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${valides} <span style="font-size:14px;color:var(--text3)">/ ${total}</span></div>
          <div class="stat-label">Fiches traitées</div>
          <div class="progress-bar" style="margin-top:6px"><div class="progress-fill" style="width:${progPct}%"></div></div>
          <div class="stat-sub">${nonTraites} non traités</div>
        </div>
        <div class="stat-card stat-green">
          <div class="stat-value" style="color:var(--green)">${admis}</div>
          <div class="stat-label">Admis</div>
          <div class="stat-sub">${taux}% de réussite</div>
        </div>
        <div class="stat-card stat-red">
          <div class="stat-value" style="color:var(--red)">${refuses}</div>
          <div class="stat-label">Refusés</div>
          <div class="stat-sub">${absents} absents</div>
        </div>
      </div>

      <!-- Barre de progression globale -->
      <div class="card" style="margin-bottom:20px">
        <div class="card-title">Progression de la saisie</div>
        <div style="display:flex;align-items:center;gap:16px">
          <div class="progress-bar" style="flex:1;height:12px">
            <div class="progress-fill pf-green" style="width:${progPct}%"></div>
          </div>
          <span style="font-size:18px;font-weight:700;font-family:var(--mono);color:var(--green)">${progPct}%</span>
        </div>
        <div style="display:flex;gap:16px;margin-top:10px;font-size:12px;color:var(--text2)">
          <span>✅ Traités : <strong>${valides}</strong></span>
          <span>⏳ En attente : <strong>${nonTraites}</strong></span>
          <span>❌ Absents : <strong>${absents}</strong></span>
        </div>
      </div>

      <!-- Détail par centre -->
      <div class="card" style="margin-bottom:20px">
        <div class="card-title">📍 Détail par centre d'examen</div>
        <div class="table-wrap">
          <table>
            <thead><tr>
              <th>Centre</th><th>Candidats</th><th>Traités</th><th>Non traités</th>
              <th>Absents</th><th>Admis</th><th>% Réussite</th><th>Progression</th>
            </tr></thead>
            <tbody>
              ${statsCentres.map(s => `<tr>
                <td><strong>${s.nom}</strong></td>
                <td class="td-mono">${s.total}</td>
                <td class="td-mono" style="color:var(--green)">${s.valides}</td>
                <td class="td-mono" style="color:var(--amber)">${s.nonTraites}</td>
                <td class="td-mono" style="color:var(--text3)">${s.absents}</td>
                <td class="td-mono" style="color:var(--green);font-weight:600">${s.admis}</td>
                <td><span class="badge badge-${s.taux>=50?'green':s.taux>=30?'amber':'red'}">${s.taux}%</span></td>
                <td style="min-width:120px">
                  <div class="progress-bar"><div class="progress-fill" style="width:${s.total>0?Math.round(s.valides/s.total*100):0}%"></div></div>
                </td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <!-- Liste individuelle des candidats -->
      <div class="card">
        <div class="card-title">👥 Liste individuelle des candidats (${total})</div>
        <div style="overflow-x:auto">
          <table style="width:100%;border-collapse:collapse;font-size:12px">
            <thead style="background:var(--surface2)">
              <tr>
                <th style="padding:8px 12px;text-align:left;border-bottom:1px solid var(--border)">N° Table</th>
                <th style="padding:8px 12px;text-align:left;border-bottom:1px solid var(--border)">Matricule</th>
                <th style="padding:8px 12px;text-align:left;border-bottom:1px solid var(--border)">Nom & Prénoms</th>
                ${type === 'bac' ? '<th style="padding:8px 12px;border-bottom:1px solid var(--border)">Série</th>' : ''}
                <th style="padding:8px 12px;text-align:left;border-bottom:1px solid var(--border)">Centre</th>
                <th style="padding:8px 12px;text-align:center;border-bottom:1px solid var(--border)">Statut saisie</th>
                <th style="padding:8px 12px;text-align:center;border-bottom:1px solid var(--border)">Moyenne</th>
                <th style="padding:8px 12px;text-align:center;border-bottom:1px solid var(--border)">Décision</th>
              </tr>
            </thead>
            <tbody>
              ${cands.map((c, i) => {
                const notes = notesIdx[c.id] || {};
                const res = type === 'bepc'
                  ? calcMoyenneBepc(notes, c.inapt_eps, c.arts_plastiques)
                  : calcMoyenneBac(notes, c.serie, c.inapt_eps);
                const dec = getDecision(res.moy, c.absent);
                const decColor = dec === 'Admis' ? 'var(--green)' : dec === 'Refusé' ? 'var(--red)' : 'var(--text3)';
                const bg = i % 2 === 0 ? 'var(--surface)' : 'var(--surface2)';
                return `<tr style="background:${bg}">
                  <td style="padding:6px 12px;border-bottom:1px solid var(--border);font-family:var(--mono)">${c.num_table}</td>
                  <td style="padding:6px 12px;border-bottom:1px solid var(--border);font-family:var(--mono);font-size:11px">${c.matricule}</td>
                  <td style="padding:6px 12px;border-bottom:1px solid var(--border)"><strong>${c.nom}</strong> ${c.prenoms}</td>
                  ${type === 'bac' ? `<td style="padding:6px 12px;border-bottom:1px solid var(--border);text-align:center"><span class="badge badge-${c.serie==='C'?'red':c.serie==='D'?'amber':c.serie==='A1'?'green':'blue'}">${c.serie}</span></td>` : ''}
                  <td style="padding:6px 12px;border-bottom:1px solid var(--border);font-size:11px">${getCentreNom(c.centre_id)}</td>
                  <td style="padding:6px 12px;border-bottom:1px solid var(--border);text-align:center">
                    ${c.absent ? `<span class="badge badge-gray">Absent</span>`
                      : c.valide ? `<span class="badge badge-green">✓ Validé</span>`
                      : `<span class="badge badge-amber">En attente</span>`}
                  </td>
                  <td style="padding:6px 12px;border-bottom:1px solid var(--border);text-align:center;font-family:var(--mono);font-weight:600">
                    ${res.moy !== null ? res.moy.toFixed(2) : '—'}
                  </td>
                  <td style="padding:6px 12px;border-bottom:1px solid var(--border);text-align:center;font-weight:600;color:${decColor}">
                    ${dec}
                  </td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>`;
  } catch(e) {
    el.innerHTML = `<div class="alert alert-danger">Erreur : ${e.message}</div>`;
  }
};

window.inspExportCSV = function() {
  const d = window._inspData;
  if (!d) { showToast('Cliquez d\'abord sur Analyser', 'error'); return; }
  const { cands, notesIdx, type } = d;
  const h = ['num_table','matricule','nom','prenoms','sexe','classe',
    ...(type === 'bac' ? ['serie'] : []),
    'centre','etablissement','valide','absent','moyenne','decision'];
  const rows = cands.map(c => {
    const notes = notesIdx[c.id] || {};
    const res   = type === 'bepc'
      ? calcMoyenneBepc(notes, c.inapt_eps, c.arts_plastiques)
      : calcMoyenneBac(notes, c.serie, c.inapt_eps);
    const dec = getDecision(res.moy, c.absent);
    return [
      c.num_table, c.matricule, c.nom, c.prenoms, c.sexe, c.classe,
      ...(type === 'bac' ? [c.serie] : []),
      getCentreNom(c.centre_id), getEtabNom(c.etab_id),
      c.valide ? 'Oui' : 'Non', c.absent ? 'Oui' : 'Non',
      res.moy !== null ? res.moy.toFixed(2) : '',
      dec
    ].join(';');
  });
  _dlCSV([h.join(';'), ...rows].join('\n'), `inspecteur_${type}_${_dateFichier()}.csv`);
  showToast('✅ Export CSV téléchargé !');
};


// ═══════════════════════════════════════════════════════════════
// INTÉGRATION — Mise à jour de renderPage + nav + sidebar
// ═══════════════════════════════════════════════════════════════

// Surcharger renderPage pour ajouter les nouvelles pages
const _renderPageOrig = window.nav;

// Patch de renderPage pour inclure les nouvelles pages
const _pagesAdditions = {
  'notifications': renderNotifications,
  'sauvegarde':    renderSauvegarde,
  'connectes':     renderConnectes,
  'inspecteur':    renderInspecteur,
};

// Injecter dans le routeur existant
const _renderPageNative = async function(page) {
  const c = document.getElementById('content');
  c.innerHTML = `<div class="loading"><div class="spinner"></div>Chargement...</div>`;
  const fn = _pagesAdditions[page];
  if (fn) {
    try { c.innerHTML = await fn(); }
    catch(e) { c.innerHTML = `<div class="alert alert-danger">Erreur : ${e.message}</div>`; }
    return true; // indique qu'on a géré la page
  }
  return false;
};

// Monkey-patch de nav() pour intercepter les nouvelles pages
const _navOrig = window.nav;
window.nav = async function(page) {
  // Mettre à jour présence
  updatePresencePage(page);

  // Essayer les nouvelles pages d'abord
  if (_pagesAdditions[page]) {
    G.page = page;
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(el => {
      if (el.getAttribute('onclick')?.includes(`'${page}'`)) el.classList.add('active');
    });
    const c = document.getElementById('content');
    c.className = 'fade-in'; void c.offsetWidth;
    await _renderPageNative(page);
    return;
  }
  // Sinon routeur original
  _navOrig(page);
};

// Ajouter les liens dans la sidebar Directeur
function _injecterSidebarDirecteur() {
  if (G.role !== 'directeur') return;
  const adminSec = document.getElementById('adminSection');
  if (!adminSec) return;

  // Vérifier qu'on n'a pas déjà injecté
  if (document.getElementById('navDirecteurExtra')) return;

  // Créer une nouvelle section Directeur
  const section = document.createElement('div');
  section.className = 'sb-section';
  section.id = 'navDirecteurExtra';
  section.innerHTML = `
    <div class="sb-label">Directeur Régional</div>
    <div class="nav-item" onclick="nav('notifications')">
      <svg class="nav-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M8 1a5 5 0 0 1 5 5v3l1 2H2l1-2V6a5 5 0 0 1 5-5z"/><circle cx="8" cy="14" r="1.2"/>
      </svg>
      <span>Notifications RT</span>
    </div>
    <div class="nav-item" onclick="nav('connectes')">
      <svg class="nav-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
        <circle cx="5" cy="5" r="2.5"/><circle cx="11" cy="5" r="2.5"/>
        <path d="M1 13c0-2 1.8-3.5 4-3.5"/><path d="M15 13c0-2-1.8-3.5-4-3.5"/>
        <path d="M5.5 13c0-2 1.1-3.5 2.5-3.5s2.5 1.5 2.5 3.5"/>
      </svg>
      <span>Connectés <span id="presenceBadge" style="background:var(--green);color:#fff;border-radius:10px;padding:0 5px;font-size:10px;margin-left:4px">0</span></span>
    </div>
    <div class="nav-item" onclick="nav('inspecteur')">
      <svg class="nav-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
        <circle cx="6.5" cy="6.5" r="4.5"/><path d="M11 11l3 3"/>
      </svg>
      Tableau Inspecteur
    </div>
    <div class="nav-item" onclick="nav('sauvegarde')">
      <svg class="nav-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M2 2h9l3 3v9H2z"/><rect x="5" y="9" width="6" height="5"/><rect x="5" y="2" width="5" height="4"/>
      </svg>
      Sauvegarde
    </div>`;

  // Insérer avant la section adminSection
  adminSec.parentNode.insertBefore(section, adminSec);
}

// ═══════════════════════════════════════════════════════════════
// EBR v3 — CORRECTIFS + NOUVELLES FONCTIONNALITÉS
// ═══════════════════════════════════════════════════════════════

// ── CORRECTIF 1 : Déduplication Presence (même user = plusieurs onglets) ──
// On patch renderConnectes pour dédupliquer par email
const _renderConnectesOrig = window.renderConnectes || null;

async function renderConnectesFix() {
  const guard = checkDirecteur();
  if (guard) return guard;

  const state = _presenceChannel ? _presenceChannel.presenceState() : {};
  // Déduplication : garder uniquement la présence la plus récente par email
  const byEmail = {};
  Object.values(state).flat().forEach(u => {
    const key = u.email || u.nom || Math.random();
    const existing = byEmail[key];
    if (!existing || (u.heure && (!existing.heure || u.heure > existing.heure))) {
      byEmail[key] = u;
    }
  });
  const users = Object.values(byEmail);

  const roleLabel = r => r === 'directeur' ? '🔑 Directeur' : r === 'admin' ? '🛡 Admin' : '👤 Opérateur';
  const roleBadge = r => r === 'directeur' ? 'purple' : r === 'admin' ? 'blue' : 'gray';
  const pageLabel = p => ({
    'dashboard':       '📊 Tableau de bord',
    'saisie-bepc':     '✏️ Saisie BEPC',
    'saisie-bac':      '✏️ Saisie BAC',
    'import-notes':    '📥 Import notes',
    'candidats':       '👥 Candidats',
    'bilan':           '📈 Bilan',
    'statistiques':    '📊 Statistiques',
    'classement':      '🏆 Classement',
    'connectes':       '🟢 Connectés',
    'sauvegarde':      '💾 Sauvegarde',
    'notifications':   '🔔 Notifications',
    'inspecteur':      '🔍 Inspecteur',
    'fraude':          '🚨 Anti-fraude',
    'journal-cnx':     '📅 Journal cnx',
    'rapport-session': '📋 Rapport',
    'recherche-globale': '🔍 Recherche',
    'cloture':         '🔒 Clôture',
  }[p] || (p || '—'));

  const admins    = users.filter(u => u.role === 'admin').length;
  const operateurs = users.filter(u => u.role === 'operateur').length;
  const directeurs = users.filter(u => u.role === 'directeur').length;

  return `
    <div class="page-header">
      <div>
        <div class="page-title">🟢 Utilisateurs connectés</div>
        <div class="page-subtitle">Réservé au Directeur Régional — Vue temps réel via Supabase Presence</div>
      </div>
      <div class="header-actions">
        <button class="btn btn-outline btn-sm" onclick="nav('connectes')">🔄 Actualiser</button>
      </div>
    </div>

    <div class="alert alert-info" style="margin-bottom:20px">
      🔑 Seul le Directeur Régional peut voir qui est connecté. Cette vue se met à jour automatiquement.
    </div>

    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:24px">
      <div class="stat-card stat-green">
        <div class="stat-value">${users.length}</div>
        <div class="stat-label">Utilisateurs en ligne</div>
      </div>
      <div class="stat-card" style="border-left:3px solid var(--purple)">
        <div class="stat-value">${directeurs}</div>
        <div class="stat-label">Directeurs</div>
      </div>
      <div class="stat-card stat-accent">
        <div class="stat-value">${admins}</div>
        <div class="stat-label">Administrateurs</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${operateurs}</div>
        <div class="stat-label">Opérateurs de saisie</div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">👥 Liste des utilisateurs actifs</div>
      ${users.length === 0 ? `
        <div style="text-align:center;padding:40px;color:var(--text3)">
          <div style="font-size:32px;margin-bottom:8px">👤</div>
          <div>Aucun utilisateur connecté en ce moment.</div>
        </div>` : `
        <div class="table-wrap">
          <table>
            <thead><tr><th>Utilisateur</th><th>Rôle</th><th>Page actuelle</th><th>Connecté depuis</th></tr></thead>
            <tbody>
              ${users.map(u => {
                const heure = u.heure ? new Date(u.heure).toLocaleTimeString('fr-FR') : '—';
                return `<tr>
                  <td>
                    <div style="display:flex;align-items:center;gap:10px">
                      <span style="width:10px;height:10px;border-radius:50%;background:#1a6b3a;flex-shrink:0;box-shadow:0 0 0 3px rgba(26,107,58,.2)"></span>
                      <div>
                        <div style="font-weight:600">${u.nom || '—'}</div>
                        <div style="font-size:11px;color:var(--text3)">${u.email || ''}</div>
                      </div>
                    </div>
                  </td>
                  <td><span class="badge badge-${roleBadge(u.role)}">${roleLabel(u.role)}</span></td>
                  <td style="font-size:13px">${pageLabel(u.page)}</td>
                  <td style="font-size:12px;color:var(--text3)">${heure}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>`}
    </div>`;
}

// ── CORRECTIF 2 : Injection sidebar UNE SEULE FOIS, sans doublons ──
// Garde un flag global pour éviter le double appel observer + setTimeout
let _v3Injected = false;

function _injecterSidebarV3Safe() {
  if (_v3Injected) return;
  if (G.role !== 'directeur') return;
  const existing = document.getElementById('navDirecteurExtra');
  if (!existing) return;
  if (document.getElementById('navDirecteurV3')) return; // déjà injecté

  _v3Injected = true;

  existing.insertAdjacentHTML('beforeend', `
    <div class="nav-item" id="navDirecteurV3" onclick="nav('fraude')">
      <svg class="nav-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M8 1l1.8 3.6L14 5.6l-3 2.9.7 4.1L8 10.5l-3.7 2.1.7-4.1L2 5.6l4.2-.9z"/>
      </svg>
      Alertes anti-fraude
    </div>
    <div class="nav-item" onclick="nav('journal-cnx')">
      <svg class="nav-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
        <circle cx="8" cy="8" r="6"/><path d="M8 5v3l2 2"/>
      </svg>
      Journal connexions
    </div>
    <div class="nav-item" onclick="nav('rapport-session')">
      <svg class="nav-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M3 2h8l3 3v9H3z"/><path d="M9 2v4h4"/><path d="M6 9h4M6 12h2"/>
      </svg>
      Rapport de session
    </div>`);

  // Recherche globale dans la première section (pour tous)
  if (!document.getElementById('navRechercheGlobale')) {
    const dashSection = document.querySelector('.sb-section');
    if (dashSection) {
      dashSection.insertAdjacentHTML('beforeend', `
        <div class="nav-item" id="navRechercheGlobale" onclick="nav('recherche-globale')">
          <svg class="nav-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="6.5" cy="6.5" r="4.5"/><path d="M11 11l3 3"/>
          </svg>
          Recherche globale
        </div>`);
    }
  }
}

// ── CORRECTIF 3 : Journal connexions lit le presenceState directement ──
async function renderJournalConnexionsFix() {
  const guard = checkDirecteur();
  if (guard) return guard;

  const state = _presenceChannel ? _presenceChannel.presenceState() : {};
  // Dédupliqué par email (même logique que renderConnectesFix)
  const byEmail = {};
  Object.values(state).flat().forEach(u => {
    const key = u.email || u.nom || 'inconnu';
    if (!byEmail[key] || (u.heure && byEmail[key].heure < u.heure)) byEmail[key] = u;
  });
  const actifs = Object.values(byEmail);

  // Essayer aussi la table journal_connexions si elle existe
  let historique = [];
  try {
    const { data, error } = await supabase
      .from('journal_connexions')
      .select('*')
      .order('connected_at', { ascending: false })
      .limit(100);
    if (!error && data) historique = data;
  } catch(_) {}

  return `
    <div class="page-header">
      <div>
        <div class="page-title">📅 Journal des connexions</div>
        <div class="page-subtitle">Sessions utilisateurs — Directeur Régional uniquement</div>
      </div>
      <div class="header-actions">
        <button class="btn btn-outline btn-sm" onclick="nav('journal-cnx')">🔄 Actualiser</button>
      </div>
    </div>

    <div class="card" style="margin-bottom:16px">
      <div class="card-title">🟢 Sessions actives maintenant (${actifs.length})</div>
      ${actifs.length === 0 ? `<div style="text-align:center;padding:20px;color:var(--text2)">Aucune session active détectée</div>` : `
      <div class="table-wrap">
        <table>
          <thead><tr><th>Utilisateur</th><th>Rôle</th><th>Page actuelle</th><th>Depuis</th></tr></thead>
          <tbody>
            ${actifs.map(u => `
              <tr>
                <td>
                  <div style="font-weight:600">${u.nom || '—'}</div>
                  <div style="font-size:11px;color:var(--text3)">${u.email || ''}</div>
                </td>
                <td>${badge(u.role === 'directeur' ? '🔑 Directeur' : u.role === 'admin' ? '🛡 Admin' : '👤 Opérateur',
                  u.role === 'directeur' ? 'purple' : u.role === 'admin' ? 'blue' : 'gray')}</td>
                <td>${u.page || '—'}</td>
                <td class="td-mono">${u.heure ? new Date(u.heure).toLocaleTimeString('fr-FR') : '—'}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`}
    </div>

    ${historique.length > 0 ? `
    <div class="card">
      <div class="card-title">📋 Historique des 100 dernières sessions</div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>#</th><th>Utilisateur</th><th>Connexion</th><th>Déconnexion</th><th>Durée</th></tr></thead>
          <tbody>
            ${historique.map((l, i) => {
              const cnx  = l.connected_at    ? new Date(l.connected_at) : null;
              const dcnx = l.disconnected_at ? new Date(l.disconnected_at) : null;
              let duree = '—';
              if (cnx && dcnx) {
                const m = Math.floor((dcnx - cnx) / 60000);
                duree = m > 60 ? `${Math.floor(m/60)}h${String(m%60).padStart(2,'0')}` : `${m}min`;
              } else if (cnx && !dcnx) duree = `<span class="badge badge-green">Actif</span>`;
              return `<tr>
                <td class="td-mono">${i+1}</td>
                <td>${l.email || l.user_id || '—'}</td>
                <td class="td-mono">${cnx ? cnx.toLocaleString('fr-FR') : '—'}</td>
                <td class="td-mono">${dcnx ? dcnx.toLocaleString('fr-FR') : '—'}</td>
                <td>${duree}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>` : `
    <div class="alert alert-info">
      ℹ️ Pour activer l'historique complet des sessions, créez la table <code>journal_connexions</code> dans Supabase
      avec les colonnes : <code>id, user_id, email, connected_at, disconnected_at, ip_address</code>.
    </div>`}`;
}

// ── Nouvelles pages V3 ──
async function renderFraude() {
  const guard = checkDirecteur();
  if (guard) return guard;

  return `
    <div class="page-header">
      <div>
        <div class="page-title">🚨 Alertes anti-fraude</div>
        <div class="page-subtitle">Détection automatique d'anomalies — Directeur Régional uniquement</div>
      </div>
      <div class="header-actions">
        <button class="btn btn-primary" onclick="lancerAnalyseFraude()">🔍 Analyser maintenant</button>
      </div>
    </div>
    <div class="alert alert-info" style="margin-bottom:16px">
      ℹ️ L'analyse détecte : doublons matricule, candidats sans note, toutes notes à 20/20, notes identiques en masse sur un centre.
    </div>
    <div id="fraudeResultats">
      <div class="card" style="text-align:center;padding:48px;color:var(--text2)">
        <div style="font-size:36px;margin-bottom:12px">🔍</div>
        <div>Cliquez sur <strong>Analyser maintenant</strong> pour lancer la détection.</div>
      </div>
    </div>`;
}

window.lancerAnalyseFraude = async function() {
  const el = document.getElementById('fraudeResultats');
  if (!el) return;
  el.innerHTML = `<div class="loading"><div class="spinner"></div>Analyse en cours...</div>`;
  try {
    const [bepcR, bacR, nbR, nbacR] = await Promise.all([
      supabase.from('candidats_bepc').select('id,matricule,nom,prenoms,centre_id'),
      supabase.from('candidats_bac').select('id,matricule,nom,prenoms,centre_id,serie'),
      supabase.from('notes_bepc').select('candidat_id,matiere_id,note'),
      supabase.from('notes_bac').select('candidat_id,matiere_id,note'),
    ]);
    const bepc = bepcR.data||[], bac = bacR.data||[];
    const notesB = nbR.data||[], notesBAC = nbacR.data||[];
    const alertes = [];

    // 1. Doublons matricule BEPC
    const mbMap = {};
    bepc.forEach(c => { if (!mbMap[c.matricule]) mbMap[c.matricule]=[]; mbMap[c.matricule].push(c); });
    Object.entries(mbMap).forEach(([m,list]) => {
      if (list.length > 1) alertes.push({ type:'danger', titre:`Doublon matricule BEPC : ${m}`, detail:`${list.length} candidats : ${list.map(c=>c.nom).join(', ')}` });
    });

    // 2. Doublons matricule BAC
    const mbacMap = {};
    bac.forEach(c => { if (!mbacMap[c.matricule]) mbacMap[c.matricule]=[]; mbacMap[c.matricule].push(c); });
    Object.entries(mbacMap).forEach(([m,list]) => {
      if (list.length > 1) alertes.push({ type:'danger', titre:`Doublon matricule BAC : ${m}`, detail:`${list.length} candidats : ${list.map(c=>c.nom).join(', ')}` });
    });

    // 3. Sans aucune note BEPC
    const avecNoteB = new Set(notesB.map(n=>n.candidat_id));
    const sansB = bepc.filter(c => !avecNoteB.has(c.id));
    if (sansB.length) alertes.push({ type:'warning', titre:`${sansB.length} candidat(s) BEPC sans aucune note`, detail: sansB.slice(0,5).map(c=>`${c.nom} (${getCentreNom(c.centre_id)})`).join(' / ') + (sansB.length>5?` …+${sansB.length-5}`:'' )});

    // 4. Sans aucune note BAC
    const avecNoteBAC = new Set(notesBAC.map(n=>n.candidat_id));
    const sansBAC = bac.filter(c => !avecNoteBAC.has(c.id));
    if (sansBAC.length) alertes.push({ type:'warning', titre:`${sansBAC.length} candidat(s) BAC sans aucune note`, detail: sansBAC.slice(0,5).map(c=>`${c.nom} (${getCentreNom(c.centre_id)})`).join(' / ') + (sansBAC.length>5?` …+${sansBAC.length-5}`:'') });

    // 5. Toutes notes = 20 (BEPC)
    const notesParCand = {};
    notesB.forEach(n => { if (!notesParCand[n.candidat_id]) notesParCand[n.candidat_id]=[]; notesParCand[n.candidat_id].push(parseFloat(n.note)); });
    const suspects20 = Object.values(notesParCand).filter(ns => ns.length >= 5 && ns.every(n=>n===20)).length;
    if (suspects20 > 0) alertes.push({ type:'danger', titre:`${suspects20} candidat(s) BEPC avec TOUTES les notes à 20/20`, detail:'Statistiquement improbable. Vérification recommandée.' });

    // 6. Notes identiques en masse sur un centre (>85% même note dans une matière)
    const candCentre = {};
    bepc.forEach(c => { candCentre[c.id] = c.centre_id; });
    const centreNoteMat = {};
    notesB.forEach(n => {
      const cid = candCentre[n.candidat_id]; if (!cid) return;
      const key = `${cid}__${n.matiere_id}`;
      if (!centreNoteMat[key]) centreNoteMat[key] = {};
      const v = String(n.note);
      centreNoteMat[key][v] = (centreNoteMat[key][v]||0)+1;
    });
    const tailleCentre = {};
    bepc.forEach(c => { tailleCentre[c.centre_id] = (tailleCentre[c.centre_id]||0)+1; });
    Object.entries(centreNoteMat).forEach(([key, dist]) => {
      const [cid, matId] = key.split('__');
      const taille = tailleCentre[cid]||1;
      const maxN = Math.max(...Object.values(dist));
      const noteD = Object.entries(dist).find(([,v])=>v===maxN)?.[0];
      if (maxN/taille > 0.85 && taille >= 10)
        alertes.push({ type:'warning', titre:`Notes identiques en masse — ${getCentreNom(cid)}`, detail:`Matière ${matId} : ${maxN}/${taille} candidats ont exactement ${noteD}/20 (${Math.round(maxN/taille*100)}%)` });
    });

    if (alertes.length === 0) {
      el.innerHTML = `<div class="alert alert-success" style="padding:20px"><div style="font-size:16px;font-weight:700;margin-bottom:4px">✅ Aucune anomalie détectée</div><div>Les données semblent cohérentes.</div></div>`;
      return;
    }
    el.innerHTML = `
      <div class="card-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:16px">
        <div class="stat-card stat-red"><div class="stat-value">${alertes.length}</div><div class="stat-label">Total alertes</div></div>
        <div class="stat-card" style="border-left:3px solid #8b1a1a"><div class="stat-value">${alertes.filter(a=>a.type==='danger').length}</div><div class="stat-label">Critiques</div></div>
        <div class="stat-card stat-amber"><div class="stat-value">${alertes.filter(a=>a.type==='warning').length}</div><div class="stat-label">Avertissements</div></div>
      </div>
      <div class="card">
        <div class="card-title">Détail des anomalies</div>
        ${alertes.map(a=>`
          <div class="alert alert-${a.type==='danger'?'danger':'warning'}" style="margin-bottom:10px">
            <div><div style="font-weight:600;margin-bottom:4px">${a.type==='danger'?'🔴':'🟡'} ${a.titre}</div>
            <div style="font-size:12px;opacity:.85">${a.detail}</div></div>
          </div>`).join('')}
      </div>`;
  } catch(e) {
    el.innerHTML = `<div class="alert alert-danger">Erreur : ${e.message}</div>`;
  }
};

async function renderRapportSession() {
  const guard = checkDirecteur();
  if (guard) return guard;
  return `
    <div class="page-header">
      <div>
        <div class="page-title">📋 Rapport de session</div>
        <div class="page-subtitle">Résumé complet — imprimable / PDF</div>
      </div>
      <div class="header-actions">
        <button class="btn btn-outline" onclick="window.print()">🖨️ Imprimer / PDF</button>
        <button class="btn btn-primary" onclick="genererRapport()">📊 Générer</button>
      </div>
    </div>
    <div id="rapportContenu">
      <div class="card" style="text-align:center;padding:48px;color:var(--text2)">
        <div style="font-size:36px;margin-bottom:12px">📋</div>
        <div>Cliquez sur <strong>Générer</strong> pour produire le bilan complet de la session.</div>
      </div>
    </div>`;
}

window.genererRapport = async function() {
  const el = document.getElementById('rapportContenu');
  if (!el) return;
  el.innerHTML = `<div class="loading"><div class="spinner"></div>Génération...</div>`;
  try {
    const annee  = G.ref.config?.annee || new Date().getFullYear();
    const region = G.ref.config?.region || 'Vallée du Bandama — Bouaké';
    const [bepcR, bacR, ctrsR, etabsR] = await Promise.all([
      supabase.from('candidats_bepc').select('*'),
      supabase.from('candidats_bac').select('*'),
      supabase.from('centres').select('*').order('nom'),
      supabase.from('etablissements').select('*').order('nom'),
    ]);
    const bepc = bepcR.data||[], bac = bacR.data||[];
    const ctrs = ctrsR.data||[], etabs = etabsR.data||[];

    const bepcByCtr = {}, bacByCtr = {};
    bepc.forEach(c => { if (!bepcByCtr[c.centre_id]) bepcByCtr[c.centre_id]={total:0,val:0}; bepcByCtr[c.centre_id].total++; if(c.valide) bepcByCtr[c.centre_id].val++; });
    bac.forEach(c => { if (!bacByCtr[c.centre_id]) bacByCtr[c.centre_id]={total:0,val:0}; bacByCtr[c.centre_id].total++; if(c.valide) bacByCtr[c.centre_id].val++; });

    const now = new Date().toLocaleString('fr-FR', { dateStyle:'long', timeStyle:'short' });
    el.innerHTML = `
      <div class="releve" style="max-width:900px;padding:32px">
        <div style="text-align:center;border-bottom:3px double #1a4a8a;padding-bottom:20px;margin-bottom:24px">
          <div style="font-size:12px;color:#666;text-transform:uppercase;letter-spacing:1px">République de Côte d'Ivoire — Union · Discipline · Travail</div>
          <div style="font-size:20px;font-weight:700;color:#1a4a8a;margin:8px 0 4px">EXAMEN BLANC RÉGIONAL — ${annee}</div>
          <div style="font-size:14px;font-weight:600">Direction Régionale ${region}</div>
          <div style="font-size:12px;color:#888;margin-top:4px">RAPPORT OFFICIEL DE SESSION</div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:24px">
          ${[
            ['#1a4a8a', bepc.length, 'Candidats BEPC'],
            ['#1a6b3a', bac.length, 'Candidats BAC'],
            ['#7a4a00', ctrs.length, "Centres d'examen"],
            ['#4a1a8a', etabs.length, 'Établissements'],
          ].map(([col,val,lbl])=>`<div style="border:1px solid #ddd;border-radius:6px;padding:14px;text-align:center;border-top:3px solid ${col}"><div style="font-size:28px;font-weight:700;font-family:monospace">${val}</div><div style="font-size:12px;color:#666">${lbl}</div></div>`).join('')}
        </div>
        <div style="margin-bottom:24px">
          <div style="font-size:15px;font-weight:700;color:#1a4a8a;border-bottom:2px solid #1a4a8a;padding-bottom:6px;margin-bottom:12px">BEPC — Répartition par centre</div>
          <table class="releve-table" style="width:100%">
            <thead><tr><th class="td-left">Centre</th><th>Inscrits</th><th>Validés</th><th>Taux</th></tr></thead>
            <tbody>
              ${ctrs.map(ct=>{const s=bepcByCtr[ct.id]||{total:0,val:0};const t=s.total>0?Math.round(s.val/s.total*100):0;return `<tr><td class="td-left">${ct.nom}</td><td>${s.total}</td><td>${s.val}</td><td>${t}%</td></tr>`}).join('')}
              <tr style="font-weight:700;background:#e8f0fa"><td class="td-left">TOTAL</td><td>${bepc.length}</td><td>${bepc.filter(c=>c.valide).length}</td><td>${bepc.length>0?Math.round(bepc.filter(c=>c.valide).length/bepc.length*100):0}%</td></tr>
            </tbody>
          </table>
        </div>
        <div style="margin-bottom:24px">
          <div style="font-size:15px;font-weight:700;color:#0a5a5a;border-bottom:2px solid #0a5a5a;padding-bottom:6px;margin-bottom:12px">BAC — Répartition par centre</div>
          <table class="releve-table" style="width:100%">
            <thead><tr><th class="td-left">Centre</th><th>Inscrits</th><th>Validés</th><th>Taux</th></tr></thead>
            <tbody>
              ${ctrs.map(ct=>{const s=bacByCtr[ct.id]||{total:0,val:0};const t=s.total>0?Math.round(s.val/s.total*100):0;return `<tr><td class="td-left">${ct.nom}</td><td>${s.total}</td><td>${s.val}</td><td>${t}%</td></tr>`}).join('')}
              <tr style="font-weight:700;background:#e0f5f5"><td class="td-left">TOTAL</td><td>${bac.length}</td><td>${bac.filter(c=>c.valide).length}</td><td>${bac.length>0?Math.round(bac.filter(c=>c.valide).length/bac.length*100):0}%</td></tr>
            </tbody>
          </table>
        </div>
        <div style="margin-bottom:24px">
          <div style="font-size:15px;font-weight:700;color:#4a1a8a;border-bottom:2px solid #4a1a8a;padding-bottom:6px;margin-bottom:12px">BAC — Par série</div>
          <table class="releve-table" style="width:100%">
            <thead><tr><th>Série</th><th>Effectif</th><th>% du BAC</th></tr></thead>
            <tbody>${['A1','A2','C','D','E'].map(s=>{const n=bac.filter(c=>c.serie===s).length;return n>0?`<tr><td>${s}</td><td>${n}</td><td>${bac.length>0?Math.round(n/bac.length*100):0}%</td></tr>`:''}).join('')}</tbody>
          </table>
        </div>
        <div style="border-top:1px solid #ccc;padding-top:14px;display:flex;justify-content:space-between;font-size:11px;color:#888">
          <div>Généré le ${now}</div><div>EBR ${annee} — Bouaké</div>
          <div>Directeur : ${G.user?.profile?.nom || G.user?.email || '—'}</div>
        </div>
      </div>`;
    showToast('✅ Rapport généré !');
  } catch(e) { el.innerHTML = `<div class="alert alert-danger">Erreur : ${e.message}</div>`; }
};

async function renderRechercheGlobale() {
  return `
    <div class="page-header">
      <div>
        <div class="page-title">🔍 Recherche globale</div>
        <div class="page-subtitle">Trouvez un candidat par matricule, nom ou numéro de table</div>
      </div>
    </div>
    <div class="card" style="margin-bottom:16px">
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <input class="search-input" id="rchInput" placeholder="Matricule, nom, numéro de table…" style="flex:1;min-width:200px"
          onkeydown="if(event.key==='Enter') lancerRecherche()"/>
        <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer;white-space:nowrap">
          <input type="checkbox" id="rchBepc" checked style="accent-color:var(--accent2)"/> BEPC
        </label>
        <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer;white-space:nowrap">
          <input type="checkbox" id="rchBac" checked style="accent-color:var(--accent2)"/> BAC
        </label>
        <button class="btn btn-primary" onclick="lancerRecherche()">Rechercher</button>
      </div>
    </div>
    <div id="rchResultats" style="color:var(--text2);text-align:center;padding:32px">Saisissez un terme ci-dessus.</div>`;
}

window.lancerRecherche = async function() {
  const q  = document.getElementById('rchInput')?.value?.trim();
  const el = document.getElementById('rchResultats');
  const chkBepc = document.getElementById('rchBepc')?.checked;
  const chkBac  = document.getElementById('rchBac')?.checked;
  if (!q || q.length < 2) { el.innerHTML = `<div class="alert alert-warning">Entrez au moins 2 caractères.</div>`; return; }
  el.innerHTML = `<div class="loading"><div class="spinner"></div>Recherche…</div>`;
  try {
    const results = [];
    if (chkBepc) {
      const { data } = await supabase.from('candidats_bepc').select('*')
        .or(`matricule.ilike.%${q}%,nom.ilike.%${q}%,prenoms.ilike.%${q}%,num_table.ilike.%${q}%`).limit(50);
      (data||[]).forEach(c => results.push({ ...c, _type:'BEPC' }));
    }
    if (chkBac) {
      const { data } = await supabase.from('candidats_bac').select('*')
        .or(`matricule.ilike.%${q}%,nom.ilike.%${q}%,prenoms.ilike.%${q}%,num_table.ilike.%${q}%`).limit(50);
      (data||[]).forEach(c => results.push({ ...c, _type:'BAC' }));
    }
    if (results.length === 0) { el.innerHTML = `<div class="alert alert-warning">Aucun candidat trouvé pour « ${q} ».</div>`; return; }
    el.innerHTML = `
      <div style="font-size:13px;color:var(--text2);margin-bottom:10px">${results.length} résultat(s) pour « ${q} »</div>
      <div class="table-wrap"><table>
        <thead><tr><th>Type</th><th>N° Table</th><th>Matricule</th><th>Nom & Prénoms</th><th>Établissement</th><th>Centre</th><th>Statut</th></tr></thead>
        <tbody>
          ${results.map(c=>`<tr>
            <td>${badge(c._type, c._type==='BEPC'?'blue':'teal')}</td>
            <td class="td-mono">${c.num_table||'—'}</td>
            <td class="td-mono">${c.matricule||'—'}</td>
            <td><div style="font-weight:600">${c.nom}</div><div style="font-size:11px;color:var(--text2)">${c.prenoms||''}</div></td>
            <td style="font-size:12px">${getEtabNom(c.etab_id)}</td>
            <td style="font-size:12px">${getCentreNom(c.centre_id)}</td>
            <td>${c.valide ? badge('✓ Validé','green') : badge('En attente','amber')}</td>
          </tr>`).join('')}
        </tbody>
      </table></div>`;
  } catch(e) { el.innerHTML = `<div class="alert alert-danger">Erreur : ${e.message}</div>`; }
};

// ── Mode sombre ──
function _injecterToggleDark() {
  if (document.getElementById('darkToggleBtn')) return;
  const logoutZone = document.querySelector('.sb-logout');
  if (!logoutZone) return;
  const savedDark = localStorage.getItem('ebr-dark') === '1';
  if (savedDark) _applyDark(true);
  const btn = document.createElement('button');
  btn.id = 'darkToggleBtn';
  btn.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:12px;color:rgba(255,255,255,.4);cursor:pointer;background:none;border:none;font-family:var(--font);margin-bottom:8px;';
  const iconMoon = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 3a5 5 0 1 0 0 10A5 5 0 0 0 8 3z"/></svg>`;
  const iconSun  = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="3"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.2 3.2l1.4 1.4M11.4 11.4l1.4 1.4M3.2 12.8l1.4-1.4M11.4 4.6l1.4-1.4"/></svg>`;
  btn.innerHTML = (savedDark ? iconSun + ' Mode clair' : iconMoon + ' Mode sombre');
  btn.onclick = () => {
    const isDark = document.body.classList.toggle('dark-mode');
    localStorage.setItem('ebr-dark', isDark ? '1' : '0');
    btn.innerHTML = isDark ? iconSun + ' Mode clair' : iconMoon + ' Mode sombre';
  };
  logoutZone.insertBefore(btn, logoutZone.firstChild);
}

function _applyDark(on) {
  if (!on) { document.body.classList.remove('dark-mode'); return; }
  document.body.classList.add('dark-mode');
  let style = document.getElementById('darkModeStyle');
  if (!style) {
    style = document.createElement('style');
    style.id = 'darkModeStyle';
    style.textContent = `
      body.dark-mode{--bg:#111110;--surface:#1a1917;--surface2:#222120;--border:#2a2826;--border2:#3a3835;--text:#e8e5e0;--text2:#a09d96;--text3:#6a6760;--accent:#4a9eff;--accent2:#3a8eff;--accent-bg:#1a2a4a;--green-bg:#0a2a18;--red-bg:#2a0a0a;--amber-bg:#2a1a00;--teal-bg:#0a2020;--purple-bg:#1a0a2a;}
      body.dark-mode #sidebar{background:#0d0c0b;}
      body.dark-mode .login-box{background:#1a1917;}
    `;
    document.head.appendChild(style);
  }
}

// ── Patch nav global (v3) — route TOUTES les nouvelles pages ──
const _navV3Base = window.nav;
window.nav = async function(page) {
  const pagesV3 = {
    'fraude':            renderFraude,
    'journal-cnx':       renderJournalConnexionsFix,
    'rapport-session':   renderRapportSession,
    'recherche-globale': renderRechercheGlobale,
    'connectes':         renderConnectesFix,   // remplace la version précédente
  };
  if (pagesV3[page]) {
    G.page = page;
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(el => {
      if (el.getAttribute('onclick')?.includes(`'${page}'`)) el.classList.add('active');
    });
    if (typeof updatePresencePage === 'function') updatePresencePage(page);
    const c = document.getElementById('content');
    c.className = 'fade-in'; void c.offsetWidth;
    c.innerHTML = `<div class="loading"><div class="spinner"></div>Chargement…</div>`;
    try { c.innerHTML = await pagesV3[page](); }
    catch(e) { c.innerHTML = `<div class="alert alert-danger">Erreur : ${e.message}</div>`; }
    return;
  }
  _navV3Base(page);
};

// ── Initialisation unique et propre (une seule fois) ──
let _v3Ready = false;
function _initV3() {
  if (_v3Ready) return;
  if (!document.getElementById('adminSection') || !G.role) return;
  _v3Ready = true;

  _injecterSidebarV3Safe();
  _injecterToggleDark();
}

const _obsV3 = new MutationObserver(() => {
  if (document.getElementById('navDirecteurExtra') && G.role === 'directeur') {
    _initV3();
    _obsV3.disconnect();
  }
});
_obsV3.observe(document.body, { childList: true, subtree: true });
setTimeout(_initV3, 2200);

