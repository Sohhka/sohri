# SOHRI

Appli pour un voyage au Japon, sur **Android** (APK) et sur **iPhone** (version web installable,
**https://sohhka.github.io/sohri/**) :

- **Convertisseur ¥ → €**, avec un taux modifiable et mémorisé.
- **Notes** rangées dans des **dossiers** (Tokyo, Réservations…), avec mise en forme (titres, gras,
  listes, **cases à cocher**…), **emojis**, photos, **pièces jointes** (PDF de billets…), liées à une
  adresse. Export d'une note en fichier `.md`.
- **Carnet d'adresses** par catégories (hébergement, restaurant, à visiter…) : itinéraire Google Maps,
  adresse en japonais à **montrer au chauffeur de taxi**, téléphone, site web, pièces jointes, notes liées.
- **Images** : des albums (« Tokyo », « Shibuya »…) pour ranger ses photos, classées par jour de prise de vue.
- **Documents** : tous ses fichiers (PDF, images, vidéos, sons, textes…) rangés dans des dossiers
  et **affichés directement dans l'appli**.
- **Partage** (facultatif) : avec un compte, montrer ses **Images** aux proches de son choix, qui
  les voient dans leur appli, même hors connexion une fois reçues.
- **Paramètres** : thème **clair**, **sombre** ou automatique ; **sauvegarde** complète dans un fichier,
  et restauration.

Tout fonctionne hors connexion et les données restent sur le téléphone. Sans compte, l'appli ne
contacte aucun serveur : l'accès à Internet ne sert qu'au partage entre proches.

## Installer l'appli sur Android

1. Copier `dist/Sohri-1.4.apk` sur le téléphone (câble USB, Google Drive, e-mail…), ou le
   télécharger depuis la page [Releases](https://github.com/Sohhka/sohri/releases/latest) du dépôt.
2. L'ouvrir depuis le téléphone. Android demande d'autoriser l'installation d'applis depuis cette
   source (Fichiers, Drive…) : accepter.
3. Si Play Protect signale une appli inconnue, choisir d'installer quand même : c'est normal pour
   une appli qui ne vient pas du Play Store.

Il faut Android 8.0 ou plus récent. Une nouvelle version s'installe **par-dessus** l'ancienne :
notes, adresses, images et documents sont conservés.

## Installer l'appli sur l'iPhone

1. Ouvrir **https://sohhka.github.io/sohri/** dans **Safari**, avec Internet.
2. Toucher **Partager** (le carré avec une flèche ; selon la version d'iOS, d'abord •••), puis
   **Sur l'écran d'accueil**, puis **Ajouter**.
3. Ouvrir SOHRI depuis sa nouvelle icône, **une première fois avec Internet** : l'appli se copie
   sur l'iPhone. Elle fonctionne ensuite **hors connexion**, en plein écran, comme une vraie appli.

À savoir :

- Les données restent sur l'iPhone, **dans l'appli installée** : elles sont séparées de celles de
  Safari et de celles de l'appli Android. Pour passer de l'un à l'autre : **Créer une sauvegarde**
  d'un côté, **Restaurer une sauvegarde** de l'autre (le fichier `.zip` passe par iCloud Drive,
  Google Drive, AirDrop, e-mail…).
- « Partager », « Ouvrir avec une autre appli » et « Enregistrer sous… » passent par la feuille de
  partage de l'iPhone (Enregistrer dans Fichiers, AirDrop, Mail…).
- Les mises à jour arrivent toutes seules : quand une nouvelle version est en ligne, un bandeau
  « Mettre à jour » s'affiche dans l'appli (il faut Internet à ce moment-là).
- Supprimer l'icône de l'écran d'accueil efface les données de l'appli : faire une sauvegarde avant.
- La navigation privée de Safari n'enregistre pas les fichiers (photos, documents) : utiliser
  l'appli installée.
- Il faut un iOS récent (16.4 ou plus). La version web marche aussi dans Chrome sur Android ou sur
  un ordinateur.

## Écrire une note

La barre en bas de l'éditeur met en forme sans connaître la syntaxe : 😀 emoji, **B** gras,
*I* italique, ~~S~~ barré, **H** titre, • liste, 1. liste numérotée, ☑ case à cocher, ❝ citation,
code, 🔗 lien, ― séparateur. L'onglet « Aperçu » montre le résultat.

Le texte est enregistré en [markdown](https://www.markdownguide.org/basic-syntax/) : on peut aussi
taper directement `**gras**`, `# Titre`, `- [ ] à faire`… Dans une liste, « Entrée » prépare
l'élément suivant ; « Entrée » sur un élément vide termine la liste. Dans une note affichée, les
cases se cochent d'un simple toucher.

## Documents

Le bouton **+** ajoute un ou plusieurs fichiers (depuis le téléphone, Google Drive…) dans le dossier
ouvert. Toucher un fichier l'affiche dans l'appli :

| Type                                  | Affichage                                                              |
|---------------------------------------|------------------------------------------------------------------------|
| **PDF**                               | pages à faire défiler, zoom à deux doigts, double toucher ou boutons + / − ; texte japonais compris |
| **Images** (JPG, PNG, GIF, WebP…)     | zoom à deux doigts, double toucher ou boutons + / −                    |
| **Vidéos** (MP4, WebM…)               | lecteur intégré, plein écran possible                                  |
| **Sons** (MP3, M4A, WAV, OGG…)        | lecteur intégré                                                        |
| **Textes** (TXT, CSV…) et **Markdown** | texte (encodages japonais reconnus) ou mis en forme                   |
| Autres (Word, Excel, HEIC…)           | bouton « Ouvrir avec une autre appli »                                 |

Le menu ⋮ d'un fichier permet de le partager, de l'ouvrir avec une autre appli, de l'enregistrer
ailleurs, de le renommer, de le déplacer ou de le supprimer. Les pièces jointes des notes et des
adresses s'ouvrent dans la même visionneuse.

## Sauvegarder ses données

Paramètres → **Créer une sauvegarde** enregistre tout (notes, adresses, images, documents, pièces jointes) dans
un fichier `SOHRI-sauvegarde-AAAA-MM-JJ.zip`, à ranger par exemple sur Google Drive ou iCloud Drive.
**Restaurer une sauvegarde** remplace alors toutes les données de l'appli par celles du fichier. Une
sauvegarde faite sur Android se restaure sur l'iPhone, et inversement.

À faire avant le départ et de temps en temps pendant le voyage : désinstaller l'appli, ou
« Vider le stockage » dans les paramètres Android (sur iPhone : supprimer l'icône), efface tout.

## Partager avec ses proches (facultatif)

Sans compte, rien ne change : l'appli reste entièrement hors connexion. Avec un compte (menu
**Partage**), on choisit quelles rubriques montrer, et à qui. Pour l'instant : les **Images**
(albums et photos).

1. **Créer un compte** : prénom (ce que voient les proches), adresse e-mail et mot de passe (pour se
   connecter ; l'adresse n'est montrée à personne), et **code d'invitation** : le code d'un proche
   déjà inscrit. Seul le tout premier compte n'en a pas besoin.
2. Chaque compte a un **code** (par exemple `K7F2-9QX4`) : **Inviter** l'envoie par SMS, WhatsApp,
   e-mail… Un proche inscrit avec ce code arrive tout seul dans les contacts ; sinon, **Ajouter un
   contact** avec son code.
3. **Ce que je partage → Images** : cocher les proches qui peuvent voir les albums. Les photos
   partent réduites (1600 pixels) vers le serveur, dans l'ordre, dès qu'il y a Internet ; les
   ajouts, suppressions et changements de nom suivent tout seuls.
4. Chez le proche, **Partagés avec moi** : les albums (en lecture seule) sont copiés sur son
   téléphone et restent consultables **hors connexion**. Les nouveautés arrivent quand il ouvre
   l'appli avec Internet.

Ça marche entre la version web (iPhone) et l'appli Android : le compte est le même partout.

À savoir :

- Seules les rubriques partagées quittent le téléphone. Arrêter tous les partages d'une rubrique
  efface ses photos du serveur ; **Supprimer mon compte** efface tout ce qui est en ligne (les
  données du téléphone restent).
- Serveur : Firebase (Google), formule gratuite, sans carte bancaire : 1 Go pour tout le monde,
  soit environ 3 000 photos partagées. Au-delà, les nouveaux envois sont refusés (aucune facture
  possible).
- Si le compte est ouvert sur plusieurs appareils, un seul envoie les photos (celui où le partage
  a été activé) ; « Envoyer plutôt celles de cet appareil » change d'appareil.
- **Se déconnecter** retire du téléphone ce que les proches y avaient partagé ; tout revient à la
  reconnexion.

## Organisation du dossier

```
Sohri/
├── www/                     L'appli elle-même (HTML, CSS, JavaScript) : c'est ici qu'on la modifie
│   ├── index.html           toutes les vues
│   ├── css/style.css        styles, thèmes clair et sombre
│   ├── manifest.webmanifest version web : nom, icônes, plein écran
│   ├── sw.js                version web : copie hors connexion et mises à jour (service worker)
│   ├── icons/               icônes de la version web (écran d'accueil de l'iPhone...)
│   └── js/
│       ├── db.js            stockage local (IndexedDB)
│       ├── ui.js            boîtes de dialogue, menus du bas, visionneuse photo, carte taxi
│       ├── router.js        navigation entre les vues (bouton ←, retour d'Android)
│       ├── emoji.js         sélecteur d'emojis
│       ├── markdown.js      affichage mis en forme et barre de mise en forme
│       ├── files.js         photos, pièces jointes, envoi de fichiers à Android ou à la
│       │                    feuille de partage de l'iPhone
│       ├── docviewer.js     visionneuse de documents (PDF, image, vidéo, son, texte)
│       ├── folders.js       dossiers (notes, documents) et albums
│       ├── converter.js     convertisseur ¥ → €
│       ├── notes.js         notes
│       ├── addresses.js     carnet d'adresses
│       ├── gallery.js       Images : albums et photos
│       ├── documents.js     Documents : fichiers et dossiers
│       ├── backup.js        sauvegarde et restauration (.zip)
│       ├── settings.js      Paramètres
│       ├── cloud.js         partage : comptes, contacts, envoi et réception (API de Firebase)
│       ├── sharing.js       partage : écrans (compte, contacts, albums reçus)
│       ├── cloud-config.js  projet Firebase (local, jamais dans le dépôt : voir plus bas)
│       ├── app.js           menu, bouton retour, version web (hors connexion, mises à jour,
│       │                    clavier de l'iPhone), démarrage
│       └── vendor/          bibliothèques : marked (markdown, licence MIT),
│                            pdf.js de Mozilla (PDF, licence Apache 2.0)
├── android/                 Projet Android qui emballe www/ dans une appli
│   ├── app/src/main/java/com/sohri/app/MainActivity.java
│   ├── app/src/main/res/    icône, couleurs, nom de l'appli
│   ├── app/build.gradle.kts numéro de version, SDK, dépendances
│   └── keystore/            clé de signature : À CONSERVER (voir plus bas), jamais sur GitHub
├── firebase/                partage : règles de sécurité de la base (firestore.rules), réglages
│                            de l'émulateur pour les essais (firebase.json)
├── tools/build-web.js       prépare la version web dans _site/ (liste des fichiers hors connexion)
├── .github/workflows/       mise en ligne automatique de la version web (GitHub Pages)
├── dist/                    APK générés
├── build-apk.bat            double-clic : construit l'APK
└── build-apk.ps1            script appelé par build-apk.bat
```

## Modifier l'appli

1. Modifier les fichiers de `www/`. Pour un essai sur PC : `node tools/build-web.js`, puis
   `npx serve _site` et ouvrir l'adresse indiquée dans Chrome (les fonctions propres à Android,
   comme le bouton retour, n'y sont pas).
2. **iPhone** : envoyer les modifications sur GitHub (`git commit`, puis `git push`). GitHub met la
   version web à jour tout seul en une minute environ (onglet « Actions » du dépôt) ; l'iPhone
   propose ensuite « Mettre à jour ».
3. **Android** : augmenter `versionCode` (et `versionName`) dans `android/app/build.gradle.kts`,
   double-cliquer `build-apk.bat` (le nouvel APK arrive dans `dist/`) et l'installer par-dessus
   l'ancien.

Le nom affiché sous l'icône se trouve dans `android/app/src/main/res/values/strings.xml`. Avec un
téléphone branché en USB (débogage USB activé), `build-apk.ps1 -Install` construit et installe
directement.

## ⚠ La clé de signature

`android/keystore/` contient la clé qui signe l'APK (`sohri-release.jks`, mots de passe dans
`keystore.properties`). Android n'accepte une mise à jour que si elle est signée avec la même clé.
Si elle est perdue, il faudra désinstaller l'appli pour installer une nouvelle version, et donc
perdre toutes les données (sauf sauvegarde).

Ce dossier est dans OneDrive, donc sauvegardé. Ne pas le supprimer et ne pas le partager : il est
exclu du dépôt GitHub (`.gitignore`), qui est public.

## Compiler sur un autre PC

`build-apk.ps1` trouve tout seul :

- un **JDK 17 ou plus récent** (ici Microsoft OpenJDK 21, installé avec Visual Studio) ;
- le **SDK Android** avec `platforms;android-36` et `build-tools;36.0.0` (ici celui de Visual
  Studio, dans `C:\Program Files (x86)\Android\android-sdk`). Sur un autre PC, le plus simple est
  d'installer Android Studio.

Gradle se télécharge tout seul au premier lancement (dans `%USERPROFILE%\.gradle`). Comme le
projet est dans OneDrive, les fichiers de compilation temporaires sont placés dans
`%LOCALAPPDATA%\Sohri`, hors synchronisation. On peut supprimer ce dossier sans risque.

## Fonctionnement technique

`MainActivity` affiche `www/` dans une WebView, servi localement à l'adresse
`https://appassets.androidplatform.net/` (`WebViewAssetLoader`). Les données sont dans IndexedDB
(magasins `notes`, `addresses`, `settings`, `folders` pour les dossiers et les albums, `photos`,
`documents` pour la description des fichiers et `documentFiles` pour leur contenu ; pour le
partage, hors sauvegardes : `cloud`, `sharedAlbums`, `sharedPhotos`). L'appli Android ajoute ce
qu'une WebView ne fait pas seule :

| Côté Android                               | Côté page (`window.AndroidBridge` et fonctions globales)                  |
|--------------------------------------------|---------------------------------------------------------------------------|
| sélecteur de photos, sélecteur de fichiers | `<input type="file">`                                                     |
| ouverture de liens (Maps, site, téléphone) | `openExternal(url)`                                                       |
| ouvrir / partager / « enregistrer sous »   | `fileBegin(nom, type)`, `fileAppend(id, base64)`, `fileFinish(id, action)` |
| presse-papiers                             | `copyText(texte)`                                                         |
| envoi d'un texte (invitation au partage)   | `shareText(texte)`                                                        |
| thème choisi et thème du téléphone         | `getThemePreference()`, `setThemePreference()`, `isSystemDark()` ; `onSystemThemeChanged(sombre)` |
| barres système et clavier                  | `getSafeAreaInsets()` ; `setSafeAreaInsets(haut, droite, bas, gauche)` → variables CSS `--safe-*` |
| vidéo en plein écran                       | bouton ⛶ du lecteur vidéo (`onShowCustomView`)                            |
| bouton retour                              | `handleBackButton()` (true = géré par la page)                            |
| version                                    | `getAppVersion()`                                                         |

### Version web (iPhone)

Les mêmes fichiers `www/` sont publiés sur GitHub Pages par `.github/workflows/pages.yml` à chaque
`git push` qui les modifie. Avant la mise en ligne, `tools/build-web.js` copie `www/` dans `_site/`
et écrit dans `sw.js` la liste des fichiers et un numéro de version tiré de leur contenu.

Sans `window.AndroidBridge`, la page s'adapte (classe `is-web` sur `<html>`) :

- `sw.js` (service worker) copie tous les fichiers de l'appli au premier lancement, puis les sert
  depuis cette copie : l'appli démarre et affiche les PDF sans connexion. Quand le numéro de
  version change, la nouvelle copie se prépare en arrière-plan et un bandeau propose de recharger ;
- les fichiers à ouvrir, partager ou enregistrer passent par la feuille de partage du système
  (`navigator.share`) ; si la préparation a été trop longue, l'iPhone exige un nouveau toucher :
  une boîte « … est prêt » le demande. Sur ordinateur : nouvel onglet ou téléchargement ;
- le clavier de l'iPhone recouvre la page au lieu de la réduire : l'appli suit la partie visible
  de l'écran (`visualViewport` → variables CSS `--app-height`, `--app-top`) ;
- appli installée sur l'écran d'accueil (classe `ios-standalone`) : la barre d'état est
  transparente, une bande foncée la garde lisible ;
- le thème choisi est gardé dans `localStorage`.

### Partage (Firebase)

`cloud.js` utilise directement l'API web de Firebase (Authentication pour les comptes, Firestore
pour les données), sans bibliothèque. En ligne, chacun a son espace `users/{id}` (nom, code,
contacts, et ses albums partagés : `albums`, `photos` avec la miniature, `photoParts` pour la photo
en morceaux de moins de 1 Mo) ; `grants/{propriétaire}_{proche}` liste les rubriques qu'un membre
montre à un proche. Les suppressions laissent une trace datée : chaque téléphone ne demande que ce
qui a changé depuis sa dernière visite.

**Qui peut faire quoi** est décidé par le serveur, dans `firebase/firestore.rules` : chacun n'écrit
que chez lui, ne lit que ce qu'on lui a partagé, et l'inscription demande le code d'un membre.
Pour les installer après une modification (une fois connecté avec `npx firebase-tools login`) :

```
npx firebase-tools deploy --only firestore:rules --config firebase/firebase.json --project <identifiant du projet>
```

**Configuration** : `www/js/cloud-config.js` (`window.SOHRI_CLOUD = { apiKey, projectId }`) est
exclu du dépôt. En local, il sert à construire l'APK ; pour le site, GitHub l'écrit à partir du
secret `SOHRI_CLOUD_CONFIG` du dépôt (`{"apiKey": "...", "projectId": "..."}`). Cette clé n'est pas
un secret au sens strict (elle est visible dans toute appli web Firebase, et dans l'APK) : elle
identifie le projet, et ce sont les règles ci-dessus qui protègent les données. Sans ce fichier, la
rubrique Partage est simplement masquée.

**Essais** sans toucher au vrai projet : l'émulateur Firebase (il faut Java 21, par exemple celui
installé avec Android Studio) : `npx firebase-tools emulators:start --only auth,firestore --project
demo-sohri --config firebase/firebase.json`, puis, dans la page,
`window.SOHRI_CLOUD = { apiKey: 'demo', projectId: 'demo-sohri', emulator: { auth:
'http://127.0.0.1:9099', firestore: 'http://127.0.0.1:8085' } }` avant le chargement des scripts.
