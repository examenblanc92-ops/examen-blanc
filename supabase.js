// ============================================================
// EBR — supabase.js  (couche base de données)
// ============================================================

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://ehnlvbdpwxyinjtxevxz.supabase.co';
const SUPABASE_KEY = 'sb_publishable_GHpoVxL-AOe8ccgneWjBlg_GjCjGUh8';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ─── AUTH ────────────────────────────────────────────────────
export async function login(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function logout() {
  await supabase.auth.signOut();
}

export async function getCurrentUser() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from('profiles').select('*').eq('id', user.id).single();
  return { ...user, profile };
}

// ─── DONNÉES DE RÉFÉRENCE ────────────────────────────────────
export async function loadRefData() {
  const [cfg, etabs, ctrs, mBepc, mBac] = await Promise.all([
    supabase.from('config').select('*').eq('id','main').single(),
    supabase.from('etablissements').select('*').order('nom'),
    supabase.from('centres').select('*').order('nom'),
    supabase.from('matieres_bepc').select('*').order('ordre'),
    supabase.from('matieres_bac').select('*').order('ordre'),
  ]);
  const mBacBySerie = {};
  (mBac.data||[]).forEach(m => {
    if (!mBacBySerie[m.serie]) mBacBySerie[m.serie] = [];
    mBacBySerie[m.serie].push(m);
  });
  return {
    config:       cfg.data  || {},
    etablissements: etabs.data || [],
    centres:      ctrs.data || [],
    matBepc:      mBepc.data || [],
    matBac:       mBacBySerie,
  };
}

// ─── CONFIG ──────────────────────────────────────────────────
export async function updateConfig(updates) {
  const { data, error } = await supabase.from('config')
    .update(updates).eq('id','main').select().single();
  if (error) throw error;
  return data;
}

// ─── ÉTABLISSEMENTS ──────────────────────────────────────────
export async function addEtab(e) {
  const { data, error } = await supabase.from('etablissements').insert(e).select().single();
  if (error) throw error; return data;
}
export async function updateEtab(id, u) {
  const { data, error } = await supabase.from('etablissements').update(u).eq('id',id).select().single();
  if (error) throw error; return data;
}
export async function deleteEtab(id) {
  const { error } = await supabase.from('etablissements').delete().eq('id',id);
  if (error) throw error;
}

// ─── CENTRES ─────────────────────────────────────────────────
export async function addCentre(c) {
  const { data, error } = await supabase.from('centres').insert(c).select().single();
  if (error) throw error; return data;
}
export async function updateCentre(id, u) {
  const { data, error } = await supabase.from('centres').update(u).eq('id',id).select().single();
  if (error) throw error; return data;
}
export async function deleteCentre(id) {
  const { error } = await supabase.from('centres').delete().eq('id',id);
  if (error) throw error;
}

// ─── CANDIDATS BEPC ──────────────────────────────────────────
export async function getCandidatsBepc(filters = {}) {
  let q = supabase.from('candidats_bepc').select('*').order('num_table');
  if (filters.centreId) q = q.eq('centre_id', filters.centreId);
  if (filters.etabId)   q = q.eq('etab_id',   filters.etabId);
  if (filters.search)   q = q.or(`matricule.ilike.%${filters.search}%,nom.ilike.%${filters.search}%,num_table.ilike.%${filters.search}%`);
  const { data, error } = await q;
  if (error) throw error; return data || [];
}
export async function addCandidatBepc(c) {
  const { data, error } = await supabase.from('candidats_bepc').insert(c).select().single();
  if (error) throw error; return data;
}
export async function updateCandidatBepc(id, u) {
  const { data, error } = await supabase.from('candidats_bepc')
    .update({...u, updated_at: new Date().toISOString()}).eq('id',id).select().single();
  if (error) throw error; return data;
}
export async function deleteCandidatBepc(id) {
  const { error } = await supabase.from('candidats_bepc').delete().eq('id',id);
  if (error) throw error;
}
export async function validerBepc(id, userId) {
  const { data, error } = await supabase.from('candidats_bepc')
    .update({ valide:true, valide_par:userId, valide_at:new Date().toISOString() })
    .eq('id',id).select().single();
  if (error) throw error; return data;
}
export async function deverrouillerBepc(id) {
  const { data, error } = await supabase.from('candidats_bepc')
    .update({ valide:false, valide_par:null, valide_at:null })
    .eq('id',id).select().single();
  if (error) throw error; return data;
}
export async function upsertCandidatsBepc(list) {
  const { data, error } = await supabase.from('candidats_bepc')
    .upsert(list, { onConflict:'matricule' }).select();
  if (error) throw error; return data;
}

// ─── NOTES BEPC ──────────────────────────────────────────────
export async function getNotesBepc(candidatId) {
  const { data, error } = await supabase.from('notes_bepc')
    .select('*').eq('candidat_id', candidatId);
  if (error) throw error;
  const r = {};
  (data||[]).forEach(n => { r[n.matiere_id] = parseFloat(n.note); });
  return r;
}
export async function getNotesCentreBEPC(centreId) {
  // Toutes les notes d'un centre d'un coup
  const { data, error } = await supabase.from('notes_bepc')
    .select('candidat_id, matiere_id, note')
    .in('candidat_id',
      supabase.from('candidats_bepc').select('id').eq('centre_id', centreId)
    );
  if (error) throw error;
  // Groupe par candidat
  const r = {};
  (data||[]).forEach(n => {
    if (!r[n.candidat_id]) r[n.candidat_id] = {};
    r[n.candidat_id][n.matiere_id] = parseFloat(n.note);
  });
  return r;
}
export async function upsertNoteBepc(candidatId, matiereId, note, userId) {
  const { error } = await supabase.from('notes_bepc').upsert({
    candidat_id: candidatId,
    matiere_id:  matiereId,
    note:        note,
    saisie_par:  userId,
    updated_at:  new Date().toISOString()
  }, { onConflict:'candidat_id,matiere_id' });
  if (error) throw error;
}
export async function importNotesBepc(rows) {
  const { error } = await supabase.from('notes_bepc')
    .upsert(rows, { onConflict:'candidat_id,matiere_id' });
  if (error) throw error;
}

