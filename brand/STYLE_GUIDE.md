# Charte graphique NEYA — neyafurniture.ca

## Identité
- **Marque** : Neya Furnitures & More
- **Site** : https://neyafurniture.ca
- **Tagline** : FURNITURES & MORE

## Couleurs
| Nom | Hex | Usage |
|-----|-----|-------|
| Vert foncé | `#4D5446` | Sidebar, titres, texte principal |
| Orange brûlé | `#D86B30` | Accents, boutons, totaux PDF |
| Crème | `#F9F1EA` | Fond d'écran, surfaces secondaires |
| Bordure | `#E8DFD6` | Cartes, champs |
| Texte atténué | `#6B7264` | Labels, métadonnées |

## Typographie
- **Titres & corps** : Poppins (Google Fonts)
- Poids : 400 (corps), 600–800 (titres), 900 (accroches)

## Assets (`brand/assets/`)
- `logo-orange.png` — logo script orange (header PDF, sidebar, login)
- `wave-green.png` / `wave-orange.png` — bandeaux ondulés décoratifs
- `star-orange.png` — icône étoile/fleur orange
- `charte-graphique.png` — référence complète
- `elements/` — formes graphiques organiques

## Intégration ERP
- **Frontend** : classes Tailwind `neya-green`, `neya-orange`, `neya-cream` dans `tailwind.config.js`
- **PDF** : `backend/src/services/pdf.js` — en-tête avec logo + ligne orange
- **Public** : `frontend/public/brand/` — assets servis par Next.js
