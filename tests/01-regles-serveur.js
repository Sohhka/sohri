// Tests des règles de sécurité Firestore (firebase/firestore.rules) sur l'émulateur, par l'API REST
// (celle qu'utilise l'appli). Usage : node 01-regles-serveur.js   (émulateurs lancés : auth 9099, firestore 8085)
const PROJECT = 'demo-sohri';
const AUTH = 'http://127.0.0.1:9099';
const FS = 'http://127.0.0.1:8085/v1/projects/' + PROJECT + '/databases/(default)/documents';
const ROOT = 'projects/' + PROJECT + '/databases/(default)/documents';

const results = [];
function check(ok, msg) { results.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + msg); }

function toValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (v instanceof Uint8Array) return { bytesValue: Buffer.from(v).toString('base64') };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
  return { mapValue: { fields: toFields(v) } };
}
function toFields(obj) { const f = {}; for (const k of Object.keys(obj)) f[k] = toValue(obj[k]); return f; }

async function signUp(email) {
  const r = await fetch(AUTH + '/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'motdepasse1', returnSecureToken: true })
  });
  const j = await r.json();
  return { uid: j.localId, token: j.idToken };
}
async function req(method, path, body, user) {
  const headers = { 'Content-Type': 'application/json' };
  if (user) headers.Authorization = 'Bearer ' + user.token;
  const r = await fetch(FS + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null;
  try { json = await r.json(); } catch (e) { /* vide */ }
  return { status: r.status, json };
}
// Écritures groupées : w = { set: [chemin, champs, { time: [champs horodatés], mask: [champs] }] } ou { del: chemin }
async function commit(user, writes) {
  const body = {
    writes: writes.map(w => {
      if (w.del) return { delete: ROOT + '/' + w.del };
      const [path, fields, opt = {}] = w.set;
      const write = { update: { name: ROOT + '/' + path, fields: toFields(fields) } };
      if (opt.mask) write.updateMask = { fieldPaths: opt.mask };
      if (opt.time) write.updateTransforms = opt.time.map(f => ({ fieldPath: f, setToServerValue: 'REQUEST_TIME' }));
      return write;
    })
  };
  return req('POST', ':commit', body, user);
}
const runQuery = (user, parent, query) => req('POST', (parent ? '/' + parent : '') + ':runQuery', { structuredQuery: query }, user);
const eq = (field, value) => ({ fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: toValue(value) } });
const ok = r => r.status === 200;
const denied = r => r.status === 403;