// ─── CANDIDATS BAC ───────────────────────────────────────────
export async function getCandidatsBac(filters = {}) {
  let q = supabase.from('candidats_bac').select('*').order('num_table');
  if (filters.centreId) q = q.eq('centre_id', filters.centreId);
  if (filters.etabId)   q = q.eq('etab_id',   filters.etabId);
  if (filters.serie)    q = q.eq('serie',      filters.serie);
  if (filters.search)   q = q.or(`matricule.ilike.%${filters.search}%,nom.ilike.%${filters.search}%,num_table.ilike.%${filters.search}%`);
  const { data, error } = await q;
  if (error) throw error; return data || [];
}
export async function addCandidatBac(c) {
  const { data, error } = await supabase.from('candidats_bac').insert(c).select().single();
  if (error) throw error; return data;
}
export async function updateCandidatBac(id, u) {
  const { data, error } = await supabase.from('candidats_bac')
    .update({...u, updated_at: new Date().toISOString()}).eq('id',id).select().single();
  if (error) throw error; return data;
}
export async function deleteCandidatBac(id) {
  const { error } = await supabase.from('candidats_bac').delete().eq('id',id);
  if (error) throw error;
}
export async function validerBac(id, userId) {
  const { data, error } = await supabase.from('candidats_bac')
    .update({ valide:true, valide_par:userId, valide_at:new Date().toISOString() })
    .eq('id',id).select().single();
  if (error) throw error; return data;
}
export async function deverrouillerBac(id) {
  const { data, error } = await supabase.from('candidats_bac')
    .update({ valide:false, valide_par:null, valide_at:null })
    .eq('id',id).select().single();
  if (error) throw error; return data;
}
export async function upsertCandidatsBac(list) {
  const { data, error } = await supabase.from('candidats_bac')
    .upsert(list, { onConflict:'matricule' }).select();
  if (error) throw error; return data;
}

// ─── NOTES BAC ───────────────────────────────────────────────
export async function getNotesBac(candidatId) {
  const { data, error } = await supabase.from('notes_bac')
    .select('*').eq('candidat_id', candidatId);
  if (error) throw error;
  const r = {};
  (data||[]).forEach(n => { r[n.matiere_id] = parseFloat(n.note); });
  return r;
}
export async function upsertNoteBac(candidatId, matiereId, note, userId) {
  const { error } = await supabase.from('notes_bac').upsert({
    candidat_id: candidatId,
    matiere_id:  matiereId,
    note:        note,
    saisie_par:  userId,
    updated_at:  new Date().toISOString()
  }, { onConflict:'candidat_id,matiere_id' });
  if (error) throw error;
}
export async function importNotesBac(rows) {
  const { error } = await supabase.from('notes_bac')
    .upsert(rows, { onConflict:'candidat_id,matiere_id' });
  if (error) throw error;
}

// ─── STORAGE PHOTOS ──────────────────────────────────────────
export async function uploadPhoto(file, matricule) {
  const ext  = file.name.split('.').pop();
  const path = `candidats/${matricule}.${ext}`;
  const { error } = await supabase.storage
    .from('photos-candidats').upload(path, file, { upsert:true });
  if (error) throw error;
  const { data } = supabase.storage.from('photos-candidats').getPublicUrl(path);
  return data.publicUrl;
}

// ─── PROFILS ─────────────────────────────────────────────────
export async function getProfiles() {
  const { data, error } = await supabase.from('profiles').select('*').order('nom');
  if (error) throw error; return data || [];
}
export async function updateProfile(id, u) {
  const { data, error } = await supabase.from('profiles').update(u).eq('id',id).select().single();
  if (error) throw error; return data;
}
export async function createUser(email, password, nom, role, centreId) {
  const { data, error } = await supabase.auth.admin.createUser({
    email, password,
    user_metadata: { nom, role },
    email_confirm: true
  });
  if (error) throw error;
  if (centreId) {
    await supabase.from('profiles')
      .update({ nom, role, centre_id: centreId })
      .eq('id', data.user.id);
  }
  return data;
}

// ─── EXPORTS MANQUANTS ───────────────────────────────────────
export async function getMatieresBepc() {
  const { data, error } = await supabase
    .from('matieres_bepc').select('*').order('ordre');
  if (error) throw error;
  return data || [];
}

export async function getMatieresBac(serie = null) {
  let q = supabase.from('matieres_bac').select('*').order('ordre');
  if (serie) q = q.eq('serie', serie);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

export async function addMatiereBepc(matiere) {
  const { data, error } = await supabase
    .from('matieres_bepc').insert(matiere).select().single();
  if (error) throw error;
  return data;
}supabase.js
