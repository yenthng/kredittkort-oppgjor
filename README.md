# Kredittkort-oppgjør

En enkel nettleser-app for å laste opp og kategorisere kredittkorttransaksjoner fra SEB og Bank Norwegian.

## Filer

- `index.html` - selve nettsiden
- `styles.css` - styling
- `app.js` - all funksjonalitet

## Publisering på GitHub Pages

1. Opprett et nytt repository på GitHub, for eksempel `kredittkort-oppgjor`.
2. Opprett disse tre filene i repositoryet:
   - `index.html`
   - `styles.css`
   - `app.js`
3. Lim inn innholdet fra filene med samme navn.
4. Gå til `Settings` → `Pages`.
5. Velg `Deploy from a branch`.
6. Velg branch `main` og folder `/ (root)`.
7. Trykk `Save`.

Etter litt tid får du en URL som ligner:

`https://brukernavn.github.io/kredittkort-oppgjor/`

## Viktig om data

Transaksjoner og regler lagres lokalt i nettleseren med `localStorage`.
De sendes ikke til GitHub eller en server.

Det betyr at data ikke automatisk deles mellom PC, Mac, iPad og mobil.
