# Brumeval — Donjons coop

Jeu de donjons en vue du dessus, jouable **en solo** (avec ou sans compagnons IA) ou **en coopération en ligne jusqu’à 4 joueurs**, directement dans le navigateur (PC, mobile, manette).

- 4 classes complémentaires : **Guerrier** (tank, vol de vie), **Rôdeur** (distance, roulade), **Mage** (zone, gel), **Clerc** (soins, boucliers, relève vite).
- Une vallée à explorer (brouillard de guerre, minicarte, carte complète, fontaine de soin au village).
- 3 donjons générés aléatoirement, de plusieurs étages chacun, avec un boss aux attaques annoncées à esquiver : Crypte Oubliée → Mines Hantées → Antre du Dragon.
- Coffres, potions, gemmes de puissance, cœurs de vitalité, niveaux.
- Coop : un allié à terre se relève si un coéquipier reste à côté de lui ; on change d’étage en se rassemblant sur l’escalier.
- Progression sauvegardée dans le navigateur (niveau de chaque classe, donjons terminés).

## Jouer

Le jeu est un site statique : il suffit de l’héberger (GitHub Pages, gratuit) ou de servir le dossier en local.

```bash
python3 -m http.server 8000
# puis ouvrir http://localhost:8000
```

> Ouvrir `index.html` directement (`file://`) ne marche pas : les modules JavaScript exigent un serveur.

### Publier gratuitement sur GitHub Pages

1. Sur GitHub : **Settings → Pages**.
2. *Source* : **Deploy from a branch**, branche `main`, dossier `/ (root)`.
3. Le jeu est en ligne quelques minutes plus tard à l’adresse `https://<utilisateur>.github.io/<dépôt>/`.

### Jouer en coop

1. Un joueur clique sur **Créer une partie** et partage le **code** (ou le lien d’invitation).
2. Les autres saisissent le code et cliquent sur **Rejoindre** (ou ouvrent le lien).
3. On peut rejoindre à tout moment ; un compagnon IA laisse sa place si le groupe est complet.

La connexion est **pair-à-pair (WebRTC)** via [PeerJS](https://peerjs.com/) et son serveur public gratuit de mise en relation : aucun serveur à payer ni à installer. L’ordinateur qui crée la partie fait office d’hôte. Sur certains réseaux très restrictifs (réseau d’entreprise, partage de connexion), la connexion directe peut échouer.

Pour tester la coop sur une seule machine, ajoutez `?local=1` à l’adresse dans deux onglets : les onglets communiquent alors directement entre eux, sans Internet.

## Commandes

| Action | Clavier / souris | Manette | Mobile |
|---|---|---|---|
| Se déplacer | ZQSD / WASD / flèches | stick gauche | pouce gauche |
| Viser / attaquer | souris + clic gauche | stick droit | pouce droit |
| Compétence 1 | clic droit / Espace | LB / LT | bouton |
| Compétence 2 | Maj / E | RB | bouton |
| Potion | R | X / Y | bouton |
| Carte | Tab / M | Select | bouton |
| Menu | Échap | Start | bouton ‖ |

## Structure

| Fichier | Rôle |
|---|---|
| `js/data.js` | Classes, ennemis, boss, donjons, équilibrage |
| `js/mapgen.js` | Génération déterministe de la vallée et des donjons |
| `js/sim.js` | Simulation (combat, IA ennemie, boss, objets, réanimation, changements de carte) — fait autorité chez l’hôte |
| `js/bot.js` | IA des compagnons |
| `js/client.js` | Côté client : interpolation des instantanés et prédiction du déplacement local |
| `js/net.js` | Transport réseau (PeerJS ou onglets locaux) |
| `js/render.js` | Rendu Canvas 2D, lumière, brouillard, interface |
| `js/input.js` | Clavier, souris, manette, tactile |
| `js/main.js` | Menus et boucle de jeu |
| `vendor/peerjs.min.js` | PeerJS 1.5.5 (licence MIT, voir `vendor/PEERJS-LICENSE`) |

Aucune étape de compilation, aucune dépendance à installer : tout est en JavaScript natif.