(async () => {
  await fetch('http://127.0.0.1:8085/emulator/v1/projects/' + PROJECT + '/databases/(default)/documents', { method: 'DELETE' });
  await fetch(AUTH + '/emulator/v1/projects/' + PROJECT + '/accounts', { method: 'DELETE' });

  const A = await signUp('a@exemple.fr');
  const B = await signUp('b@exemple.fr');
  const C = await signUp('c@exemple.fr'); // compte sans profil (pas invité)
  const D = await signUp('d@exemple.fr');

  // ---------- Inscription ----------
  const profile = (name, code, by, withCode) => ['users/' + name.uid, { name: name.label, code, invitedBy: by, invitedWith: withCode }, { time: ['createdAt'] }];
  A.label = 'Alice'; B.label = 'Bruno'; C.label = 'Chloé'; D.label = 'Denis';
  check(ok(await req('GET', '/meta/bootstrap')) === false, 'avant tout : pas de premier compte');
  check(ok(await commit(A, [{ set: profile(A, 'AAAA-2222', null, null) }, { set: ['codes/AAAA-2222', { uid: A.uid, name: 'Alice' }] }, { set: ['meta/bootstrap', { uid: A.uid }] }])),
    'premier compte : créé sans invitation (ouvre le projet)');
  check(denied(await commit(C, [{ set: profile(C, 'CCCC-3333', null, null) }, { set: ['codes/CCCC-3333', { uid: C.uid, name: 'Chloé' }] }, { set: ['meta/bootstrap', { uid: C.uid }] }])),
    'second « premier compte » : refusé');
  check(denied(await commit(C, [{ set: profile(C, 'CCCC-3333', null, null) }, { set: ['codes/CCCC-3333', { uid: C.uid, name: 'Chloé' }] }])),
    'inscription sans code d\'invitation : refusée');
  check(denied(await commit(C, [{ set: profile(C, 'CCCC-3333', A.uid, 'ZZZZ-9999') }, { set: ['codes/CCCC-3333', { uid: C.uid, name: 'Chloé' }] }])),
    'inscription avec un code inexistant : refusée');
  check(denied(await commit(C, [{ set: profile(C, 'CCCC-3333', D.uid, 'AAAA-2222') }, { set: ['codes/CCCC-3333', { uid: C.uid, name: 'Chloé' }] }])),
    'code valable mais mauvais parrain : refusé');
  check(denied(await commit(B, [{ set: profile(B, 'AAAA-2222', A.uid, 'AAAA-2222') }, { set: ['codes/AAAA-2222', { uid: B.uid, name: 'Bruno' }] }])),
    'reprendre le code d\'un autre : refusé');
  check(denied(await commit(B, [{ set: profile(B, 'BBBB-4444', A.uid, 'AAAA-2222') }])),
    'profil sans son code personnel : refusé');
  check(ok(await commit(B, [
    { set: profile(B, 'BBBB-4444', A.uid, 'AAAA-2222') },
    { set: ['codes/BBBB-4444', { uid: B.uid, name: 'Bruno' }] },
    { set: ['users/' + B.uid + '/contacts/' + A.uid, { name: 'Alice', code: 'AAAA-2222' }, { time: ['addedAt'] }] }
  ])), 'invité avec le code d\'Alice : inscrit, Alice dans ses contacts');
  check(ok(await commit(D, [{ set: profile(D, 'DDDD-5555', B.uid, 'BBBB-4444') }, { set: ['codes/DDDD-5555', { uid: D.uid, name: 'Denis' }] }])),
    'invité par un invité : inscrit');

  // ---------- Codes et profils ----------
  const code = await req('GET', '/codes/AAAA-2222');
  check(ok(code) && code.json.fields.uid.stringValue === A.uid, 'code : lisible sans compte (pour vérifier une invitation)');
  check(denied(await req('GET', '/codes')), 'liste des codes : refusée');
  check(denied(await req('GET', '/users/' + A.uid)), 'profil : illisible sans compte');
  check(denied(await req('GET', '/users/' + A.uid, null, C)), 'profil : illisible pour un non-membre');
  check(ok(await req('GET', '/users/' + A.uid, null, B)), 'profil : lisible par un membre');
  check(denied(await runQuery(B, null, { from: [{ collectionId: 'users' }] })), 'liste de tous les membres : refusée');
  const invitees = await runQuery(A, null, { from: [{ collectionId: 'users' }], where: eq('invitedBy', A.uid) });
  check(ok(invitees) && invitees.json.filter(x => x.document).length === 1, 'Alice retrouve les proches inscrits avec son code');
  check(denied(await runQuery(B, null, { from: [{ collectionId: 'users' }], where: eq('invitedBy', A.uid) })), '… mais pas ceux d\'un autre');
  check(ok(await commit(A, [{ set: ['users/' + A.uid, { name: 'Alice M.' }, { mask: ['name'] }] }])), 'changer son nom : permis');
  check(denied(await commit(A, [{ set: ['users/' + A.uid, { code: 'QQQQ-2222' }, { mask: ['code'] }] }])), 'changer son code dans le profil : refusé');
  check(denied(await commit(B, [{ set: ['users/' + A.uid, { name: 'Pirate' }, { mask: ['name'] }] }])), 'modifier le profil d\'un autre : refusé');
  check(denied(await req('GET', '/users/' + B.uid + '/contacts', null, A)), 'contacts d\'un autre : illisibles');

  // ---------- Contenu ----------
  const thumb = new Uint8Array(30000).fill(7);
  const photo = (album, extra) => Object.assign({ album, takenAt: 1700000000000, width: 1600, height: 1200, thumb, parts: 1, size: 400000 }, extra || {});
  check(ok(await commit(A, [
    { set: ['users/' + A.uid + '/albums/a1', { name: 'Tokyo', icon: '🗼' }, { time: ['updatedAt'] }] },
    { set: ['users/' + A.uid + '/photos/p1', photo('a1'), { time: ['updatedAt'] }] },
    { set: ['users/' + A.uid + '/photoParts/p1-0', { photo: 'p1', index: 0, data: new Uint8Array(400000).fill(1) }] }
  ])), 'Alice publie un album et une photo dans son espace');
  check(denied(await commit(B, [{ set: ['users/' + A.uid + '/albums/x', { name: 'Intrus', icon: '😈' }, { time: ['updatedAt'] }] }])), 'écrire dans l\'espace d\'Alice : refusé');
  check(denied(await commit(C, [{ set: ['users/' + C.uid + '/albums/x', { name: 'X', icon: '📁' }, { time: ['updatedAt'] }] }])), 'non-membre : ne peut rien stocker');
  check(denied(await commit(A, [{ set: ['users/' + A.uid + '/photoParts/p2-0', { photo: 'p2', index: 0, data: new Uint8Array(960000) }] }])), 'morceau de photo trop gros : refusé');
  check(denied(await commit(A, [{ set: ['users/' + A.uid + '/photos/p3', photo('a1', { thumb: new Uint8Array(210000) }), { time: ['updatedAt'] }] }])), 'miniature trop grosse : refusée');
  check(denied(await commit(A, [{ set: ['users/' + A.uid + '/photos/p3', photo('a1', { secret: 'x' }), { time: ['updatedAt'] }] }])), 'champ inconnu : refusé');
  check(denied(await commit(A, [{ set: ['users/' + A.uid + '/albums/a2', { name: 'Kyoto', icon: '⛩️', updatedAt: new Date(0) }] }])), 'date falsifiée : refusée');

  // ---------- Partage ----------
  const photosOfA = () => runQuery(B, 'users/' + A.uid, { from: [{ collectionId: 'photos' }] });
  check(denied(await photosOfA()), 'Bruno : photos d\'Alice illisibles avant partage');
  check(denied(await req('GET', '/users/' + A.uid + '/photoParts/p1-0', null, B)), 'Bruno : contenu des photos illisible avant partage');
  const grant = (owner, to, categories, id) => ['grants/' + (id || owner.uid + '_' + to), { owner: owner.uid, to, ownerName: owner.label, categories }, { time: ['updatedAt'] }];
  check(denied(await commit(A, [{ set: grant(A, B.uid, ['albums'], A.uid + '_' + D.uid) }])), 'partage mal identifié : refusé');
  check(denied(await commit(A, [{ set: grant(A, B.uid, ['albums', 'secrets']) }])), 'rubrique inconnue : refusée');
  check(denied(await commit(A, [{ set: grant(A, 'inconnu123', ['albums']) }])), 'partage à un inconnu : refusé');
  check(denied(await commit(B, [{ set: grant(A, B.uid, ['albums']) }])), 'se donner soi-même accès aux albums d\'Alice : refusé');
  check(ok(await commit(A, [{ set: grant(A, B.uid, ['albums']) }])), 'Alice partage ses Images avec Bruno');
  const list = await photosOfA();
  check(ok(list) && list.json.filter(x => x.document).length === 1, 'Bruno : voit la photo d\'Alice');
  check(ok(await req('GET', '/users/' + A.uid + '/photoParts/p1-0', null, B)), 'Bruno : peut télécharger la photo');
  check(denied(await runQuery(D, 'users/' + A.uid, { from: [{ collectionId: 'photos' }] })), 'Denis (pas invité au partage) : ne voit rien');
  const mine = await runQuery(B, null, { from: [{ collectionId: 'grants' }], where: eq('to', B.uid) });
  check(ok(mine) && mine.json.filter(x => x.document).length === 1, 'Bruno : retrouve les partages qui lui sont destinés');
  check(denied(await runQuery(B, null, { from: [{ collectionId: 'grants' }] })), 'liste de tous les partages : refusée');
  check(denied(await runQuery(D, null, { from: [{ collectionId: 'grants' }], where: eq('to', B.uid) })), 'partages destinés à un autre : illisibles');
  check(denied(await commit(B, [{ set: ['users/' + A.uid + '/photos/p1', photo('a1'), { time: ['updatedAt'] }] }])), 'Bruno ne peut pas modifier les photos partagées');

  // ---------- Toutes mes rubriques entre mes appareils (syncAll) ----------
  check(ok(await commit(A, [{ set: ['users/' + A.uid, { syncAll: true }, { mask: ['syncAll'] }] }])), 'Alice synchronise toutes ses rubriques (réglage du compte)');
  check(denied(await commit(A, [{ set: ['users/' + A.uid, { syncAll: 'oui' }, { mask: ['syncAll'] }] }])), 'réglage syncAll qui n\'est pas oui/non : refusé');
  const H1 = 'a'.repeat(64);
  const H2 = 'b'.repeat(64);
  const item = (kind, extra) => Object.assign({ kind, data: JSON.stringify({ title: 'Ma note', body: 'Texte secret' }), blobs: [H1] }, extra || {});
  const ipath = id => 'users/' + A.uid + '/items/' + id;
  check(ok(await commit(A, [
    { set: ['users/' + A.uid + '/blobParts/' + H1 + '-0', { data: new Uint8Array(900 * 1024).fill(3) }] },
    { set: ['users/' + A.uid + '/blobParts/' + H1 + '-1', { data: new Uint8Array(1000).fill(3) }] }
  ])), 'Alice envoie les morceaux d\'un fichier');
  check(ok(await commit(A, [{ set: ['users/' + A.uid + '/blobs/' + H1, { size: 900 * 1024 + 1000, type: 'image/jpeg', parts: 2 }, { time: ['createdAt'] }] }])), '… puis sa description');
  check(ok(await commit(A, [{ set: [ipath('nabc'), item('note'), { time: ['updatedAt'] }] }])), 'Alice envoie une note (description en JSON, empreintes de ses fichiers)');
  check(ok(await commit(A, [{ set: [ipath('lxyz'), item('address', { blobs: [] }), { time: ['updatedAt'] }] }])), '… une adresse');
  check(ok(await commit(A, [{ set: [ipath('fdef'), item('folder', { blobs: [] }), { time: ['updatedAt'] }] }, { set: [ipath('d1-2'), item('document'), { time: ['updatedAt'] }] }])), '… un dossier et un document');
  check(ok(await commit(A, [{ set: [ipath('e1'), item('expense', { data: JSON.stringify({ amount: 980, currency: 'JPY', rate: 184.5, category: 'repas' }), blobs: [] }), { time: ['updatedAt'] }] }])), '… une dépense');
  check(ok(await commit(A, [{ set: [ipath('v1'), item('event', { data: JSON.stringify({ title: 'Check-in', date: '2026-10-15', time: '15:00', address: 'lxyz' }) }), { time: ['updatedAt'] }] }])), '… une étape du programme (avec son billet)');
  check(denied(await commit(A, [{ set: [ipath('n2'), item('photo'), { time: ['updatedAt'] }] }])), 'élément d\'un type inconnu : refusé');
  check(denied(await commit(A, [{ set: [ipath('n2'), item('note', { secret: 1 }), { time: ['updatedAt'] }] }])), 'élément avec un champ inconnu : refusé');
  check(denied(await commit(A, [{ set: [ipath('n2'), item('note', { updatedAt: new Date(0) })] }])), 'élément antidaté : refusé');
  check(denied(await commit(A, [{ set: [ipath('n2'), { kind: 'note', data: '{}' }, { time: ['updatedAt'] }] }])), 'élément sans ses empreintes de fichiers : refusé');
  check(denied(await commit(A, [{ set: [ipath('n2'), item('note', { data: 'x'.repeat(900001) }), { time: ['updatedAt'] }] }])), 'élément trop gros : refusé');
  check(denied(await commit(A, [{ set: [ipath('n'.repeat(81)), item('note'), { time: ['updatedAt'] }] }])), 'identifiant trop long : refusé');
  check(denied(await commit(A, [{ set: ['users/' + A.uid + '/blobs/pas-une-empreinte', { size: 10, type: '', parts: 1 }, { time: ['createdAt'] }] }])), 'fichier mal nommé : refusé');
  check(denied(await commit(A, [{ set: ['users/' + A.uid + '/blobs/' + H2, { size: 70 * 1024 * 1024, type: '', parts: 70 }, { time: ['createdAt'] }] }])), 'fichier de plus de 60 Mo : refusé');
  check(denied(await commit(A, [{ set: ['users/' + A.uid + '/blobs/' + H2, { size: 10, type: '', parts: 71 }, { time: ['createdAt'] }] }])), 'fichier en trop de morceaux : refusé');
  check(denied(await commit(A, [{ set: ['users/' + A.uid + '/blobs/' + H2, { size: 10, type: '', parts: 1, createdAt: new Date(0) }] }])), 'fichier antidaté : refusé');
  check(denied(await commit(A, [{ set: ['users/' + A.uid + '/blobParts/' + H2 + '-0', { data: new Uint8Array(960000) }] }])), 'morceau de fichier trop gros : refusé');
  check(denied(await commit(A, [{ set: ['users/' + A.uid + '/blobParts/' + H2 + '-0', { data: new Uint8Array(10), photo: 'x' }] }])), 'morceau avec un champ inconnu : refusé');
  check(denied(await commit(A, [{ set: ['users/' + A.uid + '/blobParts/autre-0', { data: new Uint8Array(10) }] }])), 'morceau mal nommé : refusé');
  const itemsOfA = user => runQuery(user, 'users/' + A.uid, { from: [{ collectionId: 'items' }] });
  const mineItems = await itemsOfA(A);
  check(ok(mineItems) && mineItems.json.filter(x => x.document).length === 6, 'Alice relit ses éléments (depuis un autre appareil)');
  check(ok(await req('GET', '/users/' + A.uid + '/blobParts/' + H1 + '-0', null, A)), 'Alice télécharge ses fichiers');
  check(denied(await itemsOfA(B)), 'Bruno (qui voit ses Images) : ne voit pas ses autres rubriques');
  check(denied(await req('GET', '/' + ipath('nabc'), null, B)), 'Bruno : note d\'Alice illisible');
  check(denied(await req('GET', '/users/' + A.uid + '/blobs/' + H1, null, B)), 'Bruno : fichiers d\'Alice illisibles');
  check(denied(await req('GET', '/users/' + A.uid + '/blobParts/' + H1 + '-0', null, B)), 'Bruno : contenu des fichiers d\'Alice illisible');
  check(denied(await itemsOfA(D)), 'Denis : rien non plus');

  // ---------- Rubriques partagées en lecture (programme, adresses, notes, documents) ----------
  const kindOfA = (user, kind, select) => runQuery(user, 'users/' + A.uid, Object.assign({ from: [{ collectionId: 'items' }], where: eq('kind', kind) }, select ? { select: { fields: [{ fieldPath: 'updatedAt' }] } } : {}));
  const docs = r => r.json.filter(x => x.document).length;
  check(denied(await commit(A, [{ set: grant(A, B.uid, ['albums', 'expenses']) }])), 'partager ses dépenses : impossible');
  check(denied(await commit(A, [{ set: grant(A, B.uid, ['albums', 'schedule', 'addresses', 'notes', 'documents', 'secrets']) }])), 'rubrique inconnue avec les autres : refusée');
  check(ok(await commit(A, [{ set: grant(A, B.uid, ['albums', 'schedule', 'addresses']) }])), 'Alice partage aussi son programme et son carnet d\'adresses avec Bruno');
  const evB = await kindOfA(B, 'event', true);
  check(ok(evB) && docs(evB) === 1 && ok(await kindOfA(B, 'address')), 'Bruno : liste le programme et les adresses d\'Alice');
  check(ok(await req('GET', '/' + ipath('v1'), null, B)), 'Bruno : lit une étape du programme');
  check(denied(await kindOfA(B, 'note')) && denied(await kindOfA(B, 'expense')) && denied(await kindOfA(B, 'folder')), 'Bruno : ni ses notes, ni ses dépenses, ni ses dossiers (pas partagés)');
  check(denied(await req('GET', '/' + ipath('nabc'), null, B)) && denied(await req('GET', '/' + ipath('e1'), null, B)), 'Bruno : une note ou une dépense d\'Alice, même par son nom : illisible');
  check(denied(await itemsOfA(B)), 'Bruno : la liste de tous les éléments d\'Alice reste refusée');
  check(ok(await req('GET', '/users/' + A.uid + '/blobs/' + H1, null, B)) && ok(await req('GET', '/users/' + A.uid + '/blobParts/' + H1 + '-0', null, B)), 'Bruno : télécharge un fichier par son empreinte (billet d\'une étape)');
  check(denied(await runQuery(B, 'users/' + A.uid, { from: [{ collectionId: 'blobs' }] })), 'Bruno : la liste des fichiers d\'Alice reste refusée');
  check(denied(await req('GET', '/users/' + A.uid + '/blobs/' + H1, null, D)), 'Denis (rien de partagé) : aucun fichier d\'Alice');
  check(denied(await commit(B, [{ set: [ipath('v1'), item('event'), { time: ['updatedAt'] }] }])), 'Bruno : ne peut pas modifier le programme d\'Alice');
  check(ok(await commit(A, [{ set: grant(A, B.uid, ['albums', 'notes']) }])), 'Alice partage ses notes, plus son programme');
  check(ok(await kindOfA(B, 'note')) && ok(await kindOfA(B, 'folder')) && denied(await kindOfA(B, 'event')), 'Bruno : notes et dossiers lisibles, le programme ne l\'est plus');
  check(ok(await commit(A, [{ set: grant(A, B.uid, ['albums']) }])), 'Alice ne partage plus que ses Images');
  check(denied(await kindOfA(B, 'note')) && denied(await req('GET', '/users/' + A.uid + '/blobs/' + H1, null, B)), 'Bruno : plus rien d\'autre que les Images');

  check(denied(await commit(B, [{ set: [ipath('nabc'), item('note'), { time: ['updatedAt'] }] }])), 'Bruno : ne peut pas écrire dans les rubriques d\'Alice');
  check(denied(await commit(B, [{ del: ipath('nabc') }])), 'Bruno : ne peut rien y effacer');
  check(denied(await commit(C, [{ set: ['users/' + C.uid + '/items/n1', item('note'), { time: ['updatedAt'] }] }])), 'non-membre : ne peut rien synchroniser');
  check(ok(await commit(A, [{ set: [ipath('nabc'), { deleted: true }, { time: ['updatedAt'] }] }])), 'Alice supprime une note (trace pour ses autres appareils)');
  check(ok(await commit(A, [{ del: 'users/' + A.uid + '/blobs/' + H1 }, { del: 'users/' + A.uid + '/blobParts/' + H1 + '-0' }, { del: 'users/' + A.uid + '/blobParts/' + H1 + '-1' }])),
    'Alice efface un fichier devenu inutile');
  check(ok(await commit(A, [{ set: ['users/' + A.uid, { syncAll: false }, { mask: ['syncAll'] }] }])), 'Alice arrête la synchronisation');

  // ---------- Espace occupé en ligne (mesuré par chaque compte, vu par ses proches) ----------
  check(ok(await commit(A, [{ set: ['users/' + A.uid, { usageBytes: 123456 }, { mask: ['usageBytes'], time: ['usageAt'] }] }])), 'Alice note l\'espace qu\'elle occupe en ligne');
  const seenByB = await req('GET', '/users/' + A.uid, null, B);
  check(ok(seenByB) && seenByB.json.fields.usageBytes.integerValue === '123456' && !!seenByB.json.fields.usageAt.timestampValue, 'Bruno (membre) voit l\'espace occupé par Alice');
  check(denied(await commit(A, [{ set: ['users/' + A.uid, { usageBytes: -1 }, { mask: ['usageBytes'] }] }])), 'espace négatif : refusé');
  check(denied(await commit(A, [{ set: ['users/' + A.uid, { usageBytes: 'beaucoup' }, { mask: ['usageBytes'] }] }])), 'espace qui n\'est pas un nombre : refusé');
  check(denied(await commit(A, [{ set: ['users/' + A.uid, { usageAt: 'hier' }, { mask: ['usageAt'] }] }])), 'date de mesure qui n\'est pas une date : refusée');
  check(denied(await commit(B, [{ set: ['users/' + A.uid, { usageBytes: 0 }, { mask: ['usageBytes'] }] }])), 'Bruno ne peut pas changer l\'espace d\'Alice');

  // ---------- Descriptions et commentaires ----------
  check(ok(await commit(A, [{ set: ['users/' + A.uid + '/photos/p1', { caption: 'Premier soir à Shibuya 🌃' }, { mask: ['caption'], time: ['updatedAt'] }] }])), 'Alice ajoute une description');
  check(denied(await commit(A, [{ set: ['users/' + A.uid + '/photos/p1', { caption: 'x'.repeat(2001) }, { mask: ['caption'], time: ['updatedAt'] }] }])), 'description trop longue : refusée');
  check(ok(await commit(A, [{ set: ['users/' + A.uid + '/photos/p1', { location: 'Tokyo, Japon' }, { mask: ['location'], time: ['updatedAt'] }] }])), 'Alice ajoute un lieu');
  check(denied(await commit(A, [{ set: ['users/' + A.uid + '/photos/p1', { location: 'x'.repeat(101) }, { mask: ['location'], time: ['updatedAt'] }] }])), 'lieu trop long : refusé');
  const comment = (who, text, extra) => Object.assign({ photo: 'p1', author: who.uid, authorName: who.label, text }, extra || {});
  const cpath = id => 'users/' + A.uid + '/comments/' + id;
  check(ok(await commit(B, [{ set: [cpath('c1'), comment(B, 'Magnifique !'), { time: ['createdAt', 'updatedAt'] }] }])), 'Bruno commente la photo partagée');
  check(ok(await commit(A, [{ set: [cpath('c2'), comment(A, '@Bruno merci !'), { time: ['createdAt', 'updatedAt'] }] }])), 'Alice répond');
  check(denied(await commit(B, [{ set: [cpath('c3'), comment(A, 'Je suis Alice'), { time: ['createdAt', 'updatedAt'] }] }])), 'commenter au nom d\'un autre : refusé');
  check(denied(await commit(D, [{ set: [cpath('c4'), comment(D, 'Coucou'), { time: ['createdAt', 'updatedAt'] }] }])), 'Denis (pas de partage) : ne peut pas commenter');
  check(denied(await commit(B, [{ set: [cpath('c5'), comment(B, 'Où ?', { photo: 'inexistante' }), { time: ['createdAt', 'updatedAt'] }] }])), 'commentaire sur une photo inexistante : refusé');
  check(denied(await commit(B, [{ set: [cpath('c6'), comment(B, 'x'.repeat(1001)), { time: ['createdAt', 'updatedAt'] }] }])), 'commentaire trop long : refusé');
  check(denied(await commit(B, [{ set: [cpath('c7'), comment(B, 'Hier', { createdAt: new Date(0), updatedAt: new Date(0) })] }])), 'commentaire antidaté : refusé');
  const readComments = user => runQuery(user, 'users/' + A.uid, { from: [{ collectionId: 'comments' }] });
  const seen = await readComments(B);
  check(ok(seen) && seen.json.filter(x => x.document).length === 2, 'Bruno lit les commentaires de la photo');
  check(denied(await readComments(D)), 'Denis ne lit pas les commentaires');
  check(denied(await commit(B, [{ set: [cpath('c2'), { text: 'modifié' }, { mask: ['text'] }] }])), 'modifier le commentaire d\'Alice : refusé');
  check(denied(await commit(B, [{ set: [cpath('c1'), comment(B, 'Texte changé'), { time: ['createdAt', 'updatedAt'] }] }])), 'réécrire son propre commentaire : refusé (seule la suppression est permise)');
  check(denied(await commit(D, [{ set: [cpath('c1'), { deleted: true, photo: 'p1' }, { time: ['updatedAt'] }] }])), 'supprimer le commentaire d\'un autre (sans être le propriétaire) : refusé');
  check(denied(await commit(B, [{ set: [cpath('c2'), { deleted: true, photo: 'p1' }, { time: ['updatedAt'] }] }])), 'Bruno supprime la réponse d\'Alice : refusé');
  check(denied(await commit(B, [{ set: [cpath('c1'), { deleted: true, photo: 'autre' }, { time: ['updatedAt'] }] }])), 'trace de suppression qui change de photo : refusée');
  check(ok(await commit(B, [{ set: [cpath('c1'), { deleted: true, photo: 'p1' }, { time: ['updatedAt'] }] }])), 'Bruno supprime son commentaire');
  check(ok(await commit(B, [{ set: [cpath('c8'), comment(B, 'Encore bravo'), { time: ['createdAt', 'updatedAt'] }] }])), 'Bruno recommente');
  check(ok(await commit(A, [{ set: [cpath('c8'), { deleted: true, photo: 'p1' }, { time: ['updatedAt'] }] }])), 'Alice supprime un commentaire sur sa photo');
  check(ok(await commit(A, [{ set: ['users/' + A.uid + '/photos/p1', { deleted: true }, { time: ['updatedAt'] }] }, { del: 'users/' + A.uid + '/photoParts/p1-0' }])),
    'Alice supprime la photo (trace « supprimée » pour les proches)');
  check(ok(await commit(A, [{ set: grant(A, B.uid, []) }])), 'Alice arrête de partager ses Images');
  check(denied(await photosOfA()), 'Bruno : plus d\'accès');

  // ---------- Suppression d'un compte ----------
  check(ok(await commit(D, [{ del: 'codes/DDDD-5555' }, { del: 'users/' + D.uid }])), 'Denis supprime son compte (profil et code)');
  check(denied(await commit(D, [{ set: ['users/' + D.uid + '/albums/x', { name: 'X', icon: '📁' }, { time: ['updatedAt'] }] }])), 'compte supprimé : plus rien à stocker');
  check(denied(await commit(B, [{ del: 'codes/AAAA-2222' }])), 'supprimer le code d\'un autre : refusé');

  console.log(`\n${results.filter(Boolean).length}/${results.length} vérifications réussies`);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
