# Tests automatiques de SOHRI

Avant de publier une modification, ces tests font le tour de l'appli comme le ferait une personne :
ils ouvrent l'appli dans un faux iPhone (Safari) et un faux téléphone Android, ajoutent des notes, des
photos et des documents, partagent entre deux comptes, coupent Internet… et vérifient chaque résultat.
Rien n'est envoyé sur le vrai serveur : le partage passe par l'**émulateur Firebase**, une copie
locale du serveur, lancée et arrêtée par les tests.

## Installer (une seule fois)

Il faut **Node.js** (20 ou plus récent), **Google Chrome** et **Java 21** (pour l'émulateur ; celui
installé avec Android Studio ou Visual Studio convient). Puis, dans ce dossier :

```
npm install
npm run setup
```

`npm run setup` télécharge le moteur de Safari (WebKit) utilisé pour les tests « iPhone ».

## Lancer

```
npm test                  tous les tests (environ 7 minutes)
node run.js 13 14         seulement les tests 13 et 14
node run.js partage       ceux dont le nom contient « partage »
```

Le résumé s'affiche à la fin ; les journaux et les captures d'écran sont dans `tests/out/`.

| Test | Ce qu'il vérifie |
|------|------------------|
| `01-regles-serveur` | règles de sécurité du serveur : qui peut lire et écrire quoi |
| `02-android` | l'appli Android : notes, adresses, images, sauvegarde, thème, bouton retour… |
| `03-documents` | rubrique Documents et visionneuse (PDF, images, vidéo, texte) |
| `04-version-web` | version iPhone : hors connexion, mises à jour, partage, appli installée |
| `05-partage` | comptes, invitations, contacts, Images partagées entre proches |
| `06-sessions` | connexion qui expire, mot de passe changé ailleurs |
| `07-commentaires` | descriptions, lieux et commentaires des photos |
| `08-images` | photos reçues qui s'affichent toujours (iPhone ↔ Android) |
| `09-images-appareils` | mes Images identiques sur tous mes appareils, envois croisés sans rien écraser, espace en ligne |
| `10-heure-mises-a-jour` | heure Japon / France, bandeau de nouvelle version Android |
| `11-taux-meteo` | taux du jour et météo (services simulés) |
| `12-sauvegardes` | sauvegarde iPhone restaurée sur Android, même transformée en route |
| `13-rubriques-appareils` | toutes mes rubriques (dépenses comprises) synchronisées entre mes appareils, appareil mis à jour depuis la 2.2 |
| `14-telecharger` | bouton « Télécharger » des photos (galerie Android, Photos sur iPhone), plusieurs d'un coup, album entier |
| `15-nouveautes` | convertisseur ⇄ et addition, Dépenses (totaux, export, sauvegarde), météo heure par heure, Phrases utiles, rappel de sauvegarde, rapport de diagnostic, témoin de synchronisation |

Les services publics (taux du jour, météo, GitHub) sont coupés ou simulés pendant les tests, pour
des résultats toujours identiques (`lib/block-external.js`). Un autre emplacement de Chrome se donne
avec la variable `CHROME_PATH`.
