# Design source — NEYA Craft Flow (Lovable)

**Preview :** https://neya-craft-flow.lovable.app  
**Repo (public) :** https://github.com/neyafurniture-lang/neya-craft-flow  

Référence visuelle officielle pour l’ERP (`neyafurniture-lang/erp`).

## Portage effectué

| Source Craft Flow | ERP |
|-------------------|-----|
| `src/styles.css` tokens | `frontend/app/globals.css` + `tailwind.config.js` |
| `src/components/app-shell.tsx` | `AppShell.js`, `Sidebar.js`, `MobileNav.js`, `NeyaMark.js` |
| `src/routes/login.tsx` | `frontend/app/login/page.js` (auth réelle conservée) |
| Urbanist + Epilogue | Google Fonts + CSS vars |
| Lucide icons | `lucide-react` |

## Suite (écran par écran)

Porter depuis Craft Flow en gardant les APIs ERP :

1. Dashboard (`routes/index.tsx`)
2. Courriel (`routes/mail.tsx`)
3. Production (`routes/production.tsx`)
4. Projets / Clients / Calendrier

Fiches Lovable : `docs/cahier-pages-lovable-une-par-une.md`
